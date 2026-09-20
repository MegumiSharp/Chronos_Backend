CREATE TABLE "bot_auth" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"twitch_id" text NOT NULL,
	"twitch_login" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_auth_singleton" CHECK ("bot_auth"."id" = 1)
);
