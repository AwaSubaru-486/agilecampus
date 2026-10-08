"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_ITEMS, activeNavHref } from "./nav-items";
import { AccountMenu } from "./account-menu";
import { ProjectSwitcher, type SwitcherProject } from "./project-switcher";
import { WorkspaceIcon } from "@/components/workspace-icon";

export function TopWorkbar({
  userName,
  projects,
  collaborationCount = 0,
}: {
  userName: string;
  projects: SwitcherProject[];
  collaborationCount?: number;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const active = activeNavHref(pathname);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setCollapsed(
        localStorage.getItem("agilecampus.sidebar.collapsed") === "1",
      );
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (ready)
      localStorage.setItem(
        "agilecampus.sidebar.collapsed",
        collapsed ? "1" : "0",
      );
  }, [collapsed, ready]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMobileOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  useEffect(() => {
    const reveal = (event: Event) => {
      const open = (event as CustomEvent<boolean>).detail !== false;
      if (open) setCollapsed(false);
      setMobileOpen(open);
    };
    window.addEventListener("agilecampus:tutorial-navigation", reveal);
    return () =>
      window.removeEventListener("agilecampus:tutorial-navigation", reveal);
  }, []);
  return (
    <header
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
      className="ac-shell-sidebar"
    >
      <div className="ac-shell-sidebar-inner">
        <div className="ac-brand-row">
          <Link
            href="/today"
            aria-label="AgileCampus 首页"
            className="flex items-center gap-3"
          >
            <span className="ac-brand-symbol">
              a<span>c</span>
            </span>
            <span className="ac-brand-label font-semibold tracking-tight">
              AgileCampus
              <span className="block text-[10px] font-normal tracking-widest text-ink-3">
                一起，把项目做好
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!collapsed}
            aria-controls="ac-primary-navigation"
            className="ac-sidebar-collapse"
          >
            {collapsed ? "→" : "←"}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "关闭导航" : "打开导航"}
            aria-expanded={mobileOpen}
            aria-controls="ac-primary-navigation"
            className="ac-sidebar-menu"
          >
            <span className={mobileOpen ? "ac-icon-close" : "ac-icon-menu"} />
          </button>
        </div>
        <div className="ac-shell-switcher">
          <ProjectSwitcher projects={projects} />
        </div>
        <nav
          id="ac-primary-navigation"
          aria-label="主导航"
          className="ac-shell-primary-nav"
        >
          <p className="ac-nav-label">我的工作</p>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-tour={"nav-" + item.href.slice(1)}
              title={item.hint}
              aria-current={active === item.href ? "page" : undefined}
              className={
                "ac-nav-item " + (active === item.href ? "is-active" : "")
              }
            >
              <WorkspaceIcon
                name={
                  item.href.slice(1) as
                    | "today"
                    | "projects"
                    | "collaboration"
                    | "tutorials"
                }
              />
              <span className={collapsed ? "sr-only" : ""}>{item.label}</span>
              {item.href === "/collaboration" && collaborationCount > 0 && (
                <span
                  aria-label={collaborationCount + " 项待处理"}
                  className="ac-nav-count"
                >
                  {collaborationCount > 9 ? "9+" : collaborationCount}
                </span>
              )}
            </Link>
          ))}
          <Link href="/settings/api" data-tour="nav-api" className={"ac-nav-item " + (pathname === "/settings/api" ? "is-active" : "")} aria-current={pathname === "/settings/api" ? "page" : undefined}>
            <WorkspaceIcon name="settings" /><span className={collapsed ? "sr-only" : ""}>API 配置</span>
          </Link>
          <div className="ac-navigation-support">
            <p className="ac-nav-label">团队与资料</p>
            <Link
              className="ac-nav-item"
              href="/teams"
              aria-current={pathname.startsWith("/teams") ? "page" : undefined}
            >
              <WorkspaceIcon name="collaboration" />
              <span>我的团队</span>
            </Link>
            <Link
              className="ac-nav-item"
              href="/library"
              aria-current={pathname === "/library" ? "page" : undefined}
            >
              <WorkspaceIcon name="projects" />
              <span>资料库</span>
            </Link>
          </div>
        </nav>
        <div className="ac-shell-account">
          <div className="ac-sidebar-tip">
            工作遇到困难？<Link href="/tutorials">从教程开始 →</Link>
          </div>
          <div className="flex items-center gap-3">
            <AccountMenu name={userName} />
            <div className="ac-account-name min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{userName}</p>
              <Link
                href="/settings"
                className="text-[11px] text-ink-3 hover:text-ink"
              >
                账号与连接
              </Link>
            </div>
          </div>
        </div>
      </div>
      {mobileOpen && (
        <button
          type="button"
          aria-label="关闭导航"
          onClick={() => setMobileOpen(false)}
          className="ac-sidebar-scrim"
        />
      )}
    </header>
  );
}
