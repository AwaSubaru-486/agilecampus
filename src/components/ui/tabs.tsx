import * as React from "react";
import { cx } from "./utils";

export function Tabs({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("min-w-0", className)} {...props} />;
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      role="tablist"
      className={cx("flex min-w-0 items-center gap-0.5 overflow-x-auto border-b border-stroke no-scrollbar", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  active = false,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cx(
        "ac-pressable min-h-10 shrink-0 border-b-2 px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1",
        active ? "border-ink text-ink" : "border-transparent text-ink-2 hover:border-stroke-strong hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function TabsLink({
  active = false,
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { active?: boolean }) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={cx(
        "ac-pressable min-h-10 shrink-0 border-b-2 px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1",
        active ? "border-ink text-ink" : "border-transparent text-ink-2 hover:border-stroke-strong hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="tabpanel" className={cx("pt-4", className)} {...props} />;
}
