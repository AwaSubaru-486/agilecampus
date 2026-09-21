import { listConversationMessages, listProjectConversations } from "@/lib/agent/conversation";
import { listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
import { listContextPacks } from "@/lib/context-pack";
import { extractDraftsFromToolCalls, listApprovalRequests, type PersistedDraft } from "@/lib/approval";
import { ChatPanel } from "../chat-panel";

// 协同室：人与 AI 怎样探索、比较、确认。
//
// 名字不再叫「聊天」——它不是聊天页。Commit 6/7 会把它重做成
// 三栏（探索树 / 工作台 / 上下文与待确认），此处先接住现有的会话能力，
// 保证功能不丢。
//
// 会话历史是全项目最重的数据，只在进这一模式时才查。

export async function StudioSpace({
  actorId,
  projectId,
  teamId,
  selectedConversationId,
  selectedTaskId,
  selectedApprovalId,
}: {
  actorId: string;
  projectId: string;
  teamId: string;
  /** `?conversation=` 指定打开哪一条 */
  selectedConversationId: string | null;
  /** 从任务上下文进入协同室时，预选这条任务 */
  selectedTaskId: string | null;
  /** 从协作页/今日页跳入时，直接打开这条 AI 审批。 */
  selectedApprovalId: string | null;
}) {
  const [projectMilestones, projectTasks, members, projectConversations, contextPacks, approvalRows] = await Promise.all([
    listProjectMilestones(actorId, projectId),
    listProjectTasks(actorId, projectId),
    listTeamMembers(teamId),
    listProjectConversations(actorId, projectId),
    listContextPacks(actorId, projectId),
    listApprovalRequests(actorId, projectId),
  ]);

  const approvalsByMessage = new Map<string, { id: string; status: (typeof approvalRows)[number]["status"] }[]>();
  for (const approval of approvalRows) {
    if (!approval.sourceMessageId) continue;
    const current = approvalsByMessage.get(approval.sourceMessageId) ?? [];
    current[approval.ordinal] = { id: approval.id, status: approval.status };
    approvalsByMessage.set(approval.sourceMessageId, current);
  }

  const selectedApproval = selectedApprovalId
    ? approvalRows.find((approval) => approval.id === selectedApprovalId) ?? null
    : null;

  // 指定了审批时优先打开它的来源会话；普通进入则打开 URL 指定或最近一条。
  const selected =
    projectConversations.find((c) => c.id === selectedConversationId) ??
    projectConversations.find((c) => c.id === selectedApproval?.sourceConversationId) ??
    projectConversations[0] ??
    null;

  const history = selected ? await listConversationMessages(actorId, selected.id) : [];
  const initialMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const drafts = extractDraftsFromToolCalls(m.toolCalls);
      const approvalIds = approvalsByMessage.get(m.id) ?? [];
      const draftsWithApprovals: PersistedDraft[] = drafts.map((draft, ordinal) => ({
        ...draft,
        approvalId: approvalIds[ordinal]?.id,
        approvalStatus: approvalIds[ordinal]?.status,
      }));
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        authorName: m.authorName,
        sourceMessageId: m.sourceMessageId,
        drafts: draftsWithApprovals.length > 0 ? draftsWithApprovals : undefined,
      };
    });

  return (
    <ChatPanel
      projectId={projectId}
      currentUserId={actorId}
      initialConversations={projectConversations.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }))}
      initialConversationId={selected?.id ?? null}
      initialMessages={initialMessages}
      members={members}
      milestones={projectMilestones.map((m) => ({ id: m.id, name: m.title }))}
      tasks={projectTasks.map((t) => ({ id: t.id, name: t.title }))}
      initialTaskId={selectedTaskId}
      initialApproval={selectedApproval}
      initialContextPacks={contextPacks.map((pack) => ({
        id: pack.id,
        title: pack.title,
        status: pack.status,
        summary: pack.summary,
        frozenAt: pack.frozenAt?.toISOString() ?? null,
      }))}
    />
  );
}
