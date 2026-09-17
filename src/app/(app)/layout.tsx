import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";
import { AppNavigation } from "./app-navigation";
import { StuckButton } from "./stuck-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // 悬浮求助入口要一份「我在哪些项目」以供选择。每页多一次查询，
  // 换来的是无论身处哪一页都能一键求助——这个代价值得。
  const myProjects = await listMyProjects(session.user.id);
  const projectOptions = myProjects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface p-4 lg:flex">
        <Link href="/projects" className="flex items-center gap-3 px-2 py-2">
          <span aria-hidden className="relative grid size-9 place-items-center rounded-xl bg-ink text-xs font-bold tracking-tight text-white shadow-sm">
            AC
            <i className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-surface bg-accent" />
          </span>
          <span>
            <span className="block text-sm font-bold tracking-[-0.02em] text-ink">AgileCampus</span>
            <span className="block text-[10px] tracking-[0.12em] text-ink-faint">TEAM OS</span>
          </span>
        </Link>

        <div className="mt-7 px-2 text-[10px] font-semibold tracking-[0.14em] text-ink-faint">WORKSPACE</div>
        <div className="mt-2"><AppNavigation /></div>

        <div className="mt-auto space-y-3">
          <div className="rounded-2xl bg-ink p-3.5 text-white">
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className="size-2 rounded-full bg-[#7CF2C3] shadow-[0_0_0_4px_rgba(124,242,195,0.12)]" />
              AI 协作在线
            </div>
            <p className="mt-2 text-[11px] leading-5 text-white/55">项目上下文会跟随任务进入会话，不再重复解释背景。</p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
            className="flex items-center gap-2 rounded-xl border border-line p-2"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              {(session.user.name || "U").slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{session.user.name}</span>
            <button className="rounded-lg px-2 py-1 text-[11px] text-ink-faint hover:bg-sunken hover:text-ink">退出</button>
          </form>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur-xl lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <Link href="/projects" className="font-bold text-ink">AgileCampus</Link>
            <span className="text-xs text-ink-faint">{session.user.name}</span>
          </div>
          <AppNavigation mobile />
        </header>
        <div className="hidden h-14 items-center justify-between border-b border-line bg-surface/70 px-8 backdrop-blur lg:flex">
          <p className="text-xs font-medium text-ink-soft">高校团队协作空间</p>
          <p className="flex items-center gap-2 text-xs text-ink-faint"><span className="size-1.5 rounded-full bg-done" /> 所有更改自动保存</p>
        </div>
        <div className="mx-auto max-w-[90rem] p-4 sm:p-6 lg:p-8">{children}</div>
      </section>

      <StuckButton projects={projectOptions} />
    </div>
  );
}
