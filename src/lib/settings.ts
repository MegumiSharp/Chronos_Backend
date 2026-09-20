import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { appSettings } from "@/db/schema";

export type ChannelPointsRewardSetting = { id: string; title: string; cost: number };

export const SETTING_KEYS = {
  /** Vecchia ricompensa unica "gettone" (sistema dismesso), conservata solo per poterla eliminare da Twitch. */
  channelPointsReward: "channel_points_reward",
  overlayKey: "overlay_key",
  /** Audio riprodotto durante l'animazione dell'overlay token. */
  overlayAudio: "overlay_audio",
  /** Audio riprodotto durante l'animazione dell'overlay abbonamenti. */
  overlaySubAudio: "overlay_sub_audio",
  /** Pianificazione del backup automatico (vedi lib/backup-schedule). */
  backupSchedule: "backup_schedule",
  /** Esito dell'ultimo backup automatico. */
  backupScheduleLastRun: "backup_schedule_last_run",
  /** Risposte automatiche in chat ai riscatti punti canale (vedi lib/chat-bot). */
  chatBot: "chat_bot",
} as const;

export async function deleteSetting(db: Database, key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}

export async function getSetting<T>(db: Database, key: string): Promise<T | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  return (row?.value as T | undefined) ?? null;
}

export async function setSetting(db: Database, key: string, value: unknown): Promise<void> {
  const now = new Date();
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
}
