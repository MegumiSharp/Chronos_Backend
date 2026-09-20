/** Cookie anti-CSRF per il collegamento dell'account broadcaster. */
export const BROADCASTER_STATE_COOKIE = "chronos_broadcaster_oauth_state";
export const BROADCASTER_COOKIE_PATH = "/api/twitch/broadcaster";

/**
 * Cookie anti-CSRF per il collegamento dell'account bot. Sta sullo stesso path del
 * broadcaster perché i due collegamenti condividono il redirect URI: così su Twitch
 * ne va registrato uno solo.
 */
export const BOT_STATE_COOKIE = "chronos_bot_oauth_state";
