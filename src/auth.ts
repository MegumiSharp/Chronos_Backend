import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Twitch from "next-auth/providers/twitch";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isDevLoginEnabled } from "@/lib/env";
import { getUserWithUserToken } from "@/lib/twitch/helix";
import { upsertUserOnLogin } from "@/lib/users";

declare module "next-auth" {
  interface Session {
    user: { id: string; twitchId: string } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    twitchId?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/accedi" },
  providers: [
    // Il login serve solo a identificare l'utente: nessuno scope oltre a openid.
    // Lo stato abbonamento arriva da EventSub, mai da questo token.
    Twitch({
      authorization: {
        params: {
          scope: "openid",
          // Stringa, non oggetto: il merge profondo di Auth.js manterrebbe il claim "email" di default,
          // che senza lo scope user:read:email fa rispondere a Twitch "insufficient_scope".
          claims: JSON.stringify({ id_token: { picture: null, preferred_username: null } }),
        },
      },
    }),
    Credentials({
      id: "dev-login",
      name: "Utente di prova",
      credentials: { twitchId: {} },
      async authorize(credentials) {
        if (!isDevLoginEnabled()) return null;
        const twitchId = String(credentials?.twitchId ?? "");
        const [user] = await db.select().from(users).where(eq(users.twitchId, twitchId));
        if (!user) return null;
        await upsertUserOnLogin({
          twitchId: user.twitchId,
          login: user.login,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        });
        return { id: user.id, name: user.displayName, image: user.avatarUrl, twitchId: user.twitchId };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (account?.provider === "twitch" && account.access_token) {
        const profile = await getUserWithUserToken(account.access_token);
        const dbUser = await upsertUserOnLogin({
          twitchId: profile.id,
          login: profile.login,
          displayName: profile.display_name,
          avatarUrl: profile.profile_image_url || null,
        });
        token.uid = dbUser.id;
        token.twitchId = dbUser.twitchId;
      } else if (account?.provider === "dev-login" && user?.id) {
        token.uid = user.id;
        token.twitchId = (user as { twitchId?: string }).twitchId;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid && token.twitchId) {
        session.user.id = token.uid;
        session.user.twitchId = token.twitchId;
      }
      return session;
    },
  },
});
