"use client";

import { useActionState, useState } from "react";
import { createEntryAction, deleteEntryAction, type FormState } from "./actions";
import { ENTRY_LABEL, ENTRY_PLACEHOLDER, type EntryType } from "@/lib/entry-labels";
// 类型导入，编译后擦除，不会把 db 拖进浏览器包
import type { EntryRow } from "@/lib/entry";

// 项目档案：老师反馈、文档、成果链接。
//
// 三者共用一个区域而不是各占一块，理由见 lib/entry.ts：
// 需求文档的痛点是「成果散落在不同工具中」，把它拆成三个版块
// 就是在界面里把那个毛病再演一遍。

const TONE: Record<EntryType, string> = {
  feedback: "bg-accent-soft text-accent",
  doc: "bg-sunken text-ink-soft",
  deliverable: "bg-primary-soft text-primary",
};

export function ArchiveSection({
  projectId,
  entries,
  tasks,
  canWrite,
  canGiveFeedback,
}: {
  projectId: string;
  entries: EntryRow[];
  tasks: { id: string; title: string }[];
  canWrite: boolean;
  /** 老师或组长才能留反馈 */
  canGiveFeedback: boolean;
}) {
  const [adding, setAdding] = useState<null | EntryType>(null);

  const counts = {
    feedback: entries.filter((e) => e.type === "feedback").length,
    doc: entries.filter((e) => e.type === "doc").length,
    deliverable: entries.filter((e) => e.type === "deliverable").length,
  };

  return (
    <section id="archive" className="ac-card scroll-mt-20 overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">项目档案</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            老师的反馈、团队写的文档、交出来的成果——都落在这一处，
            项目结束时不必再从聊天记录里翻
          </p>
        </div>
        <p className="text-xs text-ink-faint">
          反馈 {counts.feedback} · 文档 {counts.doc} · 成果 {counts.deliverable}
        </p>
      </header>

      {canWrite && (
        <div className="flex flex-wrap gap-2 border-b border-line bg-sunken/40 px-4 py-2">
          <AddButton type="doc" label="＋ 文档" current={adding} set={setAdding} />
          <AddButton type="deliverable" label="＋ 成果链接" current={adding} set={setAdding} />
          {canGiveFeedback && (
            <AddButton type="feedback" label="＋ 老师反馈" current={adding} set={setAdding} />
          )}
        </div>
      )}

      {adding && (
        <EntryForm
          projectId={projectId}
          type={adding}
          tasks={tasks}
          onClose={() => setAdding(null)}
        />
      )}

      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-soft">
          档案还是空的。把代码仓库、答辩材料、老师的意见放进来，
          项目结束时就有一份完整的过程资产。
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((e) => (
            <EntryItem key={e.id} entry={e} projectId={projectId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AddButton({
  type,
  label,
  current,
  set,
}: {
  type: EntryType;
  label: string;
  current: EntryType | null;
  set: (t: EntryType | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => set(current === type ? null : type)}
      className={current === type ? "ac-btn px-3 py-1.5 text-xs" : "ac-btn-ghost text-xs"}
    >
      {label}
    </button>
  );
}

function EntryForm({
  projectId,
  type,
  tasks,
  onClose,
}: {
  projectId: string;
  type: EntryType;
  tasks: { id: string; title: string }[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, fd) => {
      const res = await createEntryAction(prev, fd);
      if (!res) onClose();
      return res;
    },
    null,
  );

  return (
    <form action={formAction} className="space-y-2 border-b border-line bg-sunken/60 px-4 py-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="type" value={type} />

      <input
        name="title"
        required
        autoFocus
        placeholder={ENTRY_PLACEHOLDER[type].title}
        className="ac-field text-sm"
      />

      {type === "deliverable" && (
        <input
          name="url"
          required
          type="url"
          placeholder="https://github.com/… 或演示视频、数据集、答辩材料"
          className="ac-field text-sm"
        />
      )}

      <textarea
        name="content"
        rows={3}
        placeholder={ENTRY_PLACEHOLDER[type].content}
        className="ac-field text-sm"
      />

      {tasks.length > 0 && (
        <select name="taskId" defaultValue="" className="ac-field text-sm">
          <option value="">不关联具体任务</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      )}

      {state && "error" in state && (
        <p aria-live="polite" className="text-xs text-high">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button disabled={pending} className="ac-btn px-3 py-1.5 text-xs">
          {pending ? "保存中…" : "存入档案"}
        </button>
        <button type="button" onClick={onClose} disabled={pending} className="text-xs text-ink-faint hover:text-primary">
          取消
        </button>
      </div>
    </form>
  );
}

function EntryItem({ entry, projectId }: { entry: EntryRow; projectId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    deleteEntryAction,
    null,
  );

  // 老师的话在界面上要一眼认出来——它是指导，不是同伴的随口一说
  const fromTeacher = entry.type === "feedback" && entry.authorRole === "teacher";

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`ac-badge ${TONE[entry.type]}`}>{ENTRY_LABEL[entry.type]}</span>
        <span className="text-sm font-medium text-ink">
          {entry.url ? (
            <a href={entry.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
              {entry.title} ↗
            </a>
          ) : (
            entry.title
          )}
        </span>
        {entry.taskTitle && (
          <span className="text-xs text-ink-faint">关于「{entry.taskTitle}」</span>
        )}
      </div>

      {entry.content && (
        <p className="mt-1.5 border-l-2 border-line pl-3 text-sm leading-6 text-ink-soft">
          {entry.content}
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
        <span className="font-medium text-ink-soft">{entry.authorName ?? "已注销"}</span>
        {fromTeacher && <span className="text-accent">老师</span>}
        {entry.authorKind === "agent" && (
          <span className="text-[9px] font-semibold text-primary">AI</span>
        )}
        <span className="tabular-nums">
          {entry.createdAt.toLocaleDateString("sv-SE")}
        </span>
        <form action={formAction} className="ml-auto">
          <input type="hidden" name="entryId" value={entry.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <button disabled={pending} className="hover:text-high hover:underline">
            {pending ? "删除中…" : "删除"}
          </button>
        </form>
        {state && "error" in state && <span className="text-high">{state.error}</span>}
      </div>
    </li>
  );
}
