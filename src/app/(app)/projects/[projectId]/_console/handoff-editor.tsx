"use client";

/**
 * 交接表单（W04）。
 *
 * 允许具有项目写权限的用户编辑任务的交接契约：
 *   - 接手人（人 / Agent，改变将重置旧认领）
 *   - 交接摘要（handoffBrief）
 *   - 完成条件（doneCriteria，每行一条）
 *   - 交付物/证据要求（requiredEvidence，复选框 + 补充说明）
 *   - 响应截止时间（responseDueAt）
 *   - 绑定已冻结上下文包（contextPackId）
 *
 * 规则（工单 §5 W04）：
 *   - 保存调用既有 updateTask 逻辑，修改交接要求后 handoffVersion 自动自增，
 *     原有认领被服务端自动重置（committedAt 置空），接手人须重新认领。
 *   - 显示当前契约版本与已确认版本，不开放用户直接编辑版本号。
 *   - 失败保留输入，成功后退出编辑模式并刷新视图。
 */

import { useActionState, useEffect, useState } from "react";
import { updateTaskHandoffAction, type UpdateTaskState } from "../actions";
import type { MemberSummary, SelectedTaskDetail } from "./console-shell";
import type { EvidenceType } from "@/lib/handoff";

const EVIDENCE_CONFIG: { type: EvidenceType; label: string; desc: string }[] = [
  { type: "link", label: "外部链接", desc: "PR / Commit / 文档" },
  { type: "file", label: "交付文件", desc: "成果附件 / 导出包" },
  { type: "text", label: "文本说明", desc: "交付记录 / 备忘" },
  { type: "test", label: "单测日志", desc: "测试报告 / CI 结果" },
  { type: "demo", label: "演示证据", desc: "录屏 / 演示截图" },
];

