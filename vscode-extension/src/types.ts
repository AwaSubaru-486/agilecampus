export type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  teamId: string;
  teamName: string;
  taskTotal: number;
  doneCount: number;
};

export type TaskSummary = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  handoffBrief: string | null;
  doneCriteria: string[];
  requiredEvidence: string[];
  updatedAt: string;
};

export type TaskDetail = TaskSummary & {
  projectId: string;
  description: string | null;
  completionNote: string | null;
  responseDueAt: string | null;
  handoffVersion: number;
  committedHandoffVersion: number | null;
};

export type ProjectSnapshot = {
  state: "disconnected" | "loading" | "ready" | "error";
  error: string | null;
  updatedAt: string | null;
  projectName: string;
  projectId: string | null;
  teamName: string | null;
  workspaceName: string | null;
  repository: string | null;
  currentBranch: string | null;
  tasks: TaskSummary[];
};

export type SessionMemoryStatus = "unbound" | "loading" | "linked" | "waiting" | "recorded" | "partial" | "stopped" | "error";

export type SessionMemoryBindingView = {
  sessionKey: string;
  provider: "codex" | "claude";
  recording: boolean;
  eventCount: number;
  latestSequence: number;
  lastSavedAt: string | null;
  hookConfigured: boolean;
  hasGaps?: boolean;
  captureFailures?: Array<{ occurredAt: string; detail: string }>;
};

export type SessionMemoryViewState = {
  taskId: string;
  status: SessionMemoryStatus;
  detail: string | null;
  sessions: SessionMemoryBindingView[];
};

export type WebviewMessage =
  | { type: "refresh" }
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "selectProject" }
  | { type: "openProject" }
  | { type: "openTask"; taskId: string }
  | { type: "viewAgentWork"; taskId: string }
  | { type: "bindSession"; taskId: string }
  | { type: "enableCodexCapture"; taskId: string }
  | { type: "disableCodexCapture" }
  | { type: "dismissHookAlert"; alertId: string }
  | { type: "refreshSessionMemory"; taskId: string }
  | { type: "openSessionRecord"; taskId: string; sessionKey: string }
  | { type: "stopSessionCapture"; taskId: string; sessionKey: string };

export type HostMessage =
  | { type: "snapshot"; snapshot: ProjectSnapshot }
  | { type: "codexHookStatus"; configured: boolean }
  | { type: "codexHookAlerts"; alerts: Array<{ id: string; occurredAt: string; detail: string }>; error: string | null }
  | { type: "taskDetail"; taskId: string; detail: TaskDetail }
  | { type: "taskDetailError"; taskId: string; error: string }
  | { type: "sessionMemoryState"; state: SessionMemoryViewState };
