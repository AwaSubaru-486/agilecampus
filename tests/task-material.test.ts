import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, getTaskDetail, updateTask } from "@/lib/task";
import { createConversation } from "@/lib/agent/conversation";
import { createContextPack } from "@/lib/context-pack";
import { bindTaskContextPack } from "@/lib/task-material";
import { createProjectMemory, listProjectMemories } from "@/lib/project-memory";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({ name: "组长", email: "owner@example.com", password: "password123" });
  const student = await createUser({ name: "组员", email: "student@example.com", password: "password123" });
  const outsider = await createUser({ name: "外部用户", email: "outsider@example.com", password: "password123" });
  const team = await createTeam(owner.id, "测试组");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "资料入口" });
  const task = await createTask(owner.id, project.id, { title: "目标任务", handoffBrief: "原始要求", doneCriteria: ["测试通过"], requiredEvidence: ["test"] });
  return { owner, student, outsider, project, task };
}

describe("任务资料入口", () => {
  beforeEach(resetDb);
  it("绑定和解除只更新资料，保留要求并更新交接版本", async () => {
    const { owner, student, project, task } = await scene();
    const { pack } = await createContextPack(student.id, project.id, { title: "资料", taskId: task.id, status: "frozen", sources: [{ sourceType: "task", sourceId: task.id }] });
    await bindTaskContextPack(student.id, project.id, task.id, pack.id);
    const bound = await getTaskDetail(owner.id, task.id);
    expect(bound.contextPackId).toBe(pack.id);
    expect(bound.handoffBrief).toBe("原始要求");
    expect(bound.doneCriteria).toEqual(["测试通过"]);
    expect(bound.requiredEvidence).toEqual(["test"]);
    expect(bound.handoffVersion).toBe(task.handoffVersion + 1);
    await bindTaskContextPack(student.id, project.id, task.id, null);
    const unbound = await getTaskDetail(owner.id, task.id);
    expect(unbound.contextPackId).toBeNull();
    expect(unbound.handoffVersion).toBe(task.handoffVersion + 2);
  });
  it("拒绝草稿、其他任务和其他项目的资料包", async () => {
    const { owner, project, task } = await scene();
    const draft = await createContextPack(owner.id, project.id, { title: "草稿", sources: [{ sourceType: "project" }] });
    await expect(bindTaskContextPack(owner.id, project.id, task.id, draft.pack.id)).rejects.toThrow("先冻结");
    const otherTask = await createTask(owner.id, project.id, { title: "其他任务" });
    const other = await createContextPack(owner.id, project.id, { title: "其他任务资料", taskId: otherTask.id, status: "frozen", sources: [{ sourceType: "project" }] });
    await expect(bindTaskContextPack(owner.id, project.id, task.id, other.pack.id)).rejects.toThrow("不属于");
    const otherProject = await createProject(owner.id, project.teamId, { name: "其他项目" });
    const wrongProject = await createContextPack(owner.id, otherProject.id, { title: "其他项目资料", status: "frozen", sources: [{ sourceType: "project" }] });
    await expect(bindTaskContextPack(owner.id, project.id, task.id, wrongProject.pack.id)).rejects.toThrow("不属于");
    await expect(bindTaskContextPack(owner.id, otherProject.id, task.id, null)).rejects.toThrow("任务不属于");
  });
  it("拒绝无权读取的私人资料和非项目成员", async () => {
    const { owner, student, outsider, project, task } = await scene();
    const conversation = await createConversation(student.id, project.id, { title: "私人会话", visibility: "private", taskId: task.id });
    const { pack } = await createContextPack(student.id, project.id, { title: "私人资料", conversationId: conversation.id, status: "frozen", sources: [{ sourceType: "conversation", sourceId: conversation.id }] });
    await expect(bindTaskContextPack(owner.id, project.id, task.id, pack.id)).rejects.toThrow("权限");
    await expect(bindTaskContextPack(outsider.id, project.id, task.id, null)).rejects.toThrow("权限");
    expect((await getTaskDetail(owner.id, task.id)).contextPackId).toBeNull();
  });
  it("验收中和完成的任务不允许更换资料", async () => {
    const { owner, project, task } = await scene();
    await updateTask(owner.id, task.id, { status: "doing" });
    await updateTask(owner.id, task.id, { status: "review" });
    await expect(bindTaskContextPack(owner.id, project.id, task.id, null)).rejects.toThrow("退回修改");
    await updateTask(owner.id, task.id, { status: "done" });
    await expect(bindTaskContextPack(owner.id, project.id, task.id, null)).rejects.toThrow("退回修改");
  });
  it("记忆关联当前任务，拒绝外部成员和跨项目任务", async () => {
    const { owner, student, outsider, project, task } = await scene();
    const input = { taskId: task.id, title: "决策依据", content: "保留接口兼容性", category: "decision" as const };
    await createProjectMemory(student.id, project.id, input);
    expect(await listProjectMemories(owner.id, project.id, { taskId: task.id })).toHaveLength(1);
    await expect(createProjectMemory(outsider.id, project.id, input)).rejects.toThrow("无权");
    const other = await createProject(owner.id, project.teamId, { name: "其他项目" });
    await expect(createProjectMemory(owner.id, other.id, input)).rejects.toThrow("不属于");
  });
});
