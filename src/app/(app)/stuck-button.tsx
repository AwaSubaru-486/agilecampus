"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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

// 全局求助入口。
//
// 之所以做成常驻悬浮而非任务卡上的按钮：人卡住时最不想做的事，
// 就是先翻到那个任务、找到那张卡、再点一个小按钮。
// 求助的门槛必须低到「无论我在哪一页，都同一个动作」。
export function StuckButton({ projects }: { projects: Project[] }) {
  const pathname = usePathname();
  const fromPath = pathname.match(PROJECT_PATH)?.[1] ?? null;

  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(fromPath ?? projects[0]?.id ?? "");
  const [reason, setReason] = useState<BlockerReason | "">("");
  const [taskId, setTaskId] = useState("");
  const [tasks, setTasks] = useState<TaskOpt[]>([]);
  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [loadingHint, setLoadingHint] = useState(false);

  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const res = await raiseBlockerAction(prev, fd);
    if (!res) {
      setOpen(false);
      setReason("");
      setTaskId("");
      setHelpers([]);
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
  }

  // 快捷键 b。与既有的 + 建任务、1/2/F/M 看板视图同一套约定
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        e.key !== "b" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        t?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(t?.tagName ?? "")
      )
        return;
      e.preventDefault();
      toggleOpen();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 选定项目后取「我的在办任务」，供可选关联。
  // 两个 effect 都只在异步回调里改状态——同步 setState 会触发
  // react-hooks/set-state-in-effect，且本就该由事件处理器负责清场。
  useEffect(() => {
    if (!open || !projectId) return;
    let alive = true;
    fetch(`/api/me/blocker-context?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setTasks(d.tasks ?? []);
      })
      .catch(() => {
        if (alive) setTasks([]);
      });
    return () => {
      alive = false;
    };
  }, [open, projectId]);

  // 选定原因后才算推荐——不知道卡在哪一环，推荐就是瞎猜
  useEffect(() => {
    if (!open || !projectId || !reason) return;
    let alive = true;
    const qs = new URLSearchParams({ projectId, reason });
    if (taskId) qs.set("taskId", taskId);
    fetch(`/api/me/blocker-context?${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setHelpers(d.helpers ?? []);
      })
      .catch(() => {
        if (alive) setHelpers([]);
      })
      .finally(() => {
        if (alive) setLoadingHint(false);
      });
    return () => {
      alive = false;
    };
  }, [open, projectId, reason, taskId]);

  // 换原因或换任务时，旧推荐立刻作废——留着会让人以为新原因也推荐他
  function pickReason(r: BlockerReason) {
    setReason(r);
    setHelpers([]);
    setLoadingHint(true);
  }

  function pickTask(id: string) {
    setTaskId(id);
    if (reason) {
      setHelpers([]);
      setLoadingHint(true);
    }
  }

  function toggleOpen() {
    setOpen((v) => !v);
    setHelpers([]);
    setLoadingHint(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-label={open ? "关闭求助" : "发起求助"}
        className={`ac-pressable fixed bottom-4 right-4 z-30 flex items-center gap-2 border-b-2 border-ink bg-ground/95 px-2 py-2 text-sm font-medium text-ink backdrop-blur-sm ${open ? "border-warn" : ""}`}
      >
        <span aria-hidden className={`h-2 w-2 ${open ? "bg-warn" : "bg-ink"}`} />
        {open ? "收起求助" : "需要搭手？"}
      </button>

      {open && (
        <div className="fixed bottom-16 right-4 z-30 w-[24rem] max-w-[calc(100vw-2rem)]">
          <form action={formAction} className="ac-panel-enter max-h-[70vh] space-y-4 overflow-y-auto border-l-2 border-ink bg-ground p-5 shadow-pop">
            <div className="flex items-start justify-between gap-4 border-b border-stroke pb-3">
              <div>
                <p className="text-xs text-ink-3">先让别人知道你停在哪里</p>
                <h2 className="mt-1 text-base font-semibold text-ink">需要搭手？</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ac-pressable min-h-9 px-1 text-xs text-ink-3 hover:text-ink"
              >
                先不发
              </button>
            </div>

            {!fromPath && (
              <label className="block space-y-1 text-xs text-ink-faint">
                哪个项目
                <select
                  className="ac-field text-sm"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
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
              <legend className="text-xs text-ink-3">你停在哪一环？</legend>
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
              <p className="-mt-2 border-l-2 border-warn/60 pl-2 text-xs leading-5 text-ink-2">{BLOCKER_REASON_HINT[reason]}</p>
            )}

            {/* 任务选填：不强制先找到任务，正是这个入口存在的理由 */}
            {tasks.length > 0 && (
              <label className="block space-y-1 text-xs text-ink-faint">
                关联任务（选填）
                <select
                  name="taskId"
                  className="ac-field text-sm"
                  value={taskId}
                  onChange={(e) => pickTask(e.target.value)}
                >
                  <option value="">不关联具体任务</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block space-y-1 text-xs text-ink-faint">
              需要什么帮助
              <textarea
                name="helpNeeded"
                rows={2}
                placeholder="比如：想找人帮我看一眼报错"
                className="ac-field text-sm"
              />
            </label>
            <label className="block space-y-1 text-xs text-ink-faint">
              补充说明（选填）
              <textarea name="detail" rows={2} className="ac-field text-sm" />
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
