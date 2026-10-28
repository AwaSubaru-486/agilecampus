const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type TaskMemoryLink = { action: "publish" | "continue" | "review"; serverOrigin: string; projectId: string; taskId: string; versionId?: string; requestId?: string; attemptId?: string };
export function parseTaskMemoryLink(value: string): TaskMemoryLink {
  const url = new URL(value);
  if (url.protocol !== "vscode:" || url.host !== "agilecampus.agilecampus-vscode" || url.pathname !== "/task-memory" || url.hash ||
      [...url.searchParams.keys()].some((key) => !["action", "server", "project", "task", "version", "request", "attempt"].includes(key)) ||
      [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) throw new Error("任务记忆链接无效");
  const action = url.searchParams.get("action");
  const projectId = url.searchParams.get("project") ?? ""; const taskId = url.searchParams.get("task") ?? "";
  const versionId = url.searchParams.get("version") ?? undefined;
  const requestId = url.searchParams.get("request") ?? undefined;
  const attemptId = url.searchParams.get("attempt") ?? undefined;
  const server = new URL(url.searchParams.get("server") ?? "");
  if (!["http:", "https:"].includes(server.protocol) || server.username || server.password || server.search || server.hash || server.pathname !== "/" ||
      server.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(server.hostname) ||
      !UUID.test(projectId) || !UUID.test(taskId) || !["publish", "continue", "review"].includes(action ?? "") ||
      action === "continue" && (!versionId || !UUID.test(versionId) || attemptId !== undefined) ||
      action === "publish" && (versionId !== undefined || requestId !== undefined || attemptId !== undefined) ||
      action === "review" && (!attemptId || !UUID.test(attemptId) || versionId !== undefined || requestId !== undefined) ||
      requestId !== undefined && !UUID.test(requestId)) throw new Error("任务记忆链接参数无效");
  return { action: action as TaskMemoryLink["action"], serverOrigin: server.toString(), projectId, taskId, ...(versionId ? { versionId } : {}), ...(requestId ? { requestId } : {}), ...(attemptId ? { attemptId } : {}) };
}
export function buildTaskMemoryLink(input: TaskMemoryLink): string {
  const url = new URL("vscode://agilecampus.agilecampus-vscode/task-memory");
  url.searchParams.set("action", input.action); url.searchParams.set("server", new URL(input.serverOrigin).toString());
  url.searchParams.set("project", input.projectId); url.searchParams.set("task", input.taskId);
  if (input.versionId) url.searchParams.set("version", input.versionId);
  if (input.requestId) url.searchParams.set("request", input.requestId);
  if (input.attemptId) url.searchParams.set("attempt", input.attemptId);
  parseTaskMemoryLink(url.toString());
  return url.toString();
}
