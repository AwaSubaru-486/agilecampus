import { listConversationMessages, listProjectConversations } from "@/lib/agent/conversation";
import { listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
import { listContextPacks } from "@/lib/context-pack";
import { extractDraftsFromToolCalls, listApprovalRequests, type PersistedDraft } from "@/lib/approval";
import { ChatPanel } from "../chat-panel";
import Link from "@/components/feedback-link";
import { selectConversationForWorkspace } from "@/lib/agent/conversation-selection";
import type { NormalizedConsoleParams } from "@/lib/console-navigation";

// AI 助手直接展示项目对话，保留任务、会话和审批深链接。

export async function StudioSpace({
  actorId,
  projectId,
  teamId,
  selectedConversationId,
  selectedTaskId,
  selectedApprovalId,
  role,
  forceNewConversation = false,
}: {
  actorId: string;
  projectId: string;
  teamId: string;
  role: "admin" | "teacher" | "student";
  /** `?conversation=` 指定打开哪一条 */
  selectedConversationId: string | null;
  /** 从任务上下文进入协同室时，预选这条任务 */
  selectedTaskId: string | null;
  /** 从协作页/今日页跳入时，直接打开这条 AI 审批。 */
  selectedApprovalId: string | null;
  /** 兼容旧项目对话链接。 */
  view?: string | null;
  normalized?: NormalizedConsoleParams;
  forceNewConversation?: boolean;
}) {
  // 所有 AI 入口使用同一个项目对话工作区。
  {
    const [projectMilestones, projectTasks, members, projectConversations, contextPacks, approvalRows] =
      await Promise.all([
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

    const selected = forceNewConversation ? null : selectConversationForWorkspace(projectConversations, {
      conversationId: selectedConversationId,
      approvalConversationId: selectedApproval?.sourceConversationId,
      taskId: selectedTaskId,
    });

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
          taskMemoryVersionId: m.taskMemoryVersionId,
          drafts: draftsWithApprovals.length > 0 ? draftsWithApprovals : undefined,
        };
      });

    return (
      <div data-tour="ai-workspace" className="space-y-3">
        <header><h2 className="text-lg font-semibold text-ink">AI 助手</h2><p className="mt-1 text-sm text-ink-3">围绕项目和任务展开对话。</p></header>
        {selectedTaskId && <Link href={`/projects/${projectId}?space=work&task=${selectedTaskId}`} className="ac-btn-ghost min-h-8 px-2.5 text-xs text-ink-2">返回任务</Link>}
        <ChatPanel
          key={`${selectedTaskId ?? "project"}:${selected?.id ?? "new"}`}
          canWriteMemory={role !== "teacher"}
          projectId={projectId}
          currentUserId={actorId}
          initialConversations={projectConversations.filter((c) => !selectedTaskId || c.taskId === selectedTaskId).map((c) => ({
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
      </div>
    );
  }

}
