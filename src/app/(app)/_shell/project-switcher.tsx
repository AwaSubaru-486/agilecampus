"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export type SwitcherProject = { id: string; name: string; teamName: string };

// 项目切换器。取代旧版左侧栏里那条「项目空间」入口。
//
// 只拿到调用方筛过的项目列表——不在客户端过滤权限，
// 无权项目根本不该出现在这份 props 里（见 (app)/layout.tsx）。
// 当前项目由 URL 推出，不由 layout 传入——App Router 的 layout 拿不到
// pathname，而这里本来就是个客户端组件，自己读更省一层传递。
const PROJECT_IN_PATH = /^\/projects\/([0-9a-f-]{36})/i;

export function ProjectSwitcher({ projects }: { projects: SwitcherProject[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const currentProjectId = pathname.match(PROJECT_IN_PATH)?.[1] ?? null;
  const current = projects.find((p) => p.id === currentProjectId) ?? null;

  // 点外面关掉；Escape 也关（键盘用户）
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 换项目时保留当前模式：在「工作」模式切项目，理应还落在「工作」。
  // 这一条是四模式设计的直接后果——模式属于人，不属于项目。
  function hrefFor(projectId: string): string {
    const space = new URLSearchParams(window.location.search).get("space");
    return `/projects/${projectId}${space ? `?space=${space}` : ""}`;
  }

  const filtered = query.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : projects;

  return (
    <div ref={boxRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="切换项目"
        className="ac-pressable flex min-h-10 max-w-[16rem] items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1.5 text-sm text-ink-2 hover:bg-sunken hover:text-ink"
      >
        <span className="min-w-0 truncate">{current ? current.name : "选择项目"}</span>
        <span aria-hidden className="shrink-0 text-ink-3">
          ⌄
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="ac-card ac-float ac-panel-enter absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden p-1"
        >
          {projects.length > 6 && (
            <div className="p-1">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索项目"
                aria-label="搜索项目"
                className="ac-field text-sm"
              />
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-ink-3">没有匹配的项目</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={p.id === currentProjectId}
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      router.push(hrefFor(p.id));
                    }}
                      className={`ac-pressable flex min-h-11 w-full flex-col items-start gap-0.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-sm ${
                      p.id === currentProjectId
                        ? "bg-signal-soft text-signal"
                        : "text-ink hover:bg-sunken"
                    }`}
                  >
                    <span className="w-full truncate">{p.name}</span>
                    <span className="text-[11px] text-ink-3">{p.teamName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 border-t border-stroke p-1">
            <Link
              href="/projects"
              onClick={() => setOpen(false)}
              className="block rounded-[var(--radius-control)] px-2.5 py-1.5 text-xs text-ink-2 hover:bg-sunken"
            >
              全部项目 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
