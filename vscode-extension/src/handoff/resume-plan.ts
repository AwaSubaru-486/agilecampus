export type HandoffPlan = {
  checkpointId: string;
  projectId: string;
  taskId: string;
  baseSha: string;
  branch: string | null;
  targetDirectory: string;
  materials: Array<{ kind: "context" | "transcript"; bytes: number }>;
  evidenceRequirements: string[];
  taskUpdatedAt: string;
  handoffVersion: number;
  mode: "context-only";
  executesAgent: false;
};
