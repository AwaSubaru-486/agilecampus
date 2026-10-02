import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { createApiToken } from "@/lib/api-token";
import { resetDb } from "./helpers";

import { GET as meRoute } from "@/app/api/extension/v1/me/route";
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


function req(body?: unknown, token?: string, method = "POST") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost:3000/api/extension/v1/test", {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

describe("VS Code 扩展接口与检查点共享（B01/B02 API）", () => {
  beforeEach(resetDb);

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
      // 传入旧版本 1 (此时最新应为 2)
      const res = await createCheckpointRoute(req({ ...validCheckpointData, taskHandoffVersion: 1 }, aliceToken), ctx);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain("契约版本已更新");
    });

    it("成功创建检查点并在列表中分页读取", async () => {
      const { alice, project, task, aliceToken, bobToken } = await testScene();
      const createCtx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
      const res = await createCheckpointRoute(req(validCheckpointData, aliceToken), createCtx);
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
  });

  describe("Handoff 发起、幂等性与状态流转", () => {
    it("Alice 向 Bob 发起交接，支持重试幂等", async () => {
      const { alice, bob, project, task, aliceToken } = await testScene();
      // 先建检查点
      const createCtx = { params: Promise.resolve({ projectId: project.id, taskId: task.id }) };
      const cpRes = await createCheckpointRoute(
        req({
          taskHandoffVersion: 1,
          taskUpdatedAt: new Date().toISOString(),
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
        expectedTaskUpdatedAt: new Date().toISOString(),
        expectedHandoffVersion: 1,
        idempotencyKey: "unique-key-12345",
      };

      // 首次发起
      const h1 = await createHandoffRoute(req(handoffPayload, aliceToken), handoffCtx);
      expect(h1.status).toBe(201);
      const h1Data = await h1.json();
      expect(h1Data.state).toBe("offered");
      expect(h1Data.fromUserId).toBe(alice.id);
      expect(h1Data.toUserId).toBe(bob.id);

      // 重复请求（同幂等键同 payload）返回首次创建的记录
      const h2 = await createHandoffRoute(req(handoffPayload, aliceToken), handoffCtx);
      expect(h2.status).toBe(200);
      const h2Data = await h2.json();
      expect(h2Data.id).toBe(h1Data.id);

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
          taskUpdatedAt: new Date().toISOString(),
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
          expectedTaskUpdatedAt: new Date().toISOString(),
          expectedHandoffVersion: 1,
          idempotencyKey: "key-accept-test",
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const handoff = await hRes.json();

      // Alice 尝试接收 -> 403
      const failAccept = await resolveHandoffRoute(
        req({}, aliceToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(failAccept.status).toBe(403);

      // Bob 正常接收 -> 200 accepted
      const bobAccept = await resolveHandoffRoute(
        req({}, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(bobAccept.status).toBe(200);
      const acceptedData = await bobAccept.json();
      expect(acceptedData.state).toBe("accepted");
      expect(acceptedData.resolvedAt).toBeDefined();

      // 重复接收 -> 409 Conflict
      const duplicateAccept = await resolveHandoffRoute(
        req({}, bobToken),
        { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) },
      );
      expect(duplicateAccept.status).toBe(409);
    });
  });

  describe("Attempt 执行记录与回执更新", () => {
    it("接受交接后，Bob 登记 Attempt 回执并更新状态与测试结果", async () => {
      const { bob, project, task, aliceToken, bobToken } = await testScene();
      const headSha = "d4e5f6789012345678901234567890123456789a";


      const cpRes = await createCheckpointRoute(
        req({
          taskHandoffVersion: 1,
          taskUpdatedAt: new Date().toISOString(),
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
          expectedTaskUpdatedAt: new Date().toISOString(),
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
      await resolveHandoffRoute(req({}, bobToken), { params: Promise.resolve({ handoffId: handoff.id, action: "accept" }) });

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
          taskUpdatedAt: new Date().toISOString(),
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
          expectedTaskUpdatedAt: new Date().toISOString(),
          expectedHandoffVersion: 1,
          idempotencyKey: "key-preflight-test",
        }, aliceToken),
        { params: Promise.resolve({ projectId: project.id, taskId: task.id }) },
      );
      const handoff = await hRes.json();

      const preflightCtx = { params: Promise.resolve({ handoffId: handoff.id }) };

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
});