export function HandoffEditor({
  projectId,
  selectedTask,
  canWrite,
  members = [],
  availablePacks = [],
  onClose,
}: {
  projectId: string;
  selectedTask: SelectedTaskDetail;
  canWrite: boolean;
  members?: MemberSummary[];
  availablePacks?: { id: string; title: string; frozenAt?: string | null }[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<UpdateTaskState, FormData>(
    updateTaskHandoffAction,
    null,
  );

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      onClose();
    }
  }, [state, onClose]);

  // 解析既有的证据要求
  const evidenceSourceKey = selectedTask.id + "\0" + (selectedTask.requiredEvidence ?? []).join("\0");
  const [evidenceDraft, setEvidenceDraft] = useState<{
    sourceKey: string;
    values: Set<EvidenceType>;
  }>(() => ({ sourceKey: evidenceSourceKey, values: new Set(selectedTask.requiredEvidence ?? []) }));
  const checkedEvidence = evidenceDraft.sourceKey === evidenceSourceKey
    ? evidenceDraft.values
    : new Set(selectedTask.requiredEvidence ?? []);

  function toggleEvidence(type: EvidenceType) {
    setEvidenceDraft((previous) => {
      const current = previous.sourceKey === evidenceSourceKey
        ? previous.values
        : new Set(selectedTask.requiredEvidence ?? []);
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { sourceKey: evidenceSourceKey, values: next };
    });
  }

  if (!canWrite) {
    return (
      <div className="rounded border border-stroke p-3 text-xs text-ink-3">
        你没有修改该任务交接契约的权限。
      </div>
    );
  }

  const initialCriteria = (selectedTask.doneCriteria ?? []).join("\n");
  const initialDueDate = selectedTask.responseDueAt
    ? selectedTask.responseDueAt.slice(0, 10)
    : "";

  return (
    <form action={formAction} className="space-y-4 rounded border border-stroke-strong bg-panel p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={selectedTask.id} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stroke pb-2">
        <h4 className="text-sm font-semibold text-ink">编辑交接契约</h4>
        <div className="flex items-center gap-3 text-xs tabular-nums text-ink-3">
          <span>契约版本：v{selectedTask.handoffVersion}</span>
          <span>
            已认领版本：{selectedTask.committedHandoffVersion ? `v${selectedTask.committedHandoffVersion}` : "未认领"}
          </span>
        </div>
      </div>

      {state && "error" in state && (
        <div role="alert" className="rounded bg-risk/10 p-2 text-xs text-risk">
          {state.error}
        </div>
      )}

      {/* 接手人选择 */}
      <div>
        <label htmlFor="assigneeId" className="block text-xs font-medium text-ink-2">
          接手负责人（人 / Agent）
        </label>
        <select
          id="assigneeId"
          name="assigneeId"
          defaultValue={selectedTask.assigneeId ?? "unassigned"}
          className="ac-field mt-1 text-sm"
        >
          <option value="unassigned">未指派</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.kind === "agent" ? "Agent" : m.role === "admin" ? "负责人" : "成员"})
            </option>
          ))}
          {/* 若当前负责人不在 members 列表中，保留当前值 */}
          {selectedTask.assigneeId && !members.some((m) => m.id === selectedTask.assigneeId) && (
            <option value={selectedTask.assigneeId}>
              {selectedTask.assigneeName ?? selectedTask.assigneeId} (当前)
            </option>
          )}
        </select>
        <p className="mt-1 text-[11px] text-ink-3">
          改派负责人后将自动重置旧认领状态，需由新负责人重新确认契约。
        </p>
      </div>

      {/* 交接摘要 */}
      <div>
        <label htmlFor="handoffBrief" className="block text-xs font-medium text-ink-2">
          交接要求 / 任务背景
        </label>
        <textarea
          id="handoffBrief"
          name="handoffBrief"
          rows={3}
          defaultValue={selectedTask.handoffBrief ?? ""}
          placeholder="说明为什么做这件事、需要注意的背景或约束…"
          className="ac-field mt-1 text-sm"
        />
      </div>

      {/* 完成条件 */}
      <div>
        <label htmlFor="doneCriteria" className="block text-xs font-medium text-ink-2">
          完成条件（每行一条）
        </label>
        <textarea
          id="doneCriteria"
          name="doneCriteria"
          rows={3}
          defaultValue={initialCriteria}
          placeholder="单测通过率 100%&#10;符合设计规范&#10;部署到预发环境验证"
          className="ac-field mt-1 text-sm font-mono"
        />
        <p className="mt-1 text-[11px] text-ink-3">每行一条，验收时将逐项核对</p>
      </div>

      {/* 交付证据类型 */}
      <div>
        <span className="block text-xs font-medium text-ink-2">
          交付证据类型要求
        </span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {EVIDENCE_CONFIG.map(({ type, label, desc }) => (
            <label
              key={type}
              className={[
                "flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs cursor-pointer transition-colors",
                checkedEvidence.has(type)
                  ? "border-signal bg-signal/10 text-signal font-medium"
                  : "border-stroke bg-panel text-ink hover:bg-panel-hover",
              ].join(" ")}
            >
              <input
                type="checkbox"
                name="requiredEvidence"
                value={type}
                checked={checkedEvidence.has(type)}
                onChange={() => toggleEvidence(type)}
                className="sr-only"
              />
              <span>{label}</span>
              <span className="text-[10px] text-ink-3">({desc})</span>
            </label>
          ))}
        </div>
      </div>

      {/* 响应截止时间与交接资料包 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="responseDueAt" className="block text-xs font-medium text-ink-2">
            接手响应截止时间
          </label>
          <input
            type="date"
            id="responseDueAt"
            name="responseDueAt"
            defaultValue={initialDueDate}
            className="ac-field mt-1 text-sm"
          />
        </div>

        <div>
          <label htmlFor="contextPackId" className="block text-xs font-medium text-ink-2">
            绑定交接资料包
          </label>
          {availablePacks.length > 0 ? (
            <select
              id="contextPackId"
              name="contextPackId"
              defaultValue={selectedTask.contextPackId ?? ""}
              className="ac-field mt-1 text-xs"
            >
              <option value="">不绑定资料包</option>
              {availablePacks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} (已冻结{p.frozenAt ? ` ${new Date(p.frozenAt).toLocaleDateString("zh-CN")}` : ""})
                </option>
              ))}
              {selectedTask.contextPackId && !availablePacks.some((p) => p.id === selectedTask.contextPackId) && (
                <option value={selectedTask.contextPackId}>
                  {selectedTask.contextTitle ?? "当前已绑定资料包"}
                </option>
              )}
            </select>
          ) : (
            <input
              type="text"
              id="contextPackId"
              name="contextPackId"
              defaultValue={selectedTask.contextPackId ?? ""}
              placeholder="暂无冻结包，可输入资料包 UUID"
              className="ac-field mt-1 text-xs font-mono"
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-stroke">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1.5 text-xs text-ink-2 hover:bg-panel-hover"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={pending}
          className="ac-btn min-h-8 px-3 text-xs"
        >
          {pending ? "保存中…" : "保存交接契约"}
        </button>
      </div>
    </form>
  );
}
