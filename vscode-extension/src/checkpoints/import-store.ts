import { createHash } from "node:crypto";
import { CheckpointStore, CheckpointStoreError } from "./store";
import { parseWorkCheckpoint } from "./schema";
import type { NewCheckpointArtifact, WorkCheckpoint } from "./types";

/**
 * Importing the same reviewed package again is a valid recovery action: the
 * immutable local checkpoint remains untouched, while its server lineage can
 * be re-verified and repaired by the caller.
 */
export async function saveImportedCheckpoint(
  store: CheckpointStore,
  manifest: WorkCheckpoint,
  artifacts: NewCheckpointArtifact[],
): Promise<WorkCheckpoint> {
  const existing = await store.read(manifest.serverOrigin, manifest.projectId, manifest.id);
  if (existing) {
    if (sameImportedCheckpoint(existing, manifest, artifacts)) return existing;
    throw new CheckpointStoreError("本机已存在同 ID 但内容不同的检查点；为保护原记录，本次未覆盖");
  }
  try {
    return await store.save(manifest, artifacts);
  } catch (error) {
    if (!(error instanceof CheckpointStoreError) || !error.message.includes("ID 已存在")) throw error;
    const existing = await store.read(manifest.serverOrigin, manifest.projectId, manifest.id);
    if (existing && sameImportedCheckpoint(existing, manifest, artifacts)) return existing;
    throw new CheckpointStoreError("本机已存在同 ID 但内容不同的检查点；为保护原记录，本次未覆盖");
  }
}

function sameImportedCheckpoint(existing: WorkCheckpoint, incoming: WorkCheckpoint, artifacts: NewCheckpointArtifact[]): boolean {
  const existingCanonical = parseWorkCheckpoint(existing);
  const incomingCanonical = parseWorkCheckpoint(incoming);
  const { artifacts: _existingArtifacts, ...existingCore } = existingCanonical;
  const { artifacts: _incomingArtifacts, ...incomingCore } = incomingCanonical;
  if (stableJson(existingCore) !== stableJson(incomingCore)) return false;

  const existingMaterials = existingCanonical.artifacts.map(({ kind, byteLength, sha256 }) => `${kind}:${byteLength}:${sha256}`).sort();
  const incomingMaterials = artifacts.map(({ kind, content }) =>
    `${kind}:${content.byteLength}:${createHash("sha256").update(content).digest("hex")}`,
  ).sort();
  return stableJson(existingMaterials) === stableJson(incomingMaterials);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
