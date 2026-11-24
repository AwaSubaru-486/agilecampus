import { describe, expect, it } from "vitest";
import { summarizeOfficeTasks } from "@/lib/office-task-summary";

describe("办公室黑板个人任务统计", () => {
  it("只统计当前视角用户的实际任务，分开待办、进行中、待验收和完成", () => {
    const task = (status: string, assigneeId: string | null = "me", isTaskGroup = false) => ({ status, assigneeId, isTaskGroup });
    expect(summarizeOfficeTasks([task("todo"), task("doing"), task("doing"), task("review"), task("done"), task("todo", "peer"), task("doing", null), task("doing", "me", true), task("unknown")], "me"))
      .toEqual({ todo: 1, doing: 2, review: 1, done: 1, total: 5 });
  });
  it("空任务显示全零，预览视角不会混入操作账号的任务", () => {
    expect(summarizeOfficeTasks([], "me")).toEqual({ todo: 0, doing: 0, review: 0, done: 0, total: 0 });
    expect(summarizeOfficeTasks([{ assigneeId: "actor", isTaskGroup: false, status: "todo" }, { assigneeId: "preview", isTaskGroup: false, status: "review" }], "preview"))
      .toEqual({ todo: 0, doing: 0, review: 1, done: 0, total: 1 });
  });
});
