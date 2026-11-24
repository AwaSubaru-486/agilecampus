"use client";

import { Fragment, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FURNITURE, type HomeFurniture, type HomeProfile, type HomeView } from "@/lib/home-contract";
import { FurnitureArt, GardenBackdrop, WorkstationArt } from "./home-art";
import { DesktopCompanionControl } from "@/components/pets/desktop-companion-control";
import { HomePetAvatar } from "@/components/pets/home-pet-avatar";
import s from "./home.module.css";
import type { OfficeTaskSummary } from "@/lib/office-task-summary";
import { OfficePetInteractions } from "@/components/pets/office-pet-interactions";
import { LiveOfficeProjectile } from "@/components/pets/office-projectile";
import { PET_INTERACTIONS, type PetInteractionEvent } from "@/lib/pets/interaction-contract";

const WEB_PRESETS = [
  { id: "puppy", name: "线条小狗" }, { id: "pacman", name: "吃豆人" }, { id: "nailong", name: "敏捷奶龙" },
] as const;
type WebPreset = typeof WEB_PRESETS[number]["id"];

const COURTYARD_FURNITURE: HomeFurniture[] = [
  { id: "yard-lamp", kind: "lamp", x: 8, y: 1, flipped: false },
  { id: "yard-flowers", kind: "flowers", x: 0, y: 1, flipped: false },
];

