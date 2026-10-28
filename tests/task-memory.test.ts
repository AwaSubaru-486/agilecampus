import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { saveTaskMemory, listTaskMemoryVersions, getTaskMemoryVersion } from "@/lib/task-memory";
import { memoryTransferDigest } from "../shared/task-memory/transfer";
import { previewTaskMemory, renderTaskMemoryContext } from "@/lib/task-memory-view";
import { createContinuationFixture } from "../vscode-extension/tests/fixtures/session-memory/continuation-fixture";
import { resetDb } from "./helpers";
import { MockLanguageModelV2 } from "ai/test";
import { createConversation, forkConversation, getConversationForUser, listConversationMessages } from "@/lib/agent/conversation";
import { runAgentTurn } from "@/lib/agent/orchestrator";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/lib/auth";
import { GET, POST } from "@/app/api/projects/[projectId]/tasks/[taskId]/memory/route";
import { claimMemoryContinuation, createMemoryContinuation, getMemoryContinuation, reportMemoryContinuation } from "@/lib/task-memory-continuation";
import { GET as progressGET, POST as progressPOST, PATCH as progressPATCH } from "@/app/api/projects/[projectId]/tasks/[taskId]/memory/continuations/route";
import { createApiToken } from "@/lib/api-token";

const roots: string[] = [];
beforeEach(async () => { await resetDb(); vi.mocked(auth).mockReset(); });
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function scene() {
  const owner = await createUser({ email: "memory-web-owner@test.local", password: "password123", name: "Owner" });
  const member = await createUser({ email: "memory-web-member@test.local", password: "password123", name: "Member" });
  const outsider = await createUser({ email: "memory-web-outsider@test.local", password: "password123", name: "Outsider" });
  const team = await createTeam(owner.id, "Memory Web Test"); await joinTeam(member.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "Memory Web Project" });
  const task = await createTask(owner.id, project.id, { title: "Continue a search task" });
  const root = await mkdtemp(path.join(tmpdir(), "agile-memory-web-")); roots.push(root);
  const fixture = await createContinuationFixture(root);
  const payload = structuredClone(fixture.handoff);
  payload.memory.projectId = project.id; payload.memory.taskId = task.id;
  payload.material.scope.projectId = project.id; payload.material.scope.taskId = task.id;
  const body = { ...payload.material } as Partial<typeof payload.material>; delete body.materialDigest;
  payload.material.materialDigest = memoryTransferDigest(body);
  const url = `http://localhost:3000/api/projects/${project.id}/tasks/${task.id}/memory`;
  const ctx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
  return { owner, member, outsider, project, task, payload, url, ctx };
}
describe("web and extension continuation receipts", () => {
  async function prepared() {
    const f = await scene();
    const memory = await saveTaskMemory(f.owner.id, f.project.id, f.task.id, f.payload, "http://localhost:3000");
    const id = randomUUID();
    await createMemoryContinuation(f.owner.id, f.project.id, f.task.id, id, memory.id);
    return { ...f, memory, id };
  }
  it("keeps creation idempotent and gives exactly one competing extension the claim", async () => {
    const f = await prepared();
    const same = await createMemoryContinuation(f.owner.id, f.project.id, f.task.id, f.id, f.memory.id);
    expect(same.sequence).toBe(0);
    const claims = await Promise.allSettled([1, 2].map(() => claimMemoryContinuation(f.owner.id, f.project.id, f.task.id, f.id, f.memory.id)));
    expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await getMemoryContinuation(f.owner.id, f.project.id, f.task.id)).toMatchObject({ id: f.id, state: "received", sequence: 1 });
    expect(await getMemoryContinuation(f.owner.id, f.project.id, f.task.id)).not.toHaveProperty("claimId");
    await expect(claimMemoryContinuation(f.member.id, f.project.id, f.task.id, f.id, f.memory.id)).rejects.toThrow("同一账号");
    await expect(getMemoryContinuation(f.outsider.id, f.project.id, f.task.id, f.id)).rejects.toThrow("无权");
  });
  it("requires ordered receipts and a real-session assertion before running; persists exact version and history", async () => {
    const f = await prepared();
    const claim = await claimMemoryContinuation(f.owner.id, f.project.id, f.task.id, f.id, f.memory.id);
    const send = (sequence: number, progress: Parameters<typeof reportMemoryContinuation>[6]) => reportMemoryContinuation(f.owner.id, f.project.id, f.task.id, f.id, claim.claimId, sequence, progress);
    await expect(send(2, { state: "running", attemptId: randomUUID(), sessionConfirmed: true })).rejects.toThrow("顺序");
    await send(2, { state: "checking" });
    expect(await send(2, { state: "checking" })).toMatchObject({ sequence: 2 }); // lost HTTP response, retry same event
    await send(3, { state: "awaiting_confirmation" });
    const attemptId = randomUUID();
    await send(4, { state: "launching", attemptId });
    await expect(send(5, { state: "running", attemptId })).rejects.toThrow("真实会话");
    await send(5, { state: "running", attemptId, sessionConfirmed: true });
    await expect(send(6, { state: "finished", attemptId: randomUUID() })).rejects.toThrow("不能替换");
    const finished = await send(6, { state: "finished", attemptId });
    expect(finished).toMatchObject({ state: "finished", versionId: f.memory.id, attemptId });
    expect(finished.events.map((event) => event.state)).toEqual(["waiting", "received", "checking", "awaiting_confirmation", "launching", "running", "finished"]);
    await expect(send(7, { state: "checking" })).rejects.toThrow("顺序");
    await expect(reportMemoryContinuation(f.owner.id, f.project.id, f.task.id, f.id, randomUUID(), 7, { state: "failed" })).rejects.toThrow("未持有");
  });
  it("does not confuse cancellation with launch, and rejects an expired or foreign-version claim", async () => {
    const f = await prepared();
    await expect(claimMemoryContinuation(f.owner.id, f.project.id, f.task.id, f.id, randomUUID())).rejects.toThrow("版本不一致");
    const claim = await claimMemoryContinuation(f.owner.id, f.project.id, f.task.id, f.id, f.memory.id);
    await reportMemoryContinuation(f.owner.id, f.project.id, f.task.id, f.id, claim.claimId, 2, { state: "cancelled" });
    expect(await getMemoryContinuation(f.owner.id, f.project.id, f.task.id, f.id)).toMatchObject({ state: "cancelled", attemptId: null });
    const other = randomUUID();
    await createMemoryContinuation(f.owner.id, f.project.id, f.task.id, other, f.memory.id);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    try { await expect(claimMemoryContinuation(f.owner.id, f.project.id, f.task.id, other, f.memory.id)).rejects.toThrow("过期"); }
    finally { clock.mockRestore(); }
  });
  it("accepts browser creation and authenticated plugin updates but refuses cookie-only or forged receipts", async () => {
    const f = await prepared();
    vi.mocked(auth).mockResolvedValue({ user: { id: f.owner.id } } as never);
    const url = f.url + "/continuations";
    const request = (body: unknown, token?: string) => new Request(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const body = { operation: "claim", id: f.id, versionId: f.memory.id, claimId: randomUUID() };
    expect((await progressPATCH(request(body), f.ctx)).status).toBe(403);
    expect((await progressPATCH(request(body, "ac_invalid"), f.ctx)).status).toBe(401);
    const token = await createApiToken(f.owner.id, "synthetic plugin");
    const claimed = await progressPATCH(request(body, token.token), f.ctx);
    expect(claimed.status).toBe(200);
    const result = await claimed.json(); expect(result.claimId).toBeTruthy();
    expect((await progressPATCH(request(body, token.token), f.ctx)).status).toBe(200);
    expect((await progressPATCH(request({ ...body, claimId: randomUUID() }, token.token), f.ctx)).status).toBe(409);
    const read = await progressGET(new Request(url), f.ctx);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect((await read.json()).continuation).not.toHaveProperty("claimId");
    const cross = await progressPOST(new Request(url, { method: "POST", headers: { Origin: "https://evil.example" }, body: JSON.stringify({ id: randomUUID(), versionId: f.memory.id }) }), f.ctx);
    expect(cross.status).toBe(403);
    expect((await progressPOST(new Request(url, { method: "POST", body: "{" }), f.ctx)).status).toBe(400);
  });
});

