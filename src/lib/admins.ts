import { eq } from "drizzle-orm";
import type { Database } from "@/db";
import { admins } from "@/db/schema";
import { envAdminTwitchIds } from "./env";

/**
 * Lo streamer del canale è sempre admin (è il suo sito e non può restare fuori).
 * Tutti gli altri accessi sono concessi dal pannello e si possono togliere.
 */
export function isPermanentAdmin(twitchId: string): boolean {
  const broadcaster = process.env.TWITCH_BROADCASTER_ID;
  return Boolean(broadcaster) && twitchId === broadcaster;
}

export async function isAdminTwitchId(db: Database, twitchId: string): Promise<boolean> {
  if (isPermanentAdmin(twitchId)) return true;
  const [row] = await db.select({ id: admins.twitchId }).from(admins).where(eq(admins.twitchId, twitchId));
  return Boolean(row);
}

/**
 * ADMIN_TWITCH_IDS serve solo ad avviare il sistema: al primo passaggio gli id elencati
 * diventano righe normali nella tabella admins, quindi revocabili dal pannello.
 */
export async function bootstrapAdmins(db: Database): Promise<number> {
  const ids = [...envAdminTwitchIds()].filter((id) => !isPermanentAdmin(id));
  if (ids.length === 0) return 0;
  const inserted = await db
    .insert(admins)
    .values(ids.map((twitchId) => ({ twitchId })))
    .onConflictDoNothing()
    .returning({ twitchId: admins.twitchId });
  return inserted.length;
}
