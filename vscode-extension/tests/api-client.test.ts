import { describe, expect, it, vi } from "vitest";
import { ApiError, AgileCampusApiClient, validateServerUrl } from "../src/agilecampus/api-client";
import { parseWebviewMessage } from "../src/views/webview-message";
import { projectUrl } from "../src/views/project-url";

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AgileCampus API client", () => {
  it("only accepts HTTPS outside loopback and rejects URL credentials/query", () => {
    expect(validateServerUrl("http://localhost:3000").toString()).toBe("http://localhost:3000/");
    expect(() => validateServerUrl("http://192.168.1.10:3000")).toThrow("必须使用 HTTPS");
    expect(() => validateServerUrl("https://user:pass@example.com")).toThrow("不能包含账号");
    expect(() => validateServerUrl("https://example.com/?token=secret")).toThrow("不能包含账号");
    expect(() => validateServerUrl("file:///tmp/test")).toThrow("只允许 http/https");
  });

  it("sends PAT only in the host request with redirects disabled", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input); seenInit = init;
      return response(200, { projects: [] });
    }) as unknown as typeof fetch;
    const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test_token", fetcher);
    await expect(client.listProjects()).resolves.toEqual([]);
    expect(seenUrl).toBe("http://localhost:3000/api/agent/projects");
    expect(new Headers(seenInit?.headers).get("authorization")).toBe("Bearer ac_test_token");
    expect(seenInit?.redirect).toBe("error");
    expect(JSON.stringify({ endpoint: seenUrl })).not.toContain("ac_test_token");
  });

  it("does not make a request without a Personal API Token", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const client = new AgileCampusApiClient("http://localhost:3000", async () => undefined, fetcher);
    await expect(client.listProjects()).rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects malformed project records and task details without project ownership", async () => {
    const malformedProjects = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(200, { projects: [{ id: "p1", name: "项目" }] })) as unknown as typeof fetch);
    await expect(malformedProjects.listProjects()).rejects.toThrow("包含无效记录");

    const missingProjectId = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(200, { id: "t1", title: "任务", status: "doing" })) as unknown as typeof fetch);
    await expect(missingProjectId.getTask("t1")).rejects.toThrow("任务接口返回格式无效");
  });

  it.each([[401, "令牌无效"], [403, "无权访问"], [503, "服务暂不可用"]])(
    "maps HTTP %i without exposing response body", async (status, message) => {
      const fetcher = vi.fn(async () => response(status, { error: "private server details" })) as unknown as typeof fetch;
      const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test", fetcher);
      await expect(client.listProjects()).rejects.toThrow(message as string);
      await expect(client.listProjects()).rejects.not.toThrow("private server details");
    },
  );

  it("enforces timeout and reports the request as offline", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })) as unknown as typeof fetch;
    const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test", fetcher, 5);
    await expect(client.listProjects()).rejects.toThrow("连接超时");
  });

  it("refuses a cross-origin redirect", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("redirect rejected");
    }) as unknown as typeof fetch;
    const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test", fetcher);
    await expect(client.listProjects()).rejects.toThrow("无法连接 AgileCampus");
  });

  it("maps only the task fields the sidebar needs and validates API shapes", async () => {
    const fetcher = vi.fn(async () => response(200, { tasks: [{
      id: "t1", title: "修复接口", status: "doing", priority: "high", dueDate: null,
      assigneeId: "u1", assigneeName: "Agent", handoffBrief: "写接口", doneCriteria: ["测试通过"],
      requiredEvidence: ["test"], updatedAt: "2026-09-30T00:00:00Z", description: "private extra",
    }] })) as unknown as typeof fetch;
    const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test", fetcher);
    const tasks = await client.listTasks("project-1");
    expect(tasks[0].title).toBe("修复接口");
    expect(JSON.stringify(tasks)).not.toContain("private extra");
    expect(JSON.stringify(tasks)).not.toContain("token");

    const malformed = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(200, { tasks: [{}] })) as unknown as typeof fetch);
    await expect(malformed.listTasks("project-1")).rejects.toThrow("包含无效记录");
  });

  it("posts only the confirmed checkpoint index fields and validates the server response", async () => {
    const payload = {
      idempotencyKey: "00000000-0000-5000-8000-000000000001",
      visibility: "project" as const, parentCheckpointId: null,
      taskHandoffVersion: 3, taskUpdatedAt: "2026-10-01T05:00:00.000Z",
      repositoryKeyHash: "a".repeat(64), headSha: "b".repeat(40),
      source: { provider: "Entire CLI", providerVersion: "0.11.3", captureMode: "context-only" as const },
      handoffSummary: { goal: "实现检查点", completed: ["本地保存"], remaining: ["发布索引"], blocker: null, nextAction: "核对发布结果" },
      materials: [{ id: "d87c4e10-09d1-40d6-9e55-62bc029940b9", kind: "transcript" as const, sha256: "c".repeat(64), byteLength: 21, transferred: false as const }],
    };
    const record = {
      id: "d87c4e10-09d1-40d6-9e55-62bc02994100", projectId: "project-a", taskId: "task-a", creatorId: "user-a",
      idempotencyKey: payload.idempotencyKey,
      visibility: "project", parentCheckpointId: null, taskHandoffVersion: 3, taskUpdatedAt: payload.taskUpdatedAt,
      repositoryKeyHash: payload.repositoryKeyHash, headSha: payload.headSha, source: payload.source,
      handoffSummary: payload.handoffSummary, materials: payload.materials, createdAt: payload.taskUpdatedAt,
    };
    let body = "";
    let seenInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body ?? ""); seenInit = init;
      return response(201, record);
    }) as unknown as typeof fetch;
    const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test", fetcher);
    await expect(client.createCheckpointIndex("project-a", "task-a", payload)).resolves.toMatchObject({ id: record.id });
    expect(seenInit?.method).toBe("POST");
    expect(seenInit?.redirect).toBe("error");
    expect(new Headers(seenInit?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(body)).toEqual(payload);
    expect(body).not.toContain("PRIVATE_TRANSCRIPT_BODY");
    expect(body).not.toContain("/Users/");
    expect(body).not.toContain("API_KEY");
    expect(body).not.toContain("uncommitted source");
  });

  it("rejects a checkpoint response that does not match the requested project, task, and summary", async () => {
    const payload = {
      visibility: "project" as const, parentCheckpointId: null, taskHandoffVersion: 1,
      taskUpdatedAt: "2026-10-01T05:00:00.000Z", repositoryKeyHash: "a", headSha: "b",
      source: { provider: "test", providerVersion: "1", captureMode: "context-only" as const },
      handoffSummary: { goal: "预期摘要", completed: [], remaining: [], blocker: null, nextAction: "下一步" }, materials: [],
    };
    const record = {
      id: "checkpoint", projectId: "wrong-project", taskId: "task-a", creatorId: "user-a", visibility: "project",
      parentCheckpointId: null, taskHandoffVersion: 1, taskUpdatedAt: payload.taskUpdatedAt, repositoryKeyHash: "a", headSha: "b",
      source: payload.source, handoffSummary: payload.handoffSummary, materials: [], createdAt: payload.taskUpdatedAt,
    };
    const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(201, record)) as unknown as typeof fetch);
    await expect(client.createCheckpointIndex("project-a", "task-a", payload)).rejects.toThrow("与已确认内容不一致");
  });

  it("parses the current actor and only validated project member fields", async () => {
    const responses = [
      { actor: { id: "actor-1", displayName: "发起人", email: "private@example.test" } },
      { projectId: "project-a", items: [
        { userId: "actor-1", displayName: "发起人", role: "student" },
        { userId: "recipient-1", displayName: "接收人", role: "teacher", email: "private@example.test" },
      ] },
    ];
    const fetcher = vi.fn(async () => response(200, responses.shift())) as unknown as typeof fetch;
    const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test", fetcher);
    await expect(client.getCurrentActor()).resolves.toEqual({ id: "actor-1", displayName: "发起人" });
    await expect(client.listProjectHandoffMembers("project-a")).resolves.toEqual([
      { userId: "actor-1", displayName: "发起人", role: "student" },
      { userId: "recipient-1", displayName: "接收人", role: "teacher" },
    ]);
    expect(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0])).toContain("/api/extension/v1/projects/project-a/members");

    const wrongProject = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(200, { projectId: "other-project", items: [] })) as unknown as typeof fetch);
    await expect(wrongProject.listProjectHandoffMembers("project-a")).rejects.toThrow("返回格式无效");
    const unknownRole = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(200, { projectId: "project-a", items: [{ userId: "u1", displayName: "用户", role: "unknown" }] })) as unknown as typeof fetch);
    await expect(unknownRole.listProjectHandoffMembers("project-a")).rejects.toThrow("包含无效记录");
  });

  it("posts a handoff with the stable idempotency key and validates all identity/version fields", async () => {
    const payload = {
      checkpointId: "d87c4e10-09d1-40d6-9e55-62bc029940b9",
      toUserId: "d87c4e10-09d1-40d6-9e55-62bc029940ba",
      expectedTaskUpdatedAt: "2026-10-01T05:00:00.000Z",
      expectedHandoffVersion: 3,
      idempotencyKey: "d87c4e10-09d1-40d6-9e55-62bc029940bb",
    };
    const record = {
      id: "d87c4e10-09d1-40d6-9e55-62bc029940bc",
      projectId: "d87c4e10-09d1-40d6-9e55-62bc029940bd",
      taskId: "d87c4e10-09d1-40d6-9e55-62bc029940be",
      fromUserId: "d87c4e10-09d1-40d6-9e55-62bc029940bf",
      ...payload,
      state: "offered", reason: null, createdAt: payload.expectedTaskUpdatedAt, resolvedAt: null,
    };
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input); seenInit = init;
      return response(201, record);
    }) as unknown as typeof fetch);
    await expect(client.createHandoff(record.projectId, record.taskId, payload, record.fromUserId)).resolves.toMatchObject({ id: record.id, state: "offered" });
    expect(seenUrl).toBe(`http://localhost:3000/api/extension/v1/projects/${record.projectId}/tasks/${record.taskId}/handoffs`);
    expect(seenInit?.method).toBe("POST");
    expect(seenInit?.redirect).toBe("error");
    expect(JSON.parse(String(seenInit?.body))).toEqual(payload);

    const mismatched = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(201, { ...record, fromUserId: "another-actor" })) as unknown as typeof fetch);
    await expect(mismatched.createHandoff(record.projectId, record.taskId, payload, record.fromUserId)).rejects.toThrow("与已确认请求不一致");

    const acceptedReplay = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(200, { ...record, state: "accepted" })) as unknown as typeof fetch);
    await expect(acceptedReplay.createHandoff(record.projectId, record.taskId, payload, record.fromUserId))
      .resolves.toMatchObject({ id: record.id, state: "accepted" });

    const mismatches = [
      { projectId: "another-project" }, { taskId: "another-task" }, { checkpointId: "another-checkpoint" },
      { fromUserId: "another-actor" }, { toUserId: "another-recipient" }, { expectedHandoffVersion: 99 },
    ];
    for (const mismatch of mismatches) {
      const invalid = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
        vi.fn(async () => response(201, { ...record, ...mismatch })) as unknown as typeof fetch);
      await expect(invalid.createHandoff(record.projectId, record.taskId, payload, record.fromUserId))
        .rejects.toThrow("与已确认请求不一致");
    }
  });

  it("reads a handoff status and validates that the returned record matches the requested ID", async () => {
    const record = {
      id: "d87c4e10-09d1-40d6-9e55-62bc029940bc",
      projectId: "d87c4e10-09d1-40d6-9e55-62bc029940bd",
      taskId: "d87c4e10-09d1-40d6-9e55-62bc029940be",
      checkpointId: "d87c4e10-09d1-40d6-9e55-62bc029940b9",
      toUserId: "d87c4e10-09d1-40d6-9e55-62bc029940ba",
      fromUserId: "d87c4e10-09d1-40d6-9e55-62bc029940bf",
      expectedTaskUpdatedAt: "2026-10-01T05:00:00.000Z",
      expectedHandoffVersion: 3,
      idempotencyKey: "d87c4e10-09d1-40d6-9e55-62bc029940bb",
      state: "declined", reason: "暂时无法接手", createdAt: "2026-10-01T05:00:00.000Z", resolvedAt: "2026-10-01T06:00:00.000Z",
    };
    const client = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(200, record)) as unknown as typeof fetch);
    await expect(client.getHandoff(record.id)).resolves.toMatchObject({ id: record.id, state: "declined" });

    const mismatched = new AgileCampusApiClient("http://localhost:3000", async () => "ac_test",
      vi.fn(async () => response(200, { ...record, id: "another-handoff" })) as unknown as typeof fetch);
    await expect(mismatched.getHandoff(record.id)).rejects.toThrow("其他交接记录");
  });
});

