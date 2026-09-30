import { validateServerUrl } from "../agilecampus/api-client";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function projectUrl(baseUrl: string, projectId?: string, taskId?: string, space: "work" | "studio" = "work"): string {
  const base = validateServerUrl(baseUrl);
  if (!projectId) return new URL("projects", base).toString();
  if (!uuidPattern.test(projectId) || (taskId && !uuidPattern.test(taskId))) {
    throw new Error("项目或任务编号无效");
  }
  const url = new URL(`projects/${encodeURIComponent(projectId)}`, base);
  url.searchParams.set("space", space);
  if (taskId) url.searchParams.set("task", taskId);
  return url.toString();
}
