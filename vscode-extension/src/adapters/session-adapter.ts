export type CapabilityState = "verified" | "unsupported" | "unverified";

export type AdapterResult<T> =
  | { status: "ok"; value: T }
  | { status: "unsupported" | "error"; reason: string };

export type SessionCapabilities = {
  provider: "Codex CLI";
  cliVersion: string;
  workspaceEnabled: boolean;
  codexHooksConfigured: boolean;
  codexHooksReady: boolean;
  automaticPushDisabled: boolean | null;
  capabilities: {
    capture: CapabilityState;
    read: CapabilityState;
    export: CapabilityState;
    nativeResume: CapabilityState;
    crossMachineResume: CapabilityState;
    fork: CapabilityState;
    cancel: CapabilityState;
  };
  notes: string[];
};

export type SessionSummary = {
  sessionId: string;
  agent: "Codex";
  model: string | null;
  status: string;
  branch: string | null;
  startedAt: string | null;
  endedAt: string | null;
  turns: number | null;
  lastCheckpointId: string | null;
  filesTouched: string[];
};

export type CapturedSession = {
  session: SessionSummary;
  transcript: string;
  byteLength: number;
};

export type CheckpointSummary = {
  checkpointId: string;
  branch: string | null;
  message: string | null;
  date: string | null;
  sessions: Array<Pick<SessionSummary, "sessionId" | "agent" | "model">>;
  filesTouched: string[];
};

export type ReadCheckpoint = CheckpointSummary & {
  transcript: string;
  byteLength: number;
};

export type PreparedCommand = {
  executable: "entire" | "codex";
  args: string[];
};

export type ResumePlan = {
  checkpointId: string;
  sessionId: string;
  branch: string;
  commands: PreparedCommand[];
  executesAgent: false;
  warning: string;
};

export interface SessionAdapter {
  inspectCapabilities(workspacePath: string): Promise<AdapterResult<SessionCapabilities>>;
  listSessions(workspacePath: string): Promise<AdapterResult<SessionSummary[]>>;
  capture(workspacePath: string, sessionId: string): Promise<AdapterResult<CapturedSession>>;
  readCheckpoint(workspacePath: string, checkpointId: string): Promise<AdapterResult<ReadCheckpoint>>;
  prepareResume(workspacePath: string, checkpointId: string): Promise<AdapterResult<ResumePlan>>;
}
