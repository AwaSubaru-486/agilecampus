import type { HomeView } from "@/lib/home-contract";
import type { PetInteractionEvent } from "@/lib/pets/interaction-contract";
import s from "@/app/(app)/home/home.module.css";

/** Scene coordinates match the office's 960 × 600 SVG and six workstation slots. */
export function OfficeProjectile({ event, seats }: { event: PetInteractionEvent; seats: (HomeView["workstations"][number] | null)[] }) {
  if (event.kind !== "plane" && event.kind !== "paper") return null;
  const from = seats.findIndex(seat => seat?.ownerId === event.actorId && seat.working && seat.pet?.status === "ready");
  const to = seats.findIndex(seat => seat?.ownerId === event.targetId && seat.working && seat.pet?.status === "ready");
  if (from < 0 && to < 0) return null;
  const point = (index: number) => ({ x: (24 + index % 3 * 25) * 9.6, y: (48 + Math.floor(index / 3) * 27) * 6 });
  const start = from >= 0 ? point(from) : { x: 48, y: point(to).y + 20 };
  const end = to >= 0 ? point(to) : { x: 912, y: start.y + 20 };
  const curve = `M${start.x} ${start.y} Q${(start.x + end.x) / 2 + (Math.abs(start.x - end.x) < 10 ? 70 : 0)} ${Math.min(start.y, end.y) - Math.max(70, Math.abs(start.x - end.x) * .3)} ${end.x} ${end.y}`;
  return <svg key={event.id} className={s.projectileLayer} viewBox="0 0 960 600" aria-hidden="true" data-office-projectile={event.kind}>
    <path className={s.flightTrail} d={curve} fill="none" stroke="#6eac98" strokeWidth="2" strokeDasharray="4 8" opacity=".5" />
    {(from < 0 || to < 0) && <text x={from < 0 ? 48 : 810} y={Math.min(start.y, end.y) - 24} fill="#497765" fontSize="12">{from < 0 ? "从其他工位飞来" : "飞往其他工位"}</text>}
    <g className={s.flyingObject} data-projectile-object>
      <animateMotion dur="1.2s" path={curve} fill="freeze" rotate={event.kind === "plane" ? "auto" : "0"} />
      {event.kind === "plane" ? <g><path d="M-19 -12L23 0L-19 12L-10 0Z" fill="#fff" stroke="#649c89" strokeWidth="2" /><path d="M-10 0H23M-10 0L-16 8" stroke="#95bcad" strokeWidth="1.5" /></g> : <g><circle r="12" fill="#fffef6" stroke="#8ca79e" strokeWidth="2" /><path d="M-7 -5L2 -8L6 -1L-4 4L0 9M-4 4L-8 0M6 -1L9 5" fill="none" stroke="#c1cabc" strokeWidth="1.5" /></g>}
    </g>
    <g transform={`translate(${end.x} ${end.y})`}><g className={s.projectileImpact}><circle r="19" fill="none" stroke="#72ac91" strokeWidth="3" /><path d="M-28 0H-23M23 0H28M0 -28V-23M0 23V28" stroke="#b3c77e" strokeWidth="3" strokeLinecap="round" /></g></g>
  </svg>;
}
