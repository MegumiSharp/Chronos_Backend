ALTER TYPE "public"."feedback_kind" ADD VALUE 'copyright';--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD COLUMN "contact" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "show_manual_tag" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
-- Le medaglie già possedute non devono far comparire il popup "nuova medaglia" al prossimo accesso.
UPDATE "user_tokens" SET "seen_at" = now() WHERE "seen_at" IS NULL;
