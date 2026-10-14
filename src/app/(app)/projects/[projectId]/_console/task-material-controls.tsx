"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/feedback-link";
import { LoadingProgress } from "@/components/loading-progress";
import { ContextPackBuilder } from "../context-pack-builder";
import type { SelectedTaskDetail } from "./console-shell";
import { addTaskMemoryAction, bindTaskMaterialAction } from "./material-actions";

export function TaskMaterialBinding({ projectId, task, canWrite }: { projectId: string; task: SelectedTaskDetail; canWrite: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(task.contextPackId ?? "");
  const [packs, setPacks] = useState<Parameters<typeof ContextPackBuilder>[0]["packs"]>(() => (task.availablePacks ?? []).map(pack => ({ ...pack, status: "frozen" as const, summary: null, frozenAt: pack.frozenAt ?? null })));
  const [state, action, pending] = useActionState(bindTaskMaterialAction, null);
  const canBind = canWrite && task.status !== "review" && task.status !== "done";
  useEffect(() => {
    if (state && "ok" in state) router.refresh();
  }, [state, router]);

  return <div className="mt-3 space-y-3 border-t border-stroke pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="ac-btn-ghost !min-h-8 !text-xs" disabled={!canBind || pending} onClick={() => setEditing(!editing)} aria-expanded={editing}>
        {editing ? "收起绑定" : task.contextPackId ? "更换交接资料" : "绑定交接资料"}
      </button>
      {!canWrite && <span className="text-xs text-ink-3">交接资料由组长或任务成员绑定。</span>}
      {canWrite && !canBind && <span className="text-xs text-ink-3">验收中或已完成的任务需先退回修改。</span>}
    </div>
    {editing && canBind && <div className="space-y-3 rounded-xl border border-stroke bg-sunken/30 p-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="taskId" value={task.id} />
        <label className="block space-y-1 text-xs text-ink-2">
          <span>选择已冻结的资料包</span>
          <select name="contextPackId" className="ac-field" value={selected} onChange={event => setSelected(event.target.value)} disabled={pending}>
            <option value="">不绑定资料包</option>
            {packs.map(pack => <option key={pack.id} value={pack.id}>{pack.title}</option>)}
            {task.contextPackId && !packs.some(pack => pack.id === task.contextPackId) && <option value={task.contextPackId}>当前已绑定资料包</option>}
          </select>
        </label>
        {packs.length === 0 && <p className="text-xs text-ink-3">还没有可用的冻结资料包，可在下方创建。</p>}
        <p className="text-xs text-ink-3">更换或解除绑定后，任务成员需要重新确认交接要求。</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="ac-btn !min-h-8 !text-xs" disabled={pending || selected === (task.contextPackId ?? "")}>{pending ? "正在绑定…" : selected || !task.contextPackId ? "保存绑定" : "解除绑定"}</button>
          <button type="button" className="ac-btn-ghost !min-h-8 !text-xs" disabled={pending} onClick={() => setCreating(!creating)} aria-expanded={creating}>{creating ? "收起创建" : "+ 创建交接资料包"}</button>
        </div>
        {pending && <LoadingProgress label="正在更新交接资料…" />}
        {state && "error" in state && <p role="alert" className="text-xs text-risk">{state.error}</p>}
        {state && "ok" in state && <p role="status" className="text-xs text-success">交接资料绑定已更新。</p>}
      </form>
      {creating && <div className="border-t border-stroke pt-4">
        <ContextPackBuilder projectId={projectId} taskId={task.id} conversationId={null}
          tasks={[{ id: task.id, name: task.title }]} milestones={[]}
          conversations={(task.conversations ?? []).map(conversation => ({ id: conversation.id, name: conversation.title ?? "任务会话", title: conversation.title ?? null }))}
          packs={packs} selectedPackId={selected || null} onPacksChange={setPacks}
          onSelectPack={id => setSelected(id ?? "")} />
        <p className="mt-3 text-xs text-ink-3">冻结完成后，点击上方“保存绑定”应用到当前任务。</p>
      </div>}
    </div>}
  </div>;
}

export function TaskMemoryEntry({ projectId, taskId, canAdd }: { projectId: string; taskId: string; canAdd: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addTaskMemoryAction, null);
  useEffect(() => {
    if (state && "ok" in state) router.refresh();
  }, [state, router]);
  return <div className="mb-3 space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="ac-btn-ghost !min-h-8 !text-xs" disabled={!canAdd || pending} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "收起表单" : "+ 添加项目记忆"}</button>
      {!canAdd && <span className="text-xs text-ink-3">当前视角只读。</span>}
    </div>
    {open && canAdd && <form action={action} className="space-y-3 rounded-xl border border-stroke bg-sunken/30 p-4">
      <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="taskId" value={taskId} />
      <label className="block space-y-1 text-xs text-ink-2"><span>记忆分类</span><select name="category" className="ac-field" disabled={pending}>
        <option value="constraint">约束限制</option><option value="decision">架构决策</option><option value="learned">已验证经验</option><option value="rejected_approach">废弃方案</option>
      </select></label>
      <label className="block space-y-1 text-xs text-ink-2"><span>记忆标题</span><input name="title" className="ac-field" required maxLength={200} disabled={pending} /></label>
      <label className="block space-y-1 text-xs text-ink-2"><span>记忆内容</span><textarea name="content" className="ac-field" rows={4} required maxLength={5000} disabled={pending} placeholder="记录结论、适用条件和依据…" /></label>
      <label className="block space-y-1 text-xs text-ink-2"><span>代码提交引用（可选）</span><input name="codeRefSha" className="ac-field" maxLength={128} disabled={pending} /></label>
      {state && "error" in state && <p role="alert" className="text-xs text-risk">{state.error}</p>}
      {state && "ok" in state && <p role="status" className="text-xs text-success">记忆已保存并关联当前任务。</p>}
      {pending && <LoadingProgress label="正在保存项目记忆…" />}
      <button type="submit" className="ac-btn !min-h-8 !text-xs" disabled={pending}>{pending ? "保存中…" : "保存项目记忆"}</button>
    </form>}
  </div>;
}

export function ExtensionEntry({ parallel = false }: { parallel?: boolean }) {
  return <div className="mt-3 space-y-2 border-t border-stroke pt-3">
    <Link href="/settings/tokens#vscode-connection" className="ac-btn-ghost !min-h-8 !text-xs">配置 VS Code 插件 →</Link>
    <p className="text-xs leading-5 text-ink-3">{parallel
      ? "连接项目后，在 VS Code 命令面板运行“AgileCampus: 创建并行尝试 worktree”。本地结果可通过“查看本地 Agent 尝试”查看；此处展示已登记到平台的接续回执。"
      : "连接项目后，在 VS Code 命令面板依次运行“AgileCampus: 保存本地检查点”“AgileCampus: 发布检查点摘要”“AgileCampus: 交接给成员”。"}</p>
  </div>;
}
