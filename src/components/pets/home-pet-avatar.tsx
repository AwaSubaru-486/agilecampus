"use client";

import { useEffect, useState } from "react";
import type { HomePetDisplay } from "@/lib/home-contract";
import type { HomePetAction } from "@/lib/pets/home-pet-contract";

/** Ground anchor: (50, 100) in a 100×112 viewport, shared by homes and courtyards. */
export function HomePetAvatar({ pet, action = "idle" }: { pet: HomePetDisplay; action?: HomePetAction }) {
  const appearance = pet.definition?.appearance;
  const [tick, setTick] = useState(0);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const animation = appearance?.type === "spritesheet" ? action === "greet" && appearance.greet ? appearance.greet : appearance.idle : null;
  useEffect(() => {
    if (!animation || animation.fps === 0 || animation.count === 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setTick(current => current + 1), 1000 / animation.fps);
    return () => clearInterval(timer);
  }, [animation]);
  const frame = animation ? animation.start + tick % animation.count : 0;
  const available = appearance && appearance.src !== failedSrc;
  return <svg viewBox="0 0 100 112" fill="none" aria-hidden="true" data-pet-state={available ? "ready" : pet.status === "ready" ? "unavailable" : pet.status}>
    <ellipse cx="50" cy="103" rx="26" ry="5" fill="#1d353912" />
    {!available ? <><rect x="19" y="24" width="62" height="70" rx="16" fill="#edf4f2" stroke="#b8d1c7" strokeWidth="1.5" strokeDasharray="4 4" /><path d="M36 64L50 52L64 64M40 62V77H60V62M47 77V68H53V77" stroke="#6d9488" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /><circle cx="71" cy="29" r="11" fill="#fff" stroke="#b8d1c7" /><path d="M66 29H76M71 24V34" stroke="#6d9488" strokeWidth="2" strokeLinecap="round" /></> : appearance.type === "image" ?
      <image href={appearance.src} x="4" y="4" width="92" height="96" preserveAspectRatio="xMidYMax meet" onError={() => setFailedSrc(appearance.src)} /> :
      <svg x="4" y="4" width="92" height="96" viewBox={`0 0 ${appearance.frameWidth} ${appearance.frameHeight}`} preserveAspectRatio="xMidYMax meet" overflow="hidden">
        <image href={appearance.src} x={-(frame % appearance.columns) * appearance.frameWidth} y={-Math.floor(frame / appearance.columns) * appearance.frameHeight}
          width={appearance.columns * appearance.frameWidth} height={appearance.rows * appearance.frameHeight} preserveAspectRatio="none" onError={() => setFailedSrc(appearance.src)} />
      </svg>}
  </svg>;
}