function Mark({ name }: { name: "leaf" | "camera" }) {
  const paths = {
    leaf: "M5 19C0 5 12 3 21 3c0 12-5 19-14 15M5 21L16 10",
    camera: "M3 7h4l2-3h6l2 3h4v14H3zM16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0",

  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

async function mutate(body: unknown): Promise<HomeProfile> {
  const response = await fetch("/api/home", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "操作失败，请稍后重试");
  return result.home;
}

export function HomeSpace({ data, project, taskBoard, taskSummary, blockedMemberIds = [] }: {
  data: HomeView;
  project?: { id: string; name: string; canAct: boolean };
  taskBoard?: ReactNode;
  taskSummary?: OfficeTaskSummary;
  blockedMemberIds?: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<PetInteractionEvent | null>(null);
  const [flights, setFlights] = useState<PetInteractionEvent[]>([]);
  const playInteraction = useCallback((event: PetInteractionEvent) => {
    setInteraction(event);
    if (event.kind === "plane" || event.kind === "paper" || event.kind === "tomato" || event.kind === "water") setFlights(current => [...current, event].slice(-50));
  }, []);
  const finishFlight = useCallback((id: string) => setFlights(current => current.filter(event => event.id !== id)), []);
  const [interactionTargetId, setInteractionTargetId] = useState<string | null>(null);
  const [seatPage, setSeatPage] = useState(0);
  const [selectedPreset, setSelectedPreset] = useState<WebPreset>("puppy");
  const webNameRef = useRef("线条小狗");
  const sceneRef = useRef<HTMLDivElement>(null);
  const petDrawerRef = useRef<HTMLDialogElement>(null);
  const interactionDrawerRef = useRef<HTMLDialogElement>(null);
  const taskBoardRef = useRef<HTMLDialogElement>(null);
  const team = data.teams.find(t => t.id === data.teamId);
  const residents = data.workstations.filter(seat => seat.working && seat.pet?.status === "ready");
  const pageCount = Math.max(1, Math.ceil(data.workstations.length / 6));
  const currentPage = Math.min(seatPage, pageCount - 1);
  const seats = Array.from({ length: 6 }, (_, index) => data.workstations[currentPage * 6 + index] ?? null);
  const canAct = project?.canAct ?? true;
  const interactionTarget = data.workstations.find(seat => seat.ownerId === interactionTargetId);
  const workingHere = data.ownWorkingTeamId === data.teamId && (!project || data.ownWorkingProjectId === project.id);
  const workingElsewhere = Boolean(data.ownWorkingTeamId && !workingHere);

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, 15000);
    const refresh = () => router.refresh();
    window.addEventListener("agilecampus:pet-updated", refresh);
    return () => { clearInterval(timer); window.removeEventListener("agilecampus:pet-updated", refresh); };
  }, [router]);
  useEffect(() => {
    if (!bubble) return;
    const timer = setTimeout(() => setBubble(null), 2800);
    return () => clearTimeout(timer);
  }, [bubble]);
  useEffect(() => {
    if (!interaction) return;
    const timer = setTimeout(() => setInteraction(current => current?.id === interaction.id ? null : current), 2200);
    return () => clearTimeout(timer);
  }, [interaction]);

  async function openPetPanel() {
    petDrawerRef.current?.showModal();
    try {
      const response = await fetch("/api/desktop-pet/status", { cache: "no-store" });
      if (!response.ok) return;
      const { config } = await response.json();
      if (WEB_PRESETS.some(preset => preset.id === config.preset)) setSelectedPreset(config.preset);
      if (typeof config.name === "string") webNameRef.current = config.name;
    } catch { /* The default preset remains usable if the read fails. */ }
  }

  function openWorkstation(seat: HomeView["workstations"][number] | null) {
    if (!seat || seat.ownerId === data.actorId || !project) { void openPetPanel(); return; }
    setInteractionTargetId(seat.ownerId);
    interactionDrawerRef.current?.showModal();
  }

  async function savePreset(preset: WebPreset) {
    const name = WEB_PRESETS.some(option => option.name === webNameRef.current) ? WEB_PRESETS.find(option => option.id === preset)!.name : webNameRef.current;
    const response = await fetch("/api/desktop-pet/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update-config", config: { preset, name } }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "桌宠选择保存失败");
    webNameRef.current = name; setSelectedPreset(preset);
    window.dispatchEvent(new CustomEvent("agilecampus:deskpet-event", { detail: { type: "switch-preset", preset, name } }));
    window.dispatchEvent(new Event("agilecampus:pet-updated"));
  }

  async function choosePreset(preset: WebPreset) {
    setPending(true); setNotice(null);
    try { await savePreset(preset); setNotice({ text: "已同步网页桌宠。点击“开始工作”即可坐到你的工位。" }); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : "选择失败，请重试。", error: true }); }
    finally { setPending(false); }
  }

  async function changeWork(teamId: string | null) {
    setPending(true); setNotice(null);
    try {
      if (teamId) await savePreset(selectedPreset);
      await mutate({ operation: "work", teamId, ...(project ? { projectId: project.id } : {}) });
      setNotice({ text: teamId ? "已开始工作，网页桌宠已在你的工位就座。" : "已结束工作，桌宠已离开工位。" }); router.refresh();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "操作失败，请重试。", error: true }); }
    finally { setPending(false); }
  }

  async function photograph() {
    if (!sceneRef.current) return;
    const ns = "http://www.w3.org/2000/svg";
    const background = sceneRef.current.querySelector<SVGSVGElement>("[data-backdrop]")!;
    const image = background.cloneNode(true) as SVGSVGElement;
    image.setAttribute("xmlns", ns);
    const paper = document.createElementNS(ns, "rect");
    paper.setAttribute("width", "960"); paper.setAttribute("height", "600"); paper.setAttribute("fill", "#edf5f1");
    image.insertBefore(paper, image.firstChild);
    sceneRef.current.querySelectorAll<HTMLElement>("[data-photo-object]").forEach(element => {
      const art = element.querySelector("svg")?.cloneNode(true) as SVGSVGElement | undefined;
      if (!art) return;
      const left = Number(element.dataset.photoLeft ?? Number.parseFloat(element.style.left)) * 9.6;
      const top = Number(element.dataset.photoTop ?? Number.parseFloat(element.style.top)) * 6;
      const isPet = element.dataset.photoObject === "pet";
      const width = isPet ? (element.dataset.photoLeft ? 76 : 72) : element.dataset.photoLeft ? 202 : 88;
      art.setAttribute("x", String(left - width / 2)); art.setAttribute("y", String(top - (isPet ? 60 : element.dataset.photoLeft ? 145 : 76)));
      art.setAttribute("width", String(width)); art.setAttribute("height", isPet ? "80" : element.dataset.photoLeft ? "158" : "97");
      if (element.dataset.flipped === "true") art.setAttribute("transform", `translate(${left * 2} 0) scale(-1 1)`);
      image.appendChild(art);
      if (isPet) {
        const label = document.createElementNS(ns, "text"); label.setAttribute("x", String(left)); label.setAttribute("y", String(top + 31));
        label.setAttribute("text-anchor", "middle"); label.setAttribute("font-size", "12"); label.setAttribute("fill", "#4d6570"); label.textContent = element.dataset.petName ?? ""; image.appendChild(label);
      }
    });
    const caption = document.createElementNS(ns, "text"); caption.setAttribute("x", "46"); caption.setAttribute("y", "57"); caption.setAttribute("font-size", "22"); caption.setAttribute("fill", "#4d6570");
    caption.textContent = `${project?.name ?? team?.name}的办公室 · ${new Date().toLocaleDateString("zh-CN")}`; image.appendChild(caption);
    try {
      for (const asset of image.querySelectorAll("image")) {
        const href = asset.getAttribute("href");
        if (!href || !href.startsWith("/")) continue;
        const response = await fetch(href);
        if (!response.ok) throw new Error("合影中的桌宠资源暂不可用，请稍后重试");
        const blob = await response.blob();
        if (!blob.type.startsWith("image/") || blob.size > 5 * 1024 * 1024) throw new Error("桌宠图片格式或大小无法用于合影");
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
        asset.setAttribute("href", dataUrl);
      }
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "暂时无法保存合影", error: true }); return; }
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(image)], { type: "image/svg+xml;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "家园合影.svg"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ text: "合影已保存。" });
  }

  return <div className={s.page}>
    <header className={`ac-page-header ${s.heading}`}>
      <div><h1>{project ? "项目办公室" : "家园"}</h1><p>{project ? "点击墙上的黑板查看我的任务，在工位上与伙伴一起工作。" : "带上你的桌宠，在团队庭院与队友相聚。"}</p></div>
      <button className="ac-btn-ghost" aria-haspopup="dialog" onClick={() => void openPetPanel()}>我的桌宠 ↗</button>
    </header>
    <div className={s.navigation}>
      <h2>{project ? project.name : "团队庭院"}</h2>
      {!project && data.teams.length > 0 && <select aria-label="选择团队" value={data.teamId ?? ""} disabled={pending} onChange={event => router.push(`/home?team=${event.target.value}`)}>{data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
    </div>
    {notice && <p className={`${s.notice} ${notice.error ? s.error : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    {!team ? <div className={s.empty}><Mark name="leaf" /><h2>庭院，等大家一起开启。</h2><p>加入一个团队，就能带伙伴到共享庭院相聚。</p><Link className="ac-btn" href="/teams">前往我的团队 →</Link></div> : <div className={`${s.workspace} ${s.officeWorkspace}`}>
      <section className={s.gardenCard} aria-label="团队共享庭院">
        <div className={s.sceneHeader}><div><p>{project ? team.name : "团队共享办公室"}</p><h2>{project ? `${project.name}的办公室` : `${team.name}的庭院`}</h2></div><span className={s.pill}><i />{data.workstations.filter(seat => seat.working).length} 位成员工作中</span></div>
        <div ref={sceneRef} className={`${s.scene} ${s.meadow}`}>
          <div className={s.sceneLabel}><Mark name="leaf" />共享空间</div>
          {interaction && <div className={s.interactionReceipt} role="status" data-interaction-receipt>{PET_INTERACTIONS[interaction.kind].icon} {data.workstations.find(seat => seat.ownerId === interaction.actorId)?.ownerName ?? "伙伴"}向{data.workstations.find(seat => seat.ownerId === interaction.targetId)?.ownerName ?? "队友"}{PET_INTERACTIONS[interaction.kind].label} · 互动动画播放中</div>}
          <GardenBackdrop courtyard taskBoard={Boolean(project)} taskSummary={taskSummary} />
          {project && <button data-tour="member-board-trigger" className={s.blackboardTrigger} aria-haspopup="dialog" aria-label="点击黑板，查看我的任务" title={taskSummary ? `我的任务：待办 ${taskSummary.todo}，进行中 ${taskSummary.doing}，待验收 ${taskSummary.review}，已完成 ${taskSummary.done}` : "查看我的任务"} onClick={() => taskBoardRef.current?.showModal()} />}
          {flights.map(event => <LiveOfficeProjectile key={event.id} event={event} seats={seats} onComplete={finishFlight} />)}
          {COURTYARD_FURNITURE.map(item => <button type="button" key={item.id} data-photo-object="furniture" data-flipped={item.flipped} aria-label={FURNITURE[item.kind].name} onClick={() => setNotice({ text: `${FURNITURE[item.kind].name}：坐一会儿，和伙伴一起休息。` })} className={s.furniture} style={{ left: `${12 + item.x * 8}%`, top: `${54 + item.y * 6.8}%`, zIndex: 2 + item.y }}><span><FurnitureArt kind={item.kind} /></span></button>)}
          {seats.map((seat, index) => {
            const left = 25 + index % 3 * 25, top = 42 + Math.floor(index / 3) * 27;
            const occupied = Boolean(seat?.working && seat.pet?.status === "ready");
            const blocked = Boolean(seat && blockedMemberIds.includes(seat.ownerId));
            const reacting = occupied && interaction && (interaction.actorId === seat?.ownerId || interaction.targetId === seat?.ownerId);
            const label = seat ? `${seat.ownerName} · ${occupied ? "工作中" : seat.working ? "桌宠暂不可用" : "未工作"}` : "空闲工位";
            const workstationLabel = seat?.ownerId === data.actorId ? "我的工位，选择网页桌宠或开始工作" : seat ? `${seat.ownerName}的工位，打开桌宠互动面板` : "空工位，打开我的桌宠面板";
            const blockerLabel = blocked ? "，有阻塞任务" : "";
            return <Fragment key={seat?.ownerId ?? index}><div className={`${s.workstation} ${reacting ? s.interacting : ""}`} style={{ left: `${left}%`, top: `${top}%`, zIndex: reacting ? 20 : 4 + Math.floor(index / 3) * 4 }} data-workstation data-occupied={occupied}>
              <div className={s.deskArt} data-photo-object="furniture" data-photo-left={left} data-photo-top={top + 18}><WorkstationArt occupied={occupied} pet={occupied && seat?.pet ? seat.pet : undefined} greeting={Boolean(reacting) || bubble === seat?.ownerId} /></div>
              {blocked && <span className={s.blockerMark} aria-hidden="true" data-office-blocker>!</span>}
              {reacting && interaction && <span className={`${s.workSpeech} ${interaction.targetId === seat?.ownerId && (interaction.kind === "paper" || interaction.kind === "plane" || interaction.kind === "tomato" || interaction.kind === "water") ? s.projectileResponse : ""}`} data-pet-interaction role="status">{PET_INTERACTIONS[interaction.kind].icon} {interaction.actorId === seat?.ownerId ? PET_INTERACTIONS[interaction.kind].from : PET_INTERACTIONS[interaction.kind].to}</span>}
              {reacting && interaction && <span key={interaction.id} className={s.interactionEmoji} aria-hidden="true" data-pet-interaction-icon>{PET_INTERACTIONS[interaction.kind].icon}</span>}
              <button className={s.workstationTrigger} aria-haspopup="dialog" aria-label={`${workstationLabel}${blockerLabel}`} onClick={() => openWorkstation(seat)} />
              {occupied && bubble === seat?.ownerId && <span className={s.workSpeech}>加油，一起完成今天的工作！</span>}
            </div><button type="button" className={s.seatLabel} data-seat-label data-occupied={occupied} style={{ left: `${left}%`, top: `${top + 22.25}%` }} title={`${label}${blockerLabel}，${seat && seat.ownerId !== data.actorId ? "点击互动" : "点击设置我的桌宠"}`} aria-haspopup="dialog" onClick={() => openWorkstation(seat)}>{label}</button></Fragment>;
          })}
        </div>
        {project && taskSummary && <button className={s.mobileTaskSummary} onClick={() => taskBoardRef.current?.showModal()} aria-haspopup="dialog"><strong>我的任务</strong><span>待办 {taskSummary.todo}</span><span>进行中 {taskSummary.doing}</span><span>待验收 {taskSummary.review}</span><span>查看 →</span></button>}
        {pageCount > 1 && <div className={s.seatPages}><button disabled={currentPage === 0} onClick={() => setSeatPage(currentPage - 1)}>上一组工位</button><span>{currentPage + 1} / {pageCount}</span><button disabled={currentPage + 1 === pageCount} onClick={() => setSeatPage(currentPage + 1)}>下一组工位</button></div>}
        <div className={s.sceneFooter}><span>手动开始工作后入座，结束工作后离座。每 15 秒同步。</span><div><button onClick={() => { setBubble(residents[0]?.ownerId ?? null); }} disabled={!residents.length}>打个招呼 ♡</button><button onClick={photograph}><Mark name="camera" />保存合影</button></div></div>
      </section>
    </div>}
    <dialog ref={petDrawerRef} className={s.petDrawer} aria-labelledby="pet-drawer-title" onClick={event => { if (event.target === event.currentTarget) petDrawerRef.current?.close(); }}>
      <div className={`${s.sidePanel} ${s.petDrawerPanel}`}>
        <div className={s.drawerHeading}><div className={s.panelHeading}><h3 id="pet-drawer-title">我的桌宠</h3><p>选择自己的桌宠，带它与团队伙伴相聚。</p></div><button className="ac-btn-ghost" aria-label="关闭我的桌宠面板" onClick={() => petDrawerRef.current?.close()}>×</button></div>
        {notice && <p className={`${s.notice} ${notice.error ? s.error : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
        <div className={s.companion}><div className={s.presetPreview} role="img" aria-label={WEB_PRESETS.find(preset => preset.id === selectedPreset)?.name} style={{ backgroundImage: `url(/desk-pet/frames/${selectedPreset}_0.png)` }} /><h4>{WEB_PRESETS.find(preset => preset.id === selectedPreset)?.name}</h4><p>{data.ownPet.status === "unavailable" ? "原桌宠暂不可用，可重新选择" : data.ownPet.status === "unbound" ? "选择下方任一形象即可入座" : workingHere ? "工作中 · 已在工位就座" : workingElsewhere ? project ? "正在其他项目工作" : "正在其他团队工作" : "休息中 · 工位空闲"}</p><span>{data.ownPet.status === "ready" ? "已关联桌宠" : "等待选择桌宠"}</span></div>
        <div className={s.presetChoices} role="group" aria-label="选择网页桌宠形象">
          {WEB_PRESETS.map(preset => <button key={preset.id} disabled={!canAct || pending} aria-pressed={selectedPreset === preset.id} onClick={() => void choosePreset(preset.id)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/desk-pet/frames/${preset.id}_0.png`} alt="" /><span>{preset.name}</span>
          </button>)}
        </div>
        <p className={s.integrationHint}>1. 选择网页桌宠形象　2. 点击“开始工作”，桌宠自动坐到自己的工位。</p>
        <button className="ac-btn" disabled={!canAct || pending || (!team && !data.ownWorkingTeamId)} onClick={() => changeWork(workingHere || workingElsewhere ? null : data.teamId)}>{pending ? "正在更新…" : workingHere || workingElsewhere ? "结束工作" : "开始工作"}</button>
        <p className={s.integrationHint}>开始后会持续显示工作中，关闭网页不会自动结束。休息时请点击“结束工作”。</p>
        {canAct ? <details><summary>独立桌面陪伴（可选）</summary><DesktopCompanionControl /></details> : <p className={s.integrationHint}>当前为角色预览，桌宠操作暂不可用。</p>}
        <div className={s.smallNote}><Mark name="leaf" /><p>点击任意工位可以打开本面板；开始工作后，桌宠会在自己的工位上陪你工作。</p></div>
      </div>
    </dialog>
    {project && <dialog ref={interactionDrawerRef} className={`${s.petDrawer} ${s.continuousInteractions}`} aria-labelledby="pet-interaction-title" onClick={event => { if (event.target === event.currentTarget) interactionDrawerRef.current?.close(); }}>
      <div className={`${s.sidePanel} ${s.petDrawerPanel}`}>
        <header className={s.drawerHeading}><div className={s.panelHeading}><h3 id="pet-interaction-title">队友桌宠互动</h3><p>点击的是谁，就和谁的桌宠互动。</p></div><button className="ac-btn-ghost" aria-label="关闭桌宠互动面板" onClick={() => interactionDrawerRef.current?.close()}>×</button></header>
        {interactionTarget && <div className={s.companion}>{interactionTarget.pet && <HomePetAvatar pet={interactionTarget.pet} />}<h4>{interactionTarget.ownerName}</h4><p>{interactionTarget.pet?.name ?? "暂未展示桌宠"} · {interactionTarget.working ? "工作中" : "休息中"}</p></div>}
        <OfficePetInteractions projectId={project.id} actorId={data.actorId} seats={data.workstations} canAct={canAct} targetId={interactionTargetId} onEvent={playInteraction} onSyncError={message => setNotice({ text: message, error: true })} onSent={event => {
          setNotice({ text: `正在向${data.workstations.find(seat => seat.ownerId === event.targetId)?.ownerName ?? "队友"}${PET_INTERACTIONS[event.kind].label}，动画已开始。` });
          sceneRef.current?.scrollIntoView({ block: window.innerWidth <= 800 ? "start" : "center", behavior: "auto" });
        }} />
      </div>
    </dialog>}
    {project && <dialog ref={taskBoardRef} className={s.taskBoardDialog} aria-labelledby="office-tasks-title" onClick={event => { if (event.target === event.currentTarget) taskBoardRef.current?.close(); }}>
      <div className={s.taskBoardContent}>
        <header className={s.drawerHeading}><div><h2 id="office-tasks-title">我的任务</h2><p>{project.name} · 按阶段查看，点击任务进入详情</p></div><button className="ac-btn-ghost" aria-label="关闭我的任务" onClick={() => taskBoardRef.current?.close()}>×</button></header>
        {taskBoard}
      </div>
    </dialog>}
    <footer className={s.pageFooter}><span>团队共享庭院，让伙伴们在这里相聚。</span><span>工作状态由成员手动设置。</span></footer>
  </div>;
}
