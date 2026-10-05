import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks, teamMembers } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createAgent } from "@/lib/agent-member";
import { createTask, updateTask } from "@/lib/task";
import { createApiToken } from "@/lib/api-token";
import { resetDb } from "./helpers";

import { GET as meRoute } from "@/app/api/extension/v1/me/route";
import { GET as projectMembersRoute } from "@/app/api/extension/v1/projects/[projectId]/members/route";
import { POST as createCheckpointRoute } from "@/app/api/extension/v1/projects/[projectId]/tasks/[taskId]/checkpoints/route";
import { GET as listCheckpointsRoute } from "@/app/api/extension/v1/projects/[projectId]/checkpoints/route";
import { GET as getCheckpointRoute } from "@/app/api/extension/v1/checkpoints/[checkpointId]/route";
import { POST as createHandoffRoute } from "@/app/api/extension/v1/projects/[projectId]/tasks/[taskId]/handoffs/route";
import { GET as listHandoffsRoute } from "@/app/api/extension/v1/handoffs/route";
import { GET as getHandoffRoute } from "@/app/api/extension/v1/handoffs/[handoffId]/route";
import { POST as resolveHandoffRoute } from "@/app/api/extension/v1/handoffs/[handoffId]/[action]/route";
import { POST as createAttemptRoute } from "@/app/api/extension/v1/handoffs/[handoffId]/attempts/route";
import { PATCH as updateAttemptRoute } from "@/app/api/extension/v1/attempts/[attemptId]/route";
import { POST as preflightRoute } from "@/app/api/extension/v1/handoffs/[handoffId]/preflight/route";
import { GET as listTaskAttemptsRoute } from "@/app/api/extension/v1/projects/[projectId]/tasks/[taskId]/attempts/route";
import { GET as listProjectMemoriesRoute, POST as createProjectMemoryRoute } from "@/app/api/extension/v1/projects/[projectId]/memories/route";
import { PATCH as updateProjectMemoryRoute } from "@/app/api/extension/v1/projects/[projectId]/memories/[memoryId]/route";


function req(body?: unknown, token?: string, method = "POST") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost:3000/api/extension/v1/test", {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function rawReq(body: string, token?: string, method = "POST") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost:3000/api/extension/v1/test", { method, headers, body });
}

async function testScene() {
  const alice = await createUser({ email: "alice@test.local", password: "password123", name: "Alice" });
  const bob = await createUser({ email: "bob@test.local", password: "password123", name: "Bob" });
  const stranger = await createUser({ email: "stranger@test.local", password: "password123", name: "Stranger" });

  const team = await createTeam(alice.id, "研发一组");
  await joinTeam(bob.id, team.inviteCode);

  const project = await createProject(alice.id, team.id, { name: "校园协作系统" });
  const task = await createTask(alice.id, project.id, {
    title: "实现登录模块",
    description: "需要对接 OAuth",
  });

  const { token: aliceToken } = await createApiToken(alice.id, "Alice VS Code PAT");
  const { token: bobToken } = await createApiToken(bob.id, "Bob VS Code PAT");
  const { token: strangerToken } = await createApiToken(stranger.id, "Stranger PAT");

  return { alice, bob, stranger, team, project, task, aliceToken, bobToken, strangerToken };
}

async function makeOfferedHandoff(
  scene: Awaited<ReturnType<typeof testScene>>,
  idempotencyKey: string,
) {
  const { project, task, bob, aliceToken } = scene;
  const params = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
  const checkpointResponse = await createCheckpointRoute(
    req({
      taskHandoffVersion: task.handoffVersion,
      taskUpdatedAt: task.updatedAt.toISOString(),
      repositoryKeyHash: "sha256:handoff-test",
      headSha: "0123456789012345678901234567890123456789",
      source: { provider: "codex-cli", providerVersion: "test", captureMode: "context-only" },
      handoffSummary: { goal: "测试交接", completed: [], remaining: ["继续实现"], blocker: null, nextAction: "接班" },
      materials: [],
    }, aliceToken),
    params,
  );
  expect(checkpointResponse.status).toBe(201);
  const checkpoint = await checkpointResponse.json();
  const response = await createHandoffRoute(
    req({
      checkpointId: checkpoint.id,
      toUserId: bob.id,
      expectedTaskUpdatedAt: task.updatedAt.toISOString(),
      expectedHandoffVersion: task.handoffVersion,
      idempotencyKey,
    }, aliceToken),
    params,
  );
  expect(response.status).toBe(201);
  return response.json();
}

