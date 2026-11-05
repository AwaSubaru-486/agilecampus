"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FURNITURE, type HomeFurniture, type HomeProfile, type HomeView } from "@/lib/home-contract";
import { FurnitureArt, GardenBackdrop } from "./home-art";
import { HomePetAvatar as PetAvatar } from "@/components/pets/home-pet-avatar";
import { DesktopCompanionControl } from "@/components/pets/desktop-companion-control";
import s from "./home.module.css";

const COURTYARD_FURNITURE: HomeFurniture[] = [
  { id: "yard-pond", kind: "pond", x: 2, y: 3, flipped: false },
  { id: "yard-picnic", kind: "picnic", x: 6, y: 4, flipped: false },
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
  const [gathered, setGathered] = useState(false);
  const [wander, setWander] = useState(0);
  const [selectedPetId, setSelectedPetId] = useState(data.ownPet.petId ?? "");
  const sceneRef = useRef<HTMLDivElement>(null);
  const team = data.teams.find(t => t.id === data.teamId);
  const residents = data.residents;

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [router]);
  useEffect(() => {
    if (!bubble) return;
    const timer = setTimeout(() => setBubble(null), 2800);
    return () => clearTimeout(timer);
  }, [bubble]);

  async function movePet(teamId: string | null) {
    setPending(true); setNotice(null);
    try {
      await mutate({ operation: "move", teamId });
      setNotice({ text: teamId ? `${data.ownPet.name}已经去庭院啦。` : `${data.ownPet.name}已经离开庭院。` }); router.refresh();
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
    setGathered(true);
    setNotice({ text: "伙伴们集合啦。再点“保存合影”，把这一刻带回家。" });
    if (!gathered || !sceneRef.current) return;
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
      const left = Number.parseFloat(element.style.left) * 9.6;
      const top = Number.parseFloat(element.style.top) * 6;
      const isPet = element.dataset.photoObject === "pet";
      const width = isPet ? 72 : 88;
      art.setAttribute("x", String(left - width / 2)); art.setAttribute("y", String(top - (isPet ? 60 : 76)));
      art.setAttribute("width", String(width)); art.setAttribute("height", isPet ? "80" : "97");
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
        <div className={s.sceneHeader}><div><p>大家的小小会客厅</p><h2>{team.name}的庭院</h2></div><span className={s.pill}><i />{residents.length} 位伙伴在庭院</span></div>
        <div ref={sceneRef} className={`${s.scene} ${s.meadow}`}>
          <div className={s.sceneLabel}><Mark name="leaf" />共享空间</div>
          <GardenBackdrop courtyard />
          {COURTYARD_FURNITURE.map(item => <button type="button" key={item.id} data-photo-object="furniture" data-flipped={item.flipped} aria-label={FURNITURE[item.kind].name} onClick={() => setNotice({ text: `${FURNITURE[item.kind].name}：坐一会儿，和伙伴一起休息。` })} className={s.furniture} style={{ left: `${12 + item.x * 8}%`, top: `${54 + item.y * 6.8}%`, zIndex: 2 + item.y }}><span><FurnitureArt kind={item.kind} /></span></button>)}
          {residents.map((resident, index) => {
            const left = gathered ? 35 + index % 6 * 7 : 39 + ((index * 13 + wander * 7) % 34);
            const top = gathered ? 78 + Math.floor(index / 6) * 9 : 67 + index % 3 * 7;
            return <button key={resident.ownerId} data-photo-object="pet" data-pet-name={resident.pet.name} className={`${s.pet} ${gathered ? s.posed : ""}`} style={{ left: `${left}%`, top: `${top}%`, zIndex: 12 + index }} aria-label={`${resident.ownerName}的伙伴${resident.pet.name}，点击打招呼`} onClick={() => setBubble(resident.ownerId)}>
              {bubble === resident.ownerId && <span className={s.speech}>♡ {resident.pet.name}向你打招呼！</span>}<PetAvatar pet={resident.pet} action={bubble === resident.ownerId ? "greet" : "idle"} /><span className={s.petName}>{resident.pet.name}</span>
            </button>;
          })}
          {residents.length === 0 && <div className={s.away}>暂无桌宠在场，选择桌宠后可带它进入庭院。</div>}
        </div>
        <div className={s.sceneFooter}><span>伙伴的位置每 15 秒更新；在场不代表主人在线。</span><div><button onClick={() => { setGathered(false); setWander(x => x + 1); setBubble(residents[0]?.ownerId ?? null); }} disabled={!residents.length}>打个招呼 ♡</button><button onClick={photograph}><Mark name="camera" />{gathered ? "保存合影" : "一起合影"}</button></div></div>
      </section>
      <aside className={s.sidePanel}>
        <div className={s.panelHeading}><h3>我的桌宠</h3><p>选择自己的桌宠，带它与团队伙伴相聚。</p></div>
        <div className={s.companion}><PetAvatar pet={data.ownPet} /><h4>{data.ownPet.name}</h4><p>{data.ownPet.status === "unavailable" ? "原桌宠暂不可用，可重新选择" : data.ownPet.status === "unbound" ? "自定义桌宠开放后，可在此选择" : data.ownPetTeamId === data.teamId ? "在当前团队庭院" : data.ownPetTeamId ? "在其他团队庭院" : "尚未进入庭院"}</p><span>{data.ownPet.status === "ready" ? "已关联桌宠" : "等待选择桌宠"}</span></div>
        <div className={s.petBinding}>
          <label className={s.field}>选择桌宠<select aria-label="选择桌宠" value={selectedPetId} disabled={pending || (!data.availablePets.length && !data.ownPet.petId)} onChange={event => setSelectedPetId(event.target.value)}>
            <option value="">{data.availablePets.length ? "暂不展示桌宠" : "暂无可选桌宠"}</option>
            {data.ownPet.petId && !data.availablePets.some(pet => pet.id === data.ownPet.petId) && <option value={data.ownPet.petId}>原桌宠暂不可用</option>}
            {data.availablePets.map(pet => <option key={pet.id} value={pet.id}>{pet.name}</option>)}
          </select></label>
          <button className="ac-btn-ghost" disabled={pending || selectedPetId === (data.ownPet.petId ?? "")} onClick={bindPet}>{pending ? "正在应用…" : "应用桌宠"}</button>
        </div>
        <button className="ac-btn" disabled={pending || (data.ownPet.status !== "ready" && data.ownPetTeamId !== data.teamId)} onClick={() => movePet(data.ownPetTeamId === data.teamId ? null : data.teamId)}>{pending ? "稍等一下…" : data.ownPetTeamId === data.teamId ? "离开庭院" : "带伙伴来庭院"}</button>
        <DesktopCompanionControl />
        <div className={s.smallNote}><Mark name="leaf" /><p>选择桌宠后，可以进入团队庭院并与其他成员的桌宠合影。</p></div>
      </aside>
    </div>}
    <footer className={s.pageFooter}><span>团队共享庭院，让伙伴们在这里相聚。</span><span>伙伴在场不代表成员在线。</span></footer>
  </div>;
}
