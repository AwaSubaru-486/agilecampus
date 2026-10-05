import * as React from "react";
import { cx } from "./utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cx("animate-pulse rounded-[var(--radius-control)] bg-sunken", className)} {...props} />;
}
