CREATE TYPE "public"."redemption_status" AS ENUM('pending', 'granted', 'refunded');--> statement-breakpoint
CREATE TABLE "channel_point_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"redemption_id" text NOT NULL,
	"reward_id" uuid,
	"twitch_user_id" text NOT NULL,
	"twitch_login" text,
	"status" "redemption_status" NOT NULL,
	"token_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "channel_point_redemptions_redemption_id_unique" UNIQUE("redemption_id")
);
--> statement-breakpoint
CREATE TABLE "channel_point_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twitch_reward_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"cost" integer NOT NULL,
	"token_id" uuid,
	"is_random" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_point_rewards_twitch_reward_id_unique" UNIQUE("twitch_reward_id")
);
--> statement-breakpoint
CREATE TABLE "overlay_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"source" "token_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "xp" integer DEFAULT 250 NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_point_redemptions" ADD CONSTRAINT "channel_point_redemptions_reward_id_channel_point_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."channel_point_rewards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_point_redemptions" ADD CONSTRAINT "channel_point_redemptions_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_point_rewards" ADD CONSTRAINT "channel_point_rewards_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_point_rewards" ADD CONSTRAINT "channel_point_rewards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlay_events" ADD CONSTRAINT "overlay_events_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_point_redemptions_user_idx" ON "channel_point_redemptions" USING btree ("twitch_user_id","status");--> statement-breakpoint
-- XP degli utenti = somma dell'XP dei token posseduti (prima ogni token valeva 100 fissi).
UPDATE "users" SET "xp" = COALESCE((
  SELECT SUM(t."xp") FROM "user_tokens" ut JOIN "tokens" t ON t."id" = ut."token_id" WHERE ut."user_id" = "users"."id"
), 0);