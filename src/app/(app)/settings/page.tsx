import { redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { FeishuCard } from "./feishu-card";

function fmt(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ feishu?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [row] = await db
    .select({ feishuName: users.feishuName, feishuBoundAt: users.feishuBoundAt })
    .from(users)
    .where(eq(users.id, session.user.id));
  const { feishu } = await searchParams;

  return (
    <main data-tour="settings" className="mx-auto max-w-2xl space-y-8 py-8">
      <header className="ac-page-header">
        <h1 className="font-display text-2xl font-semibold text-ink">设置</h1>
        <p className="text-sm text-ink-2">需要接收通知、连接外部工具时，在这里配置。</p>
      </header>

      <FeishuCard
        boundName={row?.feishuName ?? null}
        boundAtLabel={fmt(row?.feishuBoundAt ?? null)}
        notice={feishu ?? null}
      />
      <section className="ac-focus-card p-6"><h2 className="text-base font-semibold text-ink">连接你的工作工具</h2><p className="mt-2 text-sm leading-6 text-ink-3">使用个人访问令牌连接 VS Code 或外部 AI 工具。按需创建，并保管好访问权限。</p><Link href="/settings/tokens" className="ac-btn-ghost mt-5">管理访问令牌 →</Link></section>
    </main>
  );
}
