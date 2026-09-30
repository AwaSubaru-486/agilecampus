import type { ProjectSummary, TaskDetail, TaskSummary } from "../types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "ApiError";
  }
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(message, null);
  return value as Record<string, unknown>;
}

export function validateServerUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("服务地址格式无效"); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash) {
    throw new Error("服务地址只允许 http/https，且不能包含账号、查询参数或片段");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) throw new Error("非本机服务必须使用 HTTPS");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

type FetchLike = typeof fetch;

export class AgileCampusApiClient {
  readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly token: () => Promise<string | undefined>,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 10_000,
  ) {
    this.baseUrl = validateServerUrl(baseUrl);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const data = asRecord(await this.request<unknown>("api/agent/projects"), "项目接口返回格式无效");
    if (!Array.isArray(data.projects)) throw new ApiError("项目接口返回格式无效", null);
    return data.projects.map((row) => {
      const project = asRecord(row, "项目接口包含无效记录");
      if (
        typeof project.id !== "string" || typeof project.name !== "string" ||
        typeof project.status !== "string" || typeof project.teamId !== "string" ||
        typeof project.teamName !== "string" || !Number.isFinite(project.taskTotal) ||
        !Number.isFinite(project.doneCount)
      ) throw new ApiError("项目接口包含无效记录", null);
      return {
        id: project.id, name: project.name, status: project.status,
        teamId: project.teamId, teamName: project.teamName,
        taskTotal: project.taskTotal as number, doneCount: project.doneCount as number,
      };
    });
  }

  async getProject(projectId: string): Promise<{ id: string; name: string; teamId: string; myRole: string }> {
    const data = asRecord(
      await this.request<unknown>(`api/agent/projects/${encodeURIComponent(projectId)}`),
      "项目接口返回格式无效",
    );
    if (typeof data.id !== "string" || typeof data.name !== "string" || typeof data.teamId !== "string") {
      throw new ApiError("项目接口返回格式无效", null);
    }
    return { id: data.id, name: data.name, teamId: data.teamId, myRole: String(data.myRole ?? "unknown") };
  }

  async listTasks(projectId: string): Promise<TaskSummary[]> {
    const data = asRecord(
      await this.request<unknown>(`api/agent/projects/${encodeURIComponent(projectId)}/tasks`),
      "任务接口返回格式无效",
    );
    if (!Array.isArray(data.tasks)) throw new ApiError("任务接口返回格式无效", null);
    return data.tasks.map((row) => {
      const task = asRecord(row, "任务接口包含无效记录");
      if (typeof task.id !== "string" || typeof task.title !== "string" || typeof task.status !== "string") {
        throw new ApiError("任务接口包含无效记录", null);
      }
      return {
        id: task.id, title: task.title, status: task.status,
        priority: typeof task.priority === "string" ? task.priority : "unknown",
        dueDate: typeof task.dueDate === "string" ? task.dueDate : null,
        assigneeId: typeof task.assigneeId === "string" ? task.assigneeId : null,
        assigneeName: typeof task.assigneeName === "string" ? task.assigneeName : null,
        handoffBrief: typeof task.handoffBrief === "string" ? task.handoffBrief : null,
        doneCriteria: Array.isArray(task.doneCriteria) ? task.doneCriteria.filter((item): item is string => typeof item === "string") : [],
        requiredEvidence: Array.isArray(task.requiredEvidence) ? task.requiredEvidence.filter((item): item is string => typeof item === "string") : [],
        updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : "",
      };
    });
  }

  async getTask(taskId: string): Promise<TaskDetail> {
    const data = asRecord(
      await this.request<unknown>(`api/agent/tasks/${encodeURIComponent(taskId)}`),
      "任务接口返回格式无效",
    );
    if (
      typeof data.id !== "string" || typeof data.projectId !== "string" ||
      typeof data.title !== "string" || typeof data.status !== "string"
    ) {
      throw new ApiError("任务接口返回格式无效", null);
    }
    return {
      id: data.id, projectId: data.projectId, title: data.title, status: data.status,
      priority: typeof data.priority === "string" ? data.priority : "unknown",
      dueDate: typeof data.dueDate === "string" ? data.dueDate : null,
      assigneeId: typeof data.assigneeId === "string" ? data.assigneeId : null,
      assigneeName: typeof data.assigneeName === "string" ? data.assigneeName : null,
      handoffBrief: typeof data.handoffBrief === "string" ? data.handoffBrief : null,
      doneCriteria: Array.isArray(data.doneCriteria) ? data.doneCriteria.filter((item): item is string => typeof item === "string") : [],
      requiredEvidence: Array.isArray(data.requiredEvidence) ? data.requiredEvidence.filter((item): item is string => typeof item === "string") : [],
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
      description: typeof data.description === "string" ? data.description : null,
      completionNote: typeof data.completionNote === "string" ? data.completionNote : null,
      responseDueAt: typeof data.responseDueAt === "string" ? data.responseDueAt : null,
      handoffVersion: typeof data.handoffVersion === "number" ? data.handoffVersion : 1,
      committedHandoffVersion: typeof data.committedHandoffVersion === "number" ? data.committedHandoffVersion : null,
    };
  }

  webUrl(path: string): string {
    return new URL(path.replace(/^\/+/, ""), this.baseUrl).toString();
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.token();
    if (!token || !token.startsWith("ac_")) throw new ApiError("请连接 AgileCampus Personal API Token", 401);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(new URL(path, this.baseUrl), {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = response.status === 401 ? "令牌无效或已撤销，请重新连接" :
          response.status === 403 ? "当前账号无权访问此项目" :
          response.status >= 500 ? "AgileCampus 服务暂不可用" : `AgileCampus 请求失败（${response.status}）`;
        throw new ApiError(message, response.status);
      }
      try { return await response.json() as T; }
      catch { throw new ApiError("AgileCampus 返回了无效数据", response.status); }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError("连接超时，请检查服务地址后重试", null);
      if (error instanceof TypeError) throw new ApiError("无法连接 AgileCampus 服务，请检查网络或服务地址", null);
      throw new ApiError("网络请求失败，请重试", null);
    } finally {
      clearTimeout(timeout);
    }
  }
}
