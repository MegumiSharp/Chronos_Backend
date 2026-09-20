/**
 * Costo dei livelli a scaglioni: dentro uno scaglione ogni livello costa uguale.
 *
 *   livelli 1-10   250 XP l'uno  → l'11 arriva a 2.500 XP
 *   livelli 11-20  500 XP l'uno  → il 21 arriva a 7.500 XP
 *   livelli 21-30  750 XP l'uno  → il 31 arriva a 15.000 XP
 *   dal 31 in poi  1.000 XP l'uno
 *
 * Gli scaglioni coincidono con gli emblemi (bronzo, argento, oro, master).
 */
const LEVEL_TIERS: { upTo: number; xp: number }[] = [
  { upTo: 10, xp: 250 },
  { upTo: 20, xp: 500 },
  { upTo: 30, xp: 750 },
];
const LEVEL_XP_BEYOND = 1000;
export const MAX_LEVEL = 200;

/** XP necessari per passare dal livello `level` al successivo. */
export function xpToAdvance(level: number): number {
  return LEVEL_TIERS.find((tier) => level <= tier.upTo)?.xp ?? LEVEL_XP_BEYOND;
}

/** XP totali necessari per raggiungere `level` (il livello 1 parte da 0 XP). */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToAdvance(l);
  return total;
}

export function levelForXp(xp: number): number {
  let level = 1;
  let total = 0;
  while (level < MAX_LEVEL && total + xpToAdvance(level) <= xp) {
    total += xpToAdvance(level);
    level++;
  }
  return level;
}

export type LevelProgress = {
  level: number;
  xp: number;
  /** XP mancanti al livello successivo. */
  xpToNextLevel: number;
  /** 0..1 all'interno del livello corrente. */
  progress: number;
};

export function levelProgress(xp: number): LevelProgress {
  const safeXp = Math.max(xp, 0);
  const level = levelForXp(safeXp);
  const start = xpForLevel(level);
  const span = xpToAdvance(level);
  return {
    level,
    xp: safeXp,
    xpToNextLevel: start + span - safeXp,
    progress: span > 0 ? (safeXp - start) / span : 1,
  };
}

/** Emblemi di traguardo: uno ogni dieci livelli, dal bronzo al master. */
export type Emblem = "bronzo" | "silver" | "gold" | "master";

export const EMBLEM_LEVELS: { level: number; emblem: Emblem }[] = [
  { level: 30, emblem: "master" },
  { level: 20, emblem: "gold" },
  { level: 10, emblem: "silver" },
  { level: 1, emblem: "bronzo" },
];

export function emblemForLevel(level: number): Emblem {
  return EMBLEM_LEVELS.find((step) => level >= step.level)?.emblem ?? "bronzo";
}

/** Livello a cui si sblocca l'emblema successivo, o null se si è già all'oro. */
export function nextEmblemLevel(level: number): number | null {
  const next = [...EMBLEM_LEVELS].reverse().find((step) => step.level > level);
  return next?.level ?? null;
}
