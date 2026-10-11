"use client";

import Link from "@/components/feedback-link";
import { usePathname, useSearchParams } from "next/navigation";
import { buildSpaceHref } from "@/lib/project-space";
import type { TeamRole } from "@/db/schema";
import { isProjectHome, PROJECT_ROLE_WORKSPACE } from "@/lib/project-role-workspace";

export function ProjectNavigation({ projectId, role }: { projectId: string; role: TeamRole }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const base = `/projects/${projectId}`;
  const workspace = PROJECT_ROLE_WORKSPACE[role];
  const section =
    pathname.includes("/task-tree") || pathname.includes("/timeline")
      ? "iterations"
      : pathname.includes("/activity") || pathname.includes("/retrospective")
        ? "record"
        : search.get("space") === "studio"
          ? "studio"
          : search.get("space") === "record"
            ? "record"
            : pathname === base && isProjectHome(Object.fromEntries(search.entries())) ? (search.get("view") === "manage" ? "manage" : "home") : search.get("scope") === "all" && role === "admin" ? "assignment" : "work";
  const spaceLink = (space: "work" | "studio" | "record") =>
    buildSpaceHref({
      projectId,
      space,
      taskId: search.get("task") ?? undefined,
    });
  const tabs = [
    { id: "home", title: role === "teacher" ? workspace.title : "看板", href: base, tour: "nav-home" },
    ...(role === "admin" ? [{ id: "manage", title: "项目推进台", href: `${base}?space=home&view=manage`, tour: "nav-manage" }, { id: "assignment", title: "分工", href: `${base}?space=work&scope=all&panel=list`, tour: "nav-assignment" }] : []),
    {
      id: "work",
      title: workspace.work,
      href: `${base}?space=work&scope=mine&panel=list`,
      tour: "nav-work",
    },
    {
      id: "iterations",
      title: workspace.iterations,
      href: `${base}/timeline`,
      tour: "nav-iterations",
    },
    {
      id: "studio",
      title: workspace.studio,
      href: spaceLink("studio"),
      tour: "nav-studio",
    },
    {
      id: "record",
      title: workspace.record,
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
        {tabs.filter(tab => tab.title && !(role === "student" && tab.id === "record")).map((tab) => (
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
      {section === "work" && role === "student" && (
        <nav aria-label="执行视图" className="ac-view-switch">
          <Link
            href={spaceLink("work")}
            aria-current={search.get("scope") !== "all" ? "page" : undefined}
          >
            我的任务
          </Link>
          <Link
            href={`${base}?space=work&scope=all&panel=list`}
            aria-current={search.get("scope") === "all" ? "page" : undefined}
          >
            全部任务
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
