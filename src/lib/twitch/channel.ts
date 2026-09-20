import { broadcasterId, getUserById } from "./helix";

export type ChannelProfile = { login: string; displayName: string; avatarUrl: string | null };

/** Nome e avatar cambiano di rado: una chiamata a Helix all'ora basta. */
const TTL_MS = 60 * 60_000;
/** Dopo un errore si riprova prima, senza martellare Twitch. */
const RETRY_MS = 5 * 60_000;

let cached: { value: ChannelProfile | null; expiresAt: number } | undefined;
let inFlight: Promise<ChannelProfile | null> | undefined;

/** Profilo Twitch dello streamer del canale, mostrato nell'header. null se Twitch non risponde. */
export async function getChannelProfile(): Promise<ChannelProfile | null> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const user = await getUserById(broadcasterId());
      const value = user
        ? { login: user.login, displayName: user.display_name, avatarUrl: user.profile_image_url || null }
        : null;
      cached = { value, expiresAt: Date.now() + TTL_MS };
      return value;
    } catch {
      // L'header non deve rompersi se Twitch è irraggiungibile: si torna al valore precedente, se c'era.
      const value = cached?.value ?? null;
      cached = { value, expiresAt: Date.now() + RETRY_MS };
      return value;
    } finally {
      inFlight = undefined;
    }
  })();

  return inFlight;
}
