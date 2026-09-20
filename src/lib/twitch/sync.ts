import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { broadcasterAuth, channelFollowers, channelModerators, eventsubMessages, subscriptions, tokens } from "@/db/schema";
import { audit } from "@/lib/audit";
import { backfillAutomaticToken } from "@/lib/grants";
import { appUrl, requireEnv } from "@/lib/env";
import { getSetting, SETTING_KEYS, type ChannelPointsRewardSetting } from "@/lib/settings";
import { markSubscriptionActive, markSubscriptionEnded } from "@/lib/subscriptions";
import { EVENTSUB_TOPICS } from "./eventsub";
import { addModerator } from "./handlers";
import {
  broadcasterId,
  createEventSubSubscription,
  deleteEventSubSubscription,
  getBroadcasterSubscriptions,
  getChannelFollowers,
  getModerators,
  listEventSubSubscriptions,
  type HelixEventSubSubscription,
} from "./helix";

const webhookCallback = () => `${appUrl()}/api/webhooks/twitch`;

/**
 * Reconciliation: allinea il database all'elenco completo degli abbonati su Helix.
 * Serve per il primo import e per correggere eventi EventSub persi. Non è la fonte primaria.
 */
export async function reconcileSubscriptions(): Promise<{ active: number; ended: number }> {
  const startedAt = new Date();
  // Se Helix fallisce a metà, l'eccezione interrompe tutto prima di chiudere qualsiasi abbonamento.
  const remote = await getBroadcasterSubscriptions();
  const channel = broadcasterId();
  const remoteIds = new Set<string>();

  for (const sub of remote) {
    if (sub.user_id === channel) continue; // Helix include il broadcaster stesso
    remoteIds.add(sub.user_id);
    await markSubscriptionActive(db, {
      twitchUserId: sub.user_id,
      twitchLogin: sub.user_login,
      tier: sub.tier,
      isGift: sub.is_gift,
      source: "reconcile",
    });
  }

  // Solo righe non toccate da EventSub durante la sincronizzazione.
  const localActive = await db
    .select({ id: subscriptions.twitchUserId })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active"), lt(subscriptions.updatedAt, startedAt)));

  let ended = 0;
  for (const row of localActive) {
    if (remoteIds.has(row.id)) continue;
    await markSubscriptionEnded(db, { twitchUserId: row.id, source: "reconcile" });
    ended++;
  }
  return { active: remoteIds.size, ended };
}

export async function reconcileModerators(): Promise<{ moderators: number; removed: number }> {
  const startedAt = new Date();
  const remote = await getModerators();
  for (const mod of remote) await addModerator(mod);

  const stale = await db
    .delete(channelModerators)
    .where(lt(channelModerators.updatedAt, startedAt))
    .returning({ id: channelModerators.twitchUserId });
  return { moderators: remote.length, removed: stale.length };
}

/**
 * Allinea l'elenco dei follower a quello di Helix. Serve per il primo import
 * e per recuperare gli unfollow, che Twitch non notifica via EventSub.
 */
export async function reconcileFollowers(): Promise<{ followers: number; removed: number }> {
  const startedAt = new Date();
  const remote = await getChannelFollowers();

  for (const follower of remote) {
    const now = new Date();
    await db
      .insert(channelFollowers)
      .values({
        twitchUserId: follower.user_id,
        twitchLogin: follower.user_login,
        followedAt: follower.followed_at ? new Date(follower.followed_at) : now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: channelFollowers.twitchUserId,
        set: { twitchLogin: follower.user_login, updatedAt: now },
      });
  }

  const stale = await db
    .delete(channelFollowers)
    .where(lt(channelFollowers.updatedAt, startedAt))
    .returning({ id: channelFollowers.twitchUserId });
  return { followers: remote.length, removed: stale.length };
}

/**
 * Riassegna i token automatici (abbonati e follower) a chi ne ha diritto ma non li ha ancora:
 * recupera gli eventi persi e chi si è abbonato prima che il token esistesse.
 */
