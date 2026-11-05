"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FURNITURE, type HomeFurniture, type HomeProfile, type HomeView } from "@/lib/home-contract";
import { FurnitureArt, GardenBackdrop, WorkstationArt } from "./home-art";
import { HomePetAvatar as PetAvatar } from "@/components/pets/home-pet-avatar";
import { DesktopCompanionControl } from "@/components/pets/desktop-companion-control";
import s from "./home.module.css";

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

export function HomeSpace({ data }: { data: HomeView }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [seatPage, setSeatPage] = useState(0);
  const [selectedPetId, setSelectedPetId] = useState(data.ownPet.petId ?? "");
  const sceneRef = useRef<HTMLDivElement>(null);
  const team = data.teams.find(t => t.id === data.teamId);
  const residents = data.workstations.filter(seat => seat.working && seat.pet?.status === "ready");
  const pageCount = Math.max(1, Math.ceil(data.workstations.length / 6));
  const currentPage = Math.min(seatPage, pageCount - 1);
  const seats = Array.from({ length: 6 }, (_, index) => data.workstations[currentPage * 6 + index] ?? null);
  const workingHere = data.ownWorkingTeamId === data.teamId;
  const workingElsewhere = Boolean(data.ownWorkingTeamId && !workingHere);

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [router]);
  useEffect(() => {
    if (!bubble) return;
    const timer = setTimeout(() => setBubble(null), 2800);
    return () => clearTimeout(timer);
  }, [bubble]);

  async function changeWork(teamId: string | null) {
    setPending(true); setNotice(null);
    try {
      await mutate({ operation: "work", teamId });
      setNotice({ text: teamId ? "已开始工作，桌宠已经在工位就座。" : "已结束工作，桌宠已离开工位。" }); router.refresh();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "暂时无法出门，请稍后重试。", error: true }); }
    finally { setPending(false); }
  }

  async function bindPet() {
    setPending(true); setNotice(null);
    try {
      const response = await fetch("/api/home/pets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ petId: selectedPetId || null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "暂时无法选择桌宠");
      setNotice({ text: selectedPetId ? "桌宠已选择，可以带它进入庭院。" : "已腾出桌宠展示位。" }); router.refresh();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "操作失败，请稍后重试。", error: true }); }
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
    caption.textContent = `${team?.name}的庭院 · ${new Date().toLocaleDateString("zh-CN")}`; image.appendChild(caption);
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
      <div><h1>家园</h1><p>带上你的桌宠，在团队庭院与队友相聚。</p></div>
      <span className={s.headerNote}><Mark name="leaf" />我的伙伴：{data.ownPet.name}</span>
    </header>
    <div className={s.navigation}>
      <h2>团队庭院</h2>
      {data.teams.length > 0 && <select aria-label="选择团队" value={data.teamId ?? ""} disabled={pending} onChange={event => router.push(`/home?team=${event.target.value}`)}>{data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
    </div>
    {notice && <p className={`${s.notice} ${notice.error ? s.error : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    {!team ? <div className={s.empty}><Mark name="leaf" /><h2>庭院，等大家一起开启。</h2><p>加入一个团队，就能带伙伴到共享庭院相聚。</p><Link className="ac-btn" href="/teams">前往我的团队 →</Link></div> : <div className={s.workspace}>
      <section className={s.gardenCard} aria-label="团队共享庭院">
        <div className={s.sceneHeader}><div><p>团队共享办公室</p><h2>{team.name}的庭院</h2></div><span className={s.pill}><i />{data.workstations.filter(seat => seat.working).length} 位成员工作中</span></div>
        <div ref={sceneRef} className={`${s.scene} ${s.meadow}`}>
          <div className={s.sceneLabel}><Mark name="leaf" />共享空间</div>
          <GardenBackdrop courtyard />
          {COURTYARD_FURNITURE.map(item => <button type="button" key={item.id} data-photo-object="furniture" data-flipped={item.flipped} aria-label={FURNITURE[item.kind].name} onClick={() => setNotice({ text: `${FURNITURE[item.kind].name}：坐一会儿，和伙伴一起休息。` })} className={s.furniture} style={{ left: `${12 + item.x * 8}%`, top: `${54 + item.y * 6.8}%`, zIndex: 2 + item.y }}><span><FurnitureArt kind={item.kind} /></span></button>)}
          {seats.map((seat, index) => {
            const left = 25 + index % 3 * 25, top = 42 + Math.floor(index / 3) * 27;
            const occupied = Boolean(seat?.working && seat.pet?.status === "ready");
            const label = seat ? `${seat.ownerName} · ${occupied ? "工作中" : seat.working ? "桌宠暂不可用" : "未工作"}` : "空闲工位";
            return <Fragment key={seat?.ownerId ?? index}><div className={s.workstation} style={{ left: `${left}%`, top: `${top}%`, zIndex: 4 + Math.floor(index / 3) * 4 }} data-workstation data-occupied={occupied}>
              <div className={s.deskArt} data-photo-object="furniture" data-photo-left={left} data-photo-top={top + 18}><WorkstationArt occupied={occupied} pet={occupied && seat?.pet ? seat.pet : undefined} greeting={bubble === seat?.ownerId} /></div>
              {occupied && seat?.pet && <button className={s.seatedPet} aria-label={`${seat.ownerName}正在工作，点击与${seat.pet.name}打招呼`} onClick={() => setBubble(seat.ownerId)} />}
              {occupied && bubble === seat?.ownerId && <span className={s.workSpeech}>加油，一起完成今天的工作！</span>}
            </div><span className={s.seatLabel} data-seat-label data-occupied={occupied} style={{ left: `${left}%`, top: `${top + 22.25}%` }} title={label}>{label}</span></Fragment>;
          })}
        </div>
        {pageCount > 1 && <div className={s.seatPages}><button disabled={currentPage === 0} onClick={() => setSeatPage(currentPage - 1)}>上一组工位</button><span>{currentPage + 1} / {pageCount}</span><button disabled={currentPage + 1 === pageCount} onClick={() => setSeatPage(currentPage + 1)}>下一组工位</button></div>}
        <div className={s.sceneFooter}><span>手动开始工作后入座，结束工作后离座。每 15 秒同步。</span><div><button onClick={() => { setBubble(residents[0]?.ownerId ?? null); }} disabled={!residents.length}>打个招呼 ♡</button><button onClick={photograph}><Mark name="camera" />保存合影</button></div></div>
      </section>
      <aside className={s.sidePanel}>
        <div className={s.panelHeading}><h3>我的桌宠</h3><p>选择自己的桌宠，带它与团队伙伴相聚。</p></div>
        <div className={s.companion}><PetAvatar pet={data.ownPet} /><h4>{data.ownPet.name}</h4><p>{data.ownPet.status === "unavailable" ? "原桌宠暂不可用，可重新选择" : data.ownPet.status === "unbound" ? "自定义桌宠开放后，可在此选择" : workingHere ? "工作中 · 已在工位就座" : workingElsewhere ? "正在其他团队工作" : "休息中 · 工位空闲"}</p><span>{data.ownPet.status === "ready" ? "已关联桌宠" : "等待选择桌宠"}</span></div>
        <div className={s.petBinding}>
          <label className={s.field}>选择桌宠<select aria-label="选择桌宠" value={selectedPetId} disabled={pending || (!data.availablePets.length && !data.ownPet.petId)} onChange={event => setSelectedPetId(event.target.value)}>
            <option value="">{data.availablePets.length ? "暂不展示桌宠" : "暂无可选桌宠"}</option>
            {data.ownPet.petId && !data.availablePets.some(pet => pet.id === data.ownPet.petId) && <option value={data.ownPet.petId}>原桌宠暂不可用</option>}
            {data.availablePets.map(pet => <option key={pet.id} value={pet.id}>{pet.name}</option>)}
          </select></label>
          <button className="ac-btn-ghost" disabled={pending || selectedPetId === (data.ownPet.petId ?? "")} onClick={bindPet}>{pending ? "正在应用…" : "应用桌宠"}</button>
        </div>
        <button className="ac-btn" disabled={pending || (data.ownPet.status !== "ready" && !data.ownWorkingTeamId)} onClick={() => changeWork(workingHere || workingElsewhere ? null : data.teamId)}>{pending ? "正在更新…" : workingHere || workingElsewhere ? "结束工作" : "开始工作"}</button>
        <p className={s.integrationHint}>开始后会持续显示工作中，关闭网页不会自动结束。休息时请点击“结束工作”。</p>
        <DesktopCompanionControl />
        <div className={s.smallNote}><Mark name="leaf" /><p>选择桌宠后点击“开始工作”，它就会在你的工位上陪你工作。</p></div>
      </aside>
    </div>}
    <footer className={s.pageFooter}><span>团队共享庭院，让伙伴们在这里相聚。</span><span>工作状态由成员手动设置。</span></footer>
  </div>;
}
