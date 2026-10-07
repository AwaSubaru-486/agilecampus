"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { buildSpaceHref } from "@/lib/project-space";

export function ProjectNavigation({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const base = `/projects/${projectId}`;
  const section =
    pathname.includes("/task-tree") || pathname.includes("/timeline")
      ? "iterations"
      : pathname.includes("/activity") || pathname.includes("/retrospective")
        ? "record"
        : search.get("space") === "studio"
          ? "studio"
          : search.get("space") === "record"
            ? "record"
            : "work";
  const spaceLink = (space: "work" | "studio" | "record") =>
    buildSpaceHref({
      projectId,
      space,
      taskId: search.get("task") ?? undefined,
    });
  const tabs = [
    {
      id: "work",
      title: "任务执行",
      href: spaceLink("work"),
      tour: "nav-work",
    },
    {
      id: "iterations",
      title: "规划与迭代",
      href: `${base}/task-tree`,
      tour: "nav-iterations",
    },
    {
      id: "studio",
      title: "AI 协作",
      href: spaceLink("studio"),
      tour: "nav-studio",
    },
    {
      id: "record",
      title: "成果与复盘",
      href: spaceLink("record"),
      tour: "nav-record",
    },
  ];
  return (
    <div className="ac-project-navigation">
      <nav
        aria-label="项目工作流程"
        className="flex gap-5 overflow-x-auto sm:gap-8"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            data-tour={tab.tour}
            aria-current={section === tab.id ? "page" : undefined}
            className={`shrink-0 border-b-2 py-4 text-sm transition-colors ${section === tab.id ? "border-signal font-semibold text-signal" : "border-transparent text-ink-3 hover:text-ink"}`}
          >
            {tab.title}
          </Link>
        ))}
      </nav>
      {section === "work" && (
        <nav aria-label="执行视图" className="ac-view-switch">
          <Link
            href={spaceLink("work")}
            aria-current={search.get("space") !== "live" ? "page" : undefined}
          >
            任务工作区
          </Link>
          <Link
            href={`${base}?space=live`}
            aria-current={search.get("space") === "live" ? "page" : undefined}
          >
            进度与风险
          </Link>
        </nav>
      )}
      {section === "iterations" && (
        <nav aria-label="迭代视图" className="ac-view-switch">
          <Link
            href={`${base}/task-tree`}
            aria-current={pathname.endsWith("/task-tree") ? "page" : undefined}
          >
            阶段与任务
          </Link>
          <Link
            href={`${base}/timeline`}
            aria-current={pathname.endsWith("/timeline") ? "page" : undefined}
          >
            时间线
          </Link>
        </nav>
      )}
      {section === "record" && (
        <nav aria-label="成果视图" className="ac-view-switch">
          <Link
            href={`${base}?space=record`}
            aria-current={pathname === base ? "page" : undefined}
          >
            成果档案
          </Link>
          <Link
            href={`${base}/retrospective`}
            aria-current={
              pathname.endsWith("/retrospective") ? "page" : undefined
            }
          >
            贡献复盘
          </Link>
          <Link
            href={`${base}/activity`}
            aria-current={pathname.endsWith("/activity") ? "page" : undefined}
          >
            活动记录
          </Link>
        </nav>
      )}
    </div>
  );
}
