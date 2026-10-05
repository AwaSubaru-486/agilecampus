import type { ProjectSummary, TaskDetail, TaskSummary } from "../types";
import type { PreparedExtractionInputV1 } from "../memory/types";

export type CheckpointIndexPayload = {
  idempotencyKey?: string;
  visibility: "project" | "assignee";
  parentCheckpointId: string | null;
  taskHandoffVersion: number;
  taskUpdatedAt: string;
  repositoryKeyHash: string;
  headSha: string;
  source: { provider: string; providerVersion: string; captureMode: "native" | "context-only" };
  handoffSummary: { goal: string; completed: string[]; remaining: string[]; blocker: string | null; nextAction: string };
  materials: Array<{ id: string; kind: "context" | "transcript"; sha256: string; byteLength: number; transferred: false }>;
};

export type ServerCheckpoint = {
  id: string;
  idempotencyKey?: string | null;
  projectId: string;
  taskId: string;
  creatorId: string;
  visibility: "project" | "assignee";
  parentCheckpointId: string | null;
  taskHandoffVersion: number;
  taskUpdatedAt: string;
  repositoryKeyHash: string;
  headSha: string;
  source: CheckpointIndexPayload["source"];
  handoffSummary: CheckpointIndexPayload["handoffSummary"];
  materials: CheckpointIndexPayload["materials"];
  createdAt: string;
};

export type ServerCheckpointSummary = Pick<ServerCheckpoint,
  "id" | "projectId" | "taskId" | "visibility" | "taskHandoffVersion" | "taskUpdatedAt" | "repositoryKeyHash" | "headSha" | "source" | "handoffSummary" | "createdAt"
> & { materialsCount: number };

