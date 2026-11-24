export type WorkCheckpoint = {
  schemaVersion: 1;
  id: string;
  parentCheckpointId: string | null;
  serverOrigin: string;
  projectId: string;
  taskId: string;
  milestoneId: string | null;
  capturedAt: string;
  handoffVersion: number;
  taskUpdatedAt: string;
  taskSnapshot: {
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    assigneeId: string | null;
    assigneeName: string | null;
    description: string | null;
    handoffBrief: string | null;
    doneCriteria: string[];
    requiredEvidence: string[];
    responseDueAt: string | null;
    completionNote: string | null;
    committedHandoffVersion: number | null;
  };
  repository: {
    key: string;
    headSha: string;
    branch: string | null;
    dirty: boolean;
    dirtyPolicy: "clean-only" | "excluded";
    recoveryBlockers: string[];
  };
  session: {
    provider: string;
    providerVersion: string;
    sessionId: string | null;
    checkpointId: string | null;
    captureMode: "native" | "context-only";
  };
  handoff: {
    goal: string;
    completed: string[];
    remaining: string[];
    blocker: string | null;
    rejectedApproaches: string[];
    nextAction: string;
  };
  tests: Array<{
    command: string;
    exitCode: number | null;
    recordedAt: string;
    source: "captured" | "user-reported";
  }>;
  artifacts: Array<{
    id: string;
    kind: "transcript" | "context";
    relativePath: string;
    byteLength: number;
    sha256: string;
  }>;
};

export type NewCheckpointArtifact = {
  kind: "transcript" | "context";
  content: Uint8Array;
};

export type CheckpointListItem = {
  manifest: WorkCheckpoint;
  integrity: "verified";
};
