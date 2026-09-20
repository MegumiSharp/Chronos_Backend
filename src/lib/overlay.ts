import { randomBytes, timingSafeEqual } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { db as defaultDb, type Database } from "@/db";
import { equippedTokens, overlayEvents, tokens, userTokens, users } from "@/db/schema";
import { appUrl } from "./env";
import { getSetting, setSetting, SETTING_KEYS } from "./settings";

/** Chiave segreta nell'URL della browser source OBS: chi non la conosce non vede gli eventi. */
export async function getOverlayKey(db: Database): Promise<string | null> {
  return getSetting<string>(db, SETTING_KEYS.overlayKey);
}

export async function rotateOverlayKey(db: Database): Promise<string> {
  const key = randomBytes(24).toString("base64url");
  await setSetting(db, SETTING_KEYS.overlayKey, key);
  return key;
}

export async function ensureOverlayKey(db: Database): Promise<string> {
  return (await getOverlayKey(db)) ?? rotateOverlayKey(db);
}

export async function isValidOverlayKey(db: Database, candidate: string): Promise<boolean> {
  const key = await getOverlayKey(db);
  if (!key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function overlayUrl(key: string): string {
  return `${appUrl()}/overlay/${key}`;
}

/** Overlay dedicato agli abbonamenti: stessa chiave segreta, percorso diverso. */
export function subOverlayUrl(key: string): string {
  return `${appUrl()}/overlay/${key}/sub`;
}

/** Token da mostrare nell'animazione sub: il preferito, altrimenti l'ultimo ottenuto, altrimenti il default. */
async function tokenForSubscriber(twitchUserId: string): Promise<string | null> {
  const [user] = await defaultDb.select({ id: users.id }).from(users).where(eq(users.twitchId, twitchUserId));

  if (user) {
    const [favourite] = await defaultDb
      .select({ tokenId: equippedTokens.tokenId })
      .from(equippedTokens)
      .where(eq(equippedTokens.userId, user.id))
      .orderBy(asc(equippedTokens.slot))
      .limit(1);
    if (favourite) return favourite.tokenId;

    const [latest] = await defaultDb
      .select({ tokenId: userTokens.tokenId })
      .from(userTokens)
      .where(eq(userTokens.userId, user.id))
      .orderBy(desc(userTokens.obtainedAt))
      .limit(1);
    if (latest) return latest.tokenId;
  }

  // Ripiego: il token assegnato automaticamente agli abbonati (il Default Token del canale).
  const [fallback] = await defaultDb
    .select({ id: tokens.id })
    .from(tokens)
    .where(eq(tokens.assignment, "subscriber"))
    .orderBy(asc(tokens.createdAt))
    .limit(1);
  return fallback?.id ?? null;
}

/** Mette in coda l'animazione dell'overlay abbonamenti: nome, mesi, tier e token preferito. */
export async function queueSubscriptionOverlay(input: {
  twitchUserId: string;
  displayName: string;
  tier: string;
  months: number | null;
}): Promise<void> {
  await defaultDb.insert(overlayEvents).values({
    kind: "subscription",
    tokenId: await tokenForSubscriber(input.twitchUserId),
    displayName: input.displayName,
    months: input.months,
    tier: input.tier,
  });
}
