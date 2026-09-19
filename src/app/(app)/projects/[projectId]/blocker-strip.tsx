"use client";

import { useActionState } from "react";
import { resolveBlockerAction, type FormState } from "../../actions";
import { BLOCKER_REASON_LABEL, type BlockerReason } from "@/lib/blocker-labels";

export type BlockerItem = {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  raisedByName: string | null;
  reason: BlockerReason;
  detail: string | null;
  helpNeeded: string | null;
  ageHours: number;
};

/** 悬置时长的说法：小时以内说分钟，一天以内说小时，再久说天 */
function ageLabel(hours: number): string {
  if (hours < 1) return "刚刚";
  if (hours < 24) return `已悬 ${hours} 小时`;
  return `已悬 ${Math.floor(hours / 24)} 天`;
}

export function BlockerStrip({
  projectId,
  blockers,
}: {
  projectId: string;
  blockers: BlockerItem[];
}) {
  if (blockers.length === 0) return null;

  return (
    <section className="scroll-mt-20">
      <div className="border-y border-accent/40">
        <div className="flex items-center gap-2 border-b border-line bg-accent-soft/40 px-0 py-2">
          <span aria-hidden className="size-2 rounded-full bg-accent" />
          <h2 className="text-xs font-semibold text-ink">
            {blockers.length} 条求助进行中
          </h2>
          <span className="text-[11px] text-ink-faint">
            ——卡住的活不会自己变好，有人搭手才动得了
          </span>
        </div>
      <ul className="divide-y divide-line">
          {blockers.map((b) => (
            <BlockerRow key={b.id} projectId={projectId} blocker={b} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function BlockerRow({ projectId, blocker }: { projectId: string; blocker: BlockerItem }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    resolveBlockerAction,
    null,
  );

  return (
    <li className="px-0 py-3">
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-medium text-ink">{blocker.raisedByName ?? "已注销成员"}</span>
        <span className="ac-badge bg-accent-soft text-accent">
          {BLOCKER_REASON_LABEL[blocker.reason]}
        </span>
        {blocker.taskTitle && (
          <span className="text-xs text-ink-soft">关于「{blocker.taskTitle}」</span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-ink-faint">
          {ageLabel(blocker.ageHours)}
        </span>
      </div>

      {blocker.helpNeeded && (
        <p className="mt-1 text-xs leading-5 text-ink-soft">
          <span className="text-ink-faint">需要</span> {blocker.helpNeeded}
        </p>
      )}
      {blocker.detail && (
        <p className="mt-0.5 text-xs leading-5 text-ink-faint">{blocker.detail}</p>
      )}

      <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="blockerId" value={blocker.id} />
        <input type="hidden" name="projectId" value={projectId} />
        <input
          name="note"
          placeholder="说一句怎么解决的（选填）"
          className="ac-field flex-1 text-xs"
        />
        <button disabled={pending} className="ac-btn-ghost shrink-0 text-xs">
          {pending ? "提交中…" : "已解决"}
        </button>
      </form>
      {state && "error" in state && (
        <p aria-live="polite" className="mt-1 text-xs text-high">
          {state.error}
        </p>
      )}
    </li>
  );
}
