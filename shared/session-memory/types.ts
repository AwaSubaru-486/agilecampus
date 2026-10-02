export type EventKindV1 = "user" | "assistant" | "tool_call" | "tool_result" | "git_snapshot" | "gap";
export type MemorySupport = "captured" | "reported" | "inferred";
export type MemoryDisposition = "active" | "superseded" | "uncertain";

export type NormalizedEventV1 = {
  schemaVersion: 1;
  id: string;
  sessionKey: string;
  sequence: number;
  timestamp: string | null;
  kind: EventKindV1;
  text: string;
  toolCallId?: string;
  command?: string;
  exitCode?: number | null;
  paths?: string[];
  sourceRef: string;
};

export type MemoryItemV1 = {
  id: string;
  text: string;
  evidenceRefs: string[];
  origin: "extracted" | "human";
  support: MemorySupport;
  disposition: MemoryDisposition;
  supersedes?: string;
};

export type MemoryTestV1 = {
  command: string;
  exitCode: number | null;
  evidenceRefs: string[];
  support: "captured" | "reported";
};

export type MemoryDocumentV1 = {
  schemaVersion: 1;
  id: string;
  sessionKey: string;
  projectId: string;
  taskId: string;
  parentMemoryId: string | null;
  revision: number;
  inputDigest: string;
  sourceCoverage: { fromSequence: number; toSequence: number; gaps: string[] };
  code: { repositoryKeyHash: string; headSha: string; dirtyExcluded: boolean };
  goal: MemoryItemV1[];
  constraints: MemoryItemV1[];
  completed: MemoryItemV1[];
  remaining: MemoryItemV1[];
  decisions: MemoryItemV1[];
  rejectedApproaches: MemoryItemV1[];
  blockers: MemoryItemV1[];
  nextActions: MemoryItemV1[];
  tests: MemoryTestV1[];
  provenance: {
    extractor: string;
    promptVersion: string;
    model: string;
    createdAt: string;
    editedBy: string | null;
    usage: { inputTokens: number | null; outputTokens: number | null };
  };
};

export type SessionMemorySegmentV1 = {
  relativePath: string;
  sha256: string;
  byteLength: number;
  fromSequence: number;
  toSequence: number;
  eventIds: string[];
};

export type SourceByteRangeV1 = { startByte: number; endByte: number };

export type SourceArchiveSegmentV1 = {
  relativePath: string;
  sha256: string;
  byteLength: number;
  sourceStartByte: number;
  sourceEndByte: number;
  publishedStartByte: number;
  publishedEndByte: number;
};

export type SourceArchiveEventRangeV1 = {
  eventId: string;
  /** Stable package-local transcript record identifier; never a native provider/session ID. */
  archiveRecordId: string;
  sourceStartByte: number;
  sourceEndByte: number;
  publishedStartByte: number;
  publishedEndByte: number;
};

export type SourceArchiveRedactionV1 = {
  confirmed: boolean;
  confirmedAt: string | null;
  previewDigest: string | null;
  redactedRanges: Array<{
    sourceStartByte: number;
    sourceEndByte: number;
    publishedStartByte: number;
    publishedEndByte: number;
    category: string;
  }>;
  excludedRanges: SourceByteRangeV1[];
  redactedByteCount: number;
  excludedByteCount: number;
};

export type SourceArchiveV1 = {
  schemaVersion: 1;
  status: "complete" | "partial" | "unavailable";
  provider: string;
  providerVersion: string;
  adapter: string;
  adapterVersion: string;
  parserVersion: "opaque-text-v1";
  encoding: "utf-8";
  compression: "none";
  integrityStatus: "verified" | "partial" | "unavailable";
  sourceByteLength: number | null;
  publishedDigest: string | null;
  publishedByteLength: number;
  reachedEof: boolean;
  truncationDetected: boolean;
  formatRecognized: boolean;
  gaps: Array<SourceByteRangeV1 & { reason: string }>;
  redaction: SourceArchiveRedactionV1;
  segments: SourceArchiveSegmentV1[];
  eventRanges: SourceArchiveEventRangeV1[];
  /** Conversation events retained in normalized form but absent from this archive. Required explicitly for partial/unavailable archives. */
  unmappedEvents: Array<{ eventId: string; reason: string }>;
};

export type SessionMemoryManifestV1 = {
  schemaVersion: 1;
  packageId: string;
  sessionKey: string;
  memoryId: string;
  checkpointLocalId: string;
  projectId: string;
  taskId: string;
  parentPackageId: string | null;
  codeHeadSha: string;
  taskHandoffVersion: number;
  taskUpdatedAt: string;
  sourceCoverage: { fromSequence: number; toSequence: number; gaps: string[] };
  segments: SessionMemorySegmentV1[];
};

export type SessionMemoryPackageV1 = {
  format: "agilecampus-session-memory";
  schemaVersion: 1;
  publicationCompleteness: "complete" | "partial";
  sharingReview: {
    confirmed: boolean;
    confirmedAt: string | null;
    previewDigest: string;
  };
  manifest: SessionMemoryManifestV1;
  memory: MemoryDocumentV1;
  eventSegments: Array<{ relativePath: string; events: NormalizedEventV1[] }>;
  sourceArchive: SourceArchiveV1;
  archiveSegments: Array<{ relativePath: string; encoding: "base64"; data: string }>;
};

export type SessionMemoryValidationContext = {
  /** Optional resolved parent lets importers reject cross-task or future lineage. */
  parent?: { packageId: string; memoryId: string; projectId: string; taskId: string; revision: number };
  /** Ancestors already traversed by the caller's package graph, used for cycle detection. */
  ancestors?: Array<{ packageId: string; memoryId: string }>;
};
