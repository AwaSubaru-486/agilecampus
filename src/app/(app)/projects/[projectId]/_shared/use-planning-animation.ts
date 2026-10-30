"use client";

import { useEffect, useRef, useState } from "react";

/** Presentation only: never requests a model or changes a plan. */
export function usePlanningAnimation() {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBusy(false);
  }
  function start() {
    if (timer.current) return;
    setBusy(true);
    timer.current = setTimeout(stop, 1800);
  }
  return { busy, start, stop };
}
