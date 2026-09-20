import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  channelFollowers,
  overlayEvents,
  subscriptions,
  tokens,
  userTokens,
  users,
  type TokenAssignment,
  type TokenSource,
} from "@/db/schema";
import { levelForXp } from "@/lib/levels";

/** Ricalcola XP come somma dell'XP dei token posseduti; aggiorna la data livello solo se il livello sale. */
export async function recomputeXp(tx: Database, userId: string): Promise<void> {
  const [current] = await tx.select({ xp: users.xp }).from(users).where(eq(users.id, userId)).for("update");
  if (!current) return;
  const [{ total }] = await tx
    .select({ total: sql<number>`coalesce(sum(${tokens.xp}), 0)::int` })
    .from(userTokens)
    .innerJoin(tokens, eq(tokens.id, userTokens.tokenId))
    .where(eq(userTokens.userId, userId));
  const xp = Number(total);
  const levelUp = levelForXp(xp) > levelForXp(current.xp);
  await tx
    .update(users)
    .set(levelUp ? { xp, levelReachedAt: new Date() } : { xp })
    .where(eq(users.id, userId));
}

/** Fonti che generano l'animazione nell'overlay OBS. */
const OVERLAY_SOURCES: TokenSource[] = ["window", "channel_points"];

/**
 * Assegna un token a un utente. Idempotente: se lo possiede già non fa nulla.
 * Va chiamata dentro una transazione. Ritorna true se il token è stato aggiunto ora.
 */
export async function grantToken(
  tx: Database,
  input: { userId: string; tokenId: string; source: TokenSource; grantedBy?: string | null },
): Promise<boolean> {
  const inserted = await tx
    .insert(userTokens)
    .values({
      userId: input.userId,
      tokenId: input.tokenId,
      source: input.source,
      grantedBy: input.grantedBy ?? null,
    })
    .onConflictDoNothing()
    .returning({ tokenId: userTokens.tokenId });
  if (inserted.length === 0) return false;
  await recomputeXp(tx, input.userId);

  if (OVERLAY_SOURCES.includes(input.source)) await queueTokenOverlay(tx, input.userId, input.tokenId, input.source);
  return true;
}

async function queueTokenOverlay(tx: Database, userId: string, tokenId: string, source: TokenSource) {
  const [user] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId));
  if (user) await tx.insert(overlayEvents).values({ tokenId, displayName: user.displayName, source });
}

/**
 * Riscatto durante l'evento di un token già ottenuto con i punti canale (es. un follower
 * diventato abbonato): il token resta uno solo, ma la sua origine diventa "evento".
 * Ritorna false se l'utente non lo possiede tramite punti canale.
 */
export async function upgradeChannelPointsToken(tx: Database, userId: string, tokenId: string): Promise<boolean> {
  const updated = await tx
    .update(userTokens)
    .set({ source: "window", obtainedAt: new Date() })
    .where(
      and(eq(userTokens.userId, userId), eq(userTokens.tokenId, tokenId), eq(userTokens.source, "channel_points")),
    )
    .returning({ tokenId: userTokens.tokenId });
  if (updated.length === 0) return false;
  await queueTokenOverlay(tx, userId, tokenId, "window");
  return true;
}

/** Revoca un token (lo toglie anche dagli equipaggiati tramite FK). Va chiamata in transazione. */
export async function revokeToken(tx: Database, userId: string, tokenId: string): Promise<boolean> {
  const deleted = await tx
    .delete(userTokens)
    .where(sql`${userTokens.userId} = ${userId} and ${userTokens.tokenId} = ${tokenId}`)
    .returning({ tokenId: userTokens.tokenId });
  if (deleted.length === 0) return false;
  await recomputeXp(tx, userId);
  return true;
}

/** Assegnazioni automatiche: non hanno finestra di riscatto, valgono per uno stato del canale. */
const AUTOMATIC: TokenAssignment[] = ["subscriber", "follower"];

function isBroadcaster(twitchId: string): boolean {
  return twitchId === process.env.TWITCH_BROADCASTER_ID;
}

/** Stato del canale che dà diritto ai token automatici. */
export async function automaticAssignmentsFor(
  tx: Database,
  user: { twitchId: string },
): Promise<TokenAssignment[]> {
  if (isBroadcaster(user.twitchId)) return [...AUTOMATIC];

  const [[sub], [follower]] = await Promise.all([
    tx
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.twitchUserId, user.twitchId)),
    tx
      .select({ id: channelFollowers.twitchUserId })
      .from(channelFollowers)
      .where(eq(channelFollowers.twitchUserId, user.twitchId)),
  ]);

  const assignments: TokenAssignment[] = [];
  if (sub?.status === "active") assignments.push("subscriber");
  if (follower) assignments.push("follower");
  return assignments;
}

/**
 * Assegna i token automatici a cui l'utente ha diritto adesso: quelli per gli abbonati
 * e quelli per i follower. Chiamata al login e quando arriva una sub o un follow da EventSub.
 */
export async function grantAutomaticTokens(tx: Database, user: { id: string; twitchId: string }): Promise<number> {
  const assignments = await automaticAssignmentsFor(tx, user);
  if (assignments.length === 0) return 0;

  const automatic = await tx
    .select({ id: tokens.id, assignment: tokens.assignment })
    .from(tokens)
    .where(inArray(tokens.assignment, assignments));

  let granted = 0;
  for (const token of automatic) {
    if (await grantToken(tx, { userId: user.id, tokenId: token.id, source: token.assignment as TokenSource })) {
      granted++;
    }
  }
  return granted;
}

/**
 * Quando un admin crea (o converte) un token automatico, lo assegna in blocco
 * a tutti gli utenti già registrati che ne hanno diritto.
 */
export async function backfillAutomaticToken(
  tx: Database,
  token: { id: string; assignment: string },
): Promise<number> {
  if (token.assignment !== "subscriber" && token.assignment !== "follower") return 0;
  const broadcaster = process.env.TWITCH_BROADCASTER_ID ?? null;

  const eligible =
    token.assignment === "subscriber"
      ? await tx
          .selectDistinct({ id: users.id })
          .from(users)
          .leftJoin(subscriptions, eq(subscriptions.twitchUserId, users.twitchId))
          .where(
            or(
              eq(subscriptions.status, "active"),
              broadcaster ? eq(users.twitchId, broadcaster) : undefined,
            ),
          )
      : await tx
          .selectDistinct({ id: users.id })
          .from(users)
          .leftJoin(channelFollowers, eq(channelFollowers.twitchUserId, users.twitchId))
          .where(
            or(
              sql`${channelFollowers.twitchUserId} is not null`,
              broadcaster ? eq(users.twitchId, broadcaster) : undefined,
            ),
          );

  let granted = 0;
  const CHUNK = 500;
  for (let i = 0; i < eligible.length; i += CHUNK) {
    const inserted = await tx
      .insert(userTokens)
      .values(eligible.slice(i, i + CHUNK).map((u) => ({ userId: u.id, tokenId: token.id, source: token.assignment as TokenSource })))
      .onConflictDoNothing()
      .returning({ userId: userTokens.userId });
    for (const row of inserted) await recomputeXp(tx, row.userId);
    granted += inserted.length;
  }
  return granted;
}

/** Dopo aver cambiato l'XP di un token: riallinea tutti i suoi possessori. */
export async function recomputeHoldersXp(tx: Database, tokenId: string): Promise<void> {
  const holders = await tx.select({ userId: userTokens.userId }).from(userTokens).where(eq(userTokens.tokenId, tokenId));
  for (const { userId } of holders) await recomputeXp(tx, userId);
}
