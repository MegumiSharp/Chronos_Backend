import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  equippedTokens,
  subscriptions,
  tokens,
  tokenVariants,
  userTokens,
  users,
  type Token,
  type TokenAssignment,
  type TokenSource,
  type TokenVariant,
} from "@/db/schema";
import { artworkSources, type ArtworkSources } from "./artwork";
import { levelForXp } from "./levels";
import { matteColor } from "./color";
import { formatDate, formatDateTime } from "./time";

export const MAX_EQUIPPED = 8;

/**
 * - automatic: token signup/moderator/manual, senza finestra
 * - draft: finestra non ancora programmata
 * - scheduled / open / closed: stato della finestra di riscatto
 */
export type TokenState = "automatic" | "draft" | "scheduled" | "open" | "closed";

export function tokenState(token: Pick<Token, "assignment" | "redeemOpensAt" | "redeemClosesAt">, now = new Date()): TokenState {
  if (token.assignment !== "window") return "automatic";
  if (!token.redeemOpensAt) return "draft";
  if (token.redeemOpensAt > now) return "scheduled";
  if (token.redeemClosesAt && token.redeemClosesAt <= now) return "closed";
  return "open";
}

export function isVisibleInCatalog(token: Token, now = new Date()): boolean {
  // I segreti restano nell'archivio, ma coperti: vedi maskSecret.
  if (token.isSecret) return true;
  const state = tokenState(token, now);
  if (state === "draft") return false;
  if (token.hiddenUntilOpen && state === "scheduled") return false;
  return true;
}

/**
 * Versione coperta di un token segreto per chi non ce l'ha: nome, descrizione e artwork
 * non escono dal server, così il segreto non si legge nel sorgente della pagina.
 */
export function maskSecret(item: CollectionItem, labels: { name: string; description: string }): CollectionItem {
  if (!item.isSecret || item.owned) return item;
  return {
    ...item,
    name: labels.name,
    description: labels.description,
    flavourText: null,
    artwork: null,
    eventLabel: null,
    eventColor: null,
    eventDescription: null,
    eventDateLabel: null,
    artist: null,
    variants: [],
    accent: null,
    // L'indizio è l'unica cosa che di un segreto può uscire dal server.
    secretHint: item.secretHint,
  };
}

/** Dati serializzabili per i Client Component. Il codice di riscatto non esce mai dal server. */
/** Numero massimo di varianti grafiche per token. */
export const MAX_VARIANTS = 5;

export type TokenVariantView = {
  id: string;
  position: number;
  label: string | null;
  artwork: ArtworkSources | null;
  accent: string | null;
};

export function toVariantView(variant: TokenVariant): TokenVariantView {
  return {
    id: variant.id,
    position: variant.position,
    label: variant.label,
    artwork: artworkSources(variant.artworkKey),
    accent: matteColor(variant.accentColor),
  };
}

export type TokenView = {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Riga d'atmosfera sotto il nome, facoltativa. */
  flavourText: string | null;
  eventLabel: string | null;
  /** Colore matte del tipo di evento, scelto dal pannello Manager. */
  eventColor: string | null;
  /** Come si ottengono i token di quel tipo: tooltip sul tag. */
  eventDescription: string | null;
  eventDateLabel: string | null;
  artwork: ArtworkSources | null;
  assignment: TokenAssignment;
  state: TokenState;
  opensAt: string | null;
  opensAtLabel: string | null;
  closesAt: string | null;
  requiresCode: boolean;
  xp: number;
  /** Colore predominante in versione matte (#rrggbb), per bordi e bagliori. */
  accent: string | null;
  /** Token segreto: si ottiene solo con il codice e nell'archivio resta coperto. */
  isSecret: boolean;
  /** Indizio mostrato in archivio a chi non l'ha ancora sbloccato. */
  secretHint: string | null;
  /** Autore dell'artwork, mostrato come pillola nel popup. */
  artist: { name: string; url: string | null } | null;
  /** Varianti grafiche selezionabili da chi possiede il token. */
  variants: TokenVariantView[];
};

