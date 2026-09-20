ALTER TABLE "event_types" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "event_description" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "auto_close" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "exclude_from_random" boolean DEFAULT false NOT NULL;