export type TaskHelpRequest = { id: string; projectId: string; taskId: string | null; taskTitle: string | null };

export function helpAnchor(request: TaskHelpRequest) {
  return request.taskId ? `task-${request.taskId}` : `help-${request.id}`;
}

export function collaborationHelpHref(request: TaskHelpRequest) {
  const params = new URLSearchParams({ project: request.projectId });
  params.set(request.taskId ? "task" : "help", request.taskId ?? request.id);
  return `/collaboration?${params.toString()}#${helpAnchor(request)}`;
}

/** Several requests about the same task share one destination; global requests stay distinct. */
export function groupTaskHelp<T extends TaskHelpRequest>(requests: T[]) {
  const grouped = new Map<string, { anchor: string; projectId: string; taskId: string | null; title: string; requests: T[] }>();
  for (const request of requests) {
    const anchor = helpAnchor(request);
    const key = `${request.projectId}:${anchor}`;
    const group = grouped.get(key);
    if (group) group.requests.push(request);
    else grouped.set(key, { anchor, projectId: request.projectId, taskId: request.taskId, title: request.taskTitle ?? "项目求助", requests: [request] });
  }
  return [...grouped.values()];
}
