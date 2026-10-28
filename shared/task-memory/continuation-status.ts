export const continuationStates = ["waiting", "received", "checking", "awaiting_confirmation", "launching", "running", "finished", "failed", "cancelled", "unknown"] as const;
export type ContinuationState = typeof continuationStates[number];
export type ContinuationProgress = { state: Exclude<ContinuationState, "waiting" | "received">; attemptId?: string; sessionConfirmed?: boolean };
export type ContinuationView = {
  id: string; versionId: string; state: ContinuationState; sequence: number;
  attemptId: string | null; createdAt: string; updatedAt: string;
  events: Array<{ state: ContinuationState; at: string }>;
};
export const continuationLabels: Record<ContinuationState, string> = {
  waiting: "等待 VS Code 插件接收", received: "插件已收到", checking: "正在核对记忆与代码",
  awaiting_confirmation: "等待你在 VS Code 确认启动", launching: "正在启动，等待会话回执",
  running: "Agent 已接收记忆并开始工作", finished: "本次会话已结束，成果待核对",
  failed: "接续失败，请查看插件的核对结果", cancelled: "已在插件中取消", unknown: "执行结果待核对，请查看插件记录",
};
export function isContinuationTerminal(state: ContinuationState) { return ["finished", "failed", "cancelled", "unknown"].includes(state); }
export function canTransitionContinuation(from: ContinuationState, to: ContinuationState) {
  const next: Record<ContinuationState, readonly ContinuationState[]> = {
    waiting: ["received"], received: ["checking", "failed", "cancelled"],
    checking: ["awaiting_confirmation", "failed", "cancelled"],
    awaiting_confirmation: ["launching", "failed", "cancelled"],
    launching: ["running", "failed", "unknown"], running: ["finished", "failed", "unknown"],
    finished: [], failed: [], cancelled: [], unknown: [],
  };
  return next[from].includes(to);
}
