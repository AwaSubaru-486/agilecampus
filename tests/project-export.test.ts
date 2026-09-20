import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, getProjectForUser } from "@/lib/project";
import { claimTask, createTask, reviewTask, submitTask } from "@/lib/task";
import { createEvidenceItem } from "@/lib/evidence";
import { createEntry } from "@/lib/entry";
import { buildProjectExport, renderProjectExportMarkdown } from "@/lib/project-export";
import { resetDb } from "./helpers";

describe("项目档案导出", () => {
  beforeEach(resetDb);

  it("聚合已验收任务、证据、档案与活动，并保留 AI/隐私边界", async () => {
    const owner = await createUser({ email: "export-owner@example.com", password: "password123", name: "导出负责人" });
    const team = await createTeam(owner.id, "档案团队");
    const reviewer = await createUser({ email: "export-reviewer@example.com", password: "password123", name: "导出教师" });
    await joinTeam(reviewer.id, team.inviteCode);
    await updateMemberRole(owner.id, team.id, reviewer.id, "teacher");
    const project = await createProject(owner.id, team.id, { name: "导出验收" });
    expect((await getProjectForUser(reviewer.id, project.id))?.role).toBe("teacher");
    const task = await createTask(owner.id, project.id, {
      title: "交付导出接口",
      assigneeId: owner.id,
      handoffBrief: "生成可复用档案",
    });
    await claimTask(owner.id, task.id, { commitmentNote: "先完成接口并验证" });
    await createEvidenceItem(owner.id, task.id, {
      type: "test",
      label: "测试结果",
      value: "52 tests passed",
    });
    await submitTask(owner.id, task.id, { completionNote: "接口已完成" });
    await reviewTask(reviewer.id, task.id, { decision: "accept", note: "证据完整" });
    await createEntry(owner.id, project.id, {
      type: "deliverable",
      title: "接口文档",
      url: "https://example.com/api-docs",
      taskId: task.id,
    });

    const pack = await buildProjectExport(owner.id, project.id);
    expect(pack.summary).toMatchObject({ taskTotal: 1, doneCount: 1, evidenceCount: 1, entryCount: 1 });
    expect(pack.tasks[0].evidence[0].label).toBe("测试结果");
    expect(pack.entries[0].title).toBe("接口文档");
    expect(pack.privacy.excluded).toEqual(["private_conversations", "tokens", "hidden_prompts"]);
    expect(pack).not.toHaveProperty("messages");

    const markdown = renderProjectExportMarkdown(pack);
    expect(markdown).toContain("# 导出验收｜项目档案");
    expect(markdown).toContain("测试结果");
    expect(markdown).toContain("私人会话、token、隐藏 prompt 永不导出");
  });
});
