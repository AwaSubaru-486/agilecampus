import Link from "next/link";
import { KIND_LABEL, KIND_ACTION, type RawAction } from "@/lib/action-queue";
import { today } from "@/lib/today";
const tone: Record<string, string> = {
  review: "bg-agent-soft text-agent",
  assignment_response: "bg-warn-soft text-warn",
  blocker_invite: "bg-risk-soft text-risk",
  rejected_work: "bg-risk-soft text-risk",
  overdue: "bg-risk-soft text-risk",
};
export function TodayActionRow({ action }: { action: RawAction }) {
  const daysLeft = action.dueDate
    ? Math.round((Date.parse(`${action.dueDate}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000)
    : null;
  const deadlineLabel = daysLeft === null ? "未设截止"
    : daysLeft < 0 ? `已逾期 ${-daysLeft} 天`
      : daysLeft === 0 ? "今天截止" : `还剩 ${daysLeft} 天`;
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
      <div className="ac-action-main min-w-0 flex-1">
        <Link
          href={href}
          className="min-w-0 text-sm font-semibold leading-6 text-ink hover:text-signal"
        >
          {action.title}
        </Link>
        <span className="ac-action-project-tag" title={action.projectName} aria-label={`项目：${action.projectName}`}>
          {action.projectName}
        </span>
        <span className={`ac-action-deadline-tag ${daysLeft === null ? "bg-sunken text-ink-3" : daysLeft < 0 ? "bg-risk-soft text-risk" : daysLeft <= 3 ? "bg-warn-soft text-warn" : "bg-signal-soft text-signal"}`}
          title={action.dueDate ? `截止日期：${action.dueDate}` : "尚未设置截止日期"}>
          {deadlineLabel}
        </span>
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
