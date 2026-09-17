import { db, type DbTx } from "@/db";
import { activityEvents, type ActivityType } from "@/db/schema";
import { statusLabel } from "./task-status";

// 活动流的写入侧。
//
// 刻意不 import ./project —— project.ts 要记事件（建项目/里程碑/改项目），
// 若此处反向引它的 getProjectForUser 即成循环。读取侧另置 lib/activity-feed.ts。
// 本模块只依赖 db 与 schema，位于依赖图底层，谁都可以放心引。

type Exec = DbTx | typeof db;

export type EventInput = {
  projectId: string;
  actorId: string;
  type: ActivityType;
  taskId?: string | null;
  /** 冻结的中文摘要，含当时的任务标题与人名，日后不随改名而变 */
  summary: string;
  payload?: Record<string, unknown> | null;
};

// 记一条事件。
//
// 调用方须传入自己正在用的 exec（事务内传 tx，否则传 db），使事件与业务写入同生共死。
//
// 刻意不吞异常：事件与业务写入同事务，写事件失败就该整笔回滚。
// 若在此 try/catch 掉，业务落库成功而事件缺失，贡献记录便悄悄失真——
// 那正是「零填写」最不能容忍的失败形态（没人会发现少了什么）。
export async function recordEvent(exec: Exec, e: EventInput): Promise<void> {
  await exec.insert(activityEvents).values({
    projectId: e.projectId,
    actorId: e.actorId,
    type: e.type,
    taskId: e.taskId ?? null,
    summary: e.summary,
    payload: e.payload ?? null,
  });
}

// 摘要措辞集中于此：各处口径一致，且纯函数可直接单测，无需碰库。
export const describe = {
  taskCreated: (title: string) => `创建了任务「${title}」`,
  taskStatusChanged: (title: string, from: string, to: string) =>
    `将「${title}」由${statusLabel(from)}改为${statusLabel(to)}`,
  taskAssigned: (title: string, to: string | null) =>
    to ? `将「${title}」指派给 ${to}` : `取消了「${title}」的指派`,
  taskUpdated: (title: string) => `修改了「${title}」`,
  taskDeleted: (title: string) => `删除了任务「${title}」`,
  taskLabeled: (title: string, names: string[]) =>
    names.length > 0 ? `为「${title}」贴上标签：${names.join("、")}` : `清空了「${title}」的标签`,
  taskDependencyChanged: (title: string, count: number) =>
    count > 0 ? `为「${title}」设置了 ${count} 个后置任务` : `清空了「${title}」的后置任务`,
  // 承诺与验收。承诺那句话进摘要：它是「答应做什么」的公开锚点，
  // 事后对照兑现与否就看它；但完整承诺也留在任务卡上常驻展示。
  taskClaimed: (title: string, commitment: string) => `认领「${title}」，承诺${commitment}`,
  taskSubmitted: (title: string) => `提交了「${title}」待验收`,
  taskAccepted: (title: string) => `验收通过「${title}」`,
  taskRejected: (title: string, note: string) => `退回「${title}」：${note}`,
  milestoneCreated: (title: string) => `新建里程碑「${title}」`,
  projectCreated: (name: string) => `创建了项目「${name}」`,
  projectUpdated: (name: string) => `更新了项目「${name}」`,
};

export type ActivityRow = {
  id: string;
  type: ActivityType;
  summary: string | null;
  taskId: string | null;
  actorId: string | null;
  actorName: string | null;
  payload: unknown;
  createdAt: Date;
};
