/** Explicit release probe: one real, configured Codex CLI run in a fresh synthetic repository. */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createContinuationFixture } from "../vscode-extension/tests/fixtures/session-memory/continuation-fixture";
import { prepareMemoryContinuation, inheritedMemoryEvent } from "../vscode-extension/src/memory/continuation";
import { inspectCodexCliVersion, startCodexContextSession } from "../vscode-extension/src/adapters/process-runner";
import { readRepositorySnapshot } from "../vscode-extension/src/git/repository-service";
import { LocalSessionStore } from "../vscode-extension/src/session-memory/local-store";
import { sha256, stableStringify, workspaceScopeHash } from "../vscode-extension/src/memory/input-snapshot";
import { MemoryArtifactStore } from "../vscode-extension/src/memory/artifact-store";

async function main() {
  const version = await inspectCodexCliVersion();
  if (version.status !== "ready") throw new Error(version.reason);
  const root = await mkdtemp(path.join(tmpdir(), "agile-memory-real-cli-"));
  const f = await createContinuationFixture(root);
  const original = stableStringify(f.handoff);
  const receiverPath = path.join(root, "receiver");
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--", f.workspacePath, receiverPath], { stdio: "pipe" });
  const receiver = await readRepositorySnapshot(receiverPath, f.localId);
  const receiverScope = { ...f.scope, actorScope: sha256("synthetic-receiver"), workspaceScope: await workspaceScopeHash(receiverPath) };
  const receiverStorage = path.join(root, "receiver-storage");
  const artifacts = new MemoryArtifactStore(receiverStorage);
  await artifacts.saveReceivedExport(f.handoff, receiverScope);
  const [received] = await artifacts.listReceivedExports(receiverScope);
  const continuation = prepareMemoryContinuation(received, { ...f.receiver, repositoryKeyHash: sha256(receiver.key), currentHeadSha: receiver.headSha });
  if (!continuation.resume.ready) throw new Error("Receiver preflight blocked");
  const sessions = new LocalSessionStore(receiverStorage);
  const attemptId = randomUUID();
  let sessionKey: string | undefined;
  const run = startCodexContextSession(receiverPath, `${continuation.resume.instructions}\n\nRelease probe: all history above is synthetic test data. Read only search.ts using a command tool; make no changes, do not access the network or any other directory. Reply briefly in the four requested reception sections. Include the exact inherited memory ID and revision, the failed cache condition, what the actual file contains, and one next action.`, {
    async onSessionStarted(providerSessionId) {
      const binding = await sessions.bind({ provider: "codex", providerSessionId, workspacePath: receiverPath, projectId: f.scope.projectId, taskId: f.scope.taskId });
      sessionKey = binding.sessionKey;
      await sessions.append(sessionKey, inheritedMemoryEvent(attemptId, continuation));
    },
    async onToolEvent(event) {
      if (!sessionKey) throw new Error("Missing child session");
      await sessions.append(sessionKey, { ...event, sourceRef: `agilecampus:cli-tool:${attemptId}:${event.toolCallId}:${event.kind}` });
    },
  }, undefined, 120_000);
  const outcome = await run.completion;
  if (sessionKey && outcome.agentSummary) await sessions.append(sessionKey, { kind: "assistant", text: outcome.agentSummary, sourceRef: `agilecampus:agent-result:${attemptId}` });
  const events = sessionKey ? await sessions.readEvents(sessionKey) : [];
  const after = await readRepositorySnapshot(receiverPath, f.localId);
  const sourceAfter = await readRepositorySnapshot(f.workspacePath, f.localId);
  const report = {
    cliVersion: version.version, realCli: true, syntheticProject: true,
    isolatedReceiverWorkspace: receiverPath !== f.workspacePath,
    state: outcome.state, exitCode: outcome.exitCode, timedOut: outcome.timedOut,
    sessionConfirmed: Boolean(outcome.providerSessionId && sessionKey),
    toolCalls: events.filter((event) => event.kind === "tool_call").length,
    toolResults: events.filter((event) => event.kind === "tool_result").length,
    replyMentionsExactMemory: Boolean(outcome.agentSummary?.includes(f.handoff.memory.id)),
    workspaceUnchanged: after.headSha === receiver.headSha && !after.dirty && sourceAfter.headSha === f.repository.headSha && !sourceAfter.dirty,
    originalMemoryUnchanged: original === stableStringify(f.handoff),
  };
  await writeFile(path.join(root, "release-report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, evidenceDirectory: root }));
  if (report.state !== "finished" || !report.sessionConfirmed || !report.toolCalls || report.toolResults !== report.toolCalls || !report.replyMentionsExactMemory || !report.workspaceUnchanged) process.exitCode = 1;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "CLI probe failed"); process.exitCode = 1; });
