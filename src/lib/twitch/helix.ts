import { eq } from "drizzle-orm";
import { db } from "@/db";
import { botAuth, broadcasterAuth } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";

const HELIX = "https://api.twitch.tv/helix";
const OAUTH = "https://id.twitch.tv/oauth2";

/** Permessi richiesti al broadcaster (una sola volta, dal pannello admin). */
export const BROADCASTER_SCOPES = [
  "channel:read:subscriptions",
  "channel:manage:redemptions",
  "moderation:read",
  // Elenco dei follower e EventSub channel.follow (v2): servono per i token riservati ai follower.
  "moderator:read:followers",
  // Ripiego del bot in chat quando non è collegato un account dedicato: scrive lo streamer.
  "user:write:chat",
] as const;

/** Permessi dell'account bot: gli serve solo scrivere in chat. */
export const BOT_SCOPES = ["user:write:chat", "user:bot"] as const;

export class TwitchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

const clientId = () => requireEnv("AUTH_TWITCH_ID");
const clientSecret = () => requireEnv("AUTH_TWITCH_SECRET");
export const broadcasterId = () => requireEnv("TWITCH_BROADCASTER_ID");

type OAuthTokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string[] | string };

async function oauthToken(params: Record<string, string>): Promise<OAuthTokenResponse> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) throw new TwitchApiError(`OAuth token: ${res.status}`, res.status, body);
  return JSON.parse(body) as OAuthTokenResponse;
}

// --- App access token (EventSub webhook, lookup utenti) ------------------------------

let appToken: { value: string; expiresAt: number } | undefined;

async function getAppToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && appToken && appToken.expiresAt - 60_000 > Date.now()) return appToken.value;
  const token = await oauthToken({ grant_type: "client_credentials" });
  appToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  return appToken.value;
}

// --- User access token del broadcaster (sub, moderatori, punti canale) ---------------

