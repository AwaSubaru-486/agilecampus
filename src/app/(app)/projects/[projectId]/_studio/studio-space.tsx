import Link from "next/link";
import { listConversationMessages, listProjectConversations } from "@/lib/agent/conversation";
import { listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
import { listContextPacks } from "@/lib/context-pack";
import { extractDraftsFromToolCalls, listApprovalRequests, type PersistedDraft } from "@/lib/approval";
import { ChatPanel } from "../chat-panel";
import { selectConversationForWorkspace } from "@/lib/agent/conversation-selection";
import { ExecutionConsole } from "../_console/execution-console";
import type { NormalizedConsoleParams } from "@/lib/console-navigation";

// Agent 协作（studio）：
//
// W03 / Section 3.1 规则：
//   - Agent 协作复用同一个执行台，左侧显示真实运行摘要或带运行的任务；
//     选中后中央仍是同一任务的契约与成果，右侧为所选 Run。
//   - 运行列表无数据时显示“暂无执行记录”，提供回任务列表的入口。
//   - 会话放在所选任务内的“会话与分支”，不再作为独立的默认 AI 首页。
//   - 未关联任务的历史会话移到显式的“项目会话”（?view=chat）次要入口，
//     保留可访问性，不删除历史。

export async function StudioSpace({
  actorId,
  projectId,
  teamId,
  role,
  selectedConversationId,
  selectedTaskId,
  selectedApprovalId,
  view,
  normalized,
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
  /** ?view=chat 时访问项目级历史会话 */
  view?: string | null;
  normalized?: NormalizedConsoleParams;
}) {
  // 显式请求项目会话视图，或仅带 conversation 参数未绑定任务时，降级展示全量聊天工作区
  const showChatPanel = view === "chat" || (selectedConversationId && !selectedTaskId);

  if (showChatPanel) {
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

    const selected = selectConversationForWorkspace(projectConversations, {
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
          drafts: draftsWithApprovals.length > 0 ? draftsWithApprovals : undefined,
        };
      });

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-stroke pb-2">
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${projectId}?space=studio`}
              className="ac-btn-ghost min-h-8 px-2.5 text-xs text-ink-2 hover:text-ink"
            >
              ← 返回 Agent 执行台
            </Link>
            <span className="text-xs text-ink-3">项目历史会话</span>
          </div>
        </div>
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
      </div>
    );
  }

  // 默认：Agent 协作复用同一个执行台（Section 3.1 & W03）
  const defaultNormalized: NormalizedConsoleParams = normalized
    ? { ...normalized, space: "studio" }
    : {
        space: "studio",
        task: selectedTaskId ?? null,
        conversation: null,
        approval: selectedApprovalId,
        run: null,
        panel: null,
        assignee: null,
        priority: null,
        label: null,
        milestone: null,
        overdue: null,
        group: null,
      };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">Agent 协作</h2>
        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${projectId}?space=studio&view=chat`}
            className="ac-btn-ghost min-h-8 px-2.5 text-xs"
          >
            项目会话
          </Link>
          <Link
            href={`/projects/${projectId}?space=work`}
            className="ac-btn-ghost min-h-8 px-2.5 text-xs"
          >
            全部任务
          </Link>
        </div>
      </div>

      <ExecutionConsole
        actorId={actorId}
        projectId={projectId}
        role={role}
        normalized={defaultNormalized}
      />
    </section>
  );
}
