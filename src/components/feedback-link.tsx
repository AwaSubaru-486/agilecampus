"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

function PendingFeedback() {
  const { pending } = useLinkStatus();
  return pending ? <span className="ac-link-pending" role="status"><span className="ac-loading-dot" aria-hidden />正在打开…</span> : null;
}

export default function FeedbackLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<PendingFeedback /></Link>;
}
