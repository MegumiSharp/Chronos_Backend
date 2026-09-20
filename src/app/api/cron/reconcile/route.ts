import { runDailyMaintenance } from "@/lib/twitch/sync";

export const maxDuration = 300;

/** Chiamato una volta al giorno da Vercel Cron (vedi vercel.json). */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return new Response("Non autorizzato", { status: 401 });
  }
  return Response.json(await runDailyMaintenance());
}
