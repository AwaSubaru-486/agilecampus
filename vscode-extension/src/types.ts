export type ProjectSnapshot = {
  projectName: string;
  projectId: string | null;
  repository: string | null;
  currentBranch: string | null;
  myTasks: { id: string; title: string; status: string; dueDate: string | null }[];
  blockers: { taskId: string | null; title: string; note: string }[];
};

export type WebviewMessage =
  | { type: "openProject" }
  | { type: "continueAiWork"; taskId?: string }
  | { type: "reportBlocker"; taskId?: string }
  | { type: "refresh" };