describe("VS Code 扩展接口与检查点共享（B01/B02 API）", () => {
  beforeEach(resetDb);

  describe("GET /api/extension/v1/projects/{projectId}/members", () => {
    it("只返回当前项目中的人类成员 ID、显示名和角色，不返回邮箱", async () => {
      const { alice, bob, project, team, aliceToken } = await testScene();
      await createAgent(alice.id, team.id, {
        name: "自动化 Agent",
        provider: "codex",
      });
      const response = await projectMembersRoute(
        req(undefined, aliceToken, "GET"),
        { params: Promise.resolve({ projectId: project.id }) },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const data = await response.json();
      expect(data.projectId).toBe(project.id);
      expect(data.items).toEqual([
        { userId: alice.id, displayName: "Alice", role: "admin" },
        { userId: bob.id, displayName: "Bob", role: "student" },
      ]);
      expect(JSON.stringify(data)).not.toContain("@test.local");
    });

    it("拒绝未认证和非项目成员，并在成员离队后立即反映权限变化", async () => {
      const { alice, bob, project, aliceToken, bobToken, strangerToken, team } = await testScene();
      const params = { params: Promise.resolve({ projectId: project.id }) };
      expect((await projectMembersRoute(req(undefined, undefined, "GET"), params)).status).toBe(401);
      expect((await projectMembersRoute(req(undefined, strangerToken, "GET"), params)).status).toBe(403);

      await db.delete(teamMembers).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, bob.id)));
      expect((await projectMembersRoute(req(undefined, bobToken, "GET"), params)).status).toBe(403);

      const refreshed = await projectMembersRoute(req(undefined, aliceToken, "GET"), params);
      expect(refreshed.status).toBe(200);
      expect((await refreshed.json()).items).toEqual([
        { userId: alice.id, displayName: "Alice", role: "admin" },
      ]);
    });

    it("对格式错误的项目 ID 返回 400", async () => {
      const { aliceToken } = await testScene();
      const response = await projectMembersRoute(
        req(undefined, aliceToken, "GET"),
        { params: Promise.resolve({ projectId: "not-a-uuid" }) },
      );
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/extension/v1/me", () => {
    it("未鉴权或伪造 token 拒绝", async () => {
      const res1 = await meRoute(req(undefined, undefined, "GET"));
      expect(res1.status).toBe(401);

      const res2 = await meRoute(req(undefined, "ac_forged_token", "GET"));
      expect(res2.status).toBe(401);
    });

    it("合法 token 返回当前用户身份、项目成员资格与能力清单", async () => {
      const { alice, project, team, aliceToken } = await testScene();
      const res = await meRoute(req(undefined, aliceToken, "GET"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.actor.id).toBe(alice.id);
      expect(data.actor.displayName).toBe("Alice");
      expect(data.memberships).toHaveLength(1);
      expect(data.memberships[0].projectId).toBe(project.id);
      expect(data.memberships[0].teamId).toBe(team.id);
      expect(data.capabilities.checkpointCreate).toBe(true);
      expect(data.capabilities.handoffReceive).toBe(true);
    });
  });

  describe("POST & GET Checkpoints", () => {
    const validCheckpointData = {
      taskHandoffVersion: 1,
      taskUpdatedAt: new Date().toISOString(),
      repositoryKeyHash: "sha256:abc123repo",
      headSha: "a1b2c3d4e5f67890123456789012345678901234",
      source: {
        provider: "codex-cli",
        providerVersion: "0.11.3",
        captureMode: "context-only",
      },
      handoffSummary: {
        goal: "重构登录接口",
        completed: ["完成密码哈希校验", "增加 Feishu OAuth 路由"],
        remaining: ["补充前端回调测试"],
        blocker: null,
        nextAction: "运行 pnpm test 验证登录单测",
      },
      materials: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          kind: "context",
          sha256: "sha256:context123",
          byteLength: 2048,
          transferred: false,
        },
      ],
    };

    it("非项目成员拒绝登记检查点 (403)", async () => {
      const { project, task, strangerToken } = await testScene();
      const ctx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
      const res = await createCheckpointRoute(req(validCheckpointData, strangerToken), ctx);
      expect(res.status).toBe(403);
    });

    it("任务契约版本冲突时拒绝登记 (409)", async () => {
      const { alice, project, task, aliceToken } = await testScene();
      // 更新交接契约使版本增加
      await updateTask(alice.id, task.id, { handoffBrief: "更新了交接要求" });

      const ctx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
      const malformed = await createCheckpointRoute(rawReq("{", aliceToken), ctx);
      expect(malformed.status).toBe(400);
      // 传入旧版本 1 (此时最新应为 2)
      const res = await createCheckpointRoute(req({ ...validCheckpointData, taskHandoffVersion: 1 }, aliceToken), ctx);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain("契约版本已更新");
    });

    it("成功创建检查点并在列表中分页读取", async () => {
      const { alice, project, task, aliceToken, bobToken } = await testScene();
      const createCtx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
      const res = await createCheckpointRoute(req({ ...validCheckpointData, taskUpdatedAt: task.updatedAt.toISOString() }, aliceToken), createCtx);
      expect(res.status).toBe(201);
      const checkpoint = await res.json();
      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.creatorId).toBe(alice.id);
      expect(checkpoint.headSha).toBe(validCheckpointData.headSha);

      // Alice 和 Bob 都能在项目检查点列表中查到
      const listReqAlice = new Request(`http://localhost:3000/api/extension/v1/projects/${project.id}/checkpoints?taskId=${task.id}`, {
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      const listResAlice = await listCheckpointsRoute(listReqAlice, { params: Promise.resolve({ projectId: project.id }) });
      expect(listResAlice.status).toBe(200);
      const listAlice = await listResAlice.json();
      expect(listAlice.items).toHaveLength(1);
      expect(listAlice.items[0].id).toBe(checkpoint.id);
      expect(listAlice.items[0].creatorName).toBe("Alice");

      // 单个详情获取
      const detailRes = await getCheckpointRoute(
        new Request(`http://localhost:3000/api/extension/v1/checkpoints/${checkpoint.id}`, {
          headers: { authorization: `Bearer ${bobToken}` },
        }),
        { params: Promise.resolve({ checkpointId: checkpoint.id }) },
      );
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.id).toBe(checkpoint.id);
      expect(detail.materials).toHaveLength(1);
    });

    it("相同幂等键重放发布只返回原检查点，改动载荷则冲突", async () => {
      const { project, task, aliceToken } = await testScene();
      const ctx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
      const payload = { ...validCheckpointData, taskUpdatedAt: task.updatedAt.toISOString(), idempotencyKey: "11111111-1111-4111-8111-111111111111" };
      const first = await createCheckpointRoute(req(payload, aliceToken), ctx);
      const firstRecord = await first.json();
      const replay = await createCheckpointRoute(req(payload, aliceToken), ctx);
      const replayRecord = await replay.json();
      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replayRecord.id).toBe(firstRecord.id);

      const conflict = await createCheckpointRoute(req({ ...payload, headSha: "c".repeat(40) }, aliceToken), ctx);
      expect(conflict.status).toBe(409);
    });

    it("并行到达的同一发布请求只创建一条检查点", async () => {
      const { project, task, aliceToken } = await testScene();
      const ctx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
      const payload = { ...validCheckpointData, taskUpdatedAt: task.updatedAt.toISOString(), idempotencyKey: "22222222-2222-4222-8222-222222222222" };
      const [first, second] = await Promise.all([
        createCheckpointRoute(req(payload, aliceToken), ctx),
        createCheckpointRoute(req(payload, aliceToken), ctx),
      ]);
      const [firstRecord, secondRecord] = await Promise.all([first.json(), second.json()]);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(firstRecord.id).toBe(secondRecord.id);
    });
  });

  describe("Handoff 发起、幂等性与状态流转", () => {
    it("Alice 向 Bob 发起交接，支持重试幂等", async () => {
      const { alice, bob, project, task, aliceToken } = await testScene();
      // 先建检查点
      const createCtx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
      const cpRes = await createCheckpointRoute(
        req({
          taskHandoffVersion: 1,
          taskUpdatedAt: task.updatedAt.toISOString(),
          repositoryKeyHash: "sha256:repohash",
          headSha: "b2c3d4e5f6789012345678901234567890123456",
          source: { provider: "codex-cli", providerVersion: "1.0", captureMode: "context-only" },
          handoffSummary: { goal: "交接目标", completed: [], remaining: [], blocker: null, nextAction: "接班继续" },
          materials: [],
        }, aliceToken),
        createCtx,
      );
      const cp = await cpRes.json();

      const handoffCtx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
      const handoffPayload = {
        checkpointId: cp.id,
        toUserId: bob.id,
        expectedTaskUpdatedAt: task.updatedAt.toISOString(),
        expectedHandoffVersion: 1,
        idempotencyKey: "unique-key-12345",
      };

      // 两个并发的同键、同 payload 请求只创建一条记录。
      const [h1, h2] = await Promise.all([
        createHandoffRoute(req({ ...handoffPayload, fromUserId: bob.id }, aliceToken), handoffCtx),
        createHandoffRoute(req(handoffPayload, aliceToken), handoffCtx),
      ]);
      expect([h1.status, h2.status].sort()).toEqual([200, 201]);
      const h1Data = await h1.json();
      const h2Data = await h2.json();
      expect(h1Data.state).toBe("offered");
      expect(h1Data.fromUserId).toBe(alice.id);
      expect(h1Data.toUserId).toBe(bob.id);
      expect(h2Data.id).toBe(h1Data.id);

      const changedVersion = await createHandoffRoute(
        req({ ...handoffPayload, expectedHandoffVersion: 0 }, aliceToken), handoffCtx,
      );
      expect(changedVersion.status).toBe(409);
      const changedTimestamp = await createHandoffRoute(
        req({
          ...handoffPayload,
          expectedTaskUpdatedAt: new Date(task.updatedAt.getTime() + 1000).toISOString(),
        }, aliceToken),
        handoffCtx,
      );
      expect(changedTimestamp.status).toBe(409);

      // Bob 在收件箱中查到此交接单
      const inboxRes = await listHandoffsRoute(
        new Request("http://localhost:3000/api/extension/v1/handoffs?box=inbox", {
          headers: { authorization: `Bearer ${aliceToken}` },
        }),
      );
      const inbox = await inboxRes.json();
      // Alice 不是接收人，收件箱为 0
      expect(inbox.items).toHaveLength(0);

      // 详情查看
      const detail = await getHandoffRoute(
        new Request(`http://localhost:3000/api/extension/v1/handoffs/${h1Data.id}`, {
          headers: { authorization: `Bearer ${aliceToken}` },
        }),
        { params: Promise.resolve({ handoffId: h1Data.id }) },
      );
      expect(detail.status).toBe(200);
      const dJson = await detail.json();
      expect(dJson.checkpoint.headSha).toBe("b2c3d4e5f6789012345678901234567890123456");
    });

    it("Bob 接受交接；Alice 无权替 Bob 接受；再次接收报 409", async () => {
      const { bob, project, task, aliceToken, bobToken } = await testScene();
      const cpRes = await createCheckpointRoute(
        req({
          taskHandoffVersion: 1,
          taskUpdatedAt: task.updatedAt.toISOString(),
          repositoryKeyHash: "sha256:repohash",
          headSha: "c3d4e5f678901234567890123456789012345678",
          source: { provider: "codex-cli", providerVersion: "1.0", captureMode: "context-only" },
          handoffSummary: { goal: "测试接受", completed: [], remaining: [], blocker: null, nextAction: "开始" },
          materials: [],
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const cp = await cpRes.json();

      const hRes = await createHandoffRoute(
        req({
          checkpointId: cp.id,
          toUserId: bob.id,
          expectedTaskUpdatedAt: task.updatedAt.toISOString(),
          expectedHandoffVersion: 1,
          idempotencyKey: "key-accept-test",
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const handoff = await hRes.json();

      // Alice 尝试接收 -> 403
      const failAccept = await resolveHandoffRoute(
        req({ expectedHandoffVersion: 1 }, aliceToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(failAccept.status).toBe(403);

      const noVersion = await resolveHandoffRoute(
        req({}, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(noVersion.status).toBe(400);
      const malformedAction = await resolveHandoffRoute(
        rawReq("{", bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(malformedAction.status).toBe(400);
      const wrongVersionType = await resolveHandoffRoute(
        req({ expectedHandoffVersion: "1" }, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(wrongVersionType.status).toBe(400);
      const staleRecordVersion = await resolveHandoffRoute(
        req({ expectedHandoffVersion: 2 }, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(staleRecordVersion.status).toBe(409);

      // Bob 正常接收 -> 200 accepted
      const bobAccept = await resolveHandoffRoute(
        req({ expectedHandoffVersion: 1 }, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(bobAccept.status).toBe(200);
      const acceptedData = await bobAccept.json();
      expect(acceptedData.state).toBe("accepted");
      expect(acceptedData.resolvedAt).toBeDefined();
      const [taskAfterAccept] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(taskAfterAccept.assigneeId).toBe(task.assigneeId);
      expect(taskAfterAccept.status).toBe(task.status);

      // 重复接收 -> 409 Conflict
      const duplicateAccept = await resolveHandoffRoute(
        req({ expectedHandoffVersion: 1 }, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(duplicateAccept.status).toBe(409);
    });

    it("接收者离开团队后不能再处理收到的交接", async () => {
      const scene = await testScene();
      const handoff = await makeOfferedHandoff(scene, "recipient-left-team");
      await db
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, scene.team.id), eq(teamMembers.userId, scene.bob.id)));

      const response = await resolveHandoffRoute(
        req({ expectedHandoffVersion: 1 }, scene.bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(response.status).toBe(403);
    });

    it("合同更新后拒绝按旧版本接收交接", async () => {
      const scene = await testScene();
      const handoff = await makeOfferedHandoff(scene, "contract-changed-before-accept");
      await updateTask(scene.alice.id, scene.task.id, { handoffBrief: "新版交接要求" });

      const response = await resolveHandoffRoute(
        req({ expectedHandoffVersion: 1 }, scene.bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toContain("任务契约已更新");
    });

    it("accept 与 withdraw 并发时最多一个状态转换成功", async () => {
      const scene = await testScene();
      const handoff = await makeOfferedHandoff(scene, "accept-withdraw-race");
      const params = { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) };
      const withdrawParams = { params: Promise.resolve({ handoffId: handoff.id, action: "withdraw" }) };

      const [accept, withdraw] = await Promise.all([
        resolveHandoffRoute(req({ expectedHandoffVersion: 1 }, scene.bobToken), params),
        resolveHandoffRoute(req({ expectedHandoffVersion: 1 }, scene.aliceToken), withdrawParams),
      ]);
      expect([accept.status, withdraw.status].sort((a, b) => a - b)).toEqual([200, 409]);

      const winner = accept.status === 200 ? await accept.json() : await withdraw.json();
      expect(["accepted", "withdrawn"]).toContain(winner.state);
      expect(winner.state).toBe(accept.status === 200 ? "accepted" : "withdrawn");
    });
  });

  describe("Attempt 执行记录与回执更新", () => {
    it("接受交接后，Bob 登记 Attempt 回执并更新状态与测试结果", async () => {
      const { bob, project, task, aliceToken, bobToken } = await testScene();
      const headSha = "d4e5f6789012345678901234567890123456789a";


      const cpRes = await createCheckpointRoute(
        req({
          taskHandoffVersion: 1,
          taskUpdatedAt: task.updatedAt.toISOString(),
          repositoryKeyHash: "sha256:repohash",
          headSha,
          source: { provider: "codex-cli", providerVersion: "1.0", captureMode: "context-only" },
          handoffSummary: { goal: "测试 Attempt", completed: [], remaining: [], blocker: null, nextAction: "接班" },
          materials: [],
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const cp = await cpRes.json();

      const hRes = await createHandoffRoute(
        req({
          checkpointId: cp.id,
          toUserId: bob.id,
          expectedTaskUpdatedAt: task.updatedAt.toISOString(),
          expectedHandoffVersion: 1,
          idempotencyKey: "key-attempt-test",
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const handoff = await hRes.json();

      // 未接受前创建 Attempt -> 409
      const earlyAttempt = await createAttemptRoute(
        req({ baseSha: headSha }, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id }) },
      );
      expect(earlyAttempt.status).toBe(409);

      // Bob 接受交接
      await resolveHandoffRoute(
        req({ expectedHandoffVersion: 1 }, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );

      // baseSha 不匹配 headSha -> 409
      const mismatchAttempt = await createAttemptRoute(
        req({ baseSha: "wrong-sha" }, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id }) },
      );
      expect(mismatchAttempt.status).toBe(409);

      // 正确创建 Attempt -> 201
      const okAttempt = await createAttemptRoute(
        req({
          baseSha: headSha,
          branchName: "attempt/bob-oauth-fix",
          kind: "continuation",
          provider: "codex-cli",
        }, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id }) },
      );
      expect(okAttempt.status).toBe(201);
      const attemptData = await okAttempt.json();
      expect(attemptData.state).toBe("started");
      expect(attemptData.actorId).toBe(bob.id);

      // 更新 Attempt 回执 -> finished
      const updateRes = await updateAttemptRoute(
        req({
          state: "finished",
          receipt: {
            headSha: "e5f6789012345678901234567890123456789abc",
            changedPaths: ["src/auth.ts", "tests/auth.test.ts"],
            tests: [
              { commandLabel: "npm test", exitCode: 0, source: "captured" },
            ],
          },
        }, bobToken, "PATCH"),
        { params: Promise.resolve({ attemptId: attemptData.id }) },
      );
      expect(updateRes.status).toBe(200);
      const updatedJson = await updateRes.json();
      expect(updatedJson.state).toBe("finished");
      expect(updatedJson.receipt.tests[0].exitCode).toBe(0);
      expect(updatedJson.receipt.changedPaths).toContain("src/auth.ts");
    });
  });

  describe("B03: 接班核对 (Handover Preflight)", () => {
    it("核对基线与契约：基线匹配且未改动时通过，契约变化或 dirty 时拦截", async () => {
      const { bob, project, task, aliceToken, bobToken } = await testScene();
      const headSha = "f678901234567890123456789012345678901234";

      const cpRes = await createCheckpointRoute(
        req({
          taskHandoffVersion: 1,
          taskUpdatedAt: task.updatedAt.toISOString(),
          repositoryKeyHash: "sha256:preflighthash",
          headSha,
          source: { provider: "codex-cli", providerVersion: "1.0", captureMode: "context-only" },
          handoffSummary: { goal: "测试 Preflight", completed: [], remaining: [], blocker: null, nextAction: "核对" },
          materials: [],
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const cp = await cpRes.json();

      const hRes = await createHandoffRoute(
        req({
          checkpointId: cp.id,
          toUserId: bob.id,
          expectedTaskUpdatedAt: task.updatedAt.toISOString(),
          expectedHandoffVersion: 1,
          idempotencyKey: "key-preflight-test",
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const handoff = await hRes.json();

      const preflightCtx = { params: Promise.resolve({ handoffId: handoff.id }) };

      const malformedPreflight = await preflightRoute(rawReq("{", bobToken), preflightCtx);
      expect(malformedPreflight.status).toBe(400);
      const invalidPreflight = await preflightRoute(
        req({ clientDirty: "false" }, bobToken),
        preflightCtx,
      );
      expect(invalidPreflight.status).toBe(400);

      // 1. 基线完全匹配，无 dirty -> ready
      const okCheck = await preflightRoute(
        req({
          clientHeadSha: headSha,
          clientRepoKeyHash: "sha256:preflighthash",
          clientDirty: false,
        }, bobToken),
        preflightCtx,
      );
      expect(okCheck.status).toBe(200);
      const okData = await okCheck.json();
      expect(okData.ok).toBe(true);
      expect(okData.status).toBe("ready");
      expect(okData.blockers).toHaveLength(0);

      // 2. 客户端有未提交改动 (dirty) -> blocked
      const dirtyCheck = await preflightRoute(
        req({
          clientHeadSha: headSha,
          clientRepoKeyHash: "sha256:preflighthash",
          clientDirty: true,
        }, bobToken),
        preflightCtx,
      );
      expect(dirtyCheck.status).toBe(200);
      const dirtyData = await dirtyCheck.json();
      expect(dirtyData.ok).toBe(false);
      expect(dirtyData.status).toBe("blocked");
      expect(dirtyData.blockers.some((b: string) => b.includes("未提交"))).toBe(true);

      // 3. 客户端 Git SHA 不匹配 -> blocked
      const shaCheck = await preflightRoute(
        req({
          clientHeadSha: "0000000000000000000000000000000000000000",
          clientRepoKeyHash: "sha256:preflighthash",
          clientDirty: false,
        }, bobToken),
        preflightCtx,
      );
      expect(shaCheck.status).toBe(200);
      const shaData = await shaCheck.json();
      expect(shaData.ok).toBe(false);
      expect(shaData.status).toBe("blocked");
      expect(shaData.blockers.some((b: string) => b.includes("基线"))).toBe(true);
    });
  });

  describe("B04: 同源并行方案 Attempts 聚合", () => {
    it("支持聚合任务下的多个并行尝试并隔离陌生人", async () => {
      const scene = await testScene();
      const { project, task, aliceToken, bobToken, strangerToken } = scene;
      const headSha = "1111222233334444555566667777888899990000";

      // 1. 创建 Checkpoint 与 Handoff
      const cpRes = await createCheckpointRoute(
        req({
          taskHandoffVersion: task.handoffVersion,
          taskUpdatedAt: task.updatedAt.toISOString(),
          repositoryKeyHash: "sha256:attempts-repo",
          headSha,
          source: { provider: "codex-cli", providerVersion: "test", captureMode: "context-only" },
          handoffSummary: { goal: "测试并行方案", completed: [], remaining: ["多方案比对"], blocker: null, nextAction: "比对" },
          materials: [],
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const cp = await cpRes.json();

      const hoRes = await createHandoffRoute(
        req({
          checkpointId: cp.id,
          toUserId: scene.bob.id,
          expectedTaskUpdatedAt: task.updatedAt.toISOString(),
          expectedHandoffVersion: task.handoffVersion,
          idempotencyKey: "11111111-2222-3333-4444-555555555555",
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const ho = await hoRes.json();

      // 2. Bob 接收交接
      await resolveHandoffRoute(
        req({ expectedHandoffVersion: task.handoffVersion }, bobToken),
        { params: Promise.resolve({ handoffId: ho.id, action: "accept" }) },
      );

      // 3. Bob 登记主线 Attempt
      const att1Res = await createAttemptRoute(
        req({
          baseSha: headSha,
          kind: "continuation",
          branchName: "feat/login-oauth-main",
          receipt: {
            sessionId: "sess-1",
            headSha: "2222333344445555666677778888999900001111",
            changedPaths: ["src/auth.ts"],
            tests: [{ commandLabel: "npm test", exitCode: 0, source: "captured" }],
          },
        }, bobToken),
        { params: Promise.resolve({ handoffId: ho.id }) },
      );
      expect(att1Res.status).toBe(201);

      // 4. Bob 登记并行尝试 Attempt (kind: parallel)
      const att2Res = await createAttemptRoute(
        req({
          baseSha: headSha,
          kind: "parallel",
          branchName: "feat/login-oauth-alt",
          receipt: {
            sessionId: "sess-2",
            headSha: "3333444455556666777788889999000011112222",
            changedPaths: ["src/auth-alt.ts"],
            tests: [{ commandLabel: "npm test -- tests/auth-alt.test.ts", exitCode: 1, source: "captured" }],
          },
        }, bobToken),
        { params: Promise.resolve({ handoffId: ho.id }) },
      );
      expect(att2Res.status).toBe(201);

      // 5. 查询任务下的 Attempts 聚合列表
      const listRes = await listTaskAttemptsRoute(
        req(undefined, bobToken, "GET"),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.attempts).toHaveLength(2);
      expect(listData.attempts[0].actorName).toBe("Bob");
      expect(listData.attempts.map((a: { kind: string }) => a.kind)).toContain("continuation");
      expect(listData.attempts.map((a: { kind: string }) => a.kind)).toContain("parallel");

      // 6. 陌生人查询拦截 403
      const strangerRes = await listTaskAttemptsRoute(
        req(undefined, strangerToken, "GET"),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      expect(strangerRes.status).toBe(403);
    });
  });

  describe("B05: 有效项目记忆 Project Memories", () => {
    it("支持沉淀、按分类筛选及更新记忆状态", async () => {
      const scene = await testScene();
      const { project, task, aliceToken, bobToken, strangerToken } = scene;

      // 1. Alice (Admin) 创建约束记忆 -> 自动已确认
      const mem1Res = await createProjectMemoryRoute(
        req({
          taskId: task.id,
          category: "constraint",
          title: "禁止在数据库存储大体积 transcript",
          content: "服务端 V1 仅保留元数据与 SHA-256 哈希索引，单项材料硬限制 15MB",
          codeRefSha: "0123456789012345678901234567890123456789",
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id }) },
      );
      expect(mem1Res.status).toBe(201);
      const mem1 = await mem1Res.json();
      expect(mem1.confirmedById).toBe(scene.alice.id);
      expect(mem1.status).toBe("active");

      // 2. Bob (Student) 创建经验总结记忆 -> 等待确认 (confirmedById 为 null)
      const mem2Res = await createProjectMemoryRoute(
        req({
          category: "learned",
          title: "PostgreSQL TRUNCATE 必须 cascade 到 project_memories",
          content: "resetDb 必须清空所有业务表，否则偶发红单测",
        }, bobToken),
        { params: Promise.resolve({ projectId: project.id }) },
      );
      expect(mem2Res.status).toBe(201);
      const mem2 = await mem2Res.json();
      expect(mem2.confirmedById).toBeNull();
      expect(mem2.status).toBe("active");

      // 3. 查询项目的所有记忆
      const listRes = await listProjectMemoriesRoute(
        req(undefined, aliceToken, "GET"),
        { params: Promise.resolve({ projectId: project.id }) },
      );
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.memories).toHaveLength(2);

      // 4. 按分类筛选 (category=constraint)
      const filterReq = new Request(
        `http://localhost:3000/api/extension/v1/projects/${project.id}/memories?category=constraint`,
        { headers: { authorization: `Bearer ${aliceToken}` } },
      );
      const filterRes = await listProjectMemoriesRoute(
        filterReq,
        { params: Promise.resolve({ projectId: project.id }) },
      );
      const filterData = await filterRes.json();
      expect(filterData.memories).toHaveLength(1);
      expect(filterData.memories[0].title).toContain("禁止在数据库存储大体积");

      // 5. 更新记忆状态 (PATCH status -> superseded)
      const patchRes = await updateProjectMemoryRoute(
        req({ status: "superseded", supersededById: mem2.id }, aliceToken, "PATCH"),
        { params: Promise.resolve({ projectId: project.id, memoryId: mem1.id }) },
      );
      expect(patchRes.status).toBe(200);
      const patched = await patchRes.json();
      expect(patched.status).toBe("superseded");
      expect(patched.supersededById).toBe(mem2.id);

      // 6. 陌生人禁止访问 403
      const strangerRes = await listProjectMemoriesRoute(
        req(undefined, strangerToken, "GET"),
        { params: Promise.resolve({ projectId: project.id }) },
      );
      expect(strangerRes.status).toBe(403);
    });
  });
});
