import { cookies } from "next/headers";
import { after } from "next/server";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { appUrl } from "@/lib/env";
import { broadcasterId, exchangeBroadcasterCode, saveBotToken, saveBroadcasterToken } from "@/lib/twitch/helix";
import { ensureEventSubSubscriptions, reconcileModerators, reconcileSubscriptions } from "@/lib/twitch/sync";
import { BOT_STATE_COOKIE, BROADCASTER_COOKIE_PATH, BROADCASTER_STATE_COOKIE } from "@/lib/twitch/oauth-state";
import { getViewer } from "@/lib/viewer";

const back = (page: string, params: Record<string, string>) =>
  Response.redirect(`${appUrl()}${page}?${new URLSearchParams(params)}`, 302);

/**
 * Ritorno dall'autorizzazione Twitch, per il canale e per l'account bot: il redirect URI
 * registrato su Twitch è uno solo, il cookie di stato dice quale dei due collegamenti è.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const cookieStore = await cookies();
  const botState = cookieStore.get(BOT_STATE_COOKIE)?.value;
  const expectedState = botState ?? cookieStore.get(BROADCASTER_STATE_COOKIE)?.value;
  for (const name of [BOT_STATE_COOKIE, BROADCASTER_STATE_COOKIE]) {
    cookieStore.delete({ name, path: BROADCASTER_COOKIE_PATH });
  }

  const isBot = Boolean(botState);
  const fail = (message: string) =>
    isBot ? back("/admin/twitch", { botError: message }) : back("/admin/twitch", { error: message });

  if (url.searchParams.get("error")) return fail("Autorizzazione annullata su Twitch.");
  const code = url.searchParams.get("code");
  if (!code || !expectedState || url.searchParams.get("state") !== expectedState) {
    return fail("Richiesta non valida o scaduta, riprova.");
  }

  try {
    const { token, info } = await exchangeBroadcasterCode(code, `${appUrl()}/api/twitch/broadcaster/callback`);
    const saved = {
      twitchId: info.user_id,
      twitchLogin: info.login,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? "",
      scopes: info.scopes,
      expiresIn: token.expires_in,
    };

    if (isBot) {
      if (info.user_id === broadcasterId()) {
        return fail(
          "Hai autorizzato l'account del canale: il bot ha bisogno di un secondo account. Esci da Twitch (o usa una finestra anonima), entra con l'account del bot e riprova.",
        );
      }
      await saveBotToken(saved);
      await audit(db, { actorUserId: viewer.user.id, action: "chat_bot.connected", data: { login: info.login } });
      return back("/admin/twitch", { botConnected: info.login });
    }

    if (info.user_id !== broadcasterId()) {
      return fail(`Hai autorizzato @${info.login}, ma il canale configurato è un altro account.`);
    }
    await saveBroadcasterToken(saved);
    await audit(db, {
      actorUserId: viewer.user.id,
      action: "twitch.broadcaster_connected",
      data: { login: info.login },
    });

    // Primo import e registrazione webhook dopo la risposta, per non far attendere il redirect.
    after(async () => {
      for (const [name, task] of [
        ["eventsub", ensureEventSubSubscriptions],
        ["subscriptions", reconcileSubscriptions],
        ["moderators", reconcileModerators],
      ] as const) {
        try {
          await task();
        } catch (error) {
          console.error(`[twitch] sincronizzazione iniziale ${name} fallita`, error);
        }
      }
    });

    return back("/admin/twitch", { connected: "1" });
  } catch (error) {
    // Senza questo il pannello tornava "da collegare" senza dire cosa fosse andato storto.
    console.error("[twitch] collegamento account fallito", error);
    return fail(error instanceof Error ? error.message : "Collegamento non riuscito, riprova.");
  }
}
