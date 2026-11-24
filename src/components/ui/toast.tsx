import * as React from "react";
import { cx } from "./utils";

export function ToastRegion({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-live="polite" aria-atomic="true" className={cx("pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex justify-end", className)} {...props} />;
}

export function Toast({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: "neutral" | "success" | "risk" }) {
  const tones = {
    neutral: "border-stroke bg-panel text-ink",
    success: "border-human/40 bg-human-soft text-human",
    risk: "border-risk/40 bg-risk-soft text-risk",
  };
  return <div role="status" className={cx("pointer-events-auto ac-float max-w-sm rounded-[var(--radius-panel)] border px-3 py-2 text-sm", tones[tone], className)} {...props} />;
}
