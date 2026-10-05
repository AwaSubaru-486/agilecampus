import * as React from "react";
import { cx } from "./utils";

export function Command({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="search" className={cx("overflow-hidden rounded-[var(--radius-panel)] border border-stroke bg-panel", className)} {...props} />;
}

export const CommandInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function CommandInput({ className, ...props }, ref) {
  return <input ref={ref} type="search" className={cx("ac-field rounded-none border-0 border-b border-stroke bg-panel focus:ring-0", className)} {...props} />;
});

CommandInput.displayName = "CommandInput";

export function CommandList({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return <ul role="listbox" className={cx("max-h-72 overflow-y-auto p-1", className)} {...props} />;
}

export function CommandItem({ selected = false, className, ...props }: React.LiHTMLAttributes<HTMLLIElement> & { selected?: boolean }) {
  return <li role="option" aria-selected={selected} className={cx("cursor-pointer rounded-[var(--radius-control)] px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-sunken hover:text-ink", className)} {...props} />;
}
