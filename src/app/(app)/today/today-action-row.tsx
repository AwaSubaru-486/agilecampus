import Link from "next/link";
import { KIND_LABEL, KIND_ACTION, type RawAction } from "@/lib/action-queue";
const tone: Record<string, string> = {
  review: "bg-agent-soft text-agent",
  assignment_response: "bg-warn-soft text-warn",
  blocker_invite: "bg-risk-soft text-risk",
  rejected_work: "bg-risk-soft text-risk",
  overdue: "bg-risk-soft text-risk",
};
export function TodayActionRow({ action }: { action: RawAction }) {
  const href = action.approvalId
    ? "/projects/" +
      action.projectId +
      "?space=studio&approval=" +
      action.approvalId
    : action.decisionId
      ? "/projects/" + action.projectId + "?space=record#decisions"
      : action.taskId
        ? "/projects/" + action.projectId + "?space=work&task=" + action.taskId
        : "/projects/" + action.projectId + "?space=live";
  return (
    <div className="ac-action-row">
      <span
        className={
          "ac-badge shrink-0 " +
          (tone[action.kind] ?? "bg-signal-soft text-signal")
        }
      >
        {KIND_LABEL[action.kind] ?? "待处理"}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="text-sm font-semibold text-ink hover:text-signal"
        >
          {action.title}
        </Link>
        <p className="mt-2 text-xs text-ink-3">
          {action.projectName}
          {action.context ? "，" + action.context : ""}
        </p>
      </div>
      <Link href={href} className="ac-action-link">
        {action.kind === "review"
          ? "检查并验收"
          : action.kind === "assignment_response"
            ? "查看交接"
            : (KIND_ACTION[action.kind] ?? "查看详情")}{" "}
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
