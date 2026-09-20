CREATE TYPE "public"."credit_status" AS ENUM('available', 'used', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."subscription_source" AS ENUM('eventsub', 'reconcile');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."token_assignment" AS ENUM('window', 'signup', 'moderator', 'manual');--> statement-breakpoint
CREATE TYPE "public"."token_source" AS ENUM('window', 'signup', 'moderator', 'manual', 'channel_points');--> statement-breakpoint
CREATE TABLE "admins" (
	"twitch_id" text PRIMARY KEY NOT NULL,
	"twitch_login" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcaster_auth" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"twitch_id" text NOT NULL,
	"twitch_login" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcaster_auth_singleton" CHECK ("broadcaster_auth"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "channel_moderators" (
	"twitch_user_id" text PRIMARY KEY NOT NULL,
	"twitch_login" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_point_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"redemption_id" text NOT NULL,
	"reward_id" text NOT NULL,
	"twitch_user_id" text NOT NULL,
	"twitch_login" text,
	"status" "credit_status" DEFAULT 'available' NOT NULL,
	"used_token_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "channel_point_credits_redemption_id_unique" UNIQUE("redemption_id")
);
--> statement-breakpoint
CREATE TABLE "equipped_tokens" (
	"user_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	"token_id" uuid NOT NULL,
	CONSTRAINT "equipped_tokens_user_id_slot_pk" PRIMARY KEY("user_id","slot"),
	CONSTRAINT "equipped_tokens_slot_range" CHECK ("equipped_tokens"."slot" between 1 and 8)
);
--> statement-breakpoint
CREATE TABLE "eventsub_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"subscription_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"twitch_user_id" text PRIMARY KEY NOT NULL,
	"twitch_login" text,
	"tier" text NOT NULL,
	"is_gift" boolean DEFAULT false NOT NULL,
	"status" "subscription_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"source" "subscription_source" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"event_label" text,
	"event_date" timestamp with time zone,
	"artwork_key" text,
	"assignment" "token_assignment" DEFAULT 'window' NOT NULL,
	"redeem_opens_at" timestamp with time zone,
	"redeem_closes_at" timestamp with time zone,
	"redeem_code" text,
	"hidden_until_open" boolean DEFAULT false NOT NULL,
	"channel_points_eligible" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tokens_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tokens_window_order" CHECK ("tokens"."redeem_opens_at" is null or "tokens"."redeem_closes_at" is null or "tokens"."redeem_closes_at" > "tokens"."redeem_opens_at")
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"user_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"source" "token_source" NOT NULL,
	"obtained_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "user_tokens_user_id_token_id_pk" PRIMARY KEY("user_id","token_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twitch_id" text NOT NULL,
	"login" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"xp" integer DEFAULT 0 NOT NULL,
	"level_reached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_twitch_id_unique" UNIQUE("twitch_id")
);
--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_point_credits" ADD CONSTRAINT "channel_point_credits_used_token_id_tokens_id_fk" FOREIGN KEY ("used_token_id") REFERENCES "public"."tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipped_tokens" ADD CONSTRAINT "equipped_tokens_owned_fk" FOREIGN KEY ("user_id","token_id") REFERENCES "public"."user_tokens"("user_id","token_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "channel_point_credits_user_idx" ON "channel_point_credits" USING btree ("twitch_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "equipped_tokens_user_token_uq" ON "equipped_tokens" USING btree ("user_id","token_id");--> statement-breakpoint
CREATE INDEX "user_tokens_token_idx" ON "user_tokens" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "users_leaderboard_idx" ON "users" USING btree ("xp" DESC NULLS LAST,"level_reached_at");