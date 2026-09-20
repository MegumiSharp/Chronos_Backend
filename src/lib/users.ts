/**
 * L'utente del sito, creato al primo accesso con Twitch. È qui che si chiude il cerchio
 * dei riscatti punti canale fatti da chi non si era ancora registrato su Chronos.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channelPointRedemptions, channelPointRewards, users, type User } from "@/db/schema";
import { fulfillRedemption } from "./channel-points";
import { grantAutomaticTokens } from "./grants";
import { notifyRedemption } from "./twitch/handlers";
import { updateRedemptionStatus } from "./twitch/helix";

/** Crea o aggiorna l'utente al login (nome e avatar Twitch possono cambiare) e assegna i token automatici. */
export async function upsertUserOnLogin(input: {
  twitchId: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
}): Promise<User> {
  const user = await db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .insert(users)
      .values({ ...input, lastLoginAt: now })
      .onConflictDoUpdate({
        target: users.twitchId,
        set: { login: input.login, displayName: input.displayName, avatarUrl: input.avatarUrl, lastLoginAt: now },
      })
      .returning();
    await grantAutomaticTokens(tx, row);
    return row;
  });

  try {
    await processPendingRedemptions(user);
  } catch (error) {
    console.error("[punti canale] riscatti in attesa non elaborati", error);
  }
  return user;
}

/** Riscatti punti canale fatti prima di registrarsi: assegna il token (o rimborsa) e aggiorna Twitch. */
async function processPendingRedemptions(user: User): Promise<void> {
  const pending = await db
    .select({
      id: channelPointRedemptions.id,
      redemptionId: channelPointRedemptions.redemptionId,
      twitchRewardId: channelPointRedemptions.twitchRewardId,
      reward: channelPointRewards,
    })
    .from(channelPointRedemptions)
    .leftJoin(channelPointRewards, eq(channelPointRewards.id, channelPointRedemptions.rewardId))
    .where(and(eq(channelPointRedemptions.twitchUserId, user.twitchId), eq(channelPointRedemptions.status, "pending")));

  for (const item of pending) {
    const outcome = await fulfillRedemption(db, item.id, item.reward, user.id);
    await updateRedemptionStatus(
      item.twitchRewardId,
      item.redemptionId,
      outcome.status === "granted" ? "FULFILLED" : "CANCELED",
    ).catch((error) => console.error("[punti canale] aggiornamento Twitch fallito", error));
    await notifyRedemption(outcome, user.displayName, item.reward?.title ?? "");
  }
}
