"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { renderMemoryHelpDraft, type TaskMemoryVersionView } from "@/lib/task-memory-view";
import { raiseBlockerAction, type FormState } from "./actions";
import {
  BLOCKER_REASONS,
  BLOCKER_REASON_HINT,
  BLOCKER_REASON_LABEL,
  type BlockerReason,
} from "@/lib/blocker-labels";

type Project = { id: string; name: string };
type TaskOpt = { id: string; title: string };
type Helper = { userId: string; name: string; score: number; reasons: string[]; degraded: boolean };

const PROJECT_PATH = /^\/projects\/([0-9a-f-]{36})/i;

// 在项目执行与协作中心提供求助，跟随当前项目上下文。
export function StuckButton({ projects }: { projects: Project[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromPath = pathname.match(PROJECT_PATH)?.[1] ?? null;

  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(fromPath ?? projects[0]?.id ?? "");
  const [reason, setReason] = useState<BlockerReason | "">("");
  const [taskId, setTaskId] = useState("");
  const [tasks, setTasks] = useState<TaskOpt[]>([]);
  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [loadingHint, setLoadingHint] = useState(false);
  const [contextError, setContextError] = useState("");
  const [detail, setDetail] = useState("");
  const [helpNeeded, setHelpNeeded] = useState("");
  const [memoryVersions, setMemoryVersions] = useState<TaskMemoryVersionView[]>([]);
  const [memoryId, setMemoryId] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [helperError, setHelperError] = useState("");
  const [retry, setRetry] = useState(0);
  const [sent, setSent] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLFormElement>(null);
  const selectedMemory = memoryVersions.find((version) => version.id === memoryId);

  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("agilecampus:tutorial-close-panels", close);
    return () => window.removeEventListener("agilecampus:tutorial-close-panels", close);
  }, []);

  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await raiseBlockerAction(prev, fd);
    if (!res) {
      setOpen(false);
      setReason("");
      setTaskId("");
      setHelpers([]);
      setDetail(""); setHelpNeeded(""); setMemoryVersions([]); setMemoryId(""); setSent(true);
      trigger.current?.focus();
    }
    return res;
  }, null);

  // 进入项目页时跟随当前项目——多数求助就发生在此处。
  // 于渲染期调整而非 useEffect（同 task-card 的深链做法）：少渲染一轮，
  // 也避开 react-hooks/set-state-in-effect。
  const [prevFromPath, setPrevFromPath] = useState(fromPath);
  if (fromPath !== prevFromPath) {
    setPrevFromPath(fromPath);
    if (fromPath) setProjectId(fromPath);
    setTaskId(""); setTasks([]); setHelpers([]); setDetail(""); setHelpNeeded(""); setMemoryVersions([]); setMemoryId(""); setOpen(false);
  }

  useEffect(() => {
    function receive(event: Event) {
      const data = (event as CustomEvent).detail;
      if (!data || !projects.some((project) => project.id === data.projectId) ||
          !/^[0-9a-f-]{36}$/i.test(data.taskId ?? "") || !/^[0-9a-f-]{36}$/i.test(data.versionId ?? "")) return;
      setProjectId(data.projectId); setTaskId(data.taskId); setMemoryId(data.versionId);
      setDetail(""); setHelpNeeded(""); setReason(""); setHelpers([]); setTasks([]); setMemoryVersions([]);
      setContextError(""); setMemoryError(""); setMemoryLoading(true); setSent(false); setOpen(true);
    }
    window.addEventListener("agilecampus:request-help", receive);
    return () => window.removeEventListener("agilecampus:request-help", receive);
  }, [projects]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) { setOpen(false); trigger.current?.focus(); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, pending]);

  useEffect(() => {
    if (!open || !projectId || !taskId) return;
    const controller = new AbortController();
    fetch(`/api/projects/${projectId}/tasks/${taskId}/memory`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "无法读取任务断点");
        if (!Array.isArray(data.versions)) throw new Error("断点列表格式错误");
        if (!controller.signal.aborted) { setMemoryVersions(data.versions); setMemoryError(""); }
      }).catch((error) => { if (!controller.signal.aborted) setMemoryError(error instanceof Error ? error.message : "无法读取任务断点"); })
      .finally(() => { if (!controller.signal.aborted) setMemoryLoading(false); });
    return () => controller.abort();
  }, [open, projectId, taskId, retry]);

  // 快捷键 b。与既有的 + 建任务、1/2/F/M 看板视图同一套约定
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        (!fromPath && pathname !== "/collaboration") ||
        e.key !== "b" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        t?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName ?? "")
      )
        return;
      e.preventDefault();
      if (!open) {
        const currentTask = searchParams.get("task") ?? "";
        if (currentTask !== taskId) { setDetail(""); setHelpNeeded(""); }
        setTaskId(currentTask); setMemoryVersions([]); setMemoryId(""); setMemoryLoading(Boolean(currentTask)); setMemoryError(""); setSent(false);
      }
      setOpen((value) => !value);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fromPath, pathname, open, searchParams, taskId]);

  // 选定项目后取「我的在办任务」，供可选关联。
  // 两个 effect 都只在异步回调里改状态——同步 setState 会触发
  // react-hooks/set-state-in-effect，且本就该由事件处理器负责清场。
  useEffect(() => {
    if (!open || !projectId) return;
    let alive = true;
    const qs = new URLSearchParams({ projectId });
    if (taskId) qs.set("taskId", taskId);
    fetch(`/api/me/blocker-context?${qs}`, { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error("无法读取任务列表"); return r.json(); })
      .then((d) => {
        if (alive) { setTasks(d.tasks ?? []); setContextError(""); }
      })
      .catch(() => {
        if (alive) { setTasks([]); setContextError("无法读取任务列表，请重试"); }
      });
    return () => {
      alive = false;
    };
  }, [open, projectId, taskId, retry]);

  // 选定原因后才算推荐——不知道卡在哪一环，推荐就是瞎猜
  useEffect(() => {
    if (!open || !projectId || !reason) return;
    let alive = true;
    const qs = new URLSearchParams({ projectId, reason });
    if (taskId) qs.set("taskId", taskId);
    fetch(`/api/me/blocker-context?${qs}`, { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error("无法读取推荐"); return r.json(); })
      .then((d) => {
        if (alive) { setHelpers(d.helpers ?? []); setHelperError(""); }
      })
      .catch(() => {
        if (alive) { setHelpers([]); setHelperError("无法读取协助人推荐，仍可发送给组长与教师。"); }
      })
      .finally(() => {
        if (alive) setLoadingHint(false);
      });
    return () => {
      alive = false;
    };
  }, [open, projectId, reason, taskId, retry]);

  // 换原因或换任务时，旧推荐立刻作废——留着会让人以为新原因也推荐他
  function pickReason(r: BlockerReason) {
    setReason(r);
    setHelpers([]);
    setHelperError("");
    setLoadingHint(true);
  }

  function pickTask(id: string) {
    setTaskId(id);
    setMemoryVersions([]); setMemoryId(""); setMemoryError(""); setMemoryLoading(Boolean(id));
    setDetail("");
    if (reason) {
      setHelpers([]);
      setLoadingHint(true);
    }
  }

  function toggleOpen() {
    if (!open) {
      const currentTask = searchParams.get("task") ?? "";
      if (currentTask !== taskId) { setDetail(""); setHelpNeeded(""); }
      setTaskId(currentTask); setMemoryVersions([]); setMemoryId(""); setMemoryLoading(Boolean(currentTask)); setMemoryError(""); setSent(false);
    }
    setOpen((v) => !v);
    setHelpers([]);
    setLoadingHint(false);
  }

  if (!fromPath && pathname !== "/collaboration") return null;
  return (
    <>
      <button
        type="button"
        ref={trigger}
        data-tour="help-button" onClick={toggleOpen}
        aria-expanded={open}
        aria-label={open ? "关闭求助" : "发起求助"}
        aria-controls="task-help-panel"
        className="ac-pressable fixed bottom-4 right-4 z-30 min-h-10 border border-stroke-strong bg-panel px-3 py-2 text-sm font-medium text-ink"
      >
        {open ? "关闭求助" : "任务求助"}
      </button>
      {sent && !open && <p role="status" className="fixed bottom-16 right-4 z-30 border border-stroke bg-panel p-3 text-xs text-ink">求助已发送。<a href="/collaboration" className="ml-2 underline">查看协作中心</a></p>}

      {open && (
        <div className="fixed bottom-16 right-4 z-30 w-[24rem] max-w-[calc(100vw-2rem)]">
          <form id="task-help-panel" ref={panel} tabIndex={-1} aria-label="任务求助" action={formAction} className="max-h-[75dvh] space-y-4 overflow-y-auto border border-stroke-strong bg-panel p-5 shadow-pop">
            <div className="flex items-start justify-between gap-4 border-b border-stroke pb-3">
              <div>
                <h2 className="text-base font-semibold text-ink">任务求助</h2>
              </div>
              <button
                type="button"
                data-tour="help-close" disabled={pending} onClick={() => { setOpen(false); trigger.current?.focus(); }}
                className="ac-pressable min-h-9 px-1 text-xs text-ink-3 hover:text-ink"
              >
                关闭
              </button>
            </div>

            {!fromPath && (
              <label className="block space-y-1 text-xs text-ink-faint">
                哪个项目
                <select
                  className="ac-field text-sm"
                  value={projectId}
                  onChange={(e) => { setProjectId(e.target.value); pickTask(""); setTasks([]); setHelpers([]); setHelpNeeded(""); }}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <input type="hidden" name="projectId" value={projectId} />

            <fieldset className="space-y-2">
              <legend className="text-xs text-ink-3">问题类型</legend>
              <input type="hidden" name="reason" value={reason} required />
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-y border-stroke py-2">
                {BLOCKER_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={reason === r}
                    onClick={() => pickReason(r)}
                    className={`ac-pressable min-h-10 border-b text-left text-sm ${
                      reason === r
                        ? "border-warn font-medium text-ink"
                        : "border-transparent text-ink-2 hover:border-stroke-strong hover:text-ink"
                    }`}
                  >
                    {BLOCKER_REASON_LABEL[r]}
                  </button>
                ))}
              </div>
            </fieldset>
            {reason && (
              <p className="text-xs text-ink-2">{BLOCKER_REASON_HINT[reason]}</p>
            )}

            {/* 任务选填：不强制先找到任务，正是这个入口存在的理由 */}
            {(tasks.length > 0 || taskId) && (
              <label className="block space-y-1 text-xs text-ink-faint">
                关联任务（选填）
                <select
                  name="taskId"
                  className="ac-field text-sm"
                  value={taskId}
                  onChange={(e) => pickTask(e.target.value)}
                >
                  <option value="">不关联具体任务</option>
                  {taskId && !tasks.some((task) => task.id === taskId) && <option value={taskId}>当前任务（正在核对）</option>}
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {contextError && <p role="alert" className="text-xs text-risk">{contextError}<button type="button" onClick={() => setRetry((value) => value + 1)} className="ml-2 underline">重试</button></p>}
            {taskId && <div className="space-y-2 border-y border-stroke py-3">
              <label className="block text-xs text-ink-2" htmlFor="help-memory-version">工作断点</label>
              {memoryLoading ? <p role="status" className="text-xs text-ink-2">正在读取断点…</p> : memoryError ? <p role="alert" className="text-xs text-risk">{memoryError}<button type="button" className="ml-2 underline" onClick={() => { setMemoryLoading(true); setRetry((value) => value + 1); }}>重试</button></p> : memoryVersions.length ? <>
                <select id="help-memory-version" className="ac-field text-sm" value={memoryId} onChange={(event) => setMemoryId(event.target.value)}>
                  <option value="">选择断点（选填）</option>
                  {memoryId && !selectedMemory && <option value={memoryId}>所选断点不在当前列表，请重新选择</option>}
                  {memoryVersions.map((version) => <option key={version.id} value={version.id}>{version.title} / r{version.revision} / {version.id.slice(0, 8)}</option>)}
                </select>
                <button type="button" disabled={!selectedMemory || pending || detail.includes(renderMemoryHelpDraft(selectedMemory))} onClick={() => {
                  if (selectedMemory) setDetail((current) => [current, renderMemoryHelpDraft(selectedMemory)].filter(Boolean).join("\n\n"));
                }} className="min-h-9 text-xs text-ink underline disabled:opacity-50">将断点内容追加到说明</button>
              </> : <p className="text-xs text-ink-2">此任务没有已保存断点，可直接填写说明。</p>}
            </div>}

            <label className="block space-y-1 text-xs text-ink-faint">
              需要什么帮助
              <textarea
                name="helpNeeded"
                value={helpNeeded} onChange={(event) => setHelpNeeded(event.target.value)}
                rows={2}
                placeholder="比如：想找人帮我看一眼报错"
                className="ac-field text-sm"
              />
            </label>
            <label className="block space-y-1 text-xs text-ink-faint">
              补充说明（选填）
              <textarea name="detail" rows={detail ? 7 : 2} value={detail} onChange={(event) => setDetail(event.target.value)} className="ac-field text-sm" />
            </label>

            {helpers.length > 0 && (
              <fieldset className="space-y-2 border-t border-stroke pt-3">
                <legend className="text-xs font-medium text-ink">可能帮得上你的人</legend>
                {helpers.map((h) => (
                  <label key={h.userId} className="flex items-start gap-2 text-xs">
                    <input type="checkbox" name="inviteeIds" value={h.userId} className="mt-0.5" />
                    <span>
                      <span className="font-medium text-ink">{h.name}</span>
                      <span className="ml-1 text-ink-faint">
                        {h.degraded ? "（按空闲度推荐）" : ""}
                      </span>
                      <span className="mt-0.5 block leading-5 text-ink-soft">
                        {h.reasons.join("；")}
                      </span>
                    </span>
                  </label>
                ))}
                <p className="text-[11px] leading-4 text-ink-faint">
                  勾选后他们会收到通知；不勾选则只知会组长与教师。
                </p>
              </fieldset>
            )}
            {loadingHint && <p className="text-[11px] text-ink-faint">正在找可能帮得上的人…</p>}
            {helperError && <p role="status" className="text-xs text-ink-2">{helperError}</p>}

            {state && "error" in state && (
              <p aria-live="polite" className="text-xs text-high">
                {state.error}
              </p>
            )}

            <button disabled={pending || !projectId || !reason} className="ac-btn-ink w-full">
              {pending ? "发送中…" : "发出求助"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
