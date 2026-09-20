CREATE TABLE "token_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"label" text,
	"artwork_key" text,
	"accent_color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_variants_position_range" CHECK ("token_variants"."position" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "is_secret" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "artist_name" text;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "artist_url" text;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "token_variants" ADD CONSTRAINT "token_variants_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "token_variants_token_position_uq" ON "token_variants" USING btree ("token_id","position");--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_variant_id_token_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."token_variants"("id") ON DELETE set null ON UPDATE no action;