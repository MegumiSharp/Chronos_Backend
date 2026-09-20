/** Utility colore senza dipendenze server: usabili anche nei Client Component. */

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export { rgbToHsl };

/** Versione "matte" di un colore: stessa tinta, saturazione contenuta e luminosità media. */
export function matteColor(hex: string | null | undefined): string | null {
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return null;
  const [h, s] = rgbToHsl(...rgb);
  return hslToHex(h, Math.min(Math.max(s * 0.55, 0.22), 0.42), 0.56);
}

/**
 * Palette matte per i tipi di evento: tinte desaturate che restano leggibili sul fondo scuro
 * e non litigano con il colore predominante dell'artwork. Sono scorciatoie, non una gabbia:
 * dal pannello si può scegliere qualsiasi colore, tanto passa comunque da matteColor().
 */
export const EVENT_COLORS: { value: string; label: string }[] = [
  { value: "#c4562e", label: "Brace" },
  { value: "#d2603f", label: "Terracotta" },
  { value: "#e08a3c", label: "Ambra" },
  { value: "#e8b04b", label: "Oro" },
  { value: "#c9bf5f", label: "Ottone" },
  { value: "#b58b5a", label: "Sabbia" },
  { value: "#8f7a4f", label: "Bronzo" },
  { value: "#8fbe5f", label: "Felce" },
  { value: "#6fbe8f", label: "Salvia" },
  { value: "#3fae7a", label: "Bosco" },
  { value: "#4fd1c5", label: "Acqua" },
  { value: "#4aa8d8", label: "Ghiaccio" },
  { value: "#7a9cc6", label: "Ardesia" },
  { value: "#6b7fd9", label: "Indaco" },
  { value: "#9b6bff", label: "Viola" },
  { value: "#b96bd9", label: "Orchidea" },
  { value: "#d9737f", label: "Rosa antico" },
  { value: "#d95f8f", label: "Magenta" },
  { value: "#c05555", label: "Rubino" },
  { value: "#a8a2b8", label: "Cenere" },
];

/** Qualsiasi #rrggbb va bene: il sito mostra sempre la versione matte di quello che scegli. */
export function isEventColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}