export type ProjectHandoffMember = { userId: string; displayName: string; role: "admin" | "teacher" | "student" };
export type CreateHandoffPayload = {
  checkpointId: string;
  toUserId: string;
  expectedTaskUpdatedAt: string;
  expectedHandoffVersion: number;
  idempotencyKey: string;
};
export type ServerHandoff = CreateHandoffPayload & {
  id: string;
  projectId: string;
  taskId: string;
  fromUserId: string;
  state: "offered" | "accepted" | "declined" | "withdrawn" | "superseded";
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

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

  async getCurrentActor(): Promise<{ id: string; displayName: string }> {
    const data = asRecord(await this.request<unknown>("api/extension/v1/me"), "当前账号接口返回格式无效");
    const actor = asRecord(data.actor, "当前账号接口返回格式无效");
    if (typeof actor.id !== "string" || typeof actor.displayName !== "string") {
      throw new ApiError("当前账号接口返回格式无效", null);
    }
    return { id: actor.id, displayName: actor.displayName };
  }

  async extractSessionMemory(input: PreparedExtractionInputV1): Promise<unknown> {
    const data = asRecord(await this.request<unknown>(
      `api/extension/v1/projects/${encodeURIComponent(input.scope.projectId)}/session-memory/extract`,
      { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } },
      120_000,
    ), "记忆提炼接口返回格式无效");
    if (!("candidate" in data)) throw new ApiError("记忆提炼接口未返回候选内容", null);
    return data.candidate;
  }

  async listProjectHandoffMembers(projectId: string): Promise<ProjectHandoffMember[]> {
    const data = asRecord(
      await this.request<unknown>(`api/extension/v1/projects/${encodeURIComponent(projectId)}/members`),
      "项目成员接口返回格式无效",
    );
    if (data.projectId !== projectId || !Array.isArray(data.items)) throw new ApiError("项目成员接口返回格式无效", null);
    return data.items.map((value) => {
      const member = asRecord(value, "项目成员接口包含无效记录");
      if (
        typeof member.userId !== "string" || typeof member.displayName !== "string" ||
        !["admin", "teacher", "student"].includes(String(member.role))
      ) {
        throw new ApiError("项目成员接口包含无效记录", null);
      }
      return { userId: member.userId, displayName: member.displayName, role: member.role as ProjectHandoffMember["role"] };
    });
  }

  async createHandoff(projectId: string, taskId: string, payload: CreateHandoffPayload, expectedFromUserId: string): Promise<ServerHandoff> {
    const value = await this.request<unknown>(
      `api/extension/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/handoffs`,
      { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } },
    );
    return parseCreatedHandoff(value, { projectId, taskId, payload, fromUserId: expectedFromUserId });
  }

  async getHandoff(handoffId: string): Promise<ServerHandoff> {
    const value = await this.request<unknown>(`api/extension/v1/handoffs/${encodeURIComponent(handoffId)}`);
    const handoff = parseServerHandoff(value);
    if (handoff.id !== handoffId) throw new ApiError("服务端返回了其他交接记录", null);
    return handoff;
  }

  async createCheckpointIndex(projectId: string, taskId: string, payload: CheckpointIndexPayload): Promise<ServerCheckpoint> {
    const value = await this.request<unknown>(
      `api/extension/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/checkpoints`,
      { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } },
    );
    return parseServerCheckpoint(value, { projectId, taskId, payload });
  }

  async listCheckpointIndexes(projectId: string, taskId: string): Promise<ServerCheckpointSummary[]> {
    const all: ServerCheckpointSummary[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({ taskId, limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const path = `api/extension/v1/projects/${encodeURIComponent(projectId)}/checkpoints?${query.toString()}`;
      const data = asRecord(await this.request<unknown>(path), "检查点列表返回格式无效");
      if (!Array.isArray(data.items) || typeof data.hasMore !== "boolean" || !(data.nextCursor === null || typeof data.nextCursor === "string")) {
        throw new ApiError("检查点列表返回格式无效", null);
      }
      all.push(...data.items.map(parseServerCheckpointSummary));
      if (!data.hasMore) return all;
      if (typeof data.nextCursor !== "string" || data.nextCursor === cursor) throw new ApiError("检查点列表游标无效，无法安全核对发布结果", null);
      cursor = data.nextCursor;
    }
    throw new ApiError("检查点记录过多，暂不能安全核对发布结果", null);
  }

  async getCheckpointIndex(checkpointId: string): Promise<ServerCheckpoint> {
    return parseServerCheckpoint(await this.request<unknown>(`api/extension/v1/checkpoints/${encodeURIComponent(checkpointId)}`));
  }

  webUrl(path: string): string {
    return new URL(path.replace(/^\/+/, ""), this.baseUrl).toString();
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<T> {
    const token = await this.token();
    if (!token || !token.startsWith("ac_")) throw new ApiError("请连接 AgileCampus Personal API Token", 401);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(new URL(path, this.baseUrl), {
        ...init,
        headers: requestHeaders(token, init.headers),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = response.status === 401 ? "令牌无效或已撤销，请重新连接" :
          response.status === 403 ? "当前账号无权访问此项目" :
          response.status === 409 ? "任务或交接版本已变化，请刷新当前任务后重新确认" :
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

function requestHeaders(token: string, extra?: RequestInit["headers"]): Headers {
  const headers = new Headers(extra);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function parseCreatedHandoff(value: unknown, expected: { projectId: string; taskId: string; payload: CreateHandoffPayload; fromUserId: string }): ServerHandoff {
  const record = parseServerHandoff(value);
  if (
    record.projectId !== expected.projectId || record.taskId !== expected.taskId ||
    record.checkpointId !== expected.payload.checkpointId || record.fromUserId !== expected.fromUserId ||
    record.toUserId !== expected.payload.toUserId || record.expectedTaskUpdatedAt !== expected.payload.expectedTaskUpdatedAt ||
    record.expectedHandoffVersion !== expected.payload.expectedHandoffVersion || record.idempotencyKey !== expected.payload.idempotencyKey
  ) throw new ApiError("服务端交接单与已确认请求不一致", null);
  return record;
}

function parseServerHandoff(value: unknown): ServerHandoff {
  const row = asRecord(value, "交接接口返回格式无效");
  if (
    typeof row.id !== "string" || typeof row.projectId !== "string" || typeof row.taskId !== "string" ||
    typeof row.checkpointId !== "string" || typeof row.fromUserId !== "string" || typeof row.toUserId !== "string" ||
    typeof row.expectedTaskUpdatedAt !== "string" || !Number.isInteger(row.expectedHandoffVersion) ||
    typeof row.idempotencyKey !== "string" || !["offered", "accepted", "declined", "withdrawn", "superseded"].includes(String(row.state)) ||
    !(row.reason === null || typeof row.reason === "string") || typeof row.createdAt !== "string" ||
    !(row.resolvedAt === null || typeof row.resolvedAt === "string")
  ) throw new ApiError("交接接口返回格式无效", null);
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    checkpointId: row.checkpointId,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    expectedTaskUpdatedAt: row.expectedTaskUpdatedAt,
    expectedHandoffVersion: row.expectedHandoffVersion as number,
    idempotencyKey: row.idempotencyKey,
    state: row.state as ServerHandoff["state"],
    reason: row.reason as string | null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt as string | null,
  };
}

function parseServerCheckpointSummary(value: unknown): ServerCheckpointSummary {
  const row = asRecord(value, "检查点列表包含无效记录");
  const source = asRecord(row.source, "检查点列表来源格式无效");
  const summary = asRecord(row.handoffSummary, "检查点列表摘要格式无效");
  if (
    typeof row.id !== "string" || typeof row.projectId !== "string" || typeof row.taskId !== "string" ||
    !["project", "assignee"].includes(String(row.visibility)) || !Number.isInteger(row.taskHandoffVersion) ||
    typeof row.taskUpdatedAt !== "string" || typeof row.repositoryKeyHash !== "string" || typeof row.headSha !== "string" ||
    typeof row.createdAt !== "string" || !Number.isInteger(row.materialsCount) ||
    typeof source.provider !== "string" || typeof source.providerVersion !== "string" ||
    !["native", "context-only"].includes(String(source.captureMode)) ||
    typeof summary.goal !== "string" || !Array.isArray(summary.completed) || !summary.completed.every((entry) => typeof entry === "string") ||
    !Array.isArray(summary.remaining) || !summary.remaining.every((entry) => typeof entry === "string") ||
    !(summary.blocker === null || typeof summary.blocker === "string") || typeof summary.nextAction !== "string"
  ) throw new ApiError("检查点列表包含无效记录", null);
  return {
    id: row.id, projectId: row.projectId, taskId: row.taskId,
    visibility: row.visibility as "project" | "assignee", taskHandoffVersion: row.taskHandoffVersion as number,
    taskUpdatedAt: row.taskUpdatedAt, repositoryKeyHash: row.repositoryKeyHash, headSha: row.headSha,
    source: { provider: source.provider, providerVersion: source.providerVersion, captureMode: source.captureMode as "native" | "context-only" },
    handoffSummary: { goal: summary.goal, completed: summary.completed as string[], remaining: summary.remaining as string[], blocker: summary.blocker as string | null, nextAction: summary.nextAction },
    createdAt: row.createdAt, materialsCount: row.materialsCount as number,
  };
}

function parseServerCheckpoint(value: unknown, expected?: { projectId: string; taskId: string; payload: CheckpointIndexPayload }): ServerCheckpoint {
  const row = asRecord(value, "检查点接口返回格式无效");
  const source = asRecord(row.source, "检查点来源格式无效");
  const summary = asRecord(row.handoffSummary, "检查点摘要格式无效");
  if (
    typeof row.id !== "string" || typeof row.projectId !== "string" || typeof row.taskId !== "string" ||
    typeof row.creatorId !== "string" || !["project", "assignee"].includes(String(row.visibility)) ||
    !(row.parentCheckpointId === null || typeof row.parentCheckpointId === "string") ||
    !Number.isInteger(row.taskHandoffVersion) || typeof row.taskUpdatedAt !== "string" ||
    typeof row.repositoryKeyHash !== "string" || typeof row.headSha !== "string" || typeof row.createdAt !== "string" ||
    typeof source.provider !== "string" || typeof source.providerVersion !== "string" ||
    !["native", "context-only"].includes(String(source.captureMode)) ||
    typeof summary.goal !== "string" || !Array.isArray(summary.completed) || !summary.completed.every((entry) => typeof entry === "string") ||
    !Array.isArray(summary.remaining) || !summary.remaining.every((entry) => typeof entry === "string") ||
    !(summary.blocker === null || typeof summary.blocker === "string") || typeof summary.nextAction !== "string" ||
    !Array.isArray(row.materials)
  ) throw new ApiError("检查点接口返回格式无效", null);
  const materials = row.materials.map((value) => {
    const material = asRecord(value, "检查点材料格式无效");
    if (
      typeof material.id !== "string" || !["context", "transcript"].includes(String(material.kind)) ||
      typeof material.sha256 !== "string" || !Number.isInteger(material.byteLength) ||
      material.transferred !== false
    ) throw new ApiError("检查点材料格式无效", null);
    return { id: material.id, kind: material.kind as "context" | "transcript", sha256: material.sha256, byteLength: material.byteLength as number, transferred: false as const };
  });
  if (row.idempotencyKey !== undefined && row.idempotencyKey !== null && typeof row.idempotencyKey !== "string") {
    throw new ApiError("检查点幂等键格式无效", null);
  }
  const parsed: ServerCheckpoint = {
    id: row.id,
    idempotencyKey: (row.idempotencyKey as string | null | undefined) ?? null,
    projectId: row.projectId,
    taskId: row.taskId,
    creatorId: row.creatorId,
    visibility: row.visibility as "project" | "assignee",
    parentCheckpointId: row.parentCheckpointId as string | null,
    taskHandoffVersion: row.taskHandoffVersion as number,
    taskUpdatedAt: row.taskUpdatedAt,
    repositoryKeyHash: row.repositoryKeyHash,
    headSha: row.headSha,
    source: { provider: source.provider, providerVersion: source.providerVersion, captureMode: source.captureMode as "native" | "context-only" },
    handoffSummary: {
      goal: summary.goal, completed: summary.completed as string[], remaining: summary.remaining as string[],
      blocker: summary.blocker as string | null, nextAction: summary.nextAction,
    },
    materials,
    createdAt: row.createdAt,
  };
  if (expected && (
    parsed.projectId !== expected.projectId || parsed.taskId !== expected.taskId ||
    parsed.visibility !== expected.payload.visibility || parsed.parentCheckpointId !== expected.payload.parentCheckpointId ||
    parsed.taskHandoffVersion !== expected.payload.taskHandoffVersion || parsed.taskUpdatedAt !== expected.payload.taskUpdatedAt ||
    parsed.repositoryKeyHash !== expected.payload.repositoryKeyHash || parsed.headSha !== expected.payload.headSha ||
    JSON.stringify(parsed.source) !== JSON.stringify(expected.payload.source) ||
    JSON.stringify(parsed.handoffSummary) !== JSON.stringify(expected.payload.handoffSummary) ||
    JSON.stringify(parsed.materials) !== JSON.stringify(expected.payload.materials)
  )) throw new ApiError("服务端检查点与已确认内容不一致", null);
  if (expected?.payload.idempotencyKey && parsed.idempotencyKey !== expected.payload.idempotencyKey) {
    throw new ApiError("服务端检查点未确认相同幂等键", null);
  }
  return parsed;
}