describe("binding and token storage boundaries", () => {
  it("isolates secrets by service and workspace", async () => {
    const values = new Map<string, string>();
    const secrets = {
      get: async (key: string) => values.get(key),
      store: async (key: string, value: string) => { values.set(key, value); },
      delete: async (key: string) => { values.delete(key); },
    };
    const { TokenStore } = await import("../src/auth/token-store");
    const store = new TokenStore(secrets as never);
    await store.store("https://one.example", "file:///work/a", "ac_one_a");
    await store.store("https://one.example", "file:///work/b", "ac_one_b");
    await store.store("https://two.example", "file:///work/a", "ac_two_a");
    expect(await store.get("https://one.example", "file:///work/a")).toBe("ac_one_a");
    expect(await store.get("https://one.example", "file:///work/b")).toBe("ac_one_b");
    expect(await store.get("https://two.example", "file:///work/a")).toBe("ac_two_a");
    expect([...values.keys()].some((key) => key.includes("one.example"))).toBe(false);
    await store.delete("https://one.example", "file:///work/a");
    expect(await store.get("https://one.example", "file:///work/a")).toBeUndefined();
    expect(await store.get("https://one.example", "file:///work/b")).toBe("ac_one_b");
  });

  it("keeps bindings separate for different workspace folders", async () => {
    const values = new Map<string, unknown>();
    const state = {
      get: (key: string) => values.get(key),
      update: async (key: string, value: unknown) => { if (value === undefined) values.delete(key); else values.set(key, value); },
    };
    const { BindingStore } = await import("../src/workspace/binding-store");
    const store = new BindingStore(state as never);
    await store.set({ serverOrigin: "https://server.example/", projectId: "project-a", workspaceUri: "file:///work/a" });
    await store.set({ serverOrigin: "https://server.example/", projectId: "project-b", workspaceUri: "file:///work/b" });
    expect(store.get("file:///work/a")?.projectId).toBe("project-a");
    expect(store.get("file:///work/b")?.projectId).toBe("project-b");
    await store.delete("file:///work/a");
    expect(store.get("file:///work/b")?.projectId).toBe("project-b");
    await store.delete("file:///work/b");
    expect(store.get("file:///work/b")).toBeUndefined();
  });
});

