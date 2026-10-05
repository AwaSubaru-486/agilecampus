import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests } from "@/db/schema";
import { createConversation, persistTurn } from "@/lib/agent/conversation";
import {
  createApprovalRequests,
  listApprovalRequests,
  recoverStaleApproval,
  resolveApprovalRequest,
} from "@/lib/approval";
import { createProject, listProjectMilestones } from "@/lib/project";
import { createTeam, joinTeam } from "@/lib/team";
import { createUser } from "@/lib/user";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({
    email: "approval-owner@example.com",
    password: "password123",
    name: "审批负责人",
  });
  const team = await createTeam(owner.id, "审批测试组");
  const teammate = await createUser({
    email: "approval-teammate@example.com",
    password: "password123",
    name: "队友",
  });
  await joinTeam(teammate.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "审批流测试" });
  const conversation = await createConversation(owner.id, project.id, { title: "审批来源" });
  const persisted = await persistTurn(conversation.id, "请拟一个里程碑", "已生成草案", [], owner.id);
  return { owner, teammate, project, conversation, messageId: persisted.assistantMessage!.id };
}

describe("持久化 AI 审批", () => {
  beforeEach(resetDb);

  it("同一消息的草案幂等登记，且可被项目成员列出", async () => {
    const { owner, project, conversation, messageId } = await scene();
    const drafts = [{ __draft: true as const, tool: "create_milestone" as const, draft: { title: "首轮评审" } }];
    const first = await createApprovalRequests(owner.id, project.id, conversation.id, messageId, drafts);
    const second = await createApprovalRequests(owner.id, project.id, conversation.id, messageId, drafts);
    expect(first).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect((await listApprovalRequests(owner.id, project.id, "pending"))).toHaveLength(1);
  });

  it("拒绝只改变审批状态，不写入业务表", async () => {
    const { owner, project, conversation, messageId } = await scene();
    const [approval] = await createApprovalRequests(
      owner.id,
      project.id,
      conversation.id,
      messageId,
      [{ __draft: true as const, tool: "create_milestone" as const, draft: { title: "不落库" } }],
    );
    const rejected = await resolveApprovalRequest(owner.id, approval.id, {
      decision: "reject",
      note: "需要再讨论",
    });
    expect(rejected.status).toBe("rejected");
    expect(await listProjectMilestones(owner.id, project.id)).toHaveLength(0);
  });

  it("私有会话来源不会泄露给队友", async () => {
    const { owner, teammate, project } = await scene();
    const privateConversation = await createConversation(owner.id, project.id, {
      title: "个人方案",
      visibility: "private",
    });
    const persisted = await persistTurn(privateConversation.id, "只给自己看", "私有草案", [], owner.id);
    await createApprovalRequests(
      owner.id,
      project.id,
      privateConversation.id,
      persisted.assistantMessage!.id,
      [{ __draft: true as const, tool: "create_milestone" as const, draft: { title: "私有" } }],
    );
    expect(await listApprovalRequests(teammate.id, project.id)).toHaveLength(0);
    await expect(
      resolveApprovalRequest(teammate.id, (await listApprovalRequests(owner.id, project.id))[0].id, {
        decision: "approve",
      }),
    ).rejects.toThrow("没有权限");
  });

  it("高权限动作在详情中明确显示角色限制，并阻止低权限成员执行", async () => {
    const { owner, teammate, project, conversation, messageId } = await scene();
    const [approval] = await createApprovalRequests(
      owner.id,
      project.id,
      conversation.id,
      messageId,
      [{ __draft: true as const, tool: "create_milestone" as const, draft: { title: "需要组长确认" } }],
    );
    const teammateView = (await listApprovalRequests(teammate.id, project.id))[0];
    expect(teammateView.canResolve).toBe(false);
    expect(teammateView.permissionReason).toContain("组长");
    await expect(resolveApprovalRequest(teammate.id, approval.id, { decision: "approve" })).rejects.toThrow("组长");
  });

  it("确认通过统一 commitDraft 执行，并保留执行结果", async () => {
    const { owner, project, conversation, messageId } = await scene();
    const [approval] = await createApprovalRequests(
      owner.id,
      project.id,
      conversation.id,
      messageId,
      [{ __draft: true as const, tool: "create_milestone" as const, draft: { title: "首轮评审" } }],
    );
    const executed = await resolveApprovalRequest(owner.id, approval.id, { decision: "approve" });
    expect(executed.status).toBe("executed");
    expect(executed.result).toEqual({ committed: 1, conflicts: [] });
    expect((await listProjectMilestones(owner.id, project.id)).map((item) => item.title)).toEqual([
      "首轮评审",
    ]);
    const replay = await resolveApprovalRequest(owner.id, approval.id, { decision: "approve" });
    expect(replay.id).toBe(approval.id);
    expect((await listProjectMilestones(owner.id, project.id))).toHaveLength(1);
  });

  it("执行状态超时只能人工恢复，不会自动重放", async () => {
    const { owner, project, conversation, messageId } = await scene();
    const [approval] = await createApprovalRequests(
      owner.id,
      project.id,
      conversation.id,
      messageId,
      [{ __draft: true as const, tool: "create_milestone" as const, draft: { title: "核对后再重试" } }],
    );
    await db
      .update(approvalRequests)
      .set({ status: "executing", updatedAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(approvalRequests.id, approval.id));
    const recovered = await recoverStaleApproval(owner.id, approval.id);
    expect(recovered.status).toBe("failed");
    expect(recovered.error).toContain("状态未知");
    expect(await listProjectMilestones(owner.id, project.id)).toHaveLength(0);
  });
});
