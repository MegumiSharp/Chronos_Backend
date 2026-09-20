import { and, eq, isNotNull, lte, notInArray } from "drizzle-orm";
import type { Database } from "@/db";
import { channelPointRedemptions, channelPointRewards, tokens, users, userTokens } from "@/db/schema";
import { grantToken } from "./grants";

/** Numero massimo di premi punti canale gestiti da Chronos. */
export const MAX_CHANNEL_POINT_REWARDS = 5;

export type ChannelPointReward = typeof channelPointRewards.$inferSelect;
type RewardTarget = Pick<ChannelPointReward, "tokenId" | "isRandom">;

export type RedemptionOutcome =
  /** remaining: token ancora ottenibili con il premio casuale dopo questa assegnazione. */
  | { status: "granted"; tokenId: string; tokenName: string; remaining: number }
  | { status: "refunded"; note: string; reason: "all_owned" | "already_owned" | "reward_deleted"; tokenName?: string };

/** Token del premio casuale che l'utente non possiede: rilasciati, a finestra, non esclusi. */
async function randomPool(tx: Database, userId: string): Promise<string[]> {
  const owned = (await tx.select({ id: userTokens.tokenId }).from(userTokens).where(eq(userTokens.userId, userId))).map(
    (row) => row.id,
  );
  const pool = await tx
    .select({ id: tokens.id })
    .from(tokens)
    .where(
      and(
        eq(tokens.assignment, "window"),
        eq(tokens.excludeFromRandom, false),
        isNotNull(tokens.redeemOpensAt),
        lte(tokens.redeemOpensAt, new Date()),
        owned.length > 0 ? notInArray(tokens.id, owned) : undefined,
      ),
    );
  return pool.map((row) => row.id);
}

/** Token da assegnare: quello del premio, oppure uno casuale tra quelli che l'utente non possiede. */
export async function pickRewardToken(tx: Database, reward: RewardTarget, userId: string): Promise<string | null> {
  if (!reward.isRandom) {
    if (!reward.tokenId) return null;
    const [owned] = await tx
      .select({ id: userTokens.tokenId })
      .from(userTokens)
      .where(and(eq(userTokens.userId, userId), eq(userTokens.tokenId, reward.tokenId)));
    return owned ? null : reward.tokenId;
  }
  const pool = await randomPool(tx, userId);
  return pool.length === 0 ? null : pool[Math.floor(Math.random() * pool.length)];
}

/** Assegna il token di un riscatto a un utente registrato e aggiorna lo storico. */
export async function fulfillRedemption(
  db: Database,
  redemptionRowId: string,
  reward: RewardTarget | null,
  userId: string,
): Promise<RedemptionOutcome> {
  return db.transaction(async (tx) => {
    const resolve = (values: Partial<typeof channelPointRedemptions.$inferInsert>) =>
      tx
        .update(channelPointRedemptions)
        .set({ ...values, resolvedAt: new Date() })
        .where(eq(channelPointRedemptions.id, redemptionRowId));

    if (!reward) {
      const note = "Premio eliminato prima dell'assegnazione";
      await resolve({ status: "refunded", note });
      return { status: "refunded", note, reason: "reward_deleted" } as const;
    }

    // Lock sull'utente: due riscatti simultanei non possono pescare lo stesso token.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const tokenId = await pickRewardToken(tx, reward, userId);
    const tokenName = async (id: string | null) =>
      id ? ((await tx.select({ name: tokens.name }).from(tokens).where(eq(tokens.id, id)))[0]?.name ?? "") : "";
    // grantToken false = già posseduto: mai segnare "assegnato" un doppione.
    if (!tokenId || !(await grantToken(tx, { userId, tokenId, source: "channel_points" }))) {
      const note = reward.isRandom ? "Nessun token rilasciato ancora da ottenere" : "Token già posseduto o non disponibile";
      await resolve({ status: "refunded", note });
      return reward.isRandom
        ? ({ status: "refunded", note, reason: "all_owned" } as const)
        : ({ status: "refunded", note, reason: "already_owned", tokenName: await tokenName(reward.tokenId) } as const);
    }

    await resolve({ status: "granted", tokenId, note: null });
    return {
      status: "granted",
      tokenId,
      tokenName: await tokenName(tokenId),
      remaining: (await randomPool(tx, userId)).length,
    } as const;
  });
}
