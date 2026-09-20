import { createHmac, timingSafeEqual } from "node:crypto";

export const EVENTSUB_HEADERS = {
  messageId: "twitch-eventsub-message-id",
  timestamp: "twitch-eventsub-message-timestamp",
  signature: "twitch-eventsub-message-signature",
  messageType: "twitch-eventsub-message-type",
  subscriptionType: "twitch-eventsub-subscription-type",
} as const;

/** Twitch consiglia di scartare i messaggi più vecchi di 10 minuti (protezione da replay). */
export const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;

export type EventSubMessageType = "notification" | "webhook_callback_verification" | "revocation";

export type VerifyInput = {
  secret: string;
  messageId: string | null;
  timestamp: string | null;
  signature: string | null;
  /** Body grezzo, esattamente come ricevuto: la firma è calcolata sui byte originali. */
  body: string;
  now?: number;
};

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function signEventSubMessage(secret: string, messageId: string, timestamp: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(messageId + timestamp + body).digest("hex");
}

export function verifyEventSubMessage(input: VerifyInput): VerifyResult {
  const { secret, messageId, timestamp, signature, body, now = Date.now() } = input;
  if (!messageId || !timestamp || !signature) return { ok: false, reason: "header mancanti" };

  const sentAt = Date.parse(timestamp);
  if (Number.isNaN(sentAt)) return { ok: false, reason: "timestamp non valido" };
  if (now - sentAt > MAX_MESSAGE_AGE_MS) return { ok: false, reason: "messaggio troppo vecchio" };

  const expected = Buffer.from(signEventSubMessage(secret, messageId, timestamp, body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "firma non valida" };
  }
  return { ok: true };
}

// --- Payload degli eventi usati da Chronos -------------------------------------

export type SubscriptionInfo = {
  id: string;
  type: string;
  version: string;
  status: string;
  condition: Record<string, string>;
};

export type EventSubEnvelope = {
  subscription: SubscriptionInfo;
  challenge?: string;
  event?: unknown;
};

type UserRef = { user_id: string; user_login: string; user_name: string };
type BroadcasterRef = { broadcaster_user_id: string; broadcaster_user_login: string };

export type ChannelSubscribeEvent = UserRef & BroadcasterRef & { tier: string; is_gift: boolean };
export type ChannelSubscriptionEndEvent = UserRef & BroadcasterRef & { tier: string; is_gift: boolean };
export type ChannelSubscriptionMessageEvent = UserRef &
  BroadcasterRef & { tier: string; cumulative_months: number; duration_months: number };
export type ChannelSubscriptionGiftEvent = BroadcasterRef & {
  user_id: string | null;
  user_login: string | null;
  total: number;
  tier: string;
  is_anonymous: boolean;
};
export type ChannelPointsRedemptionEvent = UserRef &
  BroadcasterRef & { id: string; status: string; reward: { id: string; title: string; cost: number } };
export type ChannelModeratorEvent = UserRef & BroadcasterRef;
export type ChannelFollowEvent = UserRef & BroadcasterRef & { followed_at: string };

export type EventSubTopicSpec = {
  type: string;
  version: string;
  /** Condizioni oltre a broadcaster_user_id; il segnaposto "@broadcaster" viene sostituito a runtime. */
  extraCondition?: Record<string, "@broadcaster">;
};

/** Subscription EventSub che Chronos crea sul canale. */
export const EVENTSUB_TOPICS: readonly EventSubTopicSpec[] = [
  { type: "channel.subscribe", version: "1" },
  { type: "channel.subscription.end", version: "1" },
  { type: "channel.subscription.gift", version: "1" },
  { type: "channel.subscription.message", version: "1" },
  { type: "channel.channel_points_custom_reward_redemption.add", version: "1" },
  { type: "channel.moderator.add", version: "1" },
  { type: "channel.moderator.remove", version: "1" },
  // channel.follow esiste solo in v2 e richiede moderator_user_id (il broadcaster stesso).
  { type: "channel.follow", version: "2", extraCondition: { moderator_user_id: "@broadcaster" } },
] as const;

export type EventSubTopic = (typeof EVENTSUB_TOPICS)[number]["type"];
