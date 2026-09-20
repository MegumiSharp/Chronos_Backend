import { eq } from "drizzle-orm";
import { db, type Database } from "@/db";
import { channelFollowers, users } from "@/db/schema";
import { grantAutomaticTokens } from "./grants";

/**
 * Registra un follower e gli assegna subito i token riservati ai follower,
 * se si è già registrato su Chronos (altrimenti li riceve al primo accesso).
 */
export async function addFollower(input: {
  twitchUserId: string;
  twitchLogin?: string | null;
  followedAt?: Date | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .insert(channelFollowers)
      .values({
        twitchUserId: input.twitchUserId,
        twitchLogin: input.twitchLogin ?? null,
        followedAt: input.followedAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: channelFollowers.twitchUserId,
        set: { twitchLogin: input.twitchLogin ?? null, updatedAt: now },
      });

    const [user] = await tx.select({ id: users.id, twitchId: users.twitchId }).from(users).where(eq(users.twitchId, input.twitchUserId));
    if (user) await grantAutomaticTokens(tx, user);
  });
}

/** Un unfollow toglie il diritto ai token futuri, non quelli già ottenuti: restano un ricordo. */
export async function removeFollower(twitchUserId: string): Promise<void> {
  await db.delete(channelFollowers).where(eq(channelFollowers.twitchUserId, twitchUserId));
}

/** Follower del canale, letto dal database locale (EventSub + reconciliation). Lo streamer lo è sempre. */
export async function isFollower(tx: Database, twitchUserId: string): Promise<boolean> {
  if (twitchUserId === process.env.TWITCH_BROADCASTER_ID) return true;
  const [row] = await tx
    .select({ id: channelFollowers.twitchUserId })
    .from(channelFollowers)
    .where(eq(channelFollowers.twitchUserId, twitchUserId));
  return Boolean(row);
}