/** Scambia il codice OAuth e legge a chi appartiene il token: vale per broadcaster e per il bot. */
export async function exchangeBroadcasterCode(code: string, redirectUri: string) {
  const token = await oauthToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  const res = await fetch(`${OAUTH}/validate`, {
    headers: { Authorization: `OAuth ${token.access_token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new TwitchApiError("Validazione token fallita", res.status, await res.text());
  const info = (await res.json()) as { user_id: string; login: string; scopes: string[] };
  return { token, info };
}

export async function saveBroadcasterToken(input: {
  twitchId: string;
  twitchLogin: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresIn: number;
}) {
  const values = {
    id: 1,
    twitchId: input.twitchId,
    twitchLogin: input.twitchLogin,
    accessTokenEnc: encryptSecret(input.accessToken),
    refreshTokenEnc: encryptSecret(input.refreshToken),
    scopes: input.scopes,
    expiresAt: new Date(Date.now() + input.expiresIn * 1000),
    updatedAt: new Date(),
  };
  await db.insert(broadcasterAuth).values(values).onConflictDoUpdate({ target: broadcasterAuth.id, set: values });
}

async function getBroadcasterToken(forceRefresh = false): Promise<string> {
  const [row] = await db.select().from(broadcasterAuth).where(eq(broadcasterAuth.id, 1));
  if (!row) throw new Error("Account broadcaster non collegato: collegalo da Admin → Integrazione Twitch.");
  return validOrRefreshed(row, forceRefresh, saveBroadcasterToken);
}

// --- Account bot: token dell'account secondario che scrive in chat ---------------------

export async function saveBotToken(input: {
  twitchId: string;
  twitchLogin: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresIn: number;
}) {
  const values = {
    id: 1,
    twitchId: input.twitchId,
    twitchLogin: input.twitchLogin,
    accessTokenEnc: encryptSecret(input.accessToken),
    refreshTokenEnc: encryptSecret(input.refreshToken),
    scopes: input.scopes,
    expiresAt: new Date(Date.now() + input.expiresIn * 1000),
    updatedAt: new Date(),
  };
  await db.insert(botAuth).values(values).onConflictDoUpdate({ target: botAuth.id, set: values });
}

export type BotConnection = { twitchId: string; twitchLogin: string; scopes: string[]; updatedAt: Date };

/** Account bot collegato, se c'è. Non legge i token: serve solo a mostrarlo nel pannello. */
export async function getBotConnection(): Promise<BotConnection | null> {
  const [row] = await db
    .select({
      twitchId: botAuth.twitchId,
      twitchLogin: botAuth.twitchLogin,
      scopes: botAuth.scopes,
      updatedAt: botAuth.updatedAt,
    })
    .from(botAuth);
  return row ?? null;
}

export async function deleteBotAuth(): Promise<void> {
  await db.delete(botAuth);
}

/** Scollega l'account del canale: i token cifrati spariscono e Helix smette di funzionare. */
export async function deleteBroadcasterAuth(): Promise<void> {
  await db.delete(broadcasterAuth);
}

async function getBotToken(forceRefresh = false): Promise<string> {
  const [row] = await db.select().from(botAuth).where(eq(botAuth.id, 1));
  if (!row) throw new Error("Account bot non collegato: collegalo da Manager → Punti canale.");
  return validOrRefreshed(row, forceRefresh, saveBotToken);
}

type StoredAuth = {
  twitchId: string;
  twitchLogin: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  scopes: string[];
  expiresAt: Date;
};

/** Token ancora valido, altrimenti rinnovato col refresh token e risalvato. */
async function validOrRefreshed(
  row: StoredAuth,
  forceRefresh: boolean,
  save: (input: {
    twitchId: string;
    twitchLogin: string;
    accessToken: string;
    refreshToken: string;
    scopes: string[];
    expiresIn: number;
  }) => Promise<void>,
): Promise<string> {
  if (!forceRefresh && row.expiresAt.getTime() - 5 * 60_000 > Date.now()) return decryptSecret(row.accessTokenEnc);

  const token = await oauthToken({ grant_type: "refresh_token", refresh_token: decryptSecret(row.refreshTokenEnc) });
  await save({
    twitchId: row.twitchId,
    twitchLogin: row.twitchLogin,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? decryptSecret(row.refreshTokenEnc),
    scopes: Array.isArray(token.scope) ? token.scope : row.scopes,
    expiresIn: token.expires_in,
  });
  return token.access_token;
}

// --- Chiamate Helix ------------------------------------------------------------------

type Auth = "app" | "broadcaster" | "bot";

async function helix<T>(auth: Auth, path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token =
    auth === "app"
      ? await getAppToken(retried)
      : auth === "bot"
        ? await getBotToken(retried)
        : await getBroadcasterToken(retried);
  const res = await fetch(`${HELIX}${path}`, {
    ...init,
    headers: {
      "Client-Id": clientId(),
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (res.status === 401 && !retried) return helix<T>(auth, path, init, true);
  const body = await res.text();
  if (!res.ok) throw new TwitchApiError(`Helix ${init.method ?? "GET"} ${path}: ${res.status}`, res.status, body);
  return (body ? JSON.parse(body) : {}) as T;
}

type Page<T> = { data: T[]; pagination?: { cursor?: string } };

async function paginate<T>(auth: Auth, path: string): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await helix<Page<T>>(auth, `${path}${sep}first=100${cursor ? `&after=${cursor}` : ""}`);
    all.push(...page.data);
    cursor = page.pagination?.cursor;
  } while (cursor);
  return all;
}

export type HelixUser = { id: string; login: string; display_name: string; profile_image_url: string };

/** Profilo dell'utente che ha appena fatto login (token utente, nessuno scope richiesto). */
export async function getUserWithUserToken(accessToken: string): Promise<HelixUser> {
  const res = await fetch(`${HELIX}/users`, {
    headers: { "Client-Id": clientId(), Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new TwitchApiError("Helix /users", res.status, await res.text());
  const { data } = (await res.json()) as Page<HelixUser>;
  return data[0];
}

export async function getUsersByLogin(logins: string[]): Promise<HelixUser[]> {
  if (logins.length === 0) return [];
  const query = logins.map((l) => `login=${encodeURIComponent(l.toLowerCase())}`).join("&");
  return (await helix<Page<HelixUser>>("app", `/users?${query}`)).data;
}

export async function getUserById(id: string): Promise<HelixUser | undefined> {
  return (await helix<Page<HelixUser>>("app", `/users?id=${encodeURIComponent(id)}`)).data[0];
}

export type HelixStream = {
  id: string;
  title: string;
  game_name: string;
  viewer_count: number;
  started_at: string;
};

/** Stream in corso del canale, se c'è. Usa l'app token: nessuno scope richiesto. */
export async function getStream(userId: string): Promise<HelixStream | undefined> {
  const { data } = await helix<Page<HelixStream>>("app", `/streams?user_id=${encodeURIComponent(userId)}`);
  return data[0];
}

export type HelixSubscription = { user_id: string; user_login: string; tier: string; is_gift: boolean };

export function getBroadcasterSubscriptions() {
  return paginate<HelixSubscription>("broadcaster", `/subscriptions?broadcaster_id=${broadcasterId()}`);
}

export type HelixFollower = { user_id: string; user_login: string; followed_at: string };

/** Follower del canale. Richiede lo scope moderator:read:followers sul token del broadcaster. */
export function getChannelFollowers() {
  return paginate<HelixFollower>("broadcaster", `/channels/followers?broadcaster_id=${broadcasterId()}`);
}

export function getModerators() {
  return paginate<{ user_id: string; user_login: string }>(
    "broadcaster",
    `/moderation/moderators?broadcaster_id=${broadcasterId()}`,
  );
}

export type HelixEventSubSubscription = {
  id: string;
  status: string;
  type: string;
  version: string;
  condition: Record<string, string>;
  transport: { method: string; callback?: string };
  created_at: string;
};

export function listEventSubSubscriptions() {
  return paginate<HelixEventSubSubscription>("app", "/eventsub/subscriptions");
}

export async function createEventSubSubscription(
  type: string,
  callback: string,
  secret: string,
  options: { version?: string; condition?: Record<string, string> } = {},
) {
  return helix<Page<HelixEventSubSubscription>>("app", "/eventsub/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      type,
      version: options.version ?? "1",
      condition: { broadcaster_user_id: broadcasterId(), ...options.condition },
      transport: { method: "webhook", callback, secret },
    }),
  });
}

export async function deleteEventSubSubscription(id: string) {
  await helix("app", `/eventsub/subscriptions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type CustomRewardInput = { title: string; cost: number; prompt: string; is_enabled: boolean };

export async function createCustomReward(input: CustomRewardInput) {
  const { data } = await helix<Page<{ id: string }>>(
    "broadcaster",
    `/channel_points/custom_rewards?broadcaster_id=${broadcasterId()}`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data[0];
}

export async function updateCustomReward(rewardId: string, input: Partial<CustomRewardInput>) {
  await helix(
    "broadcaster",
    `/channel_points/custom_rewards?broadcaster_id=${broadcasterId()}&id=${encodeURIComponent(rewardId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export async function deleteCustomReward(rewardId: string) {
  await helix(
    "broadcaster",
    `/channel_points/custom_rewards?broadcaster_id=${broadcasterId()}&id=${encodeURIComponent(rewardId)}`,
    { method: "DELETE" },
  );
}

/**
 * Messaggio nella chat del canale. Lo scrive l'account bot, se collegato;
 * altrimenti lo scrive lo streamer (ripiego, con il suo token).
 */
export async function sendChatMessage(message: string) {
  const bot = await getBotConnection();
  const sender = bot?.twitchId ?? broadcasterId();
  const { data } = await helix<Page<{ is_sent: boolean; drop_reason?: { message: string } | null }>>(
    bot ? "bot" : "broadcaster",
    "/chat/messages",
    { method: "POST", body: JSON.stringify({ broadcaster_id: broadcasterId(), sender_id: sender, message }) },
  );
  if (data[0] && !data[0].is_sent) throw new Error(`Messaggio scartato da Twitch: ${data[0].drop_reason?.message ?? "motivo ignoto"}`);
}

/** FULFILLED conferma, CANCELED rimborsa i punti all'utente. */
export async function updateRedemptionStatus(rewardId: string, redemptionId: string, status: "FULFILLED" | "CANCELED") {
  await helix(
    "broadcaster",
    `/channel_points/custom_rewards/redemptions?broadcaster_id=${broadcasterId()}&reward_id=${encodeURIComponent(rewardId)}&id=${encodeURIComponent(redemptionId)}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
  );
}
