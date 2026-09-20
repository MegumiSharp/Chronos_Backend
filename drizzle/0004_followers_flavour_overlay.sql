CREATE TYPE "public"."overlay_event_kind" AS ENUM('token', 'subscription');--> statement-breakpoint
CREATE TABLE "channel_followers" (
	"twitch_user_id" text PRIMARY KEY NOT NULL,
	"twitch_login" text,
	"followed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "assignment" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "assignment" SET DEFAULT 'window'::text;--> statement-breakpoint
UPDATE "tokens" SET "assignment" = 'subscriber' WHERE "assignment" = 'signup';--> statement-breakpoint
UPDATE "tokens" SET "assignment" = 'follower' WHERE "assignment" = 'moderator';--> statement-breakpoint
DROP TYPE "public"."token_assignment";--> statement-breakpoint
CREATE TYPE "public"."token_assignment" AS ENUM('window', 'subscriber', 'follower', 'manual');--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "assignment" SET DEFAULT 'window'::"public"."token_assignment";--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "assignment" SET DATA TYPE "public"."token_assignment" USING "assignment"::"public"."token_assignment";--> statement-breakpoint
ALTER TABLE "overlay_events" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user_tokens" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
UPDATE "user_tokens" SET "source" = 'subscriber' WHERE "source" = 'signup';--> statement-breakpoint
UPDATE "user_tokens" SET "source" = 'follower' WHERE "source" = 'moderator';--> statement-breakpoint
UPDATE "overlay_events" SET "source" = 'subscriber' WHERE "source" = 'signup';--> statement-breakpoint
UPDATE "overlay_events" SET "source" = 'follower' WHERE "source" = 'moderator';--> statement-breakpoint
DROP TYPE "public"."token_source";--> statement-breakpoint
CREATE TYPE "public"."token_source" AS ENUM('window', 'subscriber', 'follower', 'manual', 'channel_points');--> statement-breakpoint
ALTER TABLE "overlay_events" ALTER COLUMN "source" SET DATA TYPE "public"."token_source" USING "source"::"public"."token_source";--> statement-breakpoint
ALTER TABLE "user_tokens" ALTER COLUMN "source" SET DATA TYPE "public"."token_source" USING "source"::"public"."token_source";--> statement-breakpoint
ALTER TABLE "overlay_events" ALTER COLUMN "token_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "overlay_events" ALTER COLUMN "source" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "overlay_events" ADD COLUMN "kind" "overlay_event_kind" DEFAULT 'token' NOT NULL;--> statement-breakpoint
ALTER TABLE "overlay_events" ADD COLUMN "months" integer;--> statement-breakpoint
ALTER TABLE "overlay_events" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "flavour_text" text;
