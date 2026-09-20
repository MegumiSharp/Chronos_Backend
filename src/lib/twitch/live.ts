import { broadcasterId, getStream, type HelixStream } from "./helix";

export type LiveStatus = {
  live: boolean;
  title: string | null;
  gameName: string | null;
  viewers: number;
  startedAt: string | null;
};

const OFFLINE: LiveStatus = { live: false, title: null, gameName: null, viewers: 0, startedAt: null };

/**
 * Lo stato "in live" viene chiesto a Twitch al massimo una volta al minuto e tenuto in memoria:
 * la Home è dinamica e senza cache ogni visita diventerebbe una chiamata a Helix.
 */
const TTL_MS = 60_000;

let cached: { value: LiveStatus; expiresAt: number } | undefined;
let inFlight: Promise<LiveStatus> | undefined;

function toStatus(stream: HelixStream | undefined): LiveStatus {
  if (!stream) return OFFLINE;
  return {
    live: true,
    title: stream.title || null,
    gameName: stream.game_name || null,
    viewers: stream.viewer_count ?? 0,
    startedAt: stream.started_at || null,
  };
}

export async function getLiveStatus(): Promise<LiveStatus> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  // Più richieste contemporanee condividono la stessa chiamata.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const value = toStatus(await getStream(broadcasterId()));
      cached = { value, expiresAt: Date.now() + TTL_MS };
      return value;
    } catch {
      // Twitch irraggiungibile o credenziali mancanti: la Home non deve rompersi per questo.
      cached = { value: OFFLINE, expiresAt: Date.now() + TTL_MS };
      return OFFLINE;
    } finally {
      inFlight = undefined;
    }
  })();

  return inFlight;
}
