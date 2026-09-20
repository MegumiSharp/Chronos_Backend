import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { rgbToHex, rgbToHsl } from "./color";
import { readLocalObject, storage } from "./storage";

/** Varianti generate per ogni token: classifica/slot, griglia, card, popup. */
export const ARTWORK_SIZES = [96, 256, 512, 1024] as const;
export const MAX_ARTWORK_BYTES = 15 * 1024 * 1024;

export type ArtworkSources = { src: string; srcSet: string };

const variantKey = (key: string, size: number) => `${key}-${size}.webp`;

/**
 * Trova il riquadro dei pixel non trasparenti. Gli export attuali sono tele 2560×1440
 * con il token al centro: così il grafico può continuare a esportare come preferisce.
 */
async function opaqueBounds(input: Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: 8192 * 8192 })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    const row = y * info.width;
    for (let x = 0; x < info.width; x++) {
      if (data[row + x] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("L'immagine è completamente trasparente.");
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Colore predominante "percettivo": ignora pixel trasparenti e grigi (bordi neri/bianchi delle fiche)
 * e pesa ogni pixel per la sua intensità cromatica, raggruppando per tinta.
 */
export async function dominantColor(input: Buffer): Promise<string | null> {
  const { data, info } = await sharp(input)
    .resize(64, 64, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bins = new Map<number, { weight: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    if (chroma < 0.12) continue;
    const [hue] = rgbToHsl(r, g, b);
    const bin = Math.floor(hue / 15);
    const entry = bins.get(bin) ?? { weight: 0, r: 0, g: 0, b: 0 };
    entry.weight += chroma;
    entry.r += r * chroma;
    entry.g += g * chroma;
    entry.b += b * chroma;
    bins.set(bin, entry);
  }

  let best: { weight: number; r: number; g: number; b: number } | undefined;
  for (const entry of bins.values()) if (!best || entry.weight > best.weight) best = entry;
  if (!best) return null;
  return rgbToHex(best.r / best.weight, best.g / best.weight, best.b / best.weight);
}

export type ProcessedArtwork = { variants: { size: number; data: Buffer }[]; accentColor: string | null };

/** Quanti fotogrammi ha il file: più di uno vuol dire GIF o WebP animata. */
export async function frameCount(input: Buffer): Promise<number> {
  const { pages } = await sharp(input).metadata();
  return pages ?? 1;
}

/**
 * Medaglie animate. Il ritaglio automatico qui non si può fare: libvips tiene i fotogrammi
 * impilati in una striscia verticale, e un extract taglierebbe di traverso fra un frame e
 * l'altro. Le GIF vanno quindi esportate già inquadrate; se non sono quadrate, la differenza
 * viene riempita di trasparente invece di deformare l'immagine.
 * ponytail: nessun limite sui fotogrammi, il tetto è quello sui 15 MB del file caricato.
 */
async function processAnimated(input: Buffer): Promise<ProcessedArtwork> {
  // Il colore predominante si prende dal primo fotogramma: sull'intera striscia sarebbe
  // lento e non più preciso.
  const firstFrame = await sharp(input, { page: 0 }).png().toBuffer();
  const [variants, accentColor] = await Promise.all([
    Promise.all(
      ARTWORK_SIZES.map(async (size) => ({
        size,
        data: await sharp(input, { animated: true, limitInputPixels: 8192 * 8192 })
          .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp({ quality: 80, alphaQuality: 90, effort: 4 })
          .toBuffer(),
      })),
    ),
    dominantColor(firstFrame),
  ]);
  return { variants, accentColor };
}

/** Ritaglia, rende quadrato e converte in WebP in tutte le misure. Le animazioni restano tali. */
export async function processArtwork(input: Buffer): Promise<ProcessedArtwork> {
  if ((await frameCount(input)) > 1) return processAnimated(input);

  const bounds = await opaqueBounds(input);
  const cropped = await sharp(input).extract(bounds).png().toBuffer();
  const [variants, accentColor] = await Promise.all([
    Promise.all(
      ARTWORK_SIZES.map(async (size) => ({
        size,
        data: await sharp(cropped)
          .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .webp({ quality: 86, alphaQuality: 90, effort: 5 })
          .toBuffer(),
      })),
    ),
    dominantColor(cropped),
  ]);
  return { variants, accentColor };
}

/** Elabora e carica l'artwork. Ritorna la chiave da salvare in tokens.artwork_key e il colore predominante. */
export async function uploadArtwork(slug: string, input: Buffer): Promise<{ key: string; accentColor: string | null }> {
  const { variants, accentColor } = await processArtwork(input);
  const key = `tokens/${slug}-${randomBytes(4).toString("hex")}`;
  await Promise.all(variants.map((v) => storage().put(variantKey(key, v.size), v.data, "image/webp")));
  return { key, accentColor };
}

/** Legge una variante già caricata (per ricalcoli come il colore predominante). */
export async function readArtworkVariant(key: string, size: (typeof ARTWORK_SIZES)[number]): Promise<Buffer | null> {
  if (process.env.STORAGE_DRIVER === "s3") {
    const res = await fetch(storage().publicUrl(variantKey(key, size)));
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
  return readLocalObject(variantKey(key, size));
}

export async function deleteArtwork(key: string): Promise<void> {
  await storage().delete(ARTWORK_SIZES.map((size) => variantKey(key, size)));
}

export function artworkUrl(key: string, size: (typeof ARTWORK_SIZES)[number]): string {
  return storage().publicUrl(variantKey(key, size));
}

export function artworkSources(key: string | null): ArtworkSources | null {
  if (!key) return null;
  const url = (size: number) => storage().publicUrl(variantKey(key, size));
  return {
    src: url(512),
    srcSet: ARTWORK_SIZES.map((size) => `${url(size)} ${size}w`).join(", "),
  };
}
