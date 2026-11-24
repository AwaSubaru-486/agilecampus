"use client";
import { useEffect, useRef, useState } from "react";
import { PET_INTERACTIONS, type PetInteractionEvent, type PetInteractionKind } from "@/lib/pets/interaction-contract";
import type { HomeView } from "@/lib/home-contract";
export function OfficePetInteractions({ projectId, actorId, seats, canAct, onEvent, targetId, onSent, onSyncError }: { projectId: string; actorId: string; seats: HomeView["workstations"]; canAct: boolean; onEvent: (event: PetInteractionEvent) => void; targetId: string | null; onSent: (event: PetInteractionEvent) => void; onSyncError: (message: string) => void }) {
  const [message, setMessage] = useState<{ targetId: string; text: string } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const seen = useRef(new Set<string>());
  const localPlayback = useRef(new Map<string, number>());
  const ready = (seat: HomeView["workstations"][number]) => seat.working && seat.pet?.status === "ready" && seat.pet.petId?.startsWith("web:");
  const targets = seats.filter(seat => seat.ownerId !== actorId && ready(seat));
  const ownWorking = seats.some(seat => seat.ownerId === actorId && ready(seat));
  const selected = targets.some(seat => seat.ownerId === targetId) ? targetId! : "";
  const target = seats.find(seat => seat.ownerId === targetId);
  useEffect(() => {
    let disposed = false; const controller = new AbortController();
    async function refresh() {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/projects/${projectId}/pet-interactions`, { cache: "no-store", signal: controller.signal });
        if (!response.ok || disposed) return;
        const data = await response.json(); if (disposed) return;
        const events = (data.events ?? []) as PetInteractionEvent[];
        for (const event of [...events].reverse()) {
          if (seen.current.has(event.id)) continue;
          seen.current.add(event.id);
          const until = localPlayback.current.get(`${event.targetId}:${event.kind}`) ?? 0;
          if (!(event.actorId === actorId && Date.now() < until)) onEvent(event);
        }
        if (seen.current.size > 500) seen.current = new Set(events.map(event => event.id));
      } catch { /* Background refresh must not change work state. */ }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 4000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [projectId, actorId, onEvent]);

  const blockedReason = !canAct ? "当前视角不能操作，请切回自己的项目视角。" : !ownWorking ? "请先点击自己的工位选择桌宠并开始工作。" : !selected ? "这位队友暂未带网页桌宠开工，开工后才能互动。" : "";
  async function send(kind: PetInteractionKind) {
    if (blockedReason) { setMessage({ targetId: selected, text: blockedReason }); return; }
    setPendingCount(count => count + 1); setMessage(null);
    const localEvent: PetInteractionEvent = { id: `local-${crypto.randomUUID()}`, actorId, targetId: selected, kind, createdAt: new Date().toISOString() };
    for (const [key, until] of localPlayback.current) if (until < Date.parse(localEvent.createdAt)) localPlayback.current.delete(key);
    localPlayback.current.set(`${selected}:${kind}`, Date.parse(localEvent.createdAt) + 15000);
    onEvent(localEvent); onSent(localEvent);
    try {
      const response = await fetch(`/api/projects/${projectId}/pet-interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: selected, kind }), signal: AbortSignal.timeout(10000) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("服务响应异常，请刷新项目页面后重试。");
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? (response.status === 401 ? "登录已过期，请重新登录。" : "互动发送失败"));
      if (!data.event?.id || data.event.targetId !== selected || data.event.kind !== kind) throw new Error("没有收到有效的互动回执，请刷新后重试。");
      seen.current.add(data.event.id);
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "同步超时" : error instanceof Error ? error.message : "同步失败";
      onSyncError(`本页动画已播放，但暂未同步给队友：${reason}`);
    }
    finally { setPendingCount(count => Math.max(0, count - 1)); }
  }
  return <section aria-label="桌宠互动" className="rounded-xl border border-stroke bg-panel p-4 text-sm">
    <p className="mb-4 font-semibold">{target ? `与${target.ownerName}的桌宠互动` : "点击队友的桌宠开始互动"}</p>
    {pendingCount > 0 && <p className="mb-3 text-signal" role="status">动画立即播放，{pendingCount} 条互动正在后台同步；可以继续点击。</p>}
    {message?.targetId === selected && <p role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{message.text}</p>}
    <div className="flex flex-wrap items-center gap-3">
      {(Object.keys(PET_INTERACTIONS) as PetInteractionKind[]).map(kind => <button key={kind} className="ac-btn-ghost" aria-disabled={Boolean(blockedReason)} onClick={() => void send(kind)}>{PET_INTERACTIONS[kind].icon} {PET_INTERACTIONS[kind].label}</button>)}
    </div>
    <p className="mt-2 text-xs leading-6 text-ink-3" role="status">{blockedReason || "可连续点击，动画并行播放，无冷却时间；后台同步给同项目页面。"}</p>
  </section>;
}
