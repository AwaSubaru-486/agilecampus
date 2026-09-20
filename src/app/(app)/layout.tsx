import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";
import { countMyPendingActions } from "@/lib/shell";
import { TopWorkbar } from "./_shell/top-workbar";
import { StuckButton } from "./stuck-button";

// 应用骨架。Commit 2/13 起由「左侧永久导航」改为「顶部工作带」。
//
// 工作带取代了旧侧栏，但**发布出去的能力一个没少**：
// 换项目、进各一级页、看账户、退出，四件事都在。
// 唯一暂时保留的是悬浮求助入口——按计划 §7，它要等「协作」页
// 验收之后才撤，免得功能先没、替代的还没上。
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [myProjects, pendingCount] = await Promise.all([
    listMyProjects(session.user.id),
    countMyPendingActions(session.user.id),
  ]);

  // 只把有权访问的项目交给切换器。过滤在服务端做完，
  // 客户端拿到的这份 props 里根本不存在无权项目。
  const switcherProjects = myProjects.map((p) => ({
    id: p.id,
    name: p.name,
    teamName: p.teamName,
  }));

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-[var(--radius-control)] bg-ink px-3 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        跳到主要内容
      </a>
      <TopWorkbar
        userName={session.user.name ?? ""}
        projects={switcherProjects}
        collaborationCount={pendingCount}
      />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[120rem] px-3 py-4 sm:px-5 sm:py-6">
        {children}
      </main>

      <StuckButton projects={switcherProjects.map((p) => ({ id: p.id, name: p.name }))} />
    </div>
  );
}
