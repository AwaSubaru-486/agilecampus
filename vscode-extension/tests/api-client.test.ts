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
