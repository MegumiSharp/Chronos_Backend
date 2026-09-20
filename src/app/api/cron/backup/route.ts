import { runScheduledBackup } from "@/lib/backup-schedule";

export const maxDuration = 300;

/**
 * Chiamato dal container cron ogni 5 minuti. Non fa nulla finché il backup automatico
 * non è attivo e non è arrivato il suo orario; poi lo esegue una volta sola per giorno.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new Response("Non autorizzato", { status: 401 });
  }
  return Response.json(await runScheduledBackup());
}
