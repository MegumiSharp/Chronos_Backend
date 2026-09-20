import { db } from "@/db";
import { audit } from "./audit";
import { describeDbError, exportBackup } from "./backup";
import { deleteBackup, listBackups, saveBackup } from "./backup-store";
import { getSetting, setSetting, SETTING_KEYS } from "./settings";
import { fromRomeInputValue, TIME_ZONE } from "./time";

/**
 * Backup automatico: attivo o no, a che ora (ora italiana), in quali giorni e quanti
 * backup automatici tenere. Il container cron chiama /api/cron/backup ogni 5 minuti:
 * il backup parte alla prima chiamata dopo l'orario, una sola volta per giorno.
 */
export type BackupSchedule = {
  enabled: boolean;
  /** Giorni ISO: 1 = lunedì … 7 = domenica. */
  days: number[];
  /** "HH:MM" in ora italiana. */
  time: string;
  /** Backup automatici da conservare; i più vecchi vengono eliminati. */
  keep: number;
};

export type BackupScheduleRun = {
  /** Giorno (ora italiana) a cui si riferisce l'esecuzione: evita doppioni nello stesso giorno. */
  day: string;
  at: string;
  ok: boolean;
  id?: string;
  error?: string;
  pruned?: number;
};

export const MIN_KEEP = 1;
export const MAX_KEEP = 60;

export const DEFAULT_SCHEDULE: BackupSchedule = { enabled: false, days: [1, 2, 3, 4, 5, 6, 7], time: "04:30", keep: 14 };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normalizeSchedule(input: Partial<BackupSchedule> | null): BackupSchedule {
  const days = [...new Set((input?.days ?? DEFAULT_SCHEDULE.days).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))];
  const keep = Number(input?.keep);
  return {
    enabled: Boolean(input?.enabled),
    days: days.sort((a, b) => a - b),
    time: input?.time && TIME_PATTERN.test(input.time) ? input.time : DEFAULT_SCHEDULE.time,
    keep: Number.isInteger(keep) ? Math.min(MAX_KEEP, Math.max(MIN_KEEP, keep)) : DEFAULT_SCHEDULE.keep,
  };
}

export async function getBackupSchedule(): Promise<BackupSchedule> {
  return normalizeSchedule(await getSetting<Partial<BackupSchedule>>(db, SETTING_KEYS.backupSchedule));
}

export async function saveBackupSchedule(schedule: BackupSchedule): Promise<void> {
  await setSetting(db, SETTING_KEYS.backupSchedule, schedule);
}

export async function getLastScheduledRun(): Promise<BackupScheduleRun | null> {
  return getSetting<BackupScheduleRun>(db, SETTING_KEYS.backupScheduleLastRun);
}

/** Data, giorno della settimana e minuti del giorno in ora italiana. */
function romeClock(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const isoDay = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    isoDay,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Deve partire adesso? Sì se oggi è un giorno scelto, l'orario è passato e oggi non è ancora partito. */
export function isDue(schedule: BackupSchedule, lastRun: BackupScheduleRun | null, now = new Date()): boolean {
  if (!schedule.enabled || schedule.days.length === 0) return false;
  const clock = romeClock(now);
  return schedule.days.includes(clock.isoDay) && clock.minutes >= minutesOf(schedule.time) && lastRun?.day !== clock.day;
}

/** Prossima esecuzione prevista, per mostrarla nel pannello. */
export function nextRun(schedule: BackupSchedule, lastRun: BackupScheduleRun | null, now = new Date()): Date | null {
  if (!schedule.enabled || schedule.days.length === 0) return null;
  const today = romeClock(now);
  const [y, m, d] = today.day.split("-").map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    // Mezzogiorno UTC del giorno cercato: in Italia è sempre la stessa data, anche col cambio d'ora.
    const clock = romeClock(new Date(Date.UTC(y, m - 1, d + offset, 12)));
    if (!schedule.days.includes(clock.isoDay)) continue;
    if (offset === 0) {
      if (lastRun?.day === clock.day) continue;
      // Orario già passato ma non ancora eseguito: parte al prossimo giro del cron.
      if (today.minutes >= minutesOf(schedule.time)) return now;
    }
    return fromRomeInputValue(`${clock.day}T${schedule.time}`);
  }
  return null;
}

/** Elimina i backup automatici oltre il numero da tenere. Manuali, importati e di sicurezza non si toccano. */
export async function pruneAutomaticBackups(keep: number): Promise<number> {
  const automatic = (await listBackups()).filter((b) => b.kind === "auto");
  const excess = automatic.slice(keep);
  for (const backup of excess) await deleteBackup(backup.id);
  return excess.length;
}

let running = false;

export type ScheduledOutcome = { ran: false; reason: string } | { ran: true; run: BackupScheduleRun };

/** Chiamata dal cron: esegue il backup se è il momento, altrimenti non fa nulla. */
export async function runScheduledBackup(now = new Date()): Promise<ScheduledOutcome> {
  if (running) return { ran: false, reason: "già in corso" };
  const [schedule, lastRun] = await Promise.all([getBackupSchedule(), getLastScheduledRun()]);
  if (!isDue(schedule, lastRun, now)) return { ran: false, reason: schedule.enabled ? "non è il momento" : "disattivato" };

  running = true;
  const day = romeClock(now).day;
  try {
    // Il giorno viene segnato subito: un errore non deve far ripartire il backup ogni 5 minuti.
    const claim: BackupScheduleRun = { day, at: now.toISOString(), ok: false, error: "in corso" };
    await setSetting(db, SETTING_KEYS.backupScheduleLastRun, claim);

    let run: BackupScheduleRun;
    try {
      const stored = await saveBackup(await exportBackup(), "auto");
      const pruned = await pruneAutomaticBackups(schedule.keep);
      run = { day, at: new Date().toISOString(), ok: true, id: stored.id, pruned };
    } catch (error) {
      run = { day, at: new Date().toISOString(), ok: false, error: describeDbError(error) };
    }
    await setSetting(db, SETTING_KEYS.backupScheduleLastRun, run);
    await audit(db, { action: run.ok ? "backup.scheduled" : "backup.scheduled_failed", data: run }).catch(() => {});
    return { ran: true, run };
  } finally {
    running = false;
  }
}