export function toTokenView(token: Token, now = new Date(), variants: TokenVariant[] = []): TokenView {
  return {
    id: token.id,
    slug: token.slug,
    name: token.name,
    description: token.description,
    flavourText: token.flavourText,
    eventLabel: token.eventLabel,
    eventColor: matteColor(token.eventColor),
    eventDescription: token.eventDescription,
    eventDateLabel: token.eventDate ? formatDate(token.eventDate) : null,
    artwork: artworkSources(token.artworkKey),
    assignment: token.assignment,
    state: tokenState(token, now),
    opensAt: token.redeemOpensAt?.toISOString() ?? null,
    opensAtLabel: token.redeemOpensAt ? formatDateTime(token.redeemOpensAt) : null,
    closesAt: token.redeemClosesAt?.toISOString() ?? null,
    requiresCode: Boolean(token.redeemCode),
    xp: token.xp,
    accent: matteColor(token.accentColor),
    isSecret: token.isSecret,
    secretHint: token.secretHint,
    artist: token.artistName ? { name: token.artistName, url: token.artistUrl } : null,
    variants: variants.map(toVariantView),
  };
}

/** Varianti di più token in un colpo solo, raggruppate per token e ordinate per posizione. */
export async function getVariantsByToken(tokenIds: string[]): Promise<Map<string, TokenVariant[]>> {
  const map = new Map<string, TokenVariant[]>();
  if (tokenIds.length === 0) return map;
  const rows = await db
    .select()
    .from(tokenVariants)
    .where(inArray(tokenVariants.tokenId, tokenIds))
    .orderBy(asc(tokenVariants.position));
  for (const row of rows) {
    const list = map.get(row.tokenId) ?? [];
    list.push(row);
    map.set(row.tokenId, list);
  }
  return map;
}

/** Token con finestra aperta adesso, il primo a scadere per primo. */
export async function getOpenTokens(now = new Date()): Promise<Token[]> {
  return db
    .select()
    .from(tokens)
    .where(
      and(
        eq(tokens.assignment, "window"),
        // I segreti non si annunciano: si ottengono solo con il codice.
        eq(tokens.isSecret, false),
        isNotNull(tokens.redeemOpensAt),
        lte(tokens.redeemOpensAt, now),
        or(isNull(tokens.redeemClosesAt), gt(tokens.redeemClosesAt, now)),
      ),
    )
    .orderBy(sql`${tokens.redeemClosesAt} asc nulls last`);
}

/** Token già rilasciati (finestra aperta almeno una volta): scelta dei premi punti canale e pool casuale. */
export async function getReleasedTokens(now = new Date()): Promise<Token[]> {
  return db
    .select()
    .from(tokens)
    .where(and(eq(tokens.assignment, "window"), isNotNull(tokens.redeemOpensAt), lte(tokens.redeemOpensAt, now)))
    .orderBy(desc(tokens.redeemOpensAt));
}

/** Token che si possono mettere in palio con i punti canale: rilasciati e non esclusi dal casuale. */
export async function getRewardableTokens(now = new Date()): Promise<Token[]> {
  return (await getReleasedTokens(now)).filter((t) => !t.excludeFromRandom);
}

export async function getNextScheduledToken(now = new Date()): Promise<Token | null> {
  const [next] = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.assignment, "window"), gt(tokens.redeemOpensAt, now), eq(tokens.hiddenUntilOpen, false)))
    .orderBy(asc(tokens.redeemOpensAt))
    .limit(1);
  return next ?? null;
}

/** Catalogo pubblico, dal più recente. */
export async function getCatalog(now = new Date()): Promise<Token[]> {
  const all = await db
    .select()
    .from(tokens)
    .orderBy(desc(sql`coalesce(${tokens.eventDate}, ${tokens.redeemOpensAt}, ${tokens.createdAt})`));
  return all.filter((t) => isVisibleInCatalog(t, now));
}

export type OwnedInfo = { obtainedAt: Date; source: TokenSource; variantId: string | null };

/** Etichette del pannello Manager, che resta in italiano. Il sito pubblico usa il dizionario i18n. */
export const SOURCE_LABELS: Record<TokenSource, string> = {
  window: "Riscattato durante l'evento",
  subscriber: "Abbonato al canale",
  follower: "Follower del canale",
  manual: "Assegnato dallo staff",
  channel_points: "Riscattato tramite punti canale",
};

