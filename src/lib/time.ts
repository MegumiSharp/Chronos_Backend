/** Le date sono salvate in UTC e mostrate sempre nel fuso del canale. */
export const TIME_ZONE = "Europe/Rome";

const dateFormat = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const dateTimeFormat = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function romeParts(date: Date) {
  const parts = partsFormat.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function romeOffsetMs(date: Date): number {
  const p = romeParts(date);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60_000) * 60_000;
}

/** Date → valore per <input type="datetime-local"> nel fuso del canale. */
export function toRomeInputValue(date: Date | null | undefined): string {
  if (!date) return "";
  const p = romeParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Valore di <input type="datetime-local"> (ora italiana) → Date UTC. Gestisce l'ora legale. */
export function fromRomeInputValue(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const naive = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  let utc = naive - romeOffsetMs(new Date(naive));
  utc = naive - romeOffsetMs(new Date(utc));
  return new Date(utc);
}
