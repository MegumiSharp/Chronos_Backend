DROP TABLE "channel_point_credits" CASCADE;--> statement-breakpoint
ALTER TABLE "tokens" DROP COLUMN "channel_points_eligible";--> statement-breakpoint
DROP TYPE "public"."credit_status";