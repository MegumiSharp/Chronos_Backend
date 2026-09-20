import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { subscriptions } from "@/db/schema";

type Source = "eventsub" | "reconcile";

/** channel.subscribe / channel.subscription.message / reconciliation: abbonamento attivo. */
export async function markSubscriptionActive(
  db: Database,
  input: { twitchUserId: string; twitchLogin?: string | null; tier: string; isGift: boolean; source: Source },
): Promise<void> {
  const now = new Date();
  await db
    .insert(subscriptions)
    .values({
      twitchUserId: input.twitchUserId,
      twitchLogin: input.twitchLogin ?? null,
      tier: input.tier,
      isGift: input.isGift,
      status: "active",
      startedAt: now,
      source: input.source,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.twitchUserId,
      set: {
        twitchLogin: sql`coalesce(excluded.twitch_login, ${subscriptions.twitchLogin})`,
        tier: input.tier,
        isGift: input.isGift,
        status: "active",
        // Un nuovo periodo inizia solo se il precedente era terminato.
        startedAt: sql`case when ${subscriptions.status} = 'ended' then excluded.started_at else ${subscriptions.startedAt} end`,
        endedAt: null,
        source: input.source,
        updatedAt: now,
      },
    });
}

/** channel.subscription.end / reconciliation: abbonamento terminato (token e storico restano). */
export async function markSubscriptionEnded(
  db: Database,
  input: { twitchUserId: string; source: Source },
): Promise<void> {
  const now = new Date();
  await db
    .update(subscriptions)
    .set({ status: "ended", endedAt: now, source: input.source, updatedAt: now })
    .where(and(eq(subscriptions.twitchUserId, input.twitchUserId), eq(subscriptions.status, "active")));
}

/** Legge sempre e solo dal database locale, mai da Twitch in tempo reale. */
export async function isSubscriber(db: Database, twitchUserId: string): Promise<boolean> {
  // Il broadcaster ha sempre accesso completo al proprio sito.
  if (twitchUserId === process.env.TWITCH_BROADCASTER_ID) return true;
  const [row] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.twitchUserId, twitchUserId));
  return row?.status === "active";
}
