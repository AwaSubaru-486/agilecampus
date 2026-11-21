"use client";
import { useEffect, useRef, useState } from "react";
import { PET_INTERACTIONS, type PetInteractionEvent, type PetInteractionKind } from "@/lib/pets/interaction-contract";
import type { HomeView } from "@/lib/home-contract";
export function OfficePetInteractions({ projectId, actorId, seats, canAct, onEvent, targetId, onSent }: { projectId: string; actorId: string; seats: HomeView["workstations"]; canAct: boolean; onEvent: (event: PetInteractionEvent) => void; targetId: string | null; onSent: () => void }) {
  const [message, setMessage] = useState<{ targetId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false), [cooldown, setCooldown] = useState(false);
  const seen = useRef(new Set<string>());
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
        const latest = data.events?.[0] as PetInteractionEvent | undefined;
        if (latest && !seen.current.has(latest.id)) { seen.current.add(latest.id); if (seen.current.size > 100) seen.current = new Set([latest.id]); onEvent(latest); }
      } catch { /* Background refresh must not change work state. */ }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 4000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [projectId, onEvent]);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(false), 10000); return () => clearTimeout(timer); }, [cooldown]);
  async function send(kind: PetInteractionKind) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/pet-interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: selected, kind }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "互动发送失败");
      seen.current.add(data.event.id); onEvent(data.event); setCooldown(true); onSent();
    } catch (error) { setMessage({ targetId: selected, text: error instanceof Error ? error.message : "互动失败，请重试" }); }
    finally { setBusy(false); }
  }
  return <section aria-label="桌宠互动" className="rounded-xl border border-stroke bg-panel p-4 text-sm">
    <p className="mb-4 font-semibold">{target ? `与${target.ownerName}的桌宠互动` : "点击队友的桌宠开始互动"}</p>
    <div className="flex flex-wrap items-center gap-3">
      {(Object.keys(PET_INTERACTIONS) as PetInteractionKind[]).map(kind => <button key={kind} className="ac-btn-ghost" disabled={!canAct || !ownWorking || !selected || busy || cooldown} onClick={() => void send(kind)}>{PET_INTERACTIONS[kind].icon} {PET_INTERACTIONS[kind].label}</button>)}
    </div>
    <p className="mt-2 text-xs leading-6 text-ink-3" role="status">{message?.targetId === selected ? message.text : !ownWorking ? "请先点击自己的工位选择桌宠并开始工作。" : !selected ? "这位队友暂未带网页桌宠开工，开工后才能互动。" : cooldown ? "10 秒后可以再次互动。" : "选择一种互动后会回到办公室，双方桌宠短暂回应，然后继续工作。"}</p>
  </section>;
}
