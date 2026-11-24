"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { NavigationProgress } from "./navigation-progress";

function PendingFeedback() {
  const { pending } = useLinkStatus();
  return <NavigationProgress active={pending} />;
}

export default function FeedbackLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<PendingFeedback /></Link>;
}
