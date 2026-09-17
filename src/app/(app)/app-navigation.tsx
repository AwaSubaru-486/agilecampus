"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/projects", label: "项目空间", icon: "grid" },
  { href: "/health", label: "风险瞭望", icon: "pulse" },
  { href: "/teams", label: "团队成员", icon: "people" },
  { href: "/settings/tokens", label: "连接与设置", icon: "bolt" },
] as const;

export function AppNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className={mobile ? "flex items-center gap-1 overflow-x-auto" : "space-y-1"} aria-label="主导航">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${mobile ? "shrink-0" : "w-full"} flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-primary text-white shadow-[0_8px_22px_-12px_rgba(49,92,245,0.8)]"
                : "text-ink-soft hover:bg-sunken hover:text-ink"
            }`}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function NavIcon({ name }: { name: (typeof ITEMS)[number]["icon"] }) {
  if (name === "grid") {
    return <span aria-hidden className="grid size-4 grid-cols-2 gap-[3px]">{[0, 1, 2, 3].map((n) => <i key={n} className="rounded-[2px] border border-current" />)}</span>;
  }
  if (name === "pulse") {
    // 心电波形：与「风险感知」的语义对上，且与网格、人形图标区分得开
    return (
      <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 10h3.2l1.6-5 2.6 10 2.2-7 1.5 2h5" />
      </svg>
    );
  }
  if (name === "people") {
    return (
      <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-none stroke-current" strokeWidth="1.7">
        <circle cx="7" cy="6" r="3" /><path d="M2.5 16c.4-3 2-4.5 4.5-4.5s4.1 1.5 4.5 4.5" /><circle cx="14.2" cy="7.2" r="2.2" /><path d="M13 12c2.5-.3 4 1.2 4.4 3.5" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-none stroke-current" strokeWidth="1.7">
      <path d="M11.7 1.8 4.8 11h4l-.5 7.2 6.9-9.4h-4.1l.6-7Z" />
    </svg>
  );
}
