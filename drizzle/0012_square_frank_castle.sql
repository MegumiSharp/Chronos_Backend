ALTER TABLE "audit_log" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "subject_user_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_user_id");