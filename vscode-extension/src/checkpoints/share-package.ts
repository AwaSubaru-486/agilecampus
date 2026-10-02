import { createHash, randomUUID } from "node:crypto";
import { parseWorkCheckpoint, CheckpointSchemaError } from "./schema";
import type { NewCheckpointArtifact, WorkCheckpoint } from "./types";

export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ARTIFACT_BYTES = 10 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 15 * 1024 * 1024;
export const MAX_PACKAGE_ARTIFACTS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SharePackage = {
  format: "agilecampus-checkpoint";
  version: 1 | 2;
  sourceCheckpointId: string;
  sourceServerCheckpointId?: string | null;
  manifest: WorkCheckpoint;
  artifacts: Array<{ id: string; kind: "transcript" | "context"; encoding: "base64"; data: string }>;
  manifestSha256: string;
};

export class SharePackageError extends Error {
  constructor(message: string) { super(message); this.name = "SharePackageError"; }
}

export function createSharePackage(
  source: WorkCheckpoint,
  included: Array<{ id: string; kind: "transcript" | "context"; content: Uint8Array }>,
  sourceServerCheckpointId: string | null = null,
): { value: SharePackage; bytes: Buffer; artifacts: NewCheckpointArtifact[] } {
  if (sourceServerCheckpointId !== null && !UUID.test(sourceServerCheckpointId)) throw new SharePackageError("来源服务端检查点 ID 无效");
  if (included.length > MAX_PACKAGE_ARTIFACTS) throw new SharePackageError("附件数量超过 20 项");
  const byId = new Map(source.artifacts.map((artifact) => [artifact.id, artifact]));
  let total = 0;
  const content = included.map((item) => {
    const descriptor = byId.get(item.id);
    if (!descriptor || descriptor.kind !== item.kind) throw new SharePackageError("选择的附件不属于此检查点");
    const bytes = Buffer.from(item.content);
    if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new SharePackageError("单个附件超过 5 MiB，不能导出");
    if (bytes.byteLength !== descriptor.byteLength || sha(bytes) !== descriptor.sha256) throw new SharePackageError("所选附件已变化或完整性校验失败");
    total += bytes.byteLength;
    if (total > MAX_TOTAL_ARTIFACT_BYTES) throw new SharePackageError("附件总量超过 10 MiB，不能导出");
    const id = randomUUID();
    return { id, kind: item.kind, data: bytes.toString("base64"), bytes };
  });
  const checkpointId = randomUUID();
  const artifacts = content.map((item) => ({
    id: item.id,
    kind: item.kind,
    relativePath: `artifacts/${item.id}.${item.kind === "transcript" ? "transcript" : "json"}`,
    byteLength: item.bytes.byteLength,
    sha256: sha(item.bytes),
  }));
  const manifest = parseWorkCheckpoint({
    ...source,
    id: checkpointId,
    parentCheckpointId: source.id,
    artifacts,
  });
  const value: SharePackage = {
    format: "agilecampus-checkpoint",
    version: 2,
    sourceCheckpointId: source.id,
    sourceServerCheckpointId,
    manifest,
    artifacts: content.map(({ id, kind, data }) => ({ id, kind, encoding: "base64", data })),
    manifestSha256: sha(Buffer.from(JSON.stringify({ sourceCheckpointId: source.id, sourceServerCheckpointId, manifest }), "utf8")),
  };
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new SharePackageError("导出文件超过 15 MiB");
  return {
    value,
    bytes,
    artifacts: content.map(({ kind, bytes: contentBytes }) => ({ kind, content: contentBytes })),
  };
}

export function parseSharePackage(bytes: Uint8Array): { value: SharePackage; artifacts: NewCheckpointArtifact[] } {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new SharePackageError("导入文件超过 15 MiB");
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(bytes).toString("utf8")); }
  catch { throw new SharePackageError("交接包不是有效 JSON"); }
  if (!record(parsed) || parsed.format !== "agilecampus-checkpoint" || ![1, 2].includes(Number(parsed.version)) ||
      typeof parsed.sourceCheckpointId !== "string" || !UUID.test(parsed.sourceCheckpointId) ||
      typeof parsed.manifestSha256 !== "string" || !Array.isArray(parsed.artifacts) || parsed.artifacts.length > MAX_PACKAGE_ARTIFACTS) {
    throw new SharePackageError("交接包格式或版本不受支持");
  }
  if (parsed.version === 2 && !(parsed.sourceServerCheckpointId === null || (typeof parsed.sourceServerCheckpointId === "string" && UUID.test(parsed.sourceServerCheckpointId)))) {
    throw new SharePackageError("交接包服务端来源 ID 无效");
  }
  let manifest: WorkCheckpoint;
  try { manifest = parseWorkCheckpoint(parsed.manifest); }
  catch (error) { throw new SharePackageError(error instanceof CheckpointSchemaError ? error.message : "交接包清单无效"); }
  if (manifest.id === parsed.sourceCheckpointId || manifest.parentCheckpointId !== parsed.sourceCheckpointId) {
    throw new SharePackageError("交接包来源关系无效");
  }
  const expectedDigest = parsed.version === 1
    ? JSON.stringify(manifest)
    : JSON.stringify({ sourceCheckpointId: parsed.sourceCheckpointId, sourceServerCheckpointId: parsed.sourceServerCheckpointId, manifest });
  if (sha(Buffer.from(expectedDigest, "utf8")) !== parsed.manifestSha256) throw new SharePackageError("交接包清单校验失败");
  if (manifest.artifacts.length !== parsed.artifacts.length) throw new SharePackageError("交接包附件与清单不一致");

  let total = 0;
  const seen = new Set<string>();
  const output: NewCheckpointArtifact[] = [];
  for (const item of parsed.artifacts) {
    if (!record(item) || typeof item.id !== "string" || !UUID.test(item.id) || seen.has(item.id) ||
        !["transcript", "context"].includes(String(item.kind)) || item.encoding !== "base64" || typeof item.data !== "string") {
      throw new SharePackageError("交接包附件引用无效或重复");
    }
    seen.add(item.id);
    const descriptor = manifest.artifacts.find((artifact) => artifact.id === item.id);
    if (!descriptor || descriptor.kind !== item.kind) throw new SharePackageError("交接包附件路径/类型与清单不一致");
    const content = Buffer.from(item.data, "base64");
    if (content.toString("base64") !== item.data) throw new SharePackageError("附件编码无效");
    if (content.byteLength > MAX_ARTIFACT_BYTES) throw new SharePackageError("单个附件超过 5 MiB");
    total += content.byteLength;
    if (total > MAX_TOTAL_ARTIFACT_BYTES) throw new SharePackageError("附件总量超过 10 MiB");
    if (content.byteLength !== descriptor.byteLength || sha(content) !== descriptor.sha256) {
      throw new SharePackageError("附件完整性校验失败");
    }
    output.push({ kind: item.kind as "transcript" | "context", content });
  }
  return {
    value: parsed as unknown as SharePackage,
    artifacts: output,
  };
}

export function findObviousSecrets(value: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
    ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ["API key", /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{12,}/i],
    ["Bearer token", /\bAuthorization\s*:\s*Bearer\s+\S+/i],
    ["OpenAI-style secret", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ];
  return checks.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

function sha(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