export async function reconcileAutomaticTokens(): Promise<{ granted: number }> {
  const automatic = await db
    .select({ id: tokens.id, assignment: tokens.assignment })
    .from(tokens)
    .where(inArray(tokens.assignment, ["subscriber", "follower"]));

  let granted = 0;
  for (const token of automatic) {
    granted += await db.transaction((tx) => backfillAutomaticToken(tx, token));
  }
  return { granted };
}

export type EventSubTopicStatus = { topic: string; status: string; action: "ok" | "created" | "error"; error?: string };

/** Crea le subscription EventSub mancanti e sostituisce quelle disattivate da Twitch. */
export async function ensureEventSubSubscriptions(): Promise<EventSubTopicStatus[]> {
  const callback = webhookCallback();
  const secret = requireEnv("TWITCH_EVENTSUB_SECRET");
  const channel = broadcasterId();
  const existing = await listEventSubSubscriptions();
  const results: EventSubTopicStatus[] = [];

  for (const spec of EVENTSUB_TOPICS) {
    const topic = spec.type;
    // "@broadcaster" è un segnaposto: le condizioni extra (es. moderator_user_id) puntano al canale.
    const condition = Object.fromEntries(
      Object.entries(spec.extraCondition ?? {}).map(([key]) => [key, channel]),
    );
    const matches = existing.filter(
      (s) =>
        s.type === topic &&
        s.version === spec.version &&
        s.transport.callback === callback &&
        s.condition.broadcaster_user_id === channel,
    );
    const healthy = matches.find((s) => s.status === "enabled" || s.status === "webhook_callback_verification_pending");
    for (const broken of matches.filter((s) => s !== healthy)) await deleteEventSubSubscription(broken.id);

    if (healthy) {
      results.push({ topic, status: healthy.status, action: "ok" });
      continue;
    }
    try {
      const { data } = await createEventSubSubscription(topic, callback, secret, { version: spec.version, condition });
      results.push({ topic, status: data[0]?.status ?? "created", action: "created" });
    } catch (error) {
      results.push({ topic, status: "missing", action: "error", error: String(error) });
    }
  }
  return results;
}

export async function getTwitchIntegrationStatus() {
  const [connection] = await db
    .select({
      twitchLogin: broadcasterAuth.twitchLogin,
      scopes: broadcasterAuth.scopes,
      updatedAt: broadcasterAuth.updatedAt,
    })
    .from(broadcasterAuth);

  let subscriptionsList: HelixEventSubSubscription[] = [];
  let subscriptionsError: string | null = null;
  try {
    const callback = webhookCallback();
    subscriptionsList = (await listEventSubSubscriptions()).filter((s) => s.transport.callback === callback);
  } catch (error) {
    subscriptionsError = String(error);
  }

  return { connection: connection ?? null, subscriptions: subscriptionsList, subscriptionsError, callback: webhookCallback() };
}

/** Vecchia ricompensa unica "gettone" (sistema dismesso): ancora presente su Twitch finché non viene eliminata. */
export async function getLegacyChannelPointsReward() {
  return getSetting<ChannelPointsRewardSetting>(db, SETTING_KEYS.channelPointsReward);
}

/** Cron giornaliero: ogni passo è indipendente, un errore non blocca gli altri. */
export async function runDailyMaintenance() {
  const report: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      report[name] = await fn();
    } catch (error) {
      report[name] = { error: String(error) };
    }
  };

  await step("subscriptions", reconcileSubscriptions);
  await step("followers", reconcileFollowers);
  await step("moderators", reconcileModerators);
  await step("automaticTokens", reconcileAutomaticTokens);
  await step("eventsub", ensureEventSubSubscriptions);
  await step("cleanup", async () => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(eventsubMessages)
      .where(lt(eventsubMessages.receivedAt, cutoff))
      .returning({ id: eventsubMessages.messageId });
    return { eventsubMessagesDeleted: deleted.length };
  });

  await audit(db, { action: "maintenance.daily", data: report });
  return report;
}
