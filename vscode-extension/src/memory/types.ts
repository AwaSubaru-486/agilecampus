import type { NormalizedEventV1 } from "../../../shared/session-memory/types";

export const MEMORY_SNAPSHOT_SCHEMA = 1 as const;
export const MEMORY_SNAPSHOT_MAX_BYTES = 10 * 1024 * 1024;
export const MEMORY_INPUT_BUDGET_VERSION = "memory-input-v1" as const;
export const MEMORY_REDACTION_VERSION = "redaction-v2" as const;
export const MEMORY_INPUT_MAX_TEXT_BYTES = 48 * 1024;
export const MEMORY_INPUT_MAX_EVENT_TEXT_BYTES = 8 * 1024;

export type MemoryScope = {
  serverOrigin: string;
  actorScope: string;
  workspaceScope: string;
  projectId: string;
  taskId: string;
  sessionKey: string;
};

export type CaptureFailureMarker = { occurredAt: string; category: "source-write-failed" };

export type ExtractionSnapshotV1 = {
  schemaVersion: typeof MEMORY_SNAPSHOT_SCHEMA;
  snapshotId: string;
  scope: MemoryScope;
  createdAt: string;
  fromSequence: number;
  toSequence: number;
  orderedEventIds: string[];
  events: NormalizedEventV1[];
  perEventHashes: string[];
  captureFailures: CaptureFailureMarker[];
  gapEventIds: string[];
  captureCompleteness: "unknown" | "partial";
  repositoryKeyHash: string;
  headSha: string;
  branch: string | null;
  dirtyExcluded: boolean;
  repositoryBlockers: string[];
  captureDigest: string;
  contentBytes: number;
};

export type PreparedEventV1 = {
  id: string;
  sequence: number;
  kind: NormalizedEventV1["kind"];
  text: string;
  toolCallId?: string;
  command?: string;
  exitCode?: number | null;
  paths?: string[];
  wasTruncated: boolean;
  originalTextBytes: number;
};

export type PreparedExtractionInputV1 = {
  schemaVersion: 1;
  scope: Omit<MemoryScope, "actorScope" | "workspaceScope">;
  snapshotId: string;
  captureDigest: string;
  inputDigest: string;
  promptVersion: string;
  budgetVersion: typeof MEMORY_INPUT_BUDGET_VERSION;
  redactionVersion: typeof MEMORY_REDACTION_VERSION;
  fromSequence: number;
  toSequence: number;
  capturedEventIds: string[];
  gapEventIds: string[];
  captureCompleteness: "unknown" | "partial";
  captureFailureCount: number;
  events: PreparedEventV1[];
  omissions: Array<{ eventId: string; sequence: number; reason: "budget" | "oversize"; originalTextBytes: number }>;
  redactedCount: number;
  repositoryKeyHash: string;
  headSha: string;
  dirtyExcluded: boolean;
  repositoryBlockers: string[];
};

export type ExtractionPreview = {
  destination: string;
  eventCount: number;
  sequenceRange: { from: number; to: number };
  outboundBytes: number;
  redactedCount: number;
  omittedEventCount: number;
  captureGaps: number;
  completeness: "unknown" | "partial";
  statement: string;
};

export type CandidateItem = {
  text: string;
  evidenceRefs: string[];
  support: "captured" | "reported" | "inferred";
};

export type CandidateTest = {
  command: string;
  exitCode: number | null;
  evidenceRefs: string[];
  support: "captured" | "reported";
};

export type MemoryCandidateV1 = {
  goal: CandidateItem[];
  constraints: CandidateItem[];
  completed: CandidateItem[];
  remaining: CandidateItem[];
  decisions: CandidateItem[];
  rejectedApproaches: CandidateItem[];
  blockers: CandidateItem[];
  nextActions: CandidateItem[];
  tests: CandidateTest[];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type DraftItem = CandidateItem & {
  id: string;
  origin: "extracted" | "human";
  candidateKey: string | null;
  disposition: "active" | "superseded" | "uncertain";
};
export type DraftTest = CandidateTest & {
  id: string;
  origin: "extracted" | "human";
  candidateKey: string | null;
  disposition: "active" | "superseded" | "uncertain";
};
export type DraftCategory = "goal" | "constraints" | "completed" | "remaining" | "decisions" | "rejectedApproaches" | "blockers" | "nextActions";
export type MemoryDraftV1 = {
  schemaVersion: 1;
  draftId: string;
  memoryId: string;
  revision: number;
  parentMemoryId: string | null;
  snapshotId: string;
  inputCoverage: { capturedEventIds: string[]; omissions: Array<{ eventId: string; sequence: number; reason: "budget" | "oversize"; originalTextBytes: number }> };
  scope: MemoryScope;
  inputDigest: string;
  status: "candidate" | "accepted";
  createdAt: string;
  updatedAt: string;
  provenance: { extractor: string; promptVersion: string; model: string; inputTokens: number | null; outputTokens: number | null };
  items: Record<DraftCategory, DraftItem[]>;
  tests: DraftTest[];
  tombstones: string[];
};

export type MemoryHandoffMaterialV1 = {
  schemaVersion: 1;
  materialId: string;
  memoryId: string;
  revision: number;
  scope: Omit<MemoryScope, "actorScope" | "workspaceScope">;
  repositoryKeyHash: string;
  baseSha: string;
  dirtyExcluded: boolean;
  repositoryBlockers: string[];
  sourceRange: { from: number; to: number; gaps: string[]; omittedEventIds: string[]; truncatedEventIds: string[] };
  goal: string[];
  constraints: string[];
  completed: string[];
  remaining: string[];
  decisions: string[];
  rejectedApproaches: string[];
  blockers: string[];
  nextActions: string[];
  tests: CandidateTest[];
  evidenceIndex: Array<{ itemId: string; eventIds: string[] }>;
  uncertainItems: Array<{ category: DraftCategory | "tests"; itemId: string; text: string; eventIds: string[] }>;
  completeness: "unknown" | "partial";
  materialDigest: string;
};

export type ReceiverFacts = {
  repositoryKeyHash: string | null;
  currentHeadSha: string | null;
  workspaceReady: boolean;
  workspaceClean: boolean;
  workspaceBlockers: string[];
  receivedRevision: number | null;
  accessConfirmed: boolean;
};

export type ResumeContextV1 = {
  ready: boolean;
  blockers: string[];
  materialId: string;
  memoryId: string;
  revision: number;
  instructions: string;
  evidenceRefs: string[];
};
