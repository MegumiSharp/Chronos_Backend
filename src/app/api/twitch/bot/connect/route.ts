import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { appUrl, requireEnv } from "@/lib/env";
import { BOT_SCOPES } from "@/lib/twitch/helix";
import { BOT_STATE_COOKIE, BROADCASTER_COOKIE_PATH } from "@/lib/twitch/oauth-state";
import { getViewer } from "@/lib/viewer";

/**
 * Collega l'account che scrive in chat (solo admin). Va fatto con il browser loggato
 * su Twitch con l'account del bot. Torna sul callback del broadcaster, già registrato
 * su Twitch: il cookie di stato distingue i due collegamenti.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return new Response(null, { status: 404 });

  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(BOT_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: BROADCASTER_COOKIE_PATH,
  });

  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: requireEnv("AUTH_TWITCH_ID"),
    redirect_uri: `${appUrl()}/api/twitch/broadcaster/callback`,
    response_type: "code",
    scope: BOT_SCOPES.join(" "),
    state,
    force_verify: "true",
  }).toString();

  return Response.redirect(url.toString(), 302);
}
