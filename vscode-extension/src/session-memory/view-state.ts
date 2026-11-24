import type { SessionMemoryBindingView, SessionMemoryViewState } from "../types";

/** Human-facing session status is derived from verified local facts, never guessed from a busy flag. */
export function createSessionMemoryViewState(taskId: string, sessions: SessionMemoryBindingView[]): SessionMemoryViewState {
  const status: SessionMemoryViewState["status"] = sessions.length === 0 ? "unbound"
    : sessions.some((item) => item.hasGaps || item.captureFailures?.length) ? "partial"
      : sessions.every((item) => !item.recording) ? "stopped"
      : sessions.some((item) => item.hookConfigured && item.eventCount > 0) ? "recorded"
        : sessions.some((item) => item.hookConfigured) ? "waiting" : "linked";
  const failure = sessions.flatMap((item) => item.captureFailures ?? [])[0];
  const failureCount = sessions.reduce((count, item) => count + (item.captureFailures?.length ?? 0), 0);
  const detail = status === "linked" ? "已关联；本机记录尚未启用。"
    : status === "waiting" ? "尚未观察到新事件。首次使用时，请在 Codex 中运行 /hooks 并审查、信任该处理器。"
      : status === "recorded" ? "Hook 事件已写入本机；内容未上传。"
      : status === "partial" ? failure
          ? `${failureCount > 1 ? `有 ${failureCount} 条采集失败尚未恢复。` : "采集曾失败。"}最近一次（${new Date(failure.occurredAt).toLocaleString()}）：${failure.detail}。请核对故障时间前后的记录完整性。`
          : "事件记录中存在缺口；请查看会话记录，确认缺失的输入或工具结果。"
        : status === "stopped" ? "已停止记录；已有本地历史保留。" : null;
  return { taskId, status, detail, sessions };
}
