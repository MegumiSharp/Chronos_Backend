import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { appUrl, requireEnv } from "@/lib/env";
import { BROADCASTER_SCOPES } from "@/lib/twitch/helix";
import { BROADCASTER_COOKIE_PATH, BROADCASTER_STATE_COOKIE } from "@/lib/twitch/oauth-state";
import { getViewer } from "@/lib/viewer";

/** Avvia l'autorizzazione del broadcaster (solo admin). Va fatta una volta, loggati su Twitch come il canale. */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return new Response(null, { status: 404 });

  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(BROADCASTER_STATE_COOKIE, state, {
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
    scope: BROADCASTER_SCOPES.join(" "),
    state,
    force_verify: "true",
  }).toString();

  return Response.redirect(url.toString(), 302);
}
