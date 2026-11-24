"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  ["projects", "团队项目"],
  ["members", "成员与角色"],
  ["resources", "共享资源"],
  ["agents", "AI 成员"],
  ["labels", "任务标签"],
];

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = pathname.replace(
    /\/(projects|members|resources|agents|labels)$/,
    "",
  );
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stroke pb-5">
        <Link href="/teams" className="text-xs text-ink-3 hover:text-signal">
          ← 我的团队
        </Link>
        <nav aria-label="团队管理" className="ac-view-switch !mt-0 flex-wrap">
          {sections.map(([route, label]) => (
            <Link
              key={route}
              href={`${base}/${route}`}
              aria-current={pathname.endsWith(`/${route}`) ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
