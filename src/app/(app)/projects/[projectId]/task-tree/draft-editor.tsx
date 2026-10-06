"use client";

import { useActionState, useId, useState } from "react";
import type { TaskTreePayload } from "@/lib/task-tree";
import { saveDraftAction, type TreeActionState } from "./actions";
import { DraftActions } from "./task-tree-forms";

export function DraftEditor({
  projectId,
  draftId,
  payload,
  members,
}: {
  projectId: string;
  draftId: string;
  payload: TaskTreePayload;
  members: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(payload);
  const [saved, setSaved] = useState(JSON.stringify(payload));
  const id = useId();
  const serialized = JSON.stringify(value);
  const dirty = serialized !== saved;
  const [state, action, pending] = useActionState<TreeActionState, FormData>(
    async (previous, data) => {
      const result = await saveDraftAction(previous, data);
      if (result?.success) setSaved(String(data.get("payload")));
      return result;
    },
    null,
  );

  function changeTask(
    stageIndex: number,
    taskIndex: number,
    patch: Partial<TaskTreePayload["stages"][number]["tasks"][number]>,
  ) {
    setValue((current) => ({
      ...current,
      stages: current.stages.map((stage, si) =>
        si === stageIndex
          ? {
              ...stage,
              tasks: stage.tasks.map((task, ti) =>
                ti === taskIndex ? { ...task, ...patch } : task,
              ),
            }
          : stage,
      ),
    }));
  }

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="payload" value={serialized} />
        <fieldset disabled={pending} className="space-y-4">
          <legend className="sr-only">编辑任务草案</legend>
          <label className="block text-xs text-ink-soft">
            规划说明
            <textarea
              required
              maxLength={1000}
              value={value.summary}
              onChange={(e) => setValue({ ...value, summary: e.target.value })}
              className="ac-input mt-1 w-full"
              rows={2}
            />
          </label>
          {value.stages.map((stage, si) => (
            <section key={si} className="border border-stroke bg-panel">
              <div className="flex items-center gap-3 border-b border-stroke px-4 py-3">
                <span className="shrink-0 text-xs text-signal">
                  阶段 {si + 1}
                </span>
                <input
                  aria-label={`阶段 ${si + 1} 名称`}
                  required
                  maxLength={120}
                  className="ac-input w-full"
                  value={stage.title}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      stages: value.stages.map((item, index) =>
                        index === si
                          ? { ...item, title: e.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </div>
              <div className="divide-y divide-stroke">
                {stage.tasks.map((task, ti) => (
                  <div key={task.key} className="grid gap-3 p-4 md:grid-cols-2">
                    <label className="text-xs text-ink-soft md:col-span-2">
                      {task.parentKey ? "子任务" : "任务"} · {ti + 1}
                      <input
                        required
                        maxLength={160}
                        className="ac-input mt-1 w-full"
                        value={task.title}
                        onChange={(e) =>
                          changeTask(si, ti, { title: e.target.value })
                        }
                      />
                    </label>
                    <label className="text-xs text-ink-soft">
                      负责人
                      <select
                        className="ac-input mt-1 w-full"
                        value={task.assigneeId ?? ""}
                        onChange={(e) =>
                          changeTask(si, ti, {
                            assigneeId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">待分配</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-ink-soft">
                      优先级
                      <select
                        className="ac-input mt-1 w-full"
                        value={task.priority}
                        onChange={(e) =>
                          changeTask(si, ti, {
                            priority: e.target.value as typeof task.priority,
                          })
                        }
                      >
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                      </select>
                    </label>
                    <label className="text-xs text-ink-soft">
                      执行说明
                      <textarea
                        className="ac-input mt-1 w-full"
                        maxLength={2000}
                        rows={3}
                        value={task.description}
                        onChange={(e) =>
                          changeTask(si, ti, { description: e.target.value })
                        }
                      />
                    </label>
                    <label className="text-xs text-ink-soft">
                      完成标准（每行一项）
                      <textarea
                        className="ac-input mt-1 w-full"
                        required
                        rows={3}
                        value={task.doneCriteria.join("\n")}
                        onChange={(e) =>
                          changeTask(si, ti, {
                            doneCriteria: e.target.value.split("\n"),
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            id={`${id}-status`}
            role={state?.error ? "alert" : "status"}
            className={`text-xs ${state?.error ? "text-danger" : "text-ink-soft"}`}
          >
            {state?.error ??
              (dirty
                ? "有未保存修改，请先保存再发布。"
                : (state?.success ?? "确认任务和负责人后发布。"))}
          </p>
          <button
            disabled={pending || !dirty}
            className="ac-btn-ghost"
            aria-describedby={`${id}-status`}
          >
            {pending ? "保存中…" : "保存修改"}
          </button>
        </div>
      </form>
      <DraftActions
        projectId={projectId}
        draftId={draftId}
        disabled={dirty || pending}
      />
    </div>
  );
}