/** Token visto da un utente specifico: possesso ed evidenza. */
export type CollectionItem = TokenView & {
  owned: boolean;
  obtainedAtLabel: string | null;
  /** Come è stato ottenuto: l'etichetta viene tradotta nel componente. */
  source: TokenSource | null;
  /** Mostra il pallino e il tag "Reward Rupie". */
  viaChannelPoints: boolean;
  equipped: boolean;
  /** Variante scelta dall'utente; null = artwork principale. */
  variantId: string | null;
};

export function toCollectionItem(
  token: Token,
  owned: Map<string, OwnedInfo>,
  equippedIds: string[],
  now = new Date(),
  variants: TokenVariant[] = [],
): CollectionItem {
  const info = owned.get(token.id);
  const view = toTokenView(token, now, variants);
  /*
   * Assegnazione a mano: il tag "Assegnata dallo staff" si può spegnere sulla singola
   * medaglia. Qui, dove passano tutte le letture, così non resta da nascondere in ogni vista.
   */
  const hideSource = info?.source === "manual" && !token.showManualTag;
  // La variante scelta sostituisce artwork e colore ovunque il token venga mostrato.
  const chosen = info?.variantId ? view.variants.find((v) => v.id === info.variantId) : undefined;
  return {
    ...view,
    artwork: chosen?.artwork ?? view.artwork,
    accent: chosen?.accent ?? view.accent,
    variantId: info?.variantId ?? null,
    owned: Boolean(info),
    obtainedAtLabel: info ? formatDate(info.obtainedAt) : null,
    source: hideSource ? null : (info?.source ?? null),
    viaChannelPoints: info?.source === "channel_points",
    equipped: equippedIds.includes(token.id),
  };
}

/** Token per id, nell'ordine richiesto. */
export async function getTokensByIds(ids: string[]): Promise<Token[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(tokens).where(inArray(tokens.id, ids));
  const byId = new Map(rows.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is Token => Boolean(t));
}

export async function getOwnedTokens(userId: string): Promise<Map<string, OwnedInfo>> {
  const rows = await db
    .select({
      tokenId: userTokens.tokenId,
      obtainedAt: userTokens.obtainedAt,
      source: userTokens.source,
      variantId: userTokens.variantId,
    })
    .from(userTokens)
    .where(eq(userTokens.userId, userId));
  return new Map(
    rows.map((r) => [r.tokenId, { obtainedAt: r.obtainedAt, source: r.source, variantId: r.variantId }]),
  );
}

/**
 * Medaglie già ottenute ma mai annunciate a chi le possiede: tipicamente quelle assegnate
 * a mano o arrivate da EventSub mentre non era sul sito. Al primo accesso diventano un popup.
 * Le medaglie riscattate dal sito vengono segnate come viste nello stesso momento in cui
 * compare il popup di congratulazioni, quindi non ricompaiono.
 */
export async function getUnseenTokens(userId: string, now = new Date()): Promise<TokenView[]> {
  const rows = await db
    .select({ token: tokens })
    .from(userTokens)
    .innerJoin(tokens, eq(tokens.id, userTokens.tokenId))
    .where(and(eq(userTokens.userId, userId), isNull(userTokens.seenAt)))
    .orderBy(asc(userTokens.obtainedAt))
    // Se ne sono arrivate tante in una volta si annunciano le prime: il resto è in collezione.
    .limit(5);
  return rows.map((row) => toTokenView(row.token, now));
}

export async function getEquippedTokenIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ tokenId: equippedTokens.tokenId })
    .from(equippedTokens)
    .where(eq(equippedTokens.userId, userId))
    .orderBy(asc(equippedTokens.slot));
  return rows.map((r) => r.tokenId);
}

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  level: number;
  active: boolean;
  equipped: TokenView[];
};

const LEADERBOARD_ORDER = [desc(users.xp), sql`${users.levelReachedAt} asc nulls last`, asc(users.createdAt)] as const;

