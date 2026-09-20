import { eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { eventsubMessages } from "@/db/schema";
import { audit } from "@/lib/audit";
import { EVENTSUB_HEADERS, verifyEventSubMessage, type EventSubEnvelope } from "@/lib/twitch/eventsub";
import { handleEventSubNotification } from "@/lib/twitch/handlers";

export async function POST(request: Request) {
  const secret = process.env.TWITCH_EVENTSUB_SECRET;
  if (!secret) return new Response("EventSub non configurato", { status: 500 });

  // La firma è calcolata sul body grezzo: va letto come testo prima di qualsiasi parsing.
  const body = await request.text();
  const headers = request.headers;
  const messageId = headers.get(EVENTSUB_HEADERS.messageId);

  const verification = verifyEventSubMessage({
    secret,
    messageId,
    timestamp: headers.get(EVENTSUB_HEADERS.timestamp),
    signature: headers.get(EVENTSUB_HEADERS.signature),
    body,
  });
  if (!verification.ok) return new Response(verification.reason, { status: 403 });

  const envelope = JSON.parse(body) as EventSubEnvelope;

  switch (headers.get(EVENTSUB_HEADERS.messageType)) {
    case "webhook_callback_verification":
      return new Response(envelope.challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });

    case "revocation":
      await audit(db, {
        action: "eventsub.revoked",
        targetType: "twitch",
        targetId: envelope.subscription.id,
        label: envelope.subscription.type,
        data: envelope.subscription as unknown as Record<string, unknown>,
      });
      return new Response(null, { status: 204 });

    case "notification": {
      // Twitch può reinviare lo stesso messaggio: lo elaboriamo una volta sola.
      const fresh = await db
        .insert(eventsubMessages)
        .values({ messageId: messageId!, subscriptionType: envelope.subscription.type })
        .onConflictDoNothing()
        .returning({ messageId: eventsubMessages.messageId });
      if (fresh.length === 0) return new Response(null, { status: 204 });

      try {
        const followUp = await handleEventSubNotification(envelope.subscription.type, envelope.event);
        if (followUp) {
          after(async () => {
            try {
              await followUp();
            } catch (error) {
              console.error("[eventsub] follow-up fallito", envelope.subscription.type, error);
            }
          });
        }
      } catch (error) {
        // Liberiamo l'id così il nuovo tentativo di Twitch verrà elaborato.
        await db.delete(eventsubMessages).where(eq(eventsubMessages.messageId, messageId!));
        console.error("[eventsub] elaborazione fallita", envelope.subscription.type, error);
        return new Response("Errore interno", { status: 500 });
      }
      return new Response(null, { status: 204 });
    }

    default:
      return new Response(null, { status: 204 });
  }
}
