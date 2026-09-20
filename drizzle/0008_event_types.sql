CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN "event_type_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "event_types_name_uq" ON "event_types" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Ogni etichetta evento già usata diventa un tipo evento (senza distinzione di maiuscole),
-- con il primo colore scelto per quell'etichetta o il grigio "Cenere" della palette.
INSERT INTO "event_types" ("name", "color")
SELECT DISTINCT ON (lower(btrim("event_label"))) btrim("event_label"), coalesce("event_color", '#a8a2b8')
FROM "tokens"
WHERE "event_label" IS NOT NULL AND btrim("event_label") <> ''
ORDER BY lower(btrim("event_label")), ("event_color" IS NULL), "created_at";--> statement-breakpoint
UPDATE "tokens" t
SET "event_type_id" = e."id", "event_label" = e."name", "event_color" = e."color"
FROM "event_types" e
WHERE t."event_label" IS NOT NULL AND lower(btrim(t."event_label")) = lower(e."name");--> statement-breakpoint
UPDATE "tokens" SET "event_label" = NULL, "event_color" = NULL WHERE "event_type_id" IS NULL;
