"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_ITEMS, activeNavHref } from "./nav-items";
import { AccountMenu } from "./account-menu";
import { ProjectSwitcher, type SwitcherProject } from "./project-switcher";
import { Badge } from "@/components/ui";
import {
  buildSpaceHref,
  PROJECT_SPACES,
  SPACE_HINT,
  SPACE_LABEL,
  parseProjectSpace,
} from "@/lib/project-space";

// shadcn dashboard 风格的工作台壳：桌面固定左侧，窄屏回退到顶部。
//
// 桌面与移动用同一个组件响应式处理，而不是两份结构——两份会长歪，
// 而且「移动端少显示一项」这类差异一旦分家就再也对不上。
//
// 桌面侧栏 248px，移动端保留 52px 顶栏，避免破坏现有深链和键盘导航。
export function TopWorkbar({
  userName,
  projects,
  /** 待我处理的协作事项数。>0 时在「协作中心」上打一个点 */
  collaborationCount = 0,
}: {
  userName: string;
  projects: SwitcherProject[];
  collaborationCount?: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeNavHref(pathname);
  const projectId = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
  const currentSpace = parseProjectSpace(searchParams.get("space"));
  const currentTaskId = searchParams.get("task") ?? undefined;
  const currentConversation = searchParams.get("conversation") ?? undefined;
  const currentApproval = searchParams.get("approval") ?? undefined;

  function spaceHref(space: (typeof PROJECT_SPACES)[number]) {
    return buildSpaceHref({
      projectId: projectId as string,
      space,
      taskId: currentTaskId,
      extra: space === "studio"
        ? { conversation: currentConversation, approval: currentApproval }
        : space === "work"
          ? Object.fromEntries(
              ["assignee", "priority", "label", "milestone", "overdue", "group"].map((key) => [key, searchParams.get(key) ?? undefined]),
            )
          : undefined,
    });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-stroke bg-panel md:fixed md:inset-y-0 md:left-0 md:w-64 md:border-b-0 md:border-r">
      <div className="mx-auto flex h-[52px] max-w-[120rem] items-center gap-2 px-3 sm:h-14 sm:gap-4 sm:px-5 md:h-full md:max-w-none md:flex-col md:items-stretch md:gap-0 md:px-4 md:py-4">
        {/* 品牌 */}
        <Link
          href="/today"
          aria-label="AgileCampus 首页"
          className="flex shrink-0 items-center gap-2 rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1"
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-[var(--radius-control)] border border-stroke-strong bg-ink text-[11px] font-bold text-ground"
          >
            AC
          </span>
          <span className="hidden text-sm font-semibold tracking-tight text-ink lg:inline md:inline">
            AgileCampus
          </span>
        </Link>

        <span aria-hidden className="hidden text-stroke-strong lg:inline md:inline">
          /
        </span>

        {/* 项目切换器。移动端收小，但保留——它是换项目的主入口 */}
        <div className="min-w-0 shrink md:mt-8 md:w-full">
          <ProjectSwitcher projects={projects} />
        </div>

        {/* 一级导航 */}
        <nav aria-label="主导航" className="ml-auto flex items-center gap-0.5 overflow-x-auto no-scrollbar sm:gap-1 md:ml-0 md:mt-6 md:flex-col md:items-stretch md:gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = active === item.href;
            const showDot = item.href === "/collaboration" && collaborationCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.hint}
                aria-current={isActive ? "page" : undefined}
                className={`ac-pressable relative flex min-h-9 shrink-0 items-center whitespace-nowrap border-b-2 px-1.5 py-1.5 text-xs transition-colors rounded-t-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1 sm:px-2.5 sm:text-sm md:min-h-10 md:justify-start md:border-b-0 md:px-3 md:py-2 md:text-sm ${
                  isActive
                    ? "border-ink bg-sunken font-medium text-ink"
                    : "border-transparent text-ink-2 hover:border-stroke-strong hover:bg-sunken hover:text-ink"
                }`}
              >
                {item.label}
                {showDot && (
                  <Badge
                    tone="risk"
                    aria-label={`${collaborationCount} 项待处理`}
                    className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold leading-4 text-white"
                  >
                    {collaborationCount > 9 ? "9+" : collaborationCount}
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>

        {projectId && (
          <div className="hidden border-t border-stroke pt-4 md:mt-4 md:block">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
              当前项目
            </p>
            <nav aria-label="项目空间" className="space-y-0.5">
              {PROJECT_SPACES.map((space) => {
                const isActive = currentSpace === space;
                return (
                  <Link
                    key={space}
                    href={spaceHref(space)}
                    title={SPACE_HINT[space]}
                    aria-current={isActive ? "page" : undefined}
                    className={`ac-pressable flex min-h-9 items-center justify-between px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1 ${
                      isActive
                        ? "bg-sunken font-medium text-ink"
                        : "text-ink-2 hover:bg-sunken hover:text-ink"
                    }`}
                  >
                    <span>{SPACE_LABEL[space]}</span>
                    <span className="text-[10px] text-ink-faint">{space === "studio" ? "AI" : ""}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        )}

        <div className="ml-1 shrink-0 sm:ml-2 md:mt-auto md:ml-0 md:w-full">
          <AccountMenu name={userName} />
        </div>
      </div>
    </header>
  );
}

// 项目上下文带：只在项目内出现，承载项目名、最近里程碑与四个模式的切换。
//
// 放在同一个文件里，是因为它必须与工作带同处一个 sticky 层——
// 分两个文件会出现两条各自 sticky 的带子互相挤压。
export function ProjectBand({
  projectName,
  latestMilestone,
  spaces,
  actions,
  backHref = "/projects",
  backLabel = "项目",
}: {
  projectName: string;
  latestMilestone: string | null;
  spaces: React.ReactNode;
  actions?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="sticky top-[52px] z-30 border-b border-stroke bg-ground/95 sm:top-14 md:top-0">
      <div className="mx-auto flex h-12 max-w-[120rem] items-center justify-between gap-3 px-3 sm:px-5 md:h-14 md:px-6">
        <div className="flex min-w-0 items-baseline gap-2">
          <Link
            href={backHref}
            className="shrink-0 text-xs text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            {backLabel}
          </Link>
          <span aria-hidden className="shrink-0 text-stroke-strong">
            /
          </span>
          <span className="truncate text-sm font-semibold text-ink">{projectName}</span>
          {latestMilestone && (
            <>
              <span aria-hidden className="shrink-0 text-stroke-strong">
                /
              </span>
              <span className="hidden truncate text-xs text-ink-3 sm:inline">{latestMilestone}</span>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 overflow-x-auto">
          <div className="md:hidden">{spaces}</div>
          {actions}
        </div>
      </div>
    </div>
  );
}
