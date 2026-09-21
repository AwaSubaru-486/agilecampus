"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOutAction } from "./actions";

// 账户菜单。旧版把姓名、头像、退出平铺在侧栏底部，占掉一批视觉重量；
// 收进一个菜单后，工作带上只剩一个头像。
export function AccountMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  return (
    <div ref={boxRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`账户菜单：${name}`}
        className="ac-pressable grid size-10 place-items-center rounded-full bg-sunken text-xs font-semibold text-ink-2 hover:bg-stroke focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1"
      >
        {(name || "?").slice(0, 1).toUpperCase()}
      </button>

      {open && (
        <div
          role="menu"
          className="ac-card ac-float ac-panel-enter absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden p-1 shadow-float"
        >
          <p className="truncate px-2.5 py-2 text-sm font-medium text-ink">{name}</p>
          <div className="border-t border-stroke pt-1">
            <Link
              href="/library"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm text-ink-2 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              资料库
            </Link>
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm text-ink-2 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              设置
            </Link>
            <Link
              href="/settings/tokens"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm text-ink-2 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              个人访问令牌
            </Link>
          </div>
          <form action={signOutAction} className="border-t border-stroke pt-1">
            <button
              role="menuitem"
              className="w-full rounded-[var(--radius-control)] px-2.5 py-1.5 text-left text-sm text-ink-2 hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              退出登录
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
