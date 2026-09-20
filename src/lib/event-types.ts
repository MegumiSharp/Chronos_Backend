import { asc, eq, sql } from "drizzle-orm";
import { db, type Database } from "@/db";
import { eventTypes, tokens, type EventType } from "@/db/schema";
import { isEventColor } from "./color";

export type EventTypeView = { id: string; name: string; color: string; description: string | null };

export const EVENT_TYPE_NAME_MAX = 60;
export const EVENT_TYPE_DESCRIPTION_MAX = 200;

export async function listEventTypes(): Promise<EventTypeView[]> {
  const rows = await db.select().from(eventTypes).orderBy(asc(sql`lower(${eventTypes.name})`));
  return rows.map(({ id, name, color, description }) => ({ id, name, color, description }));
}

/** Controlli comuni a creazione e modifica. Restituisce un messaggio d'errore o null. */
export async function validateEventType(
  name: string,
  color: string,
  description: string,
  currentId?: string,
): Promise<string | null> {
  if (description.length > EVENT_TYPE_DESCRIPTION_MAX) {
    return `La descrizione può avere al massimo ${EVENT_TYPE_DESCRIPTION_MAX} caratteri.`;
  }
  if (name.length < 2) return "Il nome deve avere almeno 2 caratteri.";
  if (name.length > EVENT_TYPE_NAME_MAX) return `Il nome può avere al massimo ${EVENT_TYPE_NAME_MAX} caratteri.`;
  if (!isEventColor(color)) return "Colore non valido: usa un esadecimale tipo #7a9cc6.";
  const [clash] = await db
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(sql`lower(${eventTypes.name}) = lower(${name})`);
  if (clash && clash.id !== currentId) return `Esiste già un tipo evento chiamato "${name}".`;
  return null;
}

/** Riallinea la copia di nome, colore e descrizione sui token di quel tipo. */
export async function syncTokensOfType(tx: Database, type: Pick<EventType, "id" | "name" | "color" | "description">) {
  await tx
    .update(tokens)
    .set({ eventLabel: type.name, eventColor: type.color, eventDescription: type.description })
    .where(eq(tokens.eventTypeId, type.id));
}
