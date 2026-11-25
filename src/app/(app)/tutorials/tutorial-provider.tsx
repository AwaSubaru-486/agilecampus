"use client";
import { tutorialReopenStep, tutorialRouteMatches, tutorialStepRoute } from "@/lib/tutorials/route";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { buildTutorialCourses, type CourseId, type TutorialCourse, type TutorialProgress, type TutorialProject } from "@/lib/tutorials/catalog";
import type { TutorialCommand } from "@/lib/tutorials/progress";
import { saveTutorialProgress } from "./actions";
import { findTutorialTarget } from "@/lib/tutorials/target";
import { findShowcaseProject } from "@/lib/tutorials/showcase";
import { WELCOME_CHAPTERS, welcomeMinutes } from "@/lib/tutorials/example-flow";
import { NavigationProgress } from "@/components/navigation-progress";
import { WorkspaceIcon } from "@/components/workspace-icon";
import { useTutorialCardDrag } from "./use-tutorial-card-drag";

type TutorialContextValue = {
  projects: TutorialProject[]; project: TutorialProject | null; showcase: TutorialProject | null; courses: TutorialCourse[];
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
  const showcase = findShowcaseProject(projects);
  const [projectId, setProjectId] = useState(initialProgress.active && initialProgress.active.courseId !== "welcome" && (!initialProgress.active.projectId || projects.some((item) => item.id === initialProgress.active?.projectId))
    ? initialProgress.active.projectId ?? ""
    : showcase?.id ?? pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? projects[0]?.id ?? "");
  const project = projects.find((item) => item.id === projectId) ?? null;
  const courses = useMemo(() => buildTutorialCourses(project, progress.journey), [project, progress.journey]);
  const [running, setRunning] = useState(Boolean(initialProgress.active && !initialProgress.active.paused));
  const [prompt, setPrompt] = useState(initialProgress.status === "new");
  const [finished, setFinished] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
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
  const [collapsedStep, setCollapsedStep] = useState("");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const app = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const active = progress.active;
  const course = courses.find((item) => item.id === active?.courseId);
  const allowed = course && (course.id === "welcome" ? showcase : !course.needsProject || project) && (!course.roles || project && course.roles.includes(project.role))
    && (course.id === "welcome" || !active?.projectId || active.projectId === project?.id) && (active?.step ?? 0) < course.steps.length;
  const step = running && allowed && course ? course.steps[active?.step ?? 0] : null;
  const chapter = step?.chapter === undefined ? null : WELCOME_CHAPTERS[step.chapter];
  const guide = step?.guide;
  const nextChapter = course?.steps[(active?.step ?? 0) + 1]?.chapter;
  const stepKey = step ? `${course?.id}:${active?.step}:${projectId}` : "";
  const collapsed = Boolean(guide && collapsedStep === stepKey);
  const stepRoute = step?.route;
  const stepTarget = step?.target;
  const preferredTarget = step?.preferredTarget;
  const fallbackTarget = step?.fallbackTarget;
  const stepAction = step?.action;
  const browseAcceptance = step?.browseAcceptance ?? false;
  const isWelcome = Boolean(guide);
  const reopenIndex = course && active ? tutorialReopenStep(course.steps, active.step) : null;
  const needsReopen = reopenIndex !== null && reopenIndex !== active?.step;
  const globalNavigation = stepTarget === '[data-tour="nav-today"]' || stepTarget === '[data-tour="nav-projects"]';
  const rect = locatedKey === stepKey ? measuredRect : null;
  const targetReady = Boolean(rect || (isWelcome && locatedKey === stepKey));
  const fulfilled = actionKey === stepKey && actionDone;
  const emptyTaskList = Boolean(stepKey && emptyTaskKey === stepKey);
  const check = guide?.check;
  const answer = check?.choices[answers[stepKey]];
  const correct = check !== undefined && answers[stepKey] === check.correct;
  const canContinue = Boolean(!missing && (fulfilled || targetReady && (stepAction === "explore" || emptyTaskList)) && (!check || correct));

  useEffect(() => {
    const locate = () => setPortalRoot(document.querySelector<HTMLDialogElement>("dialog[open]") ?? document.body);
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);

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
    const selectedProject = id === "welcome" ? showcase : saved ? projects.find((item) => item.id === saved.projectId) ?? null : project;
    if (saved?.projectId && !selectedProject) {
      setError("上次练习的项目已不可访问。请选择当前项目，重新开始课程。"); return;
    }
    const selected = buildTutorialCourses(selectedProject, progress.journey).find((item) => item.id === id);
    if (!selected || selected.needsProject && !selectedProject || selected.roles && (!selectedProject || !selected.roles.includes(selectedProject.role))) {
      setError("此课程需要可访问的项目和对应角色。请选择项目后重新开始。"); return;
    }
    const index = saved ? tutorialReopenStep(selected.steps, Math.min(saved.step, selected.steps.length - 1)) : 0;
    if (await persist(id === "welcome" && !resume ? {type:"restart-example"} : { type: "save", courseId: id, step: index, projectId: id === "welcome" ? progress.journey?.projectId ?? null : selectedProject?.id ?? null })) {
      setProjectId(selectedProject?.id ?? "");
      readyKey.current = "";
      setLocatedKey(""); setFulfilled(false); setMissing(false);
      if (!resume) setAnswers({});
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
    if (!course || !active || (!back && !canContinue)) return;
    if (!back && active.step === course.steps.length - 1) {
      if (await persist({ type: "complete", courseId: course.id })) {
        if (course.id === "welcome" && progress.journey?.projectId) setProjectId(progress.journey.projectId);
        setRunning(false); setFinished(course.title); router.push("/tutorials");
      }
    } else {
      const nextIndex = Math.max(0, active.step + (back ? -1 : 1));
      const previous = course.steps[nextIndex];
      const index = back && previous.reopenFrom && !findTutorialTarget(document, previous.target).element ? tutorialReopenStep(course.steps, nextIndex) : nextIndex;
      await persist({ type: "save", courseId: course.id, step: index, projectId: course.id === "welcome" ? progress.journey?.projectId ?? null : project?.id ?? null });
    }
  }

  function retryTarget() {
    if (!course || !active || !step) return;
    if (needsReopen && reopenIndex !== null) {
      void persist({ type: "save", courseId: course.id, step: reopenIndex, projectId: active.projectId });
      return;
    }
    setMissing(false);
    setRetry((value) => value + 1);
    const current = window.location.pathname + window.location.search + window.location.hash;
    const destination = tutorialStepRoute(step.route, current);
    if (destination !== current) router.push(destination);
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
      setCollapsedStep("");
      if (!globalNavigation) window.dispatchEvent(new CustomEvent("agilecampus:tutorial-navigation", { detail: false }));
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (browseAcceptance && tutorialRouteMatches(stepRoute, current, true)) return;
      const destination = tutorialStepRoute(stepRoute, current);
      if (current !== destination) router.push(destination);
    });
    return () => cancelAnimationFrame(frame);
  }, [stepKey, stepRoute, stepTarget, browseAcceptance, globalNavigation, router]);

  // Track the real element after navigation, scrolling, resize and dynamic UI updates.
  useEffect(() => {
    if (!stepRoute || !stepTarget) return;
    let located: HTMLElement | null = null;
    const started = window.performance.now();
    const measure = () => {
      setViewport((current) => current.width === window.innerWidth && current.height === window.innerHeight ? current : { width: window.innerWidth, height: window.innerHeight });
      // A successful click can open a dialog or jump to a new section. Let the user see it.
      if (fulfilled && stepAction === "click" && readyKey.current === stepKey) return;
      if (!tutorialRouteMatches(stepRoute, window.location.href, browseAcceptance)) {
        located = null; setRect(null);
        if (!fulfilled && window.performance.now() - started > 8000) setMissing(true);
        return;
      }
      const preferred = preferredTarget ? findTutorialTarget(document, preferredTarget) : null;
      const resolved = preferred?.element ? preferred : findTutorialTarget(document, stepTarget);
      const fallback = !resolved.element && fallbackTarget ? findTutorialTarget(document, fallbackTarget).element : null;
      const element = resolved.element ?? fallback;
      if (stepAction === "result") {
        const complete = element?.getAttribute(step?.completion ?? "data-tour-complete") === "true";
        if (complete !== fulfilled) { setActionKey(stepKey); setFulfilled(complete); }
      }
      setEmptyTaskKey(resolved.emptyTaskList || (fallback && stepAction === "click") ? stepKey : "");
      // Route changes close the mobile drawer asynchronously. Keep requesting
      // it while the target is hidden, rather than losing a one-shot event.
      if (globalNavigation && !element && !fulfilled) {
        window.dispatchEvent(new Event("agilecampus:tutorial-navigation"));
      }
      if (!element) {
        located = null; setRect(null);
        if (!fulfilled && window.performance.now() - started > 5000) setMissing(true);
        return;
      }
      if (located !== element) {
        located = element;
        if (!isWelcome || !fulfilled) element.scrollIntoView({ block: browseAcceptance ? "start" : "center", inline: "nearest", behavior: "instant" });
      }
      const bounds = element.getBoundingClientRect();
      const top = Math.max(8, bounds.top - 6), left = Math.max(8, bounds.left - 6);
      const width = Math.max(0, Math.min(window.innerWidth - 8, bounds.right + 6) - left);
      const height = Math.max(0, Math.min(window.innerHeight - 8, bounds.bottom + 6) - top);
      if ((!width || !height) && !browseAcceptance) {
        if (!isWelcome) located = null;
        setRect(null);
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
  }, [stepRoute, stepTarget, preferredTarget, fallbackTarget, stepAction, stepKey, retry, fulfilled, browseAcceptance, isWelcome, globalNavigation, progress.journey, active?.step, course?.id, step?.id, step?.completion]);

  useEffect(() => {
    if (!stepTarget || !stepAction) return;
    const onAction = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest(stepTarget) : null;
      if (!(target instanceof HTMLElement)) return;
      // Fast clicks can arrive before the measuring interval, or close their target.
      // Capture the real target now so a successful action is never lost.
      if (readyKey.current !== stepKey) {
        const bounds = target.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const top = Math.max(8, bounds.top - 6), left = Math.max(8, bounds.left - 6);
        readyKey.current = stepKey; setLocatedKey(stepKey);
        setRect({ top, left, width: Math.max(0, Math.min(window.innerWidth - 8, bounds.right + 6) - left), height: Math.max(0, Math.min(window.innerHeight - 8, bounds.bottom + 6) - top) });
      }
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
      if (running && (browseAcceptance || isWelcome || (fulfilled && stepAction === "click"))) return;
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
  }, [mounted, prompt, finished, running, stepKey, pending, fulfilled, stepAction, browseAcceptance, isWelcome]);

  const modal = prompt || finished;
  const cardWidth = Math.min(check ? 428 : guide ? 392 : 360, viewport.width - 24);
  const mobile = viewport.width < 768;
  const inNativeDialog = portalRoot?.tagName === "DIALOG";
  const dockRight = !mobile && (inNativeDialog || !browseAcceptance && Boolean(rect && rect.left + rect.width / 2 < viewport.width / 2));
  const maskClass = isWelcome ? "bg-slate-950/25" : "bg-slate-950/60 pointer-events-auto";
  const welcome = courses.find(item => item.id === "welcome")!;
  const rightSpace = rect && viewport.width - rect.left - rect.width;
  const leftSpace = rect?.left ?? 0;
  const hasSideSpace = Boolean(rect && (rightSpace && rightSpace > cardWidth + 24 || leftSpace > cardWidth + 24));
  const cardLeft = !mobile && rect && rightSpace && rightSpace > cardWidth + 24 ? rect.left + rect.width + 16
    : !mobile && rect && leftSpace > cardWidth + 24 ? rect.left - cardWidth - 16 : rect ? viewport.width - cardWidth - 16 : 12;
  const desktopCardHeight = Math.min(430, Math.floor(viewport.height * .55));
  const lowestCardTop = viewport.height - desktopCardHeight - 16;
  const below = rect && rect.top + rect.height + 16 <= lowestCardTop;
  const mobileSpaceAbove = rect ? Math.max(0, rect.top - 76) : 0;
  const mobileSpaceBelow = rect ? Math.max(0, viewport.height - rect.top - rect.height - 24) : 0;
  const mobileAbove = mobile && rect && mobileSpaceAbove > mobileSpaceBelow;
  const mobileCardHeight = rect && rect.height < viewport.height * 0.65
    ? Math.max(guide ? 230 : 170, Math.min(340, Math.max(mobileSpaceAbove, mobileSpaceBelow)))
    : Math.min(340, viewport.height * 0.55);
  const cardTop = mobile ? mobileAbove ? 64 : undefined
    : rect && !hasSideSpace && rect.top >= desktopCardHeight + 32 ? rect.top - desktopCardHeight - 16
    : rect && !hasSideSpace && below ? rect.top + rect.height + 16
    : Math.max(16, Math.min(rect?.top ?? lowestCardTop, lowestCardTop));
  const { movedPosition, handle } = useTutorialCardDrag(card, viewport, cardWidth, mounted && running && !modal, portalRoot);
  const cardPlacement = collapsed
    ? { width: cardWidth, ...(dockRight ? { right: 12 } : { left: 12 }), bottom: 12 }
    : browseAcceptance
    ? { width: cardWidth, maxHeight: mobile ? "min(280px, 40vh)" : "min(360px, 50vh)", left: 12, bottom: 12 }
    : isWelcome && (!mobile || inNativeDialog)
    ? { width: cardWidth, maxHeight: inNativeDialog ? "min(340px, 46vh)" : desktopCardHeight, ...(dockRight ? { right: 12 } : { left: 12 }), bottom: 12 }
    : { width: cardWidth, maxHeight: mobile ? mobileCardHeight : desktopCardHeight, left: mobile ? 12 : cardLeft, top: cardTop, bottom: mobile && !mobileAbove ? 12 : undefined };

  return <TutorialContext.Provider value={{ projects, project, showcase, courses, progress, pending, error, selectProject: setProjectId, start }}>
    <NavigationProgress active={pending} label="正在保存教程进度…" />
    <div ref={app} data-tutorial-app inert={modal ? true : undefined}>{children}</div>
    {mounted && (modal || running) && createPortal(
      modal ? <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/65 p-4 backdrop-blur-sm">
        <div ref={card} role="dialog" aria-modal="true" aria-labelledby="tutorial-dialog-title" className="w-full max-w-lg rounded-2xl border border-stroke bg-panel p-6 shadow-2xl sm:p-8">
          <h2 id="tutorial-dialog-title" className="text-2xl font-semibold text-ink">{finished ? `已完成${finished}` : "用敏捷开发平台上手"}</h2>
          <p className="mt-3 text-sm leading-6 text-ink-2">{finished === welcome.title ? "你已经走过真实成员、任务、阶段审核和项目记录。可以回到目录选择一个功能再练，也可以把复盘想到的行动写进下一轮任务。" : finished ? "可以回到教程目录，按功能继续学习。" : showcase ? `用约 ${welcomeMinutes(welcome.steps)} 分钟认识团队和分工，从实际任务看到验收、版本和复盘。途中可以暂停。` : "当前账号暂时无法访问敏捷开发平台。可以先在教程目录学习其他功能。"}</p>
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            {finished ? <button className="ac-btn" onClick={() => { setFinished(null); router.push("/tutorials"); }}>查看教程目录</button> : <>
              {showcase ? <button className="ac-btn" disabled={pending} onClick={() => void start("welcome")}>{pending ? "保存中…" : "开始项目导览 →"}</button>
                : <button className="ac-btn" disabled={pending} onClick={async () => { if (await persist({ type: "dismiss" })) { setPrompt(false); router.push("/tutorials"); } }}>查看教程目录</button>}
              <button className="ac-btn-ghost" disabled={pending} onClick={async () => { if (await persist({ type: "dismiss" })) setPrompt(false); }}>暂时跳过</button>
            </>}
          </div>
        </div>
      </div> : <div className="fixed inset-0 z-[100] pointer-events-none" aria-label="互动教程">
        {browseAcceptance || (isWelcome && (collapsed || portalRoot?.tagName === "DIALOG")) || (fulfilled && stepAction === "click") ? null : rect && !missing ? <>
          {[
            { top: 0, left: 0, width: viewport.width, height: rect.top },
            { top: rect.top, left: 0, width: rect.left, height: rect.height },
            { top: rect.top, left: rect.left + rect.width, width: viewport.width - rect.left - rect.width, height: rect.height },
            { top: rect.top + rect.height, left: 0, width: viewport.width, height: viewport.height - rect.top - rect.height },
          ].map((style, index) => <div key={index} className={`absolute ${maskClass}`} style={style} />)}
          <div className="absolute rounded-lg border-2 border-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.18),0_0_28px_rgba(56,189,248,0.3)] transition-[top,left,width,height] duration-150 motion-reduce:transition-none" style={rect} />
        </> : <div className={`absolute inset-0 ${maskClass}`} />}
        <div ref={card} role="dialog" aria-modal="false" aria-labelledby="tutorial-step-title" className="absolute pointer-events-auto flex max-h-[min(430px,55vh)] flex-col overflow-hidden rounded-2xl border border-stroke bg-panel p-4 shadow-2xl sm:p-5"
          style={movedPosition ? { ...cardPlacement, ...movedPosition, right: "auto", bottom: "auto" } : cardPlacement}>
          <div className="flex items-center justify-between gap-3 text-xs">
            <button type="button" {...handle} title="拖动悬浮框" aria-label="拖动悬浮框。方向键移动，Home 键恢复位置"
              className="flex min-h-8 min-w-0 cursor-grab touch-none select-none items-center gap-1.5 rounded px-1.5 text-left font-semibold text-signal hover:bg-sunken active:cursor-grabbing">
              <WorkspaceIcon name="move" className="size-4 shrink-0" />
              <span>{chapter?.title ?? course?.title ?? "教程"}</span>
            </button>
            <div className="flex flex-wrap justify-end gap-1">
              {isWelcome && <button type="button" aria-expanded={!collapsed} aria-controls="tutorial-step-content" onClick={() => setCollapsedStep(collapsed ? "" : stepKey)} className="rounded px-2 py-1 text-signal hover:bg-sunken">{collapsed ? "展开讲解" : "收起讲解"}</button>}
              <button disabled={pending} onClick={() => void pause()} className="rounded px-2 py-1 text-ink-3 hover:bg-sunken">暂停 / 退出</button>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="教程进度" aria-valuemin={0} aria-valuemax={course?.steps.length ?? 1} aria-valuenow={(active?.step ?? 0) + 1}>
            <div className="h-full bg-signal transition-all motion-reduce:transition-none" style={{ width: `${((active?.step ?? 0) + 1) / (course?.steps.length ?? 1) * 100}%` }} />
          </div>
          <p className="mt-3 text-xs text-ink-3">{step?.chapter !== undefined && <>第 {step.chapter + 1} 章，共 {WELCOME_CHAPTERS.length} 章。 </>}步骤 {(active?.step ?? 0) + 1} / {course?.steps.length ?? 1}</p>
          <h2 id="tutorial-step-title" className="mt-1 shrink-0 text-lg font-semibold text-ink">{step?.title ?? "先选择可用的项目"}</h2>
          <div key={stepKey} id="tutorial-step-content" hidden={collapsed} className="min-h-0 overflow-y-auto pr-1" tabIndex={0} role="region" aria-label="步骤讲解">
            <p className="mt-2 text-sm leading-6 text-ink-2">{!allowed ? "当前项目或角色已不可用。请返回教程目录选择你有权限的项目。" : emptyTaskList ? "这里还没有可以打开的任务。可以继续用后面的示例练习交付。" : missing ? needsReopen ? "这一步需要先打开内容。返回对应的打开步骤即可继续。" : "暂未找到这一步需要的入口。可以重新定位，也可以暂停后再继续。" : step?.instruction}</p>
            {check && targetReady && !missing && <fieldset className="mt-3 space-y-1.5">
              <legend className="mb-2 text-sm font-semibold text-ink">{check.question}</legend>
              {check.choices.map((choice, index) => <button key={choice.text} type="button" aria-pressed={answers[stepKey] === index}
                className="block w-full rounded-lg border border-stroke px-3 py-2 text-left text-xs leading-5 text-ink hover:bg-sunken aria-pressed:border-signal aria-pressed:bg-signal-soft"
                onClick={() => setAnswers(current => ({ ...current, [stepKey]: index }))}>{choice.text}</button>)}
              {answer && <p role="status" className={`mt-2 rounded-lg px-3 py-2 text-xs leading-5 ${correct ? "bg-success-soft text-success" : "bg-warn-soft text-warn"}`}>{answer.feedback}</p>}
            </fieldset>}
            {guide && allowed && !missing && (!check || correct) && <div className="mt-3 rounded-lg bg-signal-soft px-3 py-2 text-xs leading-5 text-ink-2">
              <p className="font-semibold text-signal">{nextChapter === undefined ? "带到下一轮" : nextChapter !== step?.chapter ? `下一章「${WELCOME_CHAPTERS[nextChapter]?.title}」` : "接下来"}</p>
              <p>{guide.handoff}</p>
            </div>}
            {((!browseAcceptance && (!isWelcome || stepAction !== "explore")) || !targetReady || missing || emptyTaskList) && <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-xs ${fulfilled ? "bg-success-soft text-success" : "bg-sunken text-ink-3"}`}>
              {fulfilled ? "操作完成，可以继续。" : emptyTaskList ? "暂无任务，可以继续学习流程" : missing ? "尚未定位到入口" : !targetReady ? "正在定位页面入口…" : step?.action === "click" ? inNativeDialog && isWelcome ? "读完后，点击面板上的关闭按钮" : "请点击亮起的入口" : step?.completion === "data-tour-conversation-open" ? "展开会话表单后继续" : step?.completion === "data-tour-conversation-closed" ? "收起会话表单后继续" : step?.action === "result" ? "完成亮起区域的操作后继续" : step?.action === "input" ? "请在亮起的输入框中实际填写" : "查看高亮区域后继续"}
            </p>}
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
          </div>
          <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-stroke pt-2">
            <button className="ac-btn-ghost" disabled={pending || !active?.step} onClick={() => void advance(true)}>上一步</button>
            {!allowed ? <button className="ac-btn" disabled={pending} onClick={() => void pause()}>返回教程目录</button> : missing ? <button className="ac-btn" disabled={pending} onClick={retryTarget}>{needsReopen ? "返回打开步骤" : "重新定位"}</button> : <button className="ac-btn" disabled={pending || !canContinue} onClick={() => void advance()}>{pending ? "保存中…" : active?.step === (course?.steps.length ?? 0) - 1 ? "完成教程 ✓" : "下一步 →"}</button>}
          </div>
        </div>
      </div>, portalRoot ?? document.body)}
  </TutorialContext.Provider>;
}
