/** Browser QA fixture. Run with .env.test only, after Vitest has finished. No real CLI/model runs. */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createUser } from "../src/lib/user";
import { createTeam } from "../src/lib/team";
import { createProject } from "../src/lib/project";
import { createTask } from "../src/lib/task";
import { saveTaskMemory } from "../src/lib/task-memory";
import { createMemoryContinuation } from "../src/lib/task-memory-continuation";
import { memoryTransferDigest } from "../shared/task-memory/transfer";
import { createContinuationFixture } from "../vscode-extension/tests/fixtures/session-memory/continuation-fixture";
import { createApiToken } from "../src/lib/api-token";
import type { ContinuationProgress } from "../shared/task-memory/continuation-status";

type SmokeState = { ownerId: string; projectId: string; taskId: string; versionId: string; id: string; claimId?: string; sequence: number; attemptId: string; token: string };
async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  if (!database.pathname.endsWith("_test")) throw new Error("This browser fixture only supports a database ending in _test");
  const origin = "http://127.0.0.1:3101";
  if (process.argv[2] === "seed") {
    const root = await mkdtemp(path.join(tmpdir(), "agile-memory-receipt-smoke-"));
    const email = `receipt-${randomUUID()}@example.test`;
    const owner = await createUser({ email, password: "MemorySmoke123!", name: "接续测试用户" });
    const team = await createTeam(owner.id, "接续专项测试团队");
    const project = await createProject(owner.id, team.id, { name: "插件回执验证（测试数据）" });
    const task = await createTask(owner.id, project.id, { title: "搜索性能排查（合成会话）", description: "浏览器回执测试，不代表真实 Agent 执行。" });
    const f = await createContinuationFixture(root);
    const payload = f.handoff;
    payload.memory.projectId = project.id; payload.memory.taskId = task.id;
    payload.material.scope.projectId = project.id; payload.material.scope.taskId = task.id; payload.material.scope.serverOrigin = origin + "/";
    payload.memory.goal[0].text = payload.material.goal[0] = "排查搜索性能（合成测试记录）";
    payload.memory.nextActions[0].text = payload.material.nextActions[0] = "检查搜索表索引，运行针对性测试";
    payload.memory.rejectedApproaches[0].text = payload.material.rejectedApproaches[0] = "缓存方案产生旧结果，已停止此方向";
    const material = { ...payload.material } as Partial<typeof payload.material>; delete material.materialDigest;
    payload.material.materialDigest = memoryTransferDigest(material);
    const saved = await saveTaskMemory(owner.id, project.id, task.id, payload, origin);
    const child = structuredClone(payload);
    child.memory.id = randomUUID(); child.memory.sessionKey = randomUUID(); child.memory.parentMemoryId = payload.memory.id;
    child.memory.parentReference = { memoryId: payload.memory.id, revision: payload.memory.revision, memoryDigest: memoryTransferDigest(payload.memory) };
    child.material.memoryId = child.memory.id; child.material.scope.sessionKey = child.memory.sessionKey; child.material.materialId = randomUUID();
    const item = { id: randomUUID(), text: "搜索索引已调整，针对性测试通过（合成记录）", evidenceRefs: [child.memory.nextActions[0].evidenceRefs[0]], origin: "human" as const, support: "reported" as const, disposition: "active" as const };
    child.memory.completed.push(item); child.material.completed.push(item.text);
    child.material.evidenceIndex.push({ itemId: item.id, eventIds: item.evidenceRefs });
    child.memory.nextActions[0].text = child.material.nextActions[0] = "检查边界输入和回归用例（合成记录）";
    const childBody = { ...child.material } as Partial<typeof child.material>; delete childBody.materialDigest;
    child.material.materialDigest = memoryTransferDigest(childBody);
    await saveTaskMemory(owner.id, project.id, task.id, child, origin);
    const id = randomUUID();
    await createMemoryContinuation(owner.id, project.id, task.id, id, saved.id);
    const token = await createApiToken(owner.id, "browser smoke synthetic extension");
    const state: SmokeState = { ownerId: owner.id, projectId: project.id, taskId: task.id, versionId: saved.id, id, sequence: 1, attemptId: randomUUID(), token: token.token };
    const statePath = path.join(root, "smoke-state.json");
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
    console.log(JSON.stringify({ statePath, email, password: "MemorySmoke123!", url: `${origin}/projects/${project.id}?space=work&task=${task.id}` }));
    return;
  }
  const statePath = process.argv[3];
  if (!statePath) throw new Error("Pass seed, or confirm <statePath>, or finish <statePath>");
  const state = JSON.parse(await readFile(statePath, "utf8")) as SmokeState;
  const endpoint = `${origin}/api/projects/${state.projectId}/tasks/${state.taskId}/memory/continuations`;
  async function patch(body: object) {
    const response = await fetch(endpoint, { method: "PATCH", headers: { Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Synthetic extension API failed: ${response.status}`);
    return response.json();
  }
  async function send(progress: ContinuationProgress) {
    await patch({ operation: "report", id: state.id, claimId: state.claimId, sequence: state.sequence + 1, ...progress }); state.sequence++;
  }
  if (process.argv[2] === "confirm") {
    const claimId = randomUUID();
    await patch({ operation: "claim", id: state.id, versionId: state.versionId, claimId }); state.claimId = claimId;
    await send({ state: "checking" }); await send({ state: "awaiting_confirmation" });
  } else if (process.argv[2] === "finish") {
    await send({ state: "launching", attemptId: state.attemptId });
    await send({ state: "running", attemptId: state.attemptId, sessionConfirmed: true });
    await send({ state: "finished", attemptId: state.attemptId });
  } else throw new Error("Unknown smoke action");
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log("Synthetic API receipt advanced; no real Agent was launched.");
}
main().then(() => process.exit(0), (error) => { console.error(error instanceof Error ? error.message : "Smoke failed"); process.exit(1); });
