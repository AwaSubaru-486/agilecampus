import * as React from "react";
import { cx } from "./utils";

export function Timeline({ className, ...props }: React.HTMLAttributes<HTMLOListElement>) {
  return <ol className={cx("relative border-l border-stroke", className)} {...props} />;
}

export function TimelineItem({ className, ...props }: React.LiHTMLAttributes<HTMLLIElement>) {
  return <li className={cx("relative pl-5 pb-5 last:pb-0", className)} {...props} />;
}

export function TimelineDot({ tone = "neutral", className }: { tone?: "neutral" | "agent" | "human" | "risk" | "signal"; className?: string }) {
  const dots = {
    neutral: "bg-stroke-strong",
    agent: "bg-agent",
    human: "bg-human",
    risk: "bg-risk",
    signal: "bg-signal",
  };
  return <span aria-hidden className={cx("absolute -left-[5px] top-1.5 size-2 rounded-full ring-4 ring-panel", dots[tone], className)} />;
}
