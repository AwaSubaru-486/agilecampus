import { listConversationMessages, listProjectConversations } from "@/lib/agent/conversation";
import { listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
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
}: {
  actorId: string;
  projectId: string;
  teamId: string;
  /** `?conversation=` 指定打开哪一条 */
  selectedConversationId: string | null;
}) {
  const [projectMilestones, projectTasks, members, projectConversations] = await Promise.all([
    listProjectMilestones(actorId, projectId),
    listProjectTasks(actorId, projectId),
    listTeamMembers(teamId),
    listProjectConversations(actorId, projectId),
  ]);

  // 指定了会话就打开它，否则落到最近一条
  const selected =
    projectConversations.find((c) => c.id === selectedConversationId) ??
    projectConversations[0] ??
    null;

  const history = selected ? await listConversationMessages(actorId, selected.id) : [];
  const initialMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      authorName: m.authorName,
      sourceMessageId: m.sourceMessageId,
    }));

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
    />
  );
}
