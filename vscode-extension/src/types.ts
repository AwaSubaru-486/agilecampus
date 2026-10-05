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

export type WebviewMessage =
  | { type: "refresh" }
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "selectProject" }
  | { type: "openProject" }
  | { type: "openTask"; taskId: string }
  | { type: "viewAgentWork"; taskId: string };

export type HostMessage =
  | { type: "snapshot"; snapshot: ProjectSnapshot }
  | { type: "taskDetail"; taskId: string; detail: TaskDetail }
  | { type: "taskDetailError"; taskId: string; error: string };
