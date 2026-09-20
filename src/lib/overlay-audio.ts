import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { deleteSetting, getSetting, setSetting, SETTING_KEYS } from "./settings";
import { storage } from "./storage";

export type OverlayKind = "token" | "subscription";

export type OverlayAudio = {
  /** Chiave nello storage, es. "overlay/token-3f9a.mp3". */
  key: string;
  /** Nome del file caricato, mostrato nel pannello. */
  name: string;
  /** 0-100. */
  volume: number;
};

export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

export const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

const SETTING = {
  token: SETTING_KEYS.overlayAudio,
  subscription: SETTING_KEYS.overlaySubAudio,
} as const;

export async function getOverlayAudio(kind: OverlayKind): Promise<OverlayAudio | null> {
  return getSetting<OverlayAudio>(db, SETTING[kind]);
}

/** URL pubblico dell'audio, da passare alla pagina dell'overlay. */
export function overlayAudioUrl(audio: OverlayAudio | null): string | null {
  return audio ? storage().publicUrl(audio.key) : null;
}

export async function saveOverlayAudio(kind: OverlayKind, audio: OverlayAudio | null): Promise<void> {
  const previous = await getOverlayAudio(kind);
  // app_settings.value è NOT NULL: per togliere l'audio si cancella la riga, non si scrive null.
  if (audio) await setSetting(db, SETTING[kind], audio);
  else await deleteSetting(db, SETTING[kind]);
  if (previous && previous.key !== audio?.key) {
    await storage().delete([previous.key]).catch(() => undefined);
  }
}

/** Carica un nuovo file audio e restituisce la chiave di storage. */
export async function uploadOverlayAudio(kind: OverlayKind, file: File): Promise<string> {
  const extension = AUDIO_TYPES[file.type];
  if (!extension) throw new Error("Formato non supportato: usa MP3, OGG, WAV o WebM.");
  if (file.size > MAX_AUDIO_BYTES) throw new Error(`Il file supera i ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`);

  const key = `overlay/${kind}-${randomBytes(4).toString("hex")}.${extension}`;
  await storage().put(key, Buffer.from(await file.arrayBuffer()), file.type);
  return key;
}
