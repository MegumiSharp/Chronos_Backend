import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/db";
import { channelModerators, users, type User } from "@/db/schema";
import { isAdminTwitchId } from "./admins";
import { isFollower } from "./followers";
import { isSubscriber } from "./subscriptions";

/** Ruolo sul canale Twitch: moderatori da EventSub/reconciliation, broadcaster da TWITCH_BROADCASTER_ID. */
export type ChannelRole = "broadcaster" | "moderator" | null;

export type Viewer = {
  user: User;
  isSubscriber: boolean;
  isFollower: boolean;
  /**
   * Può usare il sito: follower, abbonato o staff. Gli altri vedono solo l'invito a seguire il canale
   * (abbonati e staff passano comunque, così un dato follower in ritardo non chiude fuori nessuno).
   */
  hasAccess: boolean;
  isAdmin: boolean;
  role: ChannelRole;
};

/** Utente corrente con stato abbonamento letto dal database locale. Deduplicato per richiesta. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;

  const [subscriber, follower, admin, [moderator]] = await Promise.all([
    isSubscriber(db, user.twitchId),
    isFollower(db, user.twitchId),
    isAdminTwitchId(db, user.twitchId),
    db
      .select({ id: channelModerators.twitchUserId })
      .from(channelModerators)
      .where(eq(channelModerators.twitchUserId, user.twitchId)),
  ]);

  const role: ChannelRole =
    user.twitchId === process.env.TWITCH_BROADCASTER_ID ? "broadcaster" : moderator ? "moderator" : null;

  return {
    user,
    isSubscriber: subscriber,
    isFollower: follower,
    hasAccess: follower || subscriber || admin,
    isAdmin: admin,
    role,
  };
});

/** Per le pagine admin: chi non è admin vede un 404, non la pagina. */
export async function requireAdminPage(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) notFound();
  return viewer;
}

/** Per le Server Action admin: sono raggiungibili con POST diretti, quindi si verifica sempre. */
export async function requireAdminAction(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) throw new Error("Non autorizzato");
  return viewer;
}
