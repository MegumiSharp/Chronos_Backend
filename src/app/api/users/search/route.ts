import { asc, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getViewer } from "@/lib/viewer";

const MAX_RESULTS = 8;

/**
 * Suggerimenti per i campi "username Twitch" del pannello Manager.
 * Cerca solo tra chi ha già fatto accesso a Chronos: sono gli unici a cui si può assegnare qualcosa.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return new Response(null, { status: 404 });

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().replace(/^@/, "");
  if (query.length < 1) return Response.json({ users: [] }, { headers: { "Cache-Control": "no-store" } });

  const pattern = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select({
      login: users.login,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(or(ilike(users.login, pattern), ilike(users.displayName, pattern)))
    // Prima chi comincia con il testo digitato, poi il resto in ordine alfabetico.
    .orderBy(sql`case when ${users.login} ilike ${`${query}%`} then 0 else 1 end`, asc(users.login))
    .limit(MAX_RESULTS);

  return Response.json({ users: rows }, { headers: { "Cache-Control": "no-store" } });
}
