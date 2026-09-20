import { eq } from "drizzle-orm";
import { db } from "@/db";
import { channelModerators, channelPointRedemptions, channelPointRewards, users } from "@/db/schema";
import { fulfillRedemption, type RedemptionOutcome } from "@/lib/channel-points";
import { notifyChat } from "@/lib/chat-bot";
import { addFollower, isFollower, removeFollower } from "@/lib/followers";
import { grantAutomaticTokens } from "@/lib/grants";
import { queueSubscriptionOverlay } from "@/lib/overlay";
import { isSubscriber, markSubscriptionActive, markSubscriptionEnded } from "@/lib/subscriptions";
import type {
  ChannelFollowEvent,
  ChannelModeratorEvent,
  ChannelPointsRedemptionEvent,
  ChannelSubscribeEvent,
  ChannelSubscriptionEndEvent,
  ChannelSubscriptionMessageEvent,
} from "./eventsub";
import { updateRedemptionStatus } from "./helix";

/** Lavoro da eseguire dopo aver risposto a Twitch (chiamate Helix), tramite after(). */
export type FollowUp = () => Promise<void>;

/** Un nuovo abbonato riceve subito i token riservati agli abbonati, se è già registrato. */
async function grantSubscriberTokens(twitchId: string): Promise<void> {
  const [user] = await db.select({ id: users.id, twitchId: users.twitchId }).from(users).where(eq(users.twitchId, twitchId));
  if (!user) return; // li riceverà al primo accesso
  await db.transaction((tx) => grantAutomaticTokens(tx, user));
}

export async function handleEventSubNotification(type: string, event: unknown): Promise<FollowUp | void> {
  switch (type) {
    case "channel.subscribe": {
      // Include le sub regalate: chi le riceve arriva qui con is_gift = true e vale come abbonato.
      const e = event as ChannelSubscribeEvent;
      await markSubscriptionActive(db, {
        twitchUserId: e.user_id,
        twitchLogin: e.user_login,
        tier: e.tier,
        isGift: e.is_gift,
        source: "eventsub",
      });
      await grantSubscriberTokens(e.user_id);
      await queueSubscriptionOverlay({
        twitchUserId: e.user_id,
        displayName: e.user_name,
        tier: e.tier,
        months: 1,
      });
      return;
    }
    case "channel.subscription.message": {
      // Resub condiviso in chat. I rinnovi silenziosi non generano eventi: resta attivo fino a .end.
      const e = event as ChannelSubscriptionMessageEvent;
      await markSubscriptionActive(db, {
        twitchUserId: e.user_id,
        twitchLogin: e.user_login,
        tier: e.tier,
        isGift: false,
        source: "eventsub",
      });
      await grantSubscriberTokens(e.user_id);
      await queueSubscriptionOverlay({
        twitchUserId: e.user_id,
        displayName: e.user_name,
        tier: e.tier,
        months: e.cumulative_months,
      });
      return;
    }
    case "channel.subscription.end": {
      const e = event as ChannelSubscriptionEndEvent;
      await markSubscriptionEnded(db, { twitchUserId: e.user_id, source: "eventsub" });
      return;
    }
    case "channel.subscription.gift":
      // Evento del donatore: i destinatari arrivano come channel.subscribe. Nessuno stato da aggiornare.
      return;
    case "channel.follow": {
      const e = event as ChannelFollowEvent;
      await addFollower({
        twitchUserId: e.user_id,
        twitchLogin: e.user_login,
        followedAt: e.followed_at ? new Date(e.followed_at) : null,
      });
      return;
    }
    case "channel.unfollow": {
      // Twitch non invia più questo evento, ma se arrivasse va gestito senza errori.
      const e = event as ChannelFollowEvent;
      await removeFollower(e.user_id);
      return;
    }
    case "channel.channel_points_custom_reward_redemption.add":
      return handleRedemption(event as ChannelPointsRedemptionEvent);
    case "channel.moderator.add":
      await addModerator(event as ChannelModeratorEvent);
      return;
    case "channel.moderator.remove": {
      const e = event as ChannelModeratorEvent;
      await db.delete(channelModerators).where(eq(channelModerators.twitchUserId, e.user_id));
      return;
    }
  }
}

async function handleRedemption(e: ChannelPointsRedemptionEvent): Promise<FollowUp | void> {
  // Solo le ricompense create da Chronos: le altre del canale non ci riguardano.
  const [reward] = await db.select().from(channelPointRewards).where(eq(channelPointRewards.twitchRewardId, e.reward.id));
  if (!reward) return;

  const [row] = await db
    .insert(channelPointRedemptions)
    .values({
      redemptionId: e.id,
      rewardId: reward.id,
      twitchRewardId: e.reward.id,
      twitchUserId: e.user_id,
      twitchLogin: e.user_login,
      status: "pending",
    })
    .onConflictDoNothing()
    .returning({ id: channelPointRedemptions.id });
  if (!row) return; // già elaborato

  const refund: FollowUp = () => updateRedemptionStatus(e.reward.id, e.id, "CANCELED");

  // Serve seguire il canale (o esserne abbonati): gli altri vengono rimborsati e l'overlay non parte,
  // perché l'animazione nasce solo da un token effettivamente assegnato.
  if (!(await isFollower(db, e.user_id)) && !(await isSubscriber(db, e.user_id))) {
    await db
      .update(channelPointRedemptions)
      .set({ status: "refunded", note: "Non follower del canale", resolvedAt: new Date() })
      .where(eq(channelPointRedemptions.id, row.id));
    return async () => {
      await refund();
      await notifyChat("notFollower", { user: e.user_name, reward: e.reward.title });
    };
  }

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.twitchId, e.user_id));
  if (!user) {
    // Follower ma non ancora su Chronos: resta in attesa, confermato o rimborsato al primo login.
    await db
      .update(channelPointRedemptions)
      .set({ note: "In attesa del primo accesso a Chronos" })
      .where(eq(channelPointRedemptions.id, row.id));
    return;
  }

  const outcome = await fulfillRedemption(db, row.id, reward, user.id);
  return async () => {
    await updateRedemptionStatus(e.reward.id, e.id, outcome.status === "granted" ? "FULFILLED" : "CANCELED");
    await notifyRedemption(outcome, e.user_name, e.reward.title);
  };
}

/** Risposta in chat per l'esito di un riscatto (se il bot è attivo). */
export async function notifyRedemption(outcome: RedemptionOutcome, user: string, reward: string): Promise<void> {
  if (outcome.status === "granted") {
    await notifyChat(outcome.remaining === 0 ? "completed" : "granted", { user, token: outcome.tokenName, reward });
  } else if (outcome.reason === "all_owned") {
    await notifyChat("allOwned", { user, reward });
  } else if (outcome.reason === "already_owned") {
    await notifyChat("alreadyOwned", { user, token: outcome.tokenName, reward });
  }
}

/** Traccia i moderatori del canale. Non dà più diritto a token: serve solo a riconoscerne il ruolo. */
export async function addModerator(e: { user_id: string; user_login: string }): Promise<void> {
  const now = new Date();
  await db
    .insert(channelModerators)
    .values({ twitchUserId: e.user_id, twitchLogin: e.user_login, updatedAt: now })
    .onConflictDoUpdate({
      target: channelModerators.twitchUserId,
      set: { twitchLogin: e.user_login, updatedAt: now },
    });
}
