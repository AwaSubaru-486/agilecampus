import { listProjectActivity } from "@/lib/activity-feed";
import { listProjectBlockers } from "@/lib/blocker";
import { getProjectHealth } from "@/lib/health";
import { listMilestoneProgress, syncMilestoneAchievement } from "@/lib/milestone";
import { buildRelayChains } from "@/lib/relay";
import { buildLiveBoard } from "@/lib/workspace";
import { WorkspaceView } from "../workspace-view";
import { HealthPanel } from "../health-panel";
import { BlockerStrip } from "../blocker-strip";
import { MilestoneCreateForm } from "../milestone-section";

// 现场：谁在推进，哪里需要行动。
//
// 只查「人此刻在干什么」这一路的东西——任务明细、会话历史、
// 档案条目一概不碰。这正是四模式拆开的意义：打开现场不该为了
// 渲染一张「谁在动」的表，先把整个项目读进内存。
//
// agent 状态与在跑任务属于「工作」模式（卡片上要显示 AI 处理中），
// 故此处不查。

export async function LiveSpace({
  actorId,
  projectId,
  relayTasks,
  isAdmin,
}: {
  actorId: string;
  projectId: string;
  /** 接力链需要的最小任务投影，由页面层传入以免重复查询 */
  relayTasks: { id: string; title: string; status: string; assigneeId: string | null }[];
  isAdmin: boolean;
}) {
  // 里程碑达成是自动判定的，读取时顺手同步一次
  // （与 sweepOfflineAgents 同一路数：状态由数据推出，不另存副本）
  await syncMilestoneAchievement(actorId, projectId);

  const [live, relayEvents, milestoneProgress, health, openBlockers] = await Promise.all([
    buildLiveBoard(actorId, projectId),
    listProjectActivity(actorId, projectId, { limit: 300 }),
    listMilestoneProgress(actorId, projectId),
    getProjectHealth(actorId, projectId),
    listProjectBlockers(actorId, projectId, { status: ["open"] }),
  ]);

  const relays = buildRelayChains(
    relayEvents.map((e) => ({
      taskId: e.taskId,
      type: e.type,
      actorId: e.actorId,
      actorName: e.actorName,
      actorKind: e.actorKind,
      payload: e.payload,
      createdAt: e.createdAt,
    })),
    relayTasks,
    { limit: 6 },
  );

  return (
    <div className="space-y-5">
      <WorkspaceView
        projectId={projectId}
        live={live}
        relays={relays}
        milestones={milestoneProgress}
        milestoneForm={<MilestoneCreateForm projectId={projectId} isAdmin={isAdmin} />}
      />

      {/* 求助条紧跟在「正在发生」之下：那里刚说完谁卡住了，
          这里就该能就地搭手 */}
      <BlockerStrip
        projectId={projectId}
        blockers={openBlockers.map((b) => ({
          id: b.id,
          taskId: b.taskId,
          taskTitle: b.taskTitle,
          raisedByName: b.raisedByName,
          reason: b.reason,
          detail: b.detail,
          helpNeeded: b.helpNeeded,
          ageHours: b.ageHours,
        }))}
      />

      <HealthPanel projectId={projectId} health={health} />
    </div>
  );
}
