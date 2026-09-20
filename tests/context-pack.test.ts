import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { createConversation } from "@/lib/agent/conversation";
import {
  buildContextPackPreview,
  createContextPack,
  freezeContextPack,
  getContextPackForUser,
} from "@/lib/context-pack";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, student, project };
}

describe("AI 上下文包", () => {
  beforeEach(resetDb);

  it("按固定顺序裁剪并报告 omitted 数量", async () => {
    const { owner, project } = await scene();
    const preview = await buildContextPackPreview(
      owner.id,
      project.id,
      Array.from({ length: 22 }, (_, index) => ({
        sourceType: "manual" as const,
        label: `补充 ${index + 1}`,
        snapshot: { text: `事实 ${index + 1}` },
      })),
    );
    expect(preview.items).toHaveLength(20);
    expect(preview.items[0].label).toBe("补充 1");
    expect(preview.items[19].label).toBe("补充 20");
    expect(preview.omitted).toBe(2);
  });

  it("私人会话不能被其他项目成员加入上下文", async () => {
    const { owner, student, project } = await scene();
    const conversation = await createConversation(student.id, project.id, {
      title: "个人草稿",
      visibility: "private",
    });
    await expect(
      buildContextPackPreview(owner.id, project.id, [
        { sourceType: "conversation", sourceId: conversation.id },
      ]),
    ).rejects.toThrow("没有权限");
  });

  it("冻结后来源更新会返回 stale，但不会改写快照", async () => {
    const { owner, project } = await scene();
    const task = await createTask(owner.id, project.id, { title: "定义实验" });
    const created = await createContextPack(owner.id, project.id, {
      title: "实验启动上下文",
      sources: [{ sourceType: "task", sourceId: task.id }],
      status: "frozen",
    });
    await updateTask(owner.id, task.id, { title: "定义实验（已更新）" });

    const view = await getContextPackForUser(owner.id, created.pack.id);
    expect(view.stale).toBe(true);
    expect(view.items[0].stale).toBe(true);
    expect((view.items[0].snapshot as { title: string }).title).toBe("定义实验");
  });

  it("草稿只能冻结一次，冻结包不能原地再冻结", async () => {
    const { owner, project } = await scene();
    const pack = await createContextPack(owner.id, project.id, {
      title: "待确认背景",
      sources: [{ sourceType: "manual", snapshot: { note: "先确认" } }],
    });
    expect(pack.pack.status).toBe("draft");
    const frozen = await freezeContextPack(owner.id, pack.pack.id);
    expect(frozen.status).toBe("frozen");
    await expect(freezeContextPack(owner.id, pack.pack.id)).rejects.toThrow("只有草稿");
  });

  it("非项目成员不能读取上下文包", async () => {
    const { owner, project } = await scene();
    const outsider = await makeUser("outsider@example.com");
    const pack = await createContextPack(owner.id, project.id, {
      title: "团队背景",
      sources: [{ sourceType: "manual", snapshot: { note: "内部" } }],
    });
    await expect(getContextPackForUser(outsider.id, pack.pack.id)).rejects.toThrow("没有权限");
  });
});
