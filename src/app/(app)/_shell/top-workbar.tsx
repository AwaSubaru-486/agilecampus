"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, activeNavHref } from "./nav-items";
import { AccountMenu } from "./account-menu";
import { ProjectSwitcher, type SwitcherProject } from "./project-switcher";

// 顶部工作带：取代旧版左侧永久导航。
//
// 桌面与移动用同一个组件响应式处理，而不是两份结构——两份会长歪，
// 而且「移动端少显示一项」这类差异一旦分家就再也对不上。
//
// 高度 56px（桌面）/ 52px（移动），不做玻璃拟态。
export function TopWorkbar({
  userName,
  projects,
  /** 待我处理的协作事项数。>0 时在「协作」上打一个点 */
  collaborationCount = 0,
}: {
  userName: string;
  projects: SwitcherProject[];
  collaborationCount?: number;
}) {
  const pathname = usePathname();
  const active = activeNavHref(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-stroke bg-panel">
      <div className="mx-auto flex h-[52px] max-w-[120rem] items-center gap-2 px-3 sm:h-14 sm:gap-4 sm:px-5">
        {/* 品牌 */}
        <Link
          href="/today"
          aria-label="AgileCampus 首页"
          className="flex shrink-0 items-center gap-2 rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1"
        >
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-[var(--radius-control)] bg-ink text-[11px] font-bold text-white shadow-xs"
          >
            AC
          </span>
          <span className="hidden text-sm font-semibold tracking-tight text-ink lg:inline">
            AgileCampus
          </span>
        </Link>

        <span aria-hidden className="hidden text-stroke-strong lg:inline">
          /
        </span>

        {/* 项目切换器。移动端收小，但保留——它是换项目的主入口 */}
        <div className="min-w-0 shrink">
          <ProjectSwitcher projects={projects} />
        </div>

        {/* 一级导航 */}
        <nav aria-label="主导航" className="ml-auto flex items-center gap-0.5 sm:gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = active === item.href;
            const showDot = item.href === "/collaboration" && collaborationCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.hint}
                aria-current={isActive ? "page" : undefined}
                className={`ac-pressable relative min-h-9 border-b-2 px-2 py-1.5 text-sm transition-colors rounded-t-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1 sm:px-2.5 ${
                  isActive
                    ? "border-ink font-medium text-ink"
                    : "border-transparent text-ink-2 hover:border-stroke-strong hover:text-ink"
                }`}
              >
                {item.label}
                {showDot && (
                  <span
                    aria-label={`${collaborationCount} 项待处理`}
                    className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-risk px-1 text-[10px] font-semibold leading-4 text-white"
                  >
                    {collaborationCount > 9 ? "9+" : collaborationCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-1 shrink-0 sm:ml-2">
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
}: {
  projectName: string;
  latestMilestone: string | null;
  spaces: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="sticky top-[52px] z-30 border-b border-stroke bg-ground/95 sm:top-14">
      <div className="mx-auto flex h-12 max-w-[120rem] items-center justify-between gap-3 px-3 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-2">
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
          {spaces}
          {actions}
        </div>
      </div>
    </div>
  );
}
