import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, getTaskDetail, updateTask } from "@/lib/task";
import { createContextPack } from "@/lib/context-pack";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({
    email: "owner@example.com",
    password: "password123",
    name: "owner",
  });
  const team = await createTeam(owner.id, "东吴实验室");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, project };
}

describe("交接契约", () => {
  beforeEach(resetDb);

  it("创建任务时保存目标、完成条件、证据要求与响应期限", async () => {
    const { owner, project } = await scene();
    const task = await createTask(owner.id, project.id, {
      title: "整理接口文档",
      handoffBrief: "让下一位同学可以直接接着联调",
      doneCriteria: ["列出请求参数", "补一个失败示例"],
      requiredEvidence: ["link", "test"],
      responseDueAt: new Date("2026-09-22T09:00:00Z"),
    });
    const detail = await getTaskDetail(owner.id, task.id);
    expect(detail.handoffBrief).toContain("直接接着联调");
    expect(detail.doneCriteria).toEqual(["列出请求参数", "补一个失败示例"]);
    expect(detail.requiredEvidence).toEqual(["link", "test"]);
    expect(detail.responseDueAt).toBeInstanceOf(Date);
  });

  it("完成条件超过 8 条时拒绝，避免交接协议变成另一份需求文档", async () => {
    const { owner, project } = await scene();
    await expect(
      createTask(owner.id, project.id, {
        title: "过长协议",
        doneCriteria: Array.from({ length: 9 }, (_, i) => `条件 ${i}`),
      }),
    ).rejects.toThrow("最多 8 条");
  });

  it("交接契约只能关联当前项目的冻结上下文包", async () => {
    const { owner, project } = await scene();
    const other = await createProject(owner.id, project.teamId, { name: "另一个项目" });
    const pack = await createContextPack(owner.id, other.id, {
      title: "另一个项目背景",
      status: "frozen",
      sources: [{ sourceType: "manual", snapshot: { note: "不能串项目" } }],
    });
    await expect(
      createTask(owner.id, project.id, {
        title: "错误关联",
        contextPackId: pack.pack.id,
      }),
    ).rejects.toThrow("当前项目的冻结上下文包");
  });

  it("更新任务时可以替换交接契约，但仍校验上下文包状态", async () => {
    const { owner, project } = await scene();
    const task = await createTask(owner.id, project.id, { title: "待交接" });
    await updateTask(owner.id, task.id, {
      handoffBrief: "改成可交接",
      doneCriteria: ["有复现步骤"],
      requiredEvidence: ["demo"],
    });
    const detail = await getTaskDetail(owner.id, task.id);
    expect(detail.handoffBrief).toBe("改成可交接");
    expect(detail.requiredEvidence).toEqual(["demo"]);
  });
});
