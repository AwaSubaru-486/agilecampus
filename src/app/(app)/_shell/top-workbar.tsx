"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
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
  const [collapsed, setCollapsed] = useState(false);
  const active = activeNavHref(pathname);
  const projectId = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
  const navigationProject = projectId
    ? projects.find((project) => project.id === projectId) ?? null
    : projects[0] ?? null;
  const currentSpace = parseProjectSpace(searchParams.get("space"));
  const currentTaskId = searchParams.get("task") ?? undefined;
  const currentConversation = searchParams.get("conversation") ?? undefined;
  const currentApproval = searchParams.get("approval") ?? undefined;

  function spaceHref(space: (typeof PROJECT_SPACES)[number]) {
    if (!navigationProject) return "/projects";
    return buildSpaceHref({
      projectId: navigationProject.id,
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
    <header
      data-collapsed={collapsed}
      className="ac-shell-sidebar sticky top-0 z-40 border-b border-stroke bg-panel md:fixed md:inset-y-0 md:left-0 md:w-64 md:border-b-0 md:border-r"
    >
      <div className="ac-shell-sidebar-inner mx-auto flex h-[52px] max-w-[120rem] items-center gap-2 px-3 sm:h-14 sm:gap-4 sm:px-5 md:h-full md:max-w-none md:flex-col md:items-stretch md:gap-0 md:px-4 md:py-4">
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
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          className="ac-sidebar-collapse size-8 place-items-center border border-stroke text-sm text-ink-2 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
        >
          {collapsed ? "→" : "←"}
        </button>

        {/* 项目切换器。移动端收小，但保留——它是换项目的主入口 */}
        <div className="ac-shell-switcher min-w-0 shrink md:mt-8 md:w-full">
          <ProjectSwitcher projects={projects} />
        </div>

        {/* 一级导航 */}
        <nav aria-label="主导航" className="ac-shell-primary-nav ml-auto flex items-center gap-0.5 overflow-x-auto no-scrollbar sm:gap-1 md:ml-0 md:mt-6 md:flex-col md:items-stretch md:gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = active === item.href;
            const showDot = item.href === "/collaboration" && collaborationCount > 0;
            return (
                <Fragment key={item.href}>
                  <Link
                    href={item.href}
                    title={item.hint}
                    aria-current={isActive ? "page" : undefined}
                    className={`ac-pressable relative flex min-h-9 shrink-0 items-center whitespace-nowrap border-b-2 px-1.5 py-1.5 text-xs transition-colors rounded-t-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1 sm:px-2.5 sm:text-sm md:min-h-10 md:justify-start md:border-b-0 md:px-3 md:py-2 md:text-sm ${
                      isActive
                        ? "border-ink bg-sunken font-medium text-ink"
                        : "border-transparent text-ink-2 hover:border-stroke-strong hover:bg-sunken hover:text-ink"
                    }`}
                  >
                    <span aria-hidden={collapsed}>{collapsed ? item.label.slice(0, 1) : item.label}</span>
                    {collapsed && <span className="sr-only">{item.label}</span>}
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

                  {isActive && item.href === "/today" && (
                    <SecondaryGroup label="今日">
                      <SecondaryLink href="/today#decisions">待处理</SecondaryLink>
                      <SecondaryLink href="/today#in-progress">我正在推进</SecondaryLink>
                    </SecondaryGroup>
                  )}

                  {isActive && item.href === "/projects" && (
                    <SecondaryGroup label={navigationProject ? `项目 · ${navigationProject.name}` : "项目"}>
                      <SecondaryLink href="/projects" active={!projectId}>项目列表</SecondaryLink>
                      {navigationProject && PROJECT_SPACES.map((space) => (
                        <SecondaryLink
                          key={space}
                          href={spaceHref(space)}
                          active={Boolean(projectId) && currentSpace === space}
                          suffix={space === "studio" ? "AI" : undefined}
                          title={SPACE_HINT[space]}
                        >
                          {SPACE_LABEL[space]}
                        </SecondaryLink>
                      ))}
                    </SecondaryGroup>
                  )}

                  {isActive && item.href === "/collaboration" && (
                    <SecondaryGroup label="协作中心">
                      <SecondaryLink href="/collaboration#help">待协助</SecondaryLink>
                      <SecondaryLink href="/collaboration#agents">Agent 成员</SecondaryLink>
                    </SecondaryGroup>
                  )}
                </Fragment>
              );
          })}
        </nav>

        <div className="ac-shell-account ml-1 shrink-0 sm:ml-2 md:mt-auto md:ml-0 md:w-full">
          <AccountMenu name={userName} />
        </div>
      </div>
    </header>
  );
}

function SecondaryGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ac-secondary-nav hidden border-l border-stroke py-1 pl-2 md:block">
      <p className="mb-1 px-3 text-[10px] uppercase tracking-[0.1em] text-ink-3">{label}</p>
      <nav aria-label={`${label}二级导航`} className="space-y-0.5">
        {children}
      </nav>
    </div>
  );
}

function SecondaryLink({
  href,
  active = false,
  suffix,
  title,
  children,
}: {
  href: string;
  active?: boolean;
  suffix?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "page" : undefined}
      className={`ac-pressable flex min-h-8 items-center justify-between px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1 ${
        active ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink"
      }`}
    >
      <span>{children}</span>
      {suffix && <span className="text-[10px] text-ink-faint">{suffix}</span>}
    </Link>
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
    <div className="ac-project-band sticky top-[52px] z-30 border-b border-stroke bg-ground/95 sm:top-14 md:top-0">
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
          <div className="ac-project-band-spaces md:hidden">{spaces}</div>
          {actions}
        </div>
      </div>
    </div>
  );
}
