import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword } from "./password";
import { loginWithFeishuCode } from "@/lib/user";
import { rateLimit, resetRateLimit } from "./rate-limit";

// 即使直接调用 NextAuth 的凭据接口，也要限制同一账号的密码尝试次数。
const LOGIN_EMAIL_LIMIT = 8;
const LOGIN_EMAIL_WINDOW_MS = 10 * 60 * 1000;

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase();
        const emailLimitKey = `login:email:${email}`;
        if (!rateLimit(emailLimitKey, LOGIN_EMAIL_LIMIT, LOGIN_EMAIL_WINDOW_MS).ok) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email));
        if (!user) return null;

        // agent 也是 users 的一行（见 schema 注释），但它没有密码。
        // 两道闸门缺一不可：kind 判定在前，passwordHash 为空在后——
        // 前者是意图，后者是兜底，防止日后有人给 agent 误设了密码。
        if (user.kind !== "human" || !user.passwordHash) return null;

        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        resetRateLimit(emailLimitKey);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    Credentials({
      id: "feishu",
      credentials: { code: {} },
      authorize: async (credentials) => {
        const code = credentials?.code;
        if (typeof code !== "string" || !code) return null;
        try {
          const user = await loginWithFeishuCode(code);
          return { id: user.id, email: user.email, name: user.name };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.id as string;
      return session;
    },
  },
});
