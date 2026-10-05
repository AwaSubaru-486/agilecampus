import * as React from "react";
import { cx } from "./utils";

export type BadgeTone = "neutral" | "signal" | "agent" | "human" | "risk" | "warn" | "success";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-sunken text-ink-2",
  signal: "bg-signal-soft text-signal",
  agent: "bg-agent-soft text-agent",
  human: "bg-human-soft text-human",
  risk: "bg-risk-soft text-risk",
  warn: "bg-warn-soft text-warn",
  success: "bg-success-soft text-success",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span className={cx("ac-badge", tones[tone], className)} {...props}>
      {children}
    </span>
  );
}