describe("shared task memory web workflow", () => {
  it("saves once, reloads from Postgres and preserves exact immutable versions", async () => {
    const f = await scene();
    const first = await saveTaskMemory(f.owner.id, f.project.id, f.task.id, f.payload, "http://localhost:3000");
    expect((await saveTaskMemory(f.owner.id, f.project.id, f.task.id, f.payload, "http://localhost:3000")).id).toBe(first.id);
    const shared = await listTaskMemoryVersions(f.member.id, f.project.id, f.task.id);
    expect(shared).toHaveLength(1);
    expect(shared[0].payload).toEqual(f.payload);
    expect((await getTaskMemoryVersion(f.member.id, f.project.id, f.task.id, first.id)).payload).toEqual(f.payload);
    const changed = structuredClone(f.payload); changed.memory.provenance.model = "different synthetic model";
    await expect(saveTaskMemory(f.owner.id, f.project.id, f.task.id, changed, "http://localhost:3000")).rejects.toThrow("历史未被覆盖");
  });

  it("rejects outsiders, foreign task/origin and tampering", async () => {
    const f = await scene();
    await expect(saveTaskMemory(f.outsider.id, f.project.id, f.task.id, f.payload, "http://localhost:3000")).rejects.toThrow("无权");
    await expect(saveTaskMemory(f.owner.id, f.project.id, randomUUID(), f.payload, "http://localhost:3000")).rejects.toThrow("任务不存在");
    await expect(saveTaskMemory(f.owner.id, f.project.id, f.task.id, f.payload, "http://127.0.0.1:3000")).rejects.toThrow("其他服务");
    const tampered = structuredClone(f.payload); tampered.material.nextActions.push("synthetic forged action");
    await expect(saveTaskMemory(f.owner.id, f.project.id, f.task.id, tampered, "http://localhost:3000")).rejects.toThrow("完整性");
    expect(await listTaskMemoryVersions(f.owner.id, f.project.id, f.task.id)).toEqual([]);
  });

  it("returns the selected version over the authenticated web API with private caching", async () => {
    const f = await scene();
    vi.mocked(auth).mockResolvedValue({ user: { id: f.owner.id } } as never);
    const posted = await POST(new Request(f.url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify(f.payload) }), f.ctx);
    expect(posted.status).toBe(201); const { id } = await posted.json();
    vi.mocked(auth).mockResolvedValue({ user: { id: f.member.id } } as never);
    const response = await GET(new Request(`${f.url}?version=${id}`), f.ctx);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).payload).toEqual(f.payload);
    expect((await GET(new Request(`${f.url}?version=${randomUUID()}`), f.ctx)).status).toBe(404);
    expect((await GET(new Request(f.url, { headers: { Authorization: "Bearer ac_invalid" } }), f.ctx)).status).toBe(401);
  });

  it("rejects cross-origin browser writes, malformed JSON and unauthenticated reads", async () => {
    const f = await scene();
    vi.mocked(auth).mockResolvedValue({ user: { id: f.owner.id } } as never);
    expect((await POST(new Request(f.url, { method: "POST", headers: { Origin: "https://other.example" }, body: JSON.stringify(f.payload) }), f.ctx)).status).toBe(403);
    expect((await POST(new Request(f.url, { method: "POST", body: "{" }), f.ctx)).status).toBe(400);
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(new Request(f.url), f.ctx)).status).toBe(401);
  });

  it("pins the exact parent content and refuses a conflicting published parent digest", async () => {
    const f = await scene();
    const parent = await saveTaskMemory(f.owner.id, f.project.id, f.task.id, f.payload, "http://localhost:3000");
    const child = structuredClone(f.payload);
    child.memory.id = randomUUID(); child.memory.parentMemoryId = f.payload.memory.id;
    child.memory.parentReference = { memoryId: f.payload.memory.id, revision: f.payload.memory.revision, memoryDigest: memoryTransferDigest(f.payload.memory) };
    child.material.memoryId = child.memory.id;
    const body = { ...child.material } as Partial<typeof child.material>; delete body.materialDigest;
    child.material.materialDigest = memoryTransferDigest(body);
    await saveTaskMemory(f.owner.id, f.project.id, f.task.id, child, "http://localhost:3000");
    expect((await listTaskMemoryVersions(f.owner.id, f.project.id, f.task.id)).find((record) => record.id === parent.id)?.memoryDigest).toBe(child.memory.parentReference.memoryDigest);
    child.memory.parentReference.memoryDigest = "f".repeat(64);
    await expect(saveTaskMemory(f.owner.id, f.project.id, f.task.id, child, "http://localhost:3000")).rejects.toThrow("内容校验不一致");
    child.memory.parentReference.memoryId = randomUUID();
    await expect(saveTaskMemory(f.owner.id, f.project.id, f.task.id, child, "http://localhost:3000")).rejects.toThrow("精确版本无效");
    expect((await getTaskMemoryVersion(f.owner.id, f.project.id, f.task.id, parent.id)).payload).toEqual(f.payload);
  });

  it("previews the correct task and retains provenance in human-copyable continuation context", async () => {
    const f = await scene();
    expect(previewTaskMemory(f.payload, f.project.id, f.task.id).nextActions).toEqual(f.payload.material.nextActions);
    expect(() => previewTaskMemory(f.payload, f.project.id, randomUUID())).toThrow("不属于当前任务");
    const context = renderTaskMemoryContext({ payload: f.payload });
    expect(context).toContain("cache approach returns stale results");
    expect(context).toContain('"support":"inferred"');
    expect(context).toContain("历史测试不代表当前测试通过");
  });

  it("sends selected memory to the actual model request, persists its source and inherits it on the next turn and fork", async () => {
    const f = await scene();
    const saved = await saveTaskMemory(f.owner.id, f.project.id, f.task.id, f.payload, "http://localhost:3000");
    const conversation = await createConversation(f.owner.id, f.project.id, { taskId: f.task.id });
    const prompts: string[] = [];
    const model = new MockLanguageModelV2({ doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return { finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, content: [{ type: "text", text: "synthetic: continue from inherited memory" }], warnings: [] };
    } });
    const first = await runAgentTurn({ actorId: f.member.id, projectId: f.project.id, conversationId: conversation.id, userText: "synthetic continue", taskMemoryVersionId: saved.id, model });
    expect(prompts[0]).toContain("cache approach returns stale results");
    expect(prompts[0]).toContain(f.payload.memory.id);
    expect(first.taskMemoryVersionId).toBe(saved.id);
    const messages = await listConversationMessages(f.owner.id, conversation.id);
    expect(messages.every((message) => message.taskMemoryVersionId === saved.id)).toBe(true);
    await runAgentTurn({ actorId: f.owner.id, projectId: f.project.id, conversationId: conversation.id, userText: "synthetic next turn", model });
    expect(prompts[1]).toContain(f.payload.memory.id);
    const fork = await forkConversation(f.owner.id, conversation.id, first.assistantMessageId!);
    expect(fork.taskMemoryVersionId).toBe(saved.id);
    expect((await listConversationMessages(f.owner.id, fork.id))[0].taskMemoryVersionId).toBe(saved.id);
  });

  it("does not bind failed model turns or load another task's memory", async () => {
    const f = await scene();
    const saved = await saveTaskMemory(f.owner.id, f.project.id, f.task.id, f.payload, "http://localhost:3000");
    const conversation = await createConversation(f.owner.id, f.project.id, { taskId: f.task.id });
    const model = new MockLanguageModelV2({ doGenerate: async () => { throw new Error("synthetic model unavailable"); } });
    await expect(runAgentTurn({ actorId: f.owner.id, projectId: f.project.id, conversationId: conversation.id, userText: "continue", taskMemoryVersionId: saved.id, model })).rejects.toThrow("synthetic model unavailable");
    expect((await getConversationForUser(f.owner.id, conversation.id)).taskMemoryVersionId).toBeNull();
    const otherTask = await createTask(f.owner.id, f.project.id, { title: "Other task" });
    const otherConversation = await createConversation(f.owner.id, f.project.id, { taskId: otherTask.id });
    await expect(runAgentTurn({ actorId: f.owner.id, projectId: f.project.id, conversationId: otherConversation.id, userText: "continue", taskMemoryVersionId: saved.id, model })).rejects.toThrow("此任务中没有");
  });
});
