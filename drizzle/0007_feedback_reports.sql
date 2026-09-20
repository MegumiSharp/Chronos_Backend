CREATE TYPE "public"."feedback_kind" AS ENUM('bug', 'feedback', 'suggestion');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'in_progress', 'resolved');--> statement-breakpoint
CREATE TABLE "feedback_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" "feedback_kind" NOT NULL,
	"message" text NOT NULL,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"page_path" text,
	"user_agent" text,
	"viewport" text,
	"locale" text,
	"app_version" text,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_reports_created_idx" ON "feedback_reports" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feedback_reports_user_idx" ON "feedback_reports" USING btree ("user_id","created_at");