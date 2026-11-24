import * as React from "react";
import { cx } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "ink" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "ac-btn",
  secondary: "ac-btn-ghost",
  ink: "ac-btn-ink",
  quiet:
    "inline-flex min-h-9 min-w-9 items-center justify-center rounded-[var(--radius-control)] border border-transparent px-2 text-sm font-medium text-ink-2 transition-colors hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-45",
  danger:
    "inline-flex min-h-9 items-center justify-center rounded-[var(--radius-control)] border border-risk/40 bg-risk-soft px-3 text-sm font-medium text-risk transition-colors hover:border-risk hover:bg-risk hover:text-white disabled:cursor-not-allowed disabled:opacity-45",
};

const sizes: Record<ButtonSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}>(function Button({ className, variant = "primary", size = "md", type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(variants[variant], sizes[size], "ac-pressable", className)}
      {...props}
    />
  );
});

Button.displayName = "Button";
