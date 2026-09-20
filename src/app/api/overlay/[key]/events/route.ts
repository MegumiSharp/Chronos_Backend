import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { overlayEvents, tokens, type OverlayEventKind } from "@/db/schema";
import { artworkUrl } from "@/lib/artwork";
import { isValidOverlayKey } from "@/lib/overlay";

const noStore = { "Cache-Control": "no-store" };

/**
 * Eventi per gli overlay OBS, filtrati per tipo (token o abbonamenti):
 * - senza ?after: restituisce solo l'ultimo id, così un overlay appena aperto non riproduce lo storico;
 * - con ?after=<id>: gli eventi successivi (max 10), nell'ordine in cui vanno animati.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/overlay/[key]/events">) {
  const { key } = await ctx.params;
  if (!(await isValidOverlayKey(db, key))) return new Response(null, { status: 404 });

  const params = new URL(request.url).searchParams;
  const kind: OverlayEventKind = params.get("kind") === "subscription" ? "subscription" : "token";
  const ofKind = eq(overlayEvents.kind, kind);

  const afterParam = params.get("after");
  if (afterParam === null) {
    const [latest] = await db
      .select({ id: overlayEvents.id })
      .from(overlayEvents)
      .where(ofKind)
      .orderBy(desc(overlayEvents.id))
      .limit(1);
    return Response.json({ events: [], lastId: latest?.id ?? 0 }, { headers: noStore });
  }

  const after = Number(afterParam);
  if (!Number.isSafeInteger(after) || after < 0) return new Response("after non valido", { status: 400 });

  const rows = await db
    .select({
      id: overlayEvents.id,
      displayName: overlayEvents.displayName,
      source: overlayEvents.source,
      months: overlayEvents.months,
      tier: overlayEvents.tier,
      tokenName: tokens.name,
      artworkKey: tokens.artworkKey,
      accentColor: tokens.accentColor,
      xp: tokens.xp,
    })
    .from(overlayEvents)
    // leftJoin: un evento sub può non avere nessun token da mostrare.
    .leftJoin(tokens, eq(tokens.id, overlayEvents.tokenId))
    .where(and(ofKind, gt(overlayEvents.id, after)))
    .orderBy(asc(overlayEvents.id))
    .limit(10);

  return Response.json(
    {
      events: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        tokenName: row.tokenName,
        viaChannelPoints: row.source === "channel_points",
        image: row.artworkKey ? artworkUrl(row.artworkKey, 1024) : null,
        accent: row.accentColor ?? "#e8b04b",
        xp: row.xp,
        months: row.months,
        tier: row.tier,
      })),
      lastId: rows.at(-1)?.id ?? after,
    },
    { headers: noStore },
  );
}
