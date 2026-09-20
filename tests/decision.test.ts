import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createConversation, persistTurn } from "@/lib/agent/conversation";
import { createAgent } from "@/lib/agent-member";
import {
  createDecision,
  listProjectDecisions,
  resolveDecision,
  supersedeDecision,
} from "@/lib/decision";
import { resetDb } from "./helpers";

async function makeUser(email: string, name = email.split("@")[0]) {
  return createUser({ email, password: "password123", name });
}

describe("Decision Ledger", () => {
  beforeEach(resetDb);

  it("AI 只能提出 proposed，人确认时必须选择方案并写理由", async () => {
    const owner = await makeUser("decision-owner@example.com");
    const team = await createTeam(owner.id, "决策团队");
    const reviewer = await makeUser("decision-reviewer@example.com", "教师");
    await joinTeam(reviewer.id, team.inviteCode);
    await updateMemberRole(owner.id, team.id, reviewer.id, "teacher");
    const project = await createProject(owner.id, team.id, { name: "决策项目" });
    const agent = await createAgent(owner.id, team.id, {
      name: "决策助手",
      provider: "test",
    });

    const decision = await createDecision(agent.userId, project.id, {
      title: "缓存方案",
      question: "首版是否引入缓存？",
      options: [
        { label: "引入", benefits: ["更快"], risks: ["复杂度增加"] },
        { label: "暂不引入", benefits: ["简单"], risks: ["后续可能返工"] },
      ],
    });
    expect(decision.status).toBe("proposed");
    await expect(
      resolveDecision(agent.userId, decision.id, {
        status: "accepted",
        selectedOptionId: decision.options[0].id,
        rationale: "AI 不得自行确认",
      }),
    ).rejects.toThrow("AI 只能提出决策");

    await expect(
      resolveDecision(reviewer.id, decision.id, {
        status: "accepted",
        rationale: "还没选方案",
      }),
    ).rejects.toThrow("必须选择一个选项");
    await resolveDecision(reviewer.id, decision.id, {
      status: "accepted",
      selectedOptionId: decision.options[1].id,
      rationale: "先控制实现复杂度",
    });
    await expect(
      resolveDecision(reviewer.id, decision.id, {
        status: "rejected",
        rationale: "不应覆盖已确认的审计记录",
      }),
    ).rejects.toThrow("只有待确认的决策");
    expect((await listProjectDecisions(owner.id, project.id))[0].status).toBe("accepted");
  });

  it("替代决策保留旧链路，私人会话来源不进入导出视图", async () => {
    const owner = await makeUser("decision-private-owner@example.com");
    const teammate = await makeUser("decision-private-teammate@example.com");
    const team = await createTeam(owner.id, "私密来源团队");
    await joinTeam(teammate.id, team.inviteCode);
    const project = await createProject(owner.id, team.id, { name: "来源隔离" });
    const conversation = await createConversation(owner.id, project.id, {
      title: "私人思考",
      visibility: "private",
    });
    const turn = await persistTurn(conversation.id, "内部草稿", "内部回复", [], owner.id);
    const oldDecision = await createDecision(owner.id, project.id, {
      title: "旧方案",
      question: "是否采用方案 A？",
      options: [
        {
          label: "方案 A",
          evidenceRefs: [{ type: "message", id: turn.assistantMessage!.id }],
        },
      ],
      sourceConversationId: conversation.id,
      sourceMessageId: turn.assistantMessage?.id,
    });
    const newDecision = await createDecision(owner.id, project.id, {
      title: "新方案",
      question: "是否采用方案 B？",
      options: [{ label: "方案 B" }],
    });
    await supersedeDecision(owner.id, oldDecision.id, newDecision.id);

    const ownerView = await listProjectDecisions(owner.id, project.id);
    expect(ownerView.find((item) => item.id === oldDecision.id)?.status).toBe("superseded");
    expect(ownerView.find((item) => item.id === oldDecision.id)?.sourceConversationId).toBe(conversation.id);
    expect(ownerView.find((item) => item.id === oldDecision.id)?.options[0].evidenceRefs).toEqual([
      { type: "message", id: turn.assistantMessage!.id },
    ]);

    const teammateView = await listProjectDecisions(teammate.id, project.id);
    expect(teammateView.find((item) => item.id === oldDecision.id)?.sourceConversationId).toBeNull();
    expect(teammateView.find((item) => item.id === oldDecision.id)?.options[0].evidenceRefs).toEqual([]);
  });
});
