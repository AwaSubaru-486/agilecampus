import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { getTutorialProgress } from "@/lib/tutorials/progress";
import { TutorialProvider } from "./tutorials/tutorial-provider";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";
import { Suspense } from "react";
import { PendingActionBadge } from "./_shell/pending-action-badge";
import { TopWorkbar } from "./_shell/top-workbar";
import { StuckButton } from "./stuck-button";
import { TaskNotificationInbox } from "./_shell/task-notification-inbox";
import { WebDeskPet } from "./_shell/web-desk-pet";

// 应用骨架。Commit 2/13 起由「左侧永久导航」改为「顶部工作带」。
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [myProjects, memberships, tutorialProgress] = await Promise.all([
    listMyProjects(session.user.id),
    db.select({ teamId: teamMembers.teamId, role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.userId, session.user.id)),
    getTutorialProgress(session.user.id),
  ]);

  const switcherProjects = myProjects.map((p) => ({
    id: p.id,
    name: p.name,
    teamName: p.teamName,
  }));

  return (
    <TutorialProvider initialProgress={tutorialProgress} projects={myProjects.flatMap((project) => {
      const membership = memberships.find((item) => item.teamId === project.teamId);
      return membership ? [{ id: project.id, name: project.name, teamId: project.teamId, teamName: project.teamName, taskTotal: project.taskTotal, role: membership.role }] : [];
    })}>
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
        collaborationBadge={<Suspense fallback={null}><PendingActionBadge userId={session.user.id} /></Suspense>}
      />
      <main id="main-content" tabIndex={-1} className="ac-shell-main">
        {children}
      </main>

      {/* 悬浮求助入口 */}
      <StuckButton projects={switcherProjects.map((p) => ({ id: p.id, name: p.name }))} />
      <TaskNotificationInbox key={session.user.id} userId={session.user.id} />

      {/* 网页常驻浮动桌宠 (纯像素风格 · 拖拽交互 · 消息与预警联动) */}
      <WebDeskPet />
    </div>
    </TutorialProvider>
  );
}
