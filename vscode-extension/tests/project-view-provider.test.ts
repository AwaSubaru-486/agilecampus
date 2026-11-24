import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn(async () => undefined) },
  extensions: { getExtension: () => null },
  workspace: { workspaceFolders: [] },
  Uri: { parse: (value: string) => ({ fsPath: new URL(value).pathname }) },
}));

import { ProjectViewProvider } from "../src/views/project-view-provider";
import type { ProjectSnapshot, TaskDetail, TaskSummary } from "../src/types";
import type { WorkspaceBinding } from "../src/workspace/binding-store";

type TestProvider = {
  activeBinding(): WorkspaceBinding | undefined;
  clientFor(binding: WorkspaceBinding): Promise<{
    getProject(projectId: string): Promise<{ id: string; name: string; teamId: string; myRole: string }>;
    listTasks(projectId: string): Promise<TaskSummary[]>;
    listProjects(): Promise<Array<{ id: string; name: string; status: string; teamId: string; teamName: string; taskTotal: number; doneCount: number }>>;
    getTask(taskId: string): Promise<TaskDetail>;
  } | null>;
  snapshot: ProjectSnapshot;
  detailCache: Map<string, TaskDetail>;
  view: { webview: { postMessage(message: unknown): void } } | undefined;
  refresh(): Promise<void>;
  openTaskDetail(taskId: string): Promise<void>;
};

function memoryState() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string) => values.get(key),
    update: async (key: string, value: unknown) => value === undefined ? values.delete(key) : values.set(key, value),
    keys: () => [...values.keys()],
  };
}

function createProvider() {
  const context = {
    globalState: memoryState(), workspaceState: memoryState(), secrets: {}, subscriptions: [], globalStorageUri: { fsPath: "/test/global-storage" },
  };
  const provider = new ProjectViewProvider({} as never, context as never);
  const subject = provider as unknown as TestProvider;
  const messages: unknown[] = [];
  subject.view = { webview: { postMessage: (message) => messages.push(message) } };
  return { subject, messages };
}

const task: TaskSummary = {
  id: "task-1", title: "任务", status: "doing", priority: "high", dueDate: null,
  assigneeId: null, assigneeName: "成员", handoffBrief: "v1", doneCriteria: [],
  requiredEvidence: [], updatedAt: "2026-09-30T00:00:00.000Z",
};

function project(id: string, teamName: string) {
  return { id, name: `项目 ${id}`, status: "active", teamId: `team-${id}`, teamName, taskTotal: 1, doneCount: 0 };
}

describe("project view request lifecycle", () => {
  it("does not let a delayed project response overwrite the selected project's team", async () => {
    const { subject } = createProvider();
    let binding: WorkspaceBinding = { serverOrigin: "https://server.example/", projectId: "A", workspaceUri: "file:///work/a" };
    subject.activeBinding = () => binding;

    let finishProjectA!: (rows: ReturnType<typeof project>[]) => void;
    let projectARequested!: () => void;
    const requestedA = new Promise<void>((resolve) => { projectARequested = resolve; });
    const delayedA = new Promise<ReturnType<typeof project>[]>((resolve) => { finishProjectA = resolve; });
    subject.clientFor = async (requestedBinding) => ({
      getProject: async (id) => ({ id, name: `项目 ${id}`, teamId: `team-${id}`, myRole: "member" }),
      listTasks: async () => [],
      listProjects: async () => {
        if (requestedBinding.projectId === "A") { projectARequested(); return delayedA; }
        return [project("B", "团队 B")];
      },
      getTask: async () => { throw new Error("not used"); },
    });

    const refreshA = subject.refresh();
    await requestedA;
    binding = { ...binding, projectId: "B" };
    const refreshB = subject.refresh();
    finishProjectA([project("A", "团队 A")]);
    await refreshA;
    await refreshB;

    expect(subject.snapshot).toMatchObject({ projectId: "B", projectName: "项目 B", teamName: "团队 B" });
  });

  it("discards cached task handoff details after a successful refresh", async () => {
    const { subject, messages } = createProvider();
    const binding: WorkspaceBinding = { serverOrigin: "https://server.example/", projectId: "A", workspaceUri: "file:///work/a" };
    subject.activeBinding = () => binding;
    let currentTask = task;
    subject.clientFor = async () => ({
      getProject: async (id) => ({ id, name: "项目 A", teamId: "team-A", myRole: "member" }),
      listTasks: async () => [currentTask],
      listProjects: async () => [project("A", "团队 A")],
      getTask: async (id) => ({
        ...currentTask, id, projectId: "A", description: null, completionNote: null,
        responseDueAt: null, handoffVersion: currentTask.updatedAt === task.updatedAt ? 1 : 2,
        committedHandoffVersion: null,
      }),
    });

    await subject.refresh();
    await subject.openTaskDetail(task.id);
    expect(messages.at(-1)).toMatchObject({ type: "taskDetail", detail: { handoffVersion: 1 } });

    currentTask = { ...task, handoffBrief: "v2 交接要求", updatedAt: "2026-10-01T00:00:00.000Z" };
    await subject.refresh();
    expect(subject.detailCache.size).toBe(0);
    await subject.openTaskDetail(task.id);
    expect(messages.at(-1)).toMatchObject({ type: "taskDetail", detail: { handoffBrief: "v2 交接要求", handoffVersion: 2 } });
  });
});
