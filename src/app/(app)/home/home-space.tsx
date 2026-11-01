"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FURNITURE, type FurnitureKind, type HomeFurniture, type HomeProfile, type HomeView } from "@/lib/home-contract";
import { FurnitureArt, GardenBackdrop, PetAvatar } from "./home-art";
import s from "./home.module.css";

const THEMES = [{ id: "meadow", name: "晴日草地", color: "#b8ceab" }, { id: "sunset", name: "落日余晖", color: "#e8b9a2" }, { id: "moonlight", name: "月色小院", color: "#929fbc" }] as const;
const COURTYARD_FURNITURE: HomeFurniture[] = [
  { id: "yard-pond", kind: "pond", x: 2, y: 3, flipped: false },
  { id: "yard-picnic", kind: "picnic", x: 6, y: 4, flipped: false },
  { id: "yard-lamp", kind: "lamp", x: 8, y: 1, flipped: false },
  { id: "yard-flowers", kind: "flowers", x: 0, y: 1, flipped: false },
];

function Mark({ name }: { name: "home" | "leaf" | "friends" | "camera" | "edit" }) {
  const paths = {
    home: "M3 11L12 3l9 8M5 10v11h14V10M9 21v-7h6v7",
    leaf: "M5 19C0 5 12 3 21 3c0 12-5 19-14 15M5 21L16 10",
    friends: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4",
    camera: "M3 7h4l2-3h6l2 3h4v14H3zM16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    edit: "M4 16L16 4l4 4L8 20H4zM13 7l4 4",
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.home);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [gathered, setGathered] = useState(false);
  const [wander, setWander] = useState(0);
  const sceneRef = useRef<HTMLDivElement>(null);
  const courtyard = data.view === "courtyard";
  const own = !courtyard && data.home.ownerId === data.actorId;
  const home = editing ? draft : data.home;
  const team = data.teams.find(t => t.id === data.teamId);
  const furniture = courtyard ? COURTYARD_FURNITURE : home.furniture;
  const selectedItem = draft.furniture.find(item => item.id === selected);
  const teamQuery = data.teamId ? `&team=${data.teamId}` : "";
  const residents = data.residents;

  useEffect(() => {
    if (data.view !== "courtyard" && own) return;
    const timer = setInterval(() => { if (!document.hidden && !editing) router.refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [data.view, own, editing, router]);
  useEffect(() => {
    if (!bubble) return;
    const timer = setTimeout(() => setBubble(null), 2800);
    return () => clearTimeout(timer);
  }, [bubble]);

  function navigate(href: string) {
    if (editing && !window.confirm("布置还没有保存，确定离开吗？")) return;
    router.push(href);
  }
  function beginEditing() { setDraft(data.home); setEditing(true); setSelected(null); setNotice(null); }
  function place(x: number, y: number, id = selected) {
    if (!id) { setNotice({ text: "先选择一件家具，再点选草地上的位置。" }); return; }
    if (draft.furniture.some(item => item.x === x && item.y === y && item.id !== id)) { setNotice({ text: "这里已经有家具了，换个空位置吧。", error: true }); return; }
    setDraft(current => ({ ...current, furniture: current.furniture.map(item => item.id === id ? { ...item, x, y } : item) }));
    setNotice(null);
  }
  function addFurniture(kind: FurnitureKind) {
    if (draft.furniture.length >= 24) { setNotice({ text: "小院最多摆放 24 件家具，先收纳一些吧。", error: true }); return; }
    const cells = Array.from({ length: 60 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10) }));
    const empty = cells.find(cell => !draft.furniture.some(item => item.x === cell.x && item.y === cell.y));
    if (!empty) return;
    const id = crypto.randomUUID();
    setDraft(current => ({ ...current, furniture: [...current.furniture, { id, kind, ...empty, flipped: false }] }));
    setSelected(id); setNotice({ text: "已放入小院。点选网格或拖动家具调整位置。" });
  }
  async function save() {
    setPending(true); setNotice(null);
    try {
      const updated = await mutate({ operation: "save", settings: draft });
      setDraft(updated); setEditing(false); setSelected(null); setNotice({ text: "布置已保存，欢迎朋友来做客。" }); router.refresh();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "保存失败，布置仍保留在这里。", error: true }); }
    finally { setPending(false); }
  }
  async function movePet(teamId: string | null) {
    setPending(true); setNotice(null);
    try {
      await mutate({ operation: "move", teamId });
      setNotice({ text: teamId ? `${data.ownPet.name}已经去庭院啦。` : `${data.ownPet.name}已经回家啦。` }); router.refresh();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "暂时无法出门，请稍后重试。", error: true }); }
    finally { setPending(false); }
  }

  function photograph() {
    setGathered(true);
    setNotice({ text: "伙伴们集合啦。再点“保存合影”，把这一刻带回家。" });
    if (!gathered || !sceneRef.current) return;
    const ns = "http://www.w3.org/2000/svg";
    const background = sceneRef.current.querySelector<SVGSVGElement>("[data-backdrop]")!;
    const image = background.cloneNode(true) as SVGSVGElement;
    image.setAttribute("xmlns", ns);
    const paper = document.createElementNS(ns, "rect");
    paper.setAttribute("width", "960"); paper.setAttribute("height", "600"); paper.setAttribute("fill", "#edf0e4");
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
        label.setAttribute("text-anchor", "middle"); label.setAttribute("font-size", "12"); label.setAttribute("fill", "#4b6254"); label.textContent = element.dataset.petName ?? ""; image.appendChild(label);
      }
    });
    const caption = document.createElementNS(ns, "text"); caption.setAttribute("x", "46"); caption.setAttribute("y", "57"); caption.setAttribute("font-size", "22"); caption.setAttribute("fill", "#4b6254");
    caption.textContent = `${courtyard ? team?.name + "的庭院" : home.title} · ${new Date().toLocaleDateString("zh-CN")}`; image.appendChild(caption);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(image)], { type: "image/svg+xml;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "家园合影.svg"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ text: "合影已保存。" });
  }

  return <div className={s.page}>
    <div className={s.heading}>
      <div><p className={s.eyebrow}><Mark name="leaf" /> 给生活留一点空地</p><h1>家园<span>把小日子，过成喜欢的样子。</span></h1></div>
      <span className={s.headerNote}>一起工作，也一起晒晒太阳。</span>
    </div>
    <div className={s.navigation}>
      <nav aria-label="家园区域" className={s.tabs}>
        {([{ view: "mine", label: "我的家园", icon: "home" }, { view: "courtyard", label: "团队庭院", icon: "leaf" }, { view: "members", label: "成员家园", icon: "friends" }] as const).map(tab => <button key={tab.view} type="button" onClick={() => navigate(tab.view === "mine" ? "/home" : `/home?view=${tab.view}${teamQuery}`)} aria-current={data.view === tab.view ? "page" : undefined}><Mark name={tab.icon} />{tab.label}</button>)}
      </nav>
      {data.view !== "mine" && data.teams.length > 0 && <select aria-label="选择团队" value={data.teamId ?? ""} disabled={pending} onChange={event => navigate(`/home?view=${data.view}&team=${event.target.value}`)}>{data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
    </div>

    {notice && <p className={`${s.notice} ${notice.error ? s.error : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}

    {data.view === "members" && !own && <div className={s.visitBanner}><span>正在拜访{data.ownerName}的家</span><button onClick={() => navigate(`/home?view=members${teamQuery}`)}>返回成员列表 ↗</button></div>}

    {data.view === "members" && own ? <section className={s.neighborhood}>
      <p className={s.eyebrow}>NEIGHBORHOOD / 去朋友家坐坐</p><h2>敲敲门，和邻居打个招呼。</h2><p>同一个团队里的小小世界，每一间都有自己的模样。</p>
      {data.members.length === 0 ? <div className={s.empty}><Mark name="friends" /><h3>{team ? "邻居们还在来的路上" : "先加入一个团队吧"}</h3><p>{team ? "邀请团队成员来开启家园，就能互相串门了。" : "加入团队后，就能拜访队友和使用共享庭院。"}</p><Link className="ac-btn-ghost" href="/teams">前往我的团队 →</Link></div> : <div className={s.memberGrid}>{data.members.map(member => <article key={member.id} className={s.memberCard}>
        <div className={s.memberIllustration}>{member.pet ? <PetAvatar pet={member.pet} /> : <Mark name="home" />}<span>{member.visitable ? "欢迎做客" : "暂未开放"}</span></div>
        <h3>{member.visitable ? member.title : `${member.name}的家园`}</h3><p>{member.name}{member.pet ? `，${member.pet.name}的主人` : ""}</p>
        <button className="ac-btn-ghost" disabled={!member.visitable} onClick={() => navigate(`/home?view=members&owner=${member.id}${teamQuery}`)}>{member.visitable ? "去做客 ↗" : "还不能拜访"}</button>
      </article>)}</div>}
    </section> : courtyard && !team ? <div className={s.empty}><Mark name="leaf" /><h2>庭院，等大家一起开启。</h2><p>加入一个团队，就能带伙伴到共享庭院相聚。</p><Link className="ac-btn" href="/teams">前往我的团队 →</Link></div> : <div className={s.workspace}>
      <section className={s.gardenCard} aria-label={courtyard ? "团队共享庭院" : "家园场景"}>
        <div className={s.sceneHeader}><div><p>{courtyard ? "大家的小小会客厅" : own ? "HOME, SWEET HOME" : `${data.ownerName}的小小世界`}</p><h2>{courtyard ? `${team?.name}的庭院` : home.title}</h2></div><span className={s.pill}><i />{courtyard ? `${residents.length} 位伙伴在庭院` : home.visibility === "team" ? "欢迎队友来访" : "仅自己可见"}</span></div>
        <div ref={sceneRef} className={`${s.scene} ${s[courtyard ? "meadow" : home.theme]} ${editing ? s.editing : ""}`}>
          <div className={s.sceneLabel}>{courtyard ? "PUBLIC GARDEN" : "A LITTLE PLACE OF YOUR OWN"}<span>{courtyard ? "在这里，不用着急。" : "今天也适合发会儿呆。"}</span></div>
          <GardenBackdrop courtyard={courtyard} />
          {editing && <div className={s.grid} aria-label="家具摆放网格">{Array.from({ length: 60 }, (_, i) => <button key={i} aria-label={`放到第${Math.floor(i / 10) + 1}行第${i % 10 + 1}列`} onClick={() => place(i % 10, Math.floor(i / 10))} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); place(i % 10, Math.floor(i / 10), e.dataTransfer.getData("text/plain")); }} />)}</div>}
          {furniture.map(item => <button type="button" key={item.id} data-photo-object="furniture" data-flipped={item.flipped} title={FURNITURE[item.kind].name} aria-label={`${FURNITURE[item.kind].name}${editing ? "，选择后可移动" : ""}`} aria-pressed={editing ? selected === item.id : undefined} draggable={editing} onDragStart={e => { setSelected(item.id); e.dataTransfer.setData("text/plain", item.id); }} onClick={() => editing ? setSelected(item.id) : setNotice({ text: `${FURNITURE[item.kind].name}：${item.kind === "bed" ? "软软的，适合做个好梦。" : item.kind === "pond" ? "坐一会儿，听听水声。" : "小小的物件，也是生活的心意。"}` })} onKeyDown={event => { if (!editing) return; const move = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key]; if (move) { event.preventDefault(); place(Math.max(0, Math.min(9, item.x + move[0])), Math.max(0, Math.min(5, item.y + move[1])), item.id); } }} className={`${s.furniture} ${selected === item.id && editing ? s.selected : ""}`} style={{ left: `${12 + item.x * 8}%`, top: `${54 + item.y * 6.8}%`, zIndex: 2 + item.y }}><span style={{ transform: item.flipped ? "scaleX(-1)" : undefined }}><FurnitureArt kind={item.kind} /></span></button>)}
          {!editing && residents.map((resident, index) => {
            const left = gathered ? 35 + index % 6 * 7 : 39 + ((index * 13 + wander * 7) % 34);
            const top = gathered ? 78 + Math.floor(index / 6) * 9 : 67 + index % 3 * 7;
            return <button key={resident.ownerId} data-photo-object="pet" data-pet-name={resident.pet.name} className={`${s.pet} ${gathered ? s.posed : ""}`} style={{ left: `${left}%`, top: `${top}%`, zIndex: 12 + index }} aria-label={`${resident.ownerName}的伙伴${resident.pet.name}，点击打招呼`} onClick={() => setBubble(resident.ownerId)}>
              {bubble === resident.ownerId && <span className={s.speech}>♡ {resident.pet.name}向你打招呼！</span>}<PetAvatar pet={resident.pet} /><span className={s.petName}>{resident.pet.name}</span>
            </button>;
          })}
          {!editing && residents.length === 0 && <div className={s.away}>{courtyard ? "庭院很安静，带你的伙伴来玩吧。" : own ? `${data.ownPet.name}去团队庭院玩啦。` : "小伙伴出门玩啦，坐坐等它吧。"}</div>}
          <span className={s.sceneStamp}>AGILECAMPUS / LITTLE THINGS, BIG JOY</span>
        </div>
        <div className={s.sceneFooter}><span>{editing ? "选中家具后点网格移动，也可以拖动或使用方向键。" : courtyard ? "伙伴的位置每 15 秒更新；在场不代表主人在线。" : home.welcome || "门前有风，院里有你。"}</span><div>{!editing && <><button onClick={() => { setGathered(false); setWander(x => x + 1); setBubble(residents[0]?.ownerId ?? null); }} disabled={!residents.length}>打个招呼 ♡</button><button onClick={photograph}><Mark name="camera" />{gathered ? "保存合影" : "一起合影"}</button></>}{own && !editing && <button className={s.editButton} onClick={beginEditing}><Mark name="edit" />布置家园</button>}</div></div>
      </section>

      <aside className={s.sidePanel}>
        {editing ? <><div className={s.panelHeading}><span className={s.eyebrow}>MAKE IT YOURS</span><h3>把喜欢的，放进家里。</h3></div>
          <label className={s.field}>家园名字<input value={draft.title} maxLength={30} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <label className={s.field}>留给来客的话<textarea value={draft.welcome} maxLength={100} rows={2} onChange={e => setDraft({ ...draft, welcome: e.target.value })} /></label>
          <fieldset className={s.themePicker}><legend>小院氛围</legend>{THEMES.map(theme => <button key={theme.id} type="button" aria-label={theme.name} aria-pressed={draft.theme === theme.id} title={theme.name} onClick={() => setDraft({ ...draft, theme: theme.id })}><i style={{ background: theme.color }} />{theme.name}</button>)}</fieldset>
          <label className={s.field}>来访设置<select value={draft.visibility} onChange={e => setDraft({ ...draft, visibility: e.target.value as HomeProfile["visibility"] })}><option value="team">允许同团队成员来访</option><option value="private">仅自己可见</option></select></label>
          <div className={s.petSettings}><label className={s.field}>伙伴名字<input value={draft.pet.name} maxLength={16} onChange={e => setDraft({ ...draft, pet: { ...draft.pet, name: e.target.value } })} /></label><div className={s.petChoices}>{(["cat", "bunny", "dog"] as const).map(kind => <button key={kind} aria-label={kind === "cat" ? "小猫" : kind === "bunny" ? "兔子" : "小狗"} aria-pressed={draft.pet.kind === kind} onClick={() => setDraft({ ...draft, pet: { ...draft.pet, kind } })}><PetAvatar pet={{ name: "", kind }} /></button>)}</div></div>
          <div className={s.saveActions}><button className="ac-btn" disabled={pending || !draft.title.trim() || !draft.pet.name.trim()} onClick={save}>{pending ? "正在保存…" : "保存布置"}</button><button className="ac-btn-ghost" disabled={pending} onClick={() => { setEditing(false); setSelected(null); setNotice(null); }}>取消</button></div>
        </> : <><div className={s.panelHeading}><span className={s.eyebrow}>YOUR LITTLE COMPANION</span><h3>今天，也有它陪你。</h3></div><div className={s.companion}><PetAvatar pet={data.ownPet} /><h4>{data.ownPet.name}</h4><p>{data.ownPetTeamId ? "正在团队庭院玩耍" : "在自己的小院休息"}</p><span>家园体验伙伴</span></div>
          {courtyard ? <button className="ac-btn" disabled={pending} onClick={() => movePet(data.ownPetTeamId === data.teamId ? null : data.teamId)}>{pending ? "稍等一下…" : data.ownPetTeamId === data.teamId ? "带伙伴回家" : "带伙伴来庭院"}</button> : own && data.ownPetTeamId ? <button className="ac-btn" disabled={pending} onClick={() => movePet(null)}>{pending ? "稍等一下…" : "叫伙伴回家"}</button> : own ? <button className="ac-btn-ghost" disabled={!data.teamId || pending} onClick={async () => { await movePet(data.teamId); }}>{data.teamId ? "送伙伴去团队庭院 ↗" : "加入团队后可以出门玩"}</button> : <button className="ac-btn-ghost" onClick={() => navigate("/home")}>回到我的家园 ↗</button>}
          <div className={s.smallNote}><Mark name="leaf" /><p>{courtyard ? "每个人都可以带自己的伙伴来这里。碰个面，一起留张合影。" : "家里的每一件小物，都可以有自己的位置。慢慢布置，不用着急。"}</p></div>
          <div className={s.neighborLink}><span>下一站</span><button onClick={() => navigate(courtyard ? `/home?view=members${teamQuery}` : `/home?view=courtyard${teamQuery}`)}>{courtyard ? "去朋友家串门" : "去公共庭院走走"}<span>↗</span></button></div>
        </>}
      </aside>

      {editing && <section className={s.catalog}><div className={s.catalogHeading}><div><p className={s.eyebrow}>THE LITTLE COLLECTION</p><h3>小物件，大欢喜。</h3></div><span>{draft.furniture.length} / 24 件家具</span></div><div className={s.furnitureList}>{(Object.keys(FURNITURE) as FurnitureKind[]).map(kind => <button key={kind} onClick={() => addFurniture(kind)} title={`添加${FURNITURE[kind].name}`}><span><FurnitureArt kind={kind} /></span><strong>{FURNITURE[kind].name}</strong><small>{FURNITURE[kind].category} <b>＋</b></small></button>)}</div>{selectedItem && <div className={s.selectionBar}><span>已选：{FURNITURE[selectedItem.kind].name}</span><button onClick={() => setDraft({ ...draft, furniture: draft.furniture.map(item => item.id === selected ? { ...item, flipped: !item.flipped } : item) })}>左右翻转</button><button onClick={() => { setDraft({ ...draft, furniture: draft.furniture.filter(item => item.id !== selected) }); setSelected(null); }}>收纳家具</button></div>}</section>}
    </div>}
    <footer className={s.pageFooter}><span>一处可以慢下来的地方。</span><span>你的家园会一直保留，下次见。</span></footer>
  </div>;
}
