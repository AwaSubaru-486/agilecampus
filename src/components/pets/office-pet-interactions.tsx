"use client";
import { useEffect, useRef, useState } from "react";
import { PET_INTERACTIONS, type PetInteractionEvent, type PetInteractionKind } from "@/lib/pets/interaction-contract";
import type { HomeView } from "@/lib/home-contract";
export function OfficePetInteractions({ projectId, actorId, seats, canAct, onEvent }: { projectId: string; actorId: string; seats: HomeView["workstations"]; canAct: boolean; onEvent: (event: PetInteractionEvent) => void }) {
  const [target, setTarget] = useState(""), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [cooldown, setCooldown] = useState(false);
  const seen = useRef(new Set<string>());
  const ready = (seat: HomeView["workstations"][number]) => seat.working && seat.pet?.status === "ready" && seat.pet.petId?.startsWith("web:");
  const targets = seats.filter(seat => seat.ownerId !== actorId && ready(seat));
  const ownWorking = seats.some(seat => seat.ownerId === actorId && ready(seat));
  const selected = targets.some(seat => seat.ownerId === target) ? target : targets[0]?.ownerId ?? "";
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
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/pet-interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: selected, kind }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "互动发送失败");
      seen.current.add(data.event.id); onEvent(data.event); setCooldown(true); setMessage("伙伴会短暂回应，然后继续工作。项目成员也能看到这次互动。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "互动失败，请重试"); }
    finally { setBusy(false); }
  }
  return <section aria-label="桌宠互动" className="rounded-xl border border-stroke bg-panel p-4 text-sm">
    <div className="flex flex-wrap items-center gap-3"><strong>伙伴互动</strong>
      <select aria-label="选择互动伙伴" value={selected} disabled={!canAct || busy || !targets.length} onChange={event => setTarget(event.target.value)} className="max-w-full rounded-lg border border-stroke bg-panel px-3 py-2">
        {!targets.length && <option value="">暂无其他正在工作的伙伴</option>}{targets.map(seat => <option key={seat.ownerId} value={seat.ownerId}>{seat.ownerName} · {seat.pet?.name}</option>)}
      </select>
      {(Object.keys(PET_INTERACTIONS) as PetInteractionKind[]).map(kind => <button key={kind} className="ac-btn-ghost" disabled={!canAct || !ownWorking || !selected || busy || cooldown} onClick={() => void send(kind)}>{PET_INTERACTIONS[kind].icon} {PET_INTERACTIONS[kind].label}</button>)}
    </div>
    <p className="mt-2 text-xs leading-6 text-ink-3" role="status">{message || (!ownWorking ? "先选择网页桌宠并开始工作，就能和同项目的伙伴互动。" : cooldown ? "10 秒后可以再次互动。" : "双方开工后可互动，每次间隔 10 秒；不改变任务或工作状态。")}</p>
  </section>;
}
