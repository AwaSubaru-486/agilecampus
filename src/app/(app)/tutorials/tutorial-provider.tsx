"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { buildTutorialCourses, type CourseId, type TutorialCourse, type TutorialProgress, type TutorialProject } from "@/lib/tutorials/catalog";
import type { TutorialCommand } from "@/lib/tutorials/progress";
import { saveTutorialProgress } from "./actions";
import { findTutorialTarget } from "@/lib/tutorials/target";

type TutorialContextValue = {
  projects: TutorialProject[]; project: TutorialProject | null; courses: TutorialCourse[];
  progress: TutorialProgress; pending: boolean; error: string;
  selectProject: (id: string) => void;
  start: (id: CourseId, resume?: boolean) => Promise<void>;
};
const TutorialContext = createContext<TutorialContextValue | null>(null);
export function useTutorials() {
  const context = useContext(TutorialContext);
  if (!context) throw new Error("TutorialProvider is required");
  return context;
}
type Rect = { top: number; left: number; width: number; height: number };

export function TutorialProvider({ children, projects, initialProgress }: {
  children: React.ReactNode; projects: TutorialProject[]; initialProgress: TutorialProgress;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [progress, setProgress] = useState(initialProgress);
  const [projectId, setProjectId] = useState(initialProgress.active && (!initialProgress.active.projectId || projects.some((item) => item.id === initialProgress.active?.projectId))
    ? initialProgress.active.projectId ?? ""
    : pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? projects[0]?.id ?? "");
  const project = projects.find((item) => item.id === projectId) ?? null;
  const courses = useMemo(() => buildTutorialCourses(project), [project]);
  const [running, setRunning] = useState(Boolean(initialProgress.active && !initialProgress.active.paused));
  const [prompt, setPrompt] = useState(initialProgress.status === "new");
  const [finished, setFinished] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [measuredRect, setRect] = useState<Rect | null>(null);
  const [locatedKey, setLocatedKey] = useState("");
  const [emptyTaskKey, setEmptyTaskKey] = useState("");
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [missing, setMissing] = useState(false);
  const [actionDone, setFulfilled] = useState(false);
  const [actionKey, setActionKey] = useState("");
  const readyKey = useRef("");
  const [retry, setRetry] = useState(0);
  const app = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const active = progress.active;
  const course = courses.find((item) => item.id === active?.courseId);
  const allowed = course && (!course.needsProject || project) && (!course.roles || project && course.roles.includes(project.role))
    && (!active?.projectId || active.projectId === project?.id) && (active?.step ?? 0) < course.steps.length;
  const step = running && allowed && course ? course.steps[active?.step ?? 0] : null;
  const stepKey = step ? `${course?.id}:${active?.step}:${projectId}` : "";
  const stepRoute = step?.route;
  const stepTarget = step?.target;
  const stepAction = step?.action;
  const rect = locatedKey === stepKey ? measuredRect : null;
  const fulfilled = actionKey === stepKey && actionDone;
  const emptyTaskList = Boolean(stepKey && emptyTaskKey === stepKey);

  async function persist(command: TutorialCommand) {
    if (busy.current) return null;
    busy.current = true; setPending(true); setError("");
    try {
      const result = await saveTutorialProgress(command);
      if ("error" in result) { setError(result.error ?? "教程进度未保存，请重试。"); return null; }
      setProgress(result.progress);
      return result.progress;
    } catch {
      setError("网络连接中断，请重试。你的当前步骤仍保留。");
      return null;
    } finally { busy.current = false; setPending(false); }
  }

  async function start(id: CourseId, resume = false) {
    const saved = resume && progress.active?.courseId === id ? progress.active : null;
    const selectedProject = saved ? projects.find((item) => item.id === saved.projectId) ?? null : project;
    if (saved?.projectId && !selectedProject) {
      setError("上次练习的项目已不可访问。请选择当前项目，重新开始课程。"); return;
    }
    const selected = buildTutorialCourses(selectedProject).find((item) => item.id === id);
    if (!selected || selected.needsProject && !selectedProject || selected.roles && (!selectedProject || !selected.roles.includes(selectedProject.role))) {
      setError("此课程需要可访问的项目和对应角色。请选择项目后重新开始。"); return;
    }
    const index = saved ? Math.min(saved.step, selected.steps.length - 1) : 0;
    if (await persist({ type: "save", courseId: id, step: index, projectId: selectedProject?.id ?? null })) {
      setProjectId(selectedProject?.id ?? "");
      readyKey.current = "";
      setLocatedKey(""); setFulfilled(false); setMissing(false);
      window.dispatchEvent(new Event("agilecampus:tutorial-close-panels"));
      setPrompt(false); setFinished(null); setRunning(true);
    }
  }
  async function pause() {
    if (await persist({ type: "pause" })) {
      window.dispatchEvent(new Event("agilecampus:tutorial-close-panels"));
      setRunning(false); router.push("/tutorials");
    }
  }
  async function advance(back = false) {
    if (!course || !active || (!back && (!rect || step?.action !== "explore" && !fulfilled && !emptyTaskList))) return;
    if (!back && active.step === course.steps.length - 1) {
      if (await persist({ type: "complete", courseId: course.id })) {
        setRunning(false); setFinished(course.title); router.push("/tutorials");
      }
    } else {
      await persist({ type: "save", courseId: course.id, step: Math.max(0, active.step + (back ? -1 : 1)), projectId: project?.id ?? null });
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Navigate once per step. User clicks may themselves change the URL; do not undo them.
  useEffect(() => {
    if (!stepRoute || !stepTarget) return;
    const frame = requestAnimationFrame(() => {
      setFulfilled(false); setRect(null); setMissing(false);
      if (!stepTarget.includes("nav-")) window.dispatchEvent(new CustomEvent("agilecampus:tutorial-navigation", { detail: false }));
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (current !== stepRoute) router.push(stepRoute);
    });
    return () => cancelAnimationFrame(frame);
  }, [stepKey, stepRoute, stepTarget, router]);

  // Track the real element after navigation, scrolling, resize and dynamic UI updates.
  useEffect(() => {
    if (!stepRoute || !stepTarget) return;
    let located: HTMLElement | null = null;
    const started = Date.now();
    const measure = () => {
      setViewport((current) => current.width === window.innerWidth && current.height === window.innerHeight ? current : { width: window.innerWidth, height: window.innerHeight });
      // A successful click can open a dialog or jump to a new section. Let the user see it.
      if (fulfilled && stepAction === "click" && readyKey.current === stepKey) return;
      const expected = new URL(stepRoute, window.location.origin);
      const current = new URL(window.location.href);
      if (current.pathname !== expected.pathname || [...expected.searchParams].some(([key, value]) => current.searchParams.get(key) !== value)) {
        if (!fulfilled && Date.now() - started > 8000) setMissing(true);
        return;
      }
      const resolved = findTutorialTarget(document, stepTarget);
      const element = resolved.element;
      setEmptyTaskKey(resolved.emptyTaskList ? stepKey : "");
      // Route changes close the mobile drawer asynchronously. Keep requesting
      // it while the target is hidden, rather than losing a one-shot event.
      if (stepTarget.includes("nav-") && !element && !fulfilled) {
        window.dispatchEvent(new Event("agilecampus:tutorial-navigation"));
      }
      if (!element) {
        if (!fulfilled && Date.now() - started > 5000) setMissing(true);
        return;
      }
      if (located !== element) {
        located = element;
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      }
      const bounds = element.getBoundingClientRect();
      const top = Math.max(8, bounds.top - 6), left = Math.max(8, bounds.left - 6);
      const width = Math.max(0, Math.min(window.innerWidth - 8, bounds.right + 6) - left);
      const height = Math.max(0, Math.min(window.innerHeight - 8, bounds.bottom + 6) - top);
      if (!width || !height) {
        located = null; setRect(null);
        return;
      }
      const next = { top, left, width, height };
      readyKey.current = stepKey;
      setLocatedKey(stepKey);
      setRect((current) => current && Object.keys(next).every((key) => Math.abs(current[key as keyof Rect] - next[key as keyof Rect]) < 1) ? current : next);
      setMissing(false);
    };
    const interval = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    measure();
    return () => { clearInterval(interval); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [stepRoute, stepTarget, stepAction, stepKey, retry, fulfilled]);

  useEffect(() => {
    if (!stepTarget || !stepAction) return;
    const onAction = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest(stepTarget) : null;
      if (!target || readyKey.current !== stepKey) return;
      setActionKey(stepKey);
      if (event.type === "click" && stepAction === "click") setFulfilled(true);
      if ((event.type === "input" || event.type === "change") && stepAction === "input" && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        setFulfilled(target.value.trim().length >= (target.dataset.tour === "task-brief" ? 10 : 1));
      }
    };
    document.addEventListener("click", onAction, true);
    document.addEventListener("input", onAction, true);
    document.addEventListener("change", onAction, true);
    return () => { document.removeEventListener("click", onAction, true); document.removeEventListener("input", onAction, true); document.removeEventListener("change", onAction, true); };
  }, [stepTarget, stepAction, stepKey]);

  // Initial prompt traps focus; live lessons allow keyboard access to the highlighted UI.
  useEffect(() => {
    if (!mounted || (!prompt && !finished && !running)) return;
    const frame = requestAnimationFrame(() => { if (!fulfilled) card.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }); });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (running) void pause();
        else if (prompt) void persist({ type: "dismiss" }).then((saved) => { if (saved) setPrompt(false); });
        else if (finished) { setFinished(null); router.push("/tutorials"); }
      }
      if (event.key !== "Tab") return;
      if (running && fulfilled && stepAction === "click") return;
      const targets = step ? [...document.querySelectorAll<HTMLElement>(step.target)] : [];
      const focusables = [...targets.flatMap((target) => [target, ...target.querySelectorAll<HTMLElement>("a[href],button,input,textarea,select,[tabindex]")]), ...card.current?.querySelectorAll<HTMLElement>("a[href],button,input,select,[tabindex]") ?? []]
        .filter((node) => !node.hasAttribute("disabled") && node.tabIndex >= 0 && node.getBoundingClientRect().width > 0);
      if (!focusables.length) return;
      event.preventDefault();
      const index = focusables.indexOf(document.activeElement as HTMLElement);
      focusables[(index + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); };
  // Event handler uses the current progress and lesson.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, prompt, finished, running, stepKey, pending, fulfilled, stepAction]);

  const modal = prompt || finished;
  const cardWidth = Math.min(360, viewport.width - 24);
  const mobile = viewport.width < 768;
  const rightSpace = rect && viewport.width - rect.left - rect.width;
  const leftSpace = rect?.left ?? 0;
  const hasSideSpace = Boolean(rect && (rightSpace && rightSpace > cardWidth + 24 || leftSpace > cardWidth + 24));
  const cardLeft = !mobile && rect && rightSpace && rightSpace > cardWidth + 24 ? rect.left + rect.width + 16
    : !mobile && rect && leftSpace > cardWidth + 24 ? rect.left - cardWidth - 16 : viewport.width - cardWidth - 16;
  const below = rect && rect.top + rect.height + 330 < viewport.height;
  const mobileSpaceAbove = rect ? Math.max(0, rect.top - 76) : 0;
  const mobileSpaceBelow = rect ? Math.max(0, viewport.height - rect.top - rect.height - 24) : 0;
  const mobileAbove = mobile && rect && mobileSpaceAbove > mobileSpaceBelow;
  const mobileCardHeight = rect && rect.height < viewport.height * 0.65
    ? Math.max(120, Math.min(340, Math.max(mobileSpaceAbove, mobileSpaceBelow)))
    : Math.min(340, viewport.height * 0.5);
  const cardTop = mobile ? mobileAbove ? 64 : undefined
    : rect && !hasSideSpace && rect.top > 356 ? rect.top - 340 - 16
    : rect && !hasSideSpace && below ? rect.top + rect.height + 16
    : Math.max(16, Math.min(rect?.top ?? 80, viewport.height - 340));

  return <TutorialContext.Provider value={{ projects, project, courses, progress, pending, error, selectProject: setProjectId, start }}>
    <div ref={app} data-tutorial-app inert={modal ? true : undefined}>{children}</div>
    {mounted && (modal || running) && createPortal(
      modal ? <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/65 p-4 backdrop-blur-sm">
        <div ref={card} role="dialog" aria-modal="true" aria-labelledby="tutorial-dialog-title" className="w-full max-w-lg rounded-2xl border border-stroke bg-panel p-6 shadow-2xl sm:p-8">
          <span className="text-xs font-semibold tracking-widest text-signal">AGILECAMPUS，互动教程</span>
          <h2 id="tutorial-dialog-title" className="mt-3 text-2xl font-semibold text-ink">{finished ? `完成了：${finished}` : "要一起走一遍工作台吗？"}</h2>
          <p className="mt-3 text-sm leading-6 text-ink-2">{finished ? "已经掌握这段流程。以后可以从侧栏“新手教程”单独练习任何功能。" : "像游戏的新手引导一样，亮起一个入口，亲手操作，再进入下一关。可以随时暂停，也可以只学某一项。"}</p>
          {!finished && <p className="mt-3 rounded-lg bg-sunken p-3 text-xs leading-5 text-ink-3">{project ? `当前项目：${project.name}，${project.role === "admin" ? "组长" : project.role === "teacher" ? "导师" : "组员"}路线` : "先熟悉通用入口；加入团队并拥有项目后，可在目录继续学习项目功能。"}</p>}
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            {finished ? <button className="ac-btn" onClick={() => { setFinished(null); router.push("/tutorials"); }}>查看教程目录</button> : <>
              <button className="ac-btn" disabled={pending} onClick={() => void start("welcome")}>{pending ? "保存中…" : "开始互动引导 →"}</button>
              <button className="ac-btn-ghost" disabled={pending} onClick={async () => { if (await persist({ type: "dismiss" })) setPrompt(false); }}>暂时跳过</button>
            </>}
          </div>
        </div>
      </div> : <div className="fixed inset-0 z-[100] pointer-events-none" aria-label="互动教程">
        {fulfilled && stepAction === "click" ? null : rect && !missing ? <>
          {[
            { top: 0, left: 0, width: viewport.width, height: rect.top },
            { top: rect.top, left: 0, width: rect.left, height: rect.height },
            { top: rect.top, left: rect.left + rect.width, width: viewport.width - rect.left - rect.width, height: rect.height },
            { top: rect.top + rect.height, left: 0, width: viewport.width, height: viewport.height - rect.top - rect.height },
          ].map((style, index) => <div key={index} className="absolute bg-slate-950/60 pointer-events-auto" style={style} />)}
          <div className="absolute rounded-lg border-2 border-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.18),0_0_28px_rgba(56,189,248,0.3)] transition-[top,left,width,height] duration-150 motion-reduce:transition-none" style={rect} />
        </> : <div className="absolute inset-0 bg-slate-950/60 pointer-events-auto" />}
        <div ref={card} role="dialog" aria-modal="false" aria-labelledby="tutorial-step-title" className="absolute pointer-events-auto max-h-[min(430px,55vh)] overflow-y-auto rounded-2xl border border-stroke bg-panel p-5 shadow-2xl" style={{ width: cardWidth, maxHeight: mobile ? mobileCardHeight : undefined, left: mobile ? 12 : cardLeft, top: cardTop, bottom: mobile && !mobileAbove ? 12 : undefined }}>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-signal">{course?.title ?? "教程"}</span>
            <button disabled={pending} onClick={() => void pause()} className="rounded px-2 py-1 text-ink-3 hover:bg-sunken">暂停 / 退出</button>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="教程进度" aria-valuemin={0} aria-valuemax={course?.steps.length ?? 1} aria-valuenow={(active?.step ?? 0) + 1}>
            <div className="h-full bg-signal transition-all motion-reduce:transition-none" style={{ width: `${((active?.step ?? 0) + 1) / (course?.steps.length ?? 1) * 100}%` }} />
          </div>
          <p className="mt-3 text-xs text-ink-3">步骤 {(active?.step ?? 0) + 1} / {course?.steps.length ?? 1}</p>
          <h2 id="tutorial-step-title" className="mt-1 text-lg font-semibold text-ink">{step?.title ?? "先选择可用的项目"}</h2>
          <p className="mt-2 text-sm leading-6 text-ink-2">{!allowed ? "当前项目或角色已不可用。请返回教程目录选择你有权限的项目。" : emptyTaskList ? "当前任务列表为空。任务发布后会出现在这里，点击任务即可查看交接要求与提交入口。现在可以继续认识执行流程，无需先创建任务。" : missing ? "此页暂时没有对应入口，可能尚未创建任务或阶段。先在项目中完成准备，再返回本课继续。" : step?.instruction}</p>
          <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-xs ${fulfilled ? "bg-success-soft text-success" : "bg-sunken text-ink-3"}`}>
            {fulfilled ? "✓ 操作完成！可以进入下一步。" : emptyTaskList ? "暂无任务，可以继续学习流程" : missing ? "需要先完成准备" : !rect ? "正在定位页面入口…" : step?.action === "click" ? "请点击亮起的入口" : step?.action === "input" ? "请在亮起的输入框中实际填写" : "试着操作亮起的区域，再继续"}
          </p>
          {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
          <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-2 bg-panel pt-2">
            <button className="ac-btn-ghost" disabled={pending || !active?.step} onClick={() => void advance(true)}>上一步</button>
            {!allowed ? <button className="ac-btn" disabled={pending} onClick={() => void pause()}>返回教程目录</button> : missing ? <button className="ac-btn" disabled={pending} onClick={() => { setRetry((value) => value + 1); router.push(step?.route ?? "/tutorials"); }}>重新定位</button> : <button className="ac-btn" disabled={pending || !rect || step?.action !== "explore" && !fulfilled && !emptyTaskList} onClick={() => void advance()}>{pending ? "保存中…" : active?.step === (course?.steps.length ?? 0) - 1 ? "完成教程 ✓" : "下一步 →"}</button>}
          </div>
        </div>
      </div>, document.body)}
  </TutorialContext.Provider>;
}
