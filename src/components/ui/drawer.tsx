import * as React from "react";
import { cx } from "./utils";

export function Drawer({ open, className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { open?: boolean }) {
  if (open === false) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" {...props}>
      <div aria-hidden className="absolute inset-0 bg-ink/20 transition-opacity duration-200" />
      <div className={cx("ac-card ac-float ac-panel-enter relative h-full w-full max-w-[32rem] overflow-y-auto rounded-none border-y-0 border-r-0 bg-panel sm:m-2 sm:h-[calc(100%-1rem)] sm:rounded-[var(--radius-sheet)] sm:border", className)}>
        {children}
      </div>
    </div>
  );
}

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <header className={cx("sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-stroke bg-panel px-4 py-3", className)} {...props} />;
}

export function DrawerBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("space-y-4 px-4 py-4", className)} {...props} />;
}
