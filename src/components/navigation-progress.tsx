"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Follow Next's real pending state, including cancelled or failed navigation. */
export function NavigationProgress({ active, label = "正在打开页面…" }: { active: boolean; label?: string }) {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  if (!active || !mounted) return null;
  return createPortal(<div data-navigation-progress className="ac-navigation-progress" role="progressbar" aria-label={label}>
    <span className="ac-progress-runner" />
  </div>, document.body);
}