describe("webview message and task URL validation", () => {
  const projectId = "d0000000-0000-4000-8000-000000000201";
  const taskId = "d0000000-0000-4000-8000-000000000202";

  it("accepts only known host commands and UUID task references", () => {
    expect(parseWebviewMessage({ type: "refresh" })).toEqual({ type: "refresh" });
    expect(parseWebviewMessage({ type: "openTask", taskId })).toEqual({ type: "openTask", taskId });
    expect(parseWebviewMessage({ type: "openTask", taskId: "../../settings/tokens" })).toBeNull();
    expect(parseWebviewMessage({ type: "openUrl", url: "https://attacker.example" })).toBeNull();
    expect(parseWebviewMessage({ type: "runShell", command: "cat ~/.ssh/id_rsa" })).toBeNull();
    expect(parseWebviewMessage(null)).toBeNull();
  });

  it("builds project-scoped work/studio URLs and rejects invalid identifiers", () => {
    expect(projectUrl("http://localhost:3000", projectId, taskId, "work"))
      .toBe(`http://localhost:3000/projects/${projectId}?space=work&task=${taskId}`);
    expect(projectUrl("https://agile.example/base", projectId, taskId, "studio"))
      .toBe(`https://agile.example/base/projects/${projectId}?space=studio&task=${taskId}`);
    expect(projectUrl("http://localhost:3000")).toBe("http://localhost:3000/projects");
    expect(() => projectUrl("http://localhost:3000", "../login", taskId)).toThrow("编号无效");
  });
});