/**
 * Chi entra in classifica: serve XP, essere (o essere stato) abbonato e non essere lo streamer.
 * Chi segue soltanto il canale non ha livelli né classifica; lo streamer ha accesso a tutto,
 * quindi in classifica non avrebbe senso.
 */
function inLeaderboard() {
  const broadcaster = process.env.TWITCH_BROADCASTER_ID;
  const everSubscribed = sql`exists (select 1 from ${subscriptions} where ${subscriptions.twitchUserId} = ${users.twitchId})`;
  return and(gt(users.xp, 0), everSubscribed, broadcaster ? ne(users.twitchId, broadcaster) : undefined);
}

/** Token in evidenza dei profili indicati, nell'ordine degli slot. */
async function equippedByUser(userIds: string[], now: Date): Promise<Map<string, TokenView[]>> {
  const map = new Map<string, TokenView[]>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({ userId: equippedTokens.userId, token: tokens })
    .from(equippedTokens)
    .innerJoin(tokens, eq(tokens.id, equippedTokens.tokenId))
    .where(inArray(equippedTokens.userId, userIds))
    .orderBy(asc(equippedTokens.slot));
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push(toTokenView(row.token, now));
    map.set(row.userId, list);
  }
  return map;
}

const leaderboardColumns = {
  id: users.id,
  twitchId: users.twitchId,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  xp: users.xp,
  levelReachedAt: users.levelReachedAt,
  createdAt: users.createdAt,
  subStatus: subscriptions.status,
};

type LeaderboardRow = {
  id: string;
  twitchId: string;
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  subStatus: "active" | "ended" | null;
};

function toEntry(row: LeaderboardRow, rank: number, equipped: TokenView[]): LeaderboardEntry {
  return {
    rank,
    userId: row.id,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    xp: row.xp,
    level: levelForXp(row.xp),
    active: row.subStatus === "active" || row.twitchId === process.env.TWITCH_BROADCASTER_ID,
    equipped,
  };
}

export async function getLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  const rows = await db
    .select(leaderboardColumns)
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.twitchUserId, users.twitchId))
    .where(inLeaderboard())
    .orderBy(...LEADERBOARD_ORDER)
    .limit(limit);

  const now = new Date();
  const equipped = await equippedByUser(
    rows.map((r) => r.id),
    now,
  );
  return rows.map((row, index) => toEntry(row, index + 1, equipped.get(row.id) ?? []));
}

/**
 * Riga di classifica di un singolo utente, con la sua posizione reale.
 * Serve a mostrare a chi è fuori dai primi 100 dove si trova, senza caricare tutta la classifica.
 */
export async function getLeaderboardEntryFor(userId: string): Promise<LeaderboardEntry | null> {
  const [row] = await db
    .select(leaderboardColumns)
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.twitchUserId, users.twitchId))
    .where(eq(users.id, userId));
  if (!row || row.xp <= 0 || !row.subStatus) return null;
  if (row.twitchId === process.env.TWITCH_BROADCASTER_ID) return null;

  // Stesso criterio dell'ORDER BY: XP decrescenti, poi chi ha raggiunto il livello prima.
  // 'infinity' emula il "nulls last" all'interno del confronto tra tuple.
  const [{ ahead }] = await db
    .select({ ahead: count() })
    .from(users)
    .where(
      and(
        inLeaderboard(),
        sql`(
        ${users.xp} > ${row.xp}
        or (
          ${users.xp} = ${row.xp}
          and (coalesce(${users.levelReachedAt}, 'infinity'::timestamptz), ${users.createdAt})
            < (coalesce(${row.levelReachedAt}::timestamptz, 'infinity'::timestamptz), ${row.createdAt}::timestamptz)
        )
      )`,
      ),
    );

  const now = new Date();
  const equipped = await equippedByUser([row.id], now);
  return toEntry(row, Number(ahead) + 1, equipped.get(row.id) ?? []);
}

/** Id dei primi tre in classifica, in ordine: serve per la coroncina sul profilo. */
export async function getPodiumUserIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inLeaderboard())
    .orderBy(...LEADERBOARD_ORDER)
    .limit(3);
  return rows.map((r) => r.id);
}
