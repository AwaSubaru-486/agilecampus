import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { claimTask, createTask, getTaskDetail, submitTask, updateTask } from "@/lib/task";
import { createContextPack } from "@/lib/context-pack";
import { createEvidenceItem, listTaskEvidence } from "@/lib/evidence";
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

  it("提交前检查必需证据，证据补齐后才进入待验收", async () => {
    const { owner, project } = await scene();
    const task = await createTask(owner.id, project.id, {
      title: "补齐验收材料",
      requiredEvidence: ["link", "test"],
    });
    await expect(submitTask(owner.id, task.id, { completionNote: "已完成" })).rejects.toThrow(
      "还缺少必需证据",
    );

    await createEvidenceItem(owner.id, task.id, {
      type: "link",
      label: "演示地址",
      value: "https://example.com/demo",
    });
    await expect(submitTask(owner.id, task.id, { completionNote: "已完成" })).rejects.toThrow(
      "还缺少必需证据：test",
    );

    await createEvidenceItem(owner.id, task.id, {
      type: "test",
      label: "测试结果",
      value: "vitest 通过",
    });
    const submitted = await submitTask(owner.id, task.id, { completionNote: "已完成" });
    expect(submitted.status).toBe("review");
    expect(await listTaskEvidence(owner.id, task.id)).toHaveLength(2);
  });

  it("链接证据必须是真实 URL", async () => {
    const { owner, project } = await scene();
    const task = await createTask(owner.id, project.id, { title: "链接校验" });
    await expect(
      createEvidenceItem(owner.id, task.id, {
        type: "link",
        label: "错误链接",
        value: "不是链接",
      }),
    ).rejects.toThrow("必须以 http:// 或 https:// 开头");
  });

  it("交接契约变化后，旧承诺必须重新确认", async () => {
    const { owner, project } = await scene();
    const task = await createTask(owner.id, project.id, {
      title: "按契约交付",
      assigneeId: owner.id,
      handoffBrief: "完成首版接口",
    });
    await claimTask(owner.id, task.id, { commitmentNote: "先完成接口再补测试" });

    const changed = await updateTask(owner.id, task.id, {
      handoffBrief: "完成首版接口并补齐测试",
    });
    expect(changed.handoffVersion).toBe(2);
    expect(changed.committedHandoffVersion).toBe(1);
    await expect(submitTask(owner.id, task.id, { completionNote: "已完成" })).rejects.toThrow(
      "交接契约已更新",
    );

    const recommitted = await claimTask(owner.id, task.id, { commitmentNote: "按新版契约补齐测试" });
    expect(recommitted.committedHandoffVersion).toBe(2);
    expect((await submitTask(owner.id, task.id, { completionNote: "已完成" })).status).toBe("review");
  });
});
