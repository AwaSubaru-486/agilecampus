import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, projects, tasks, teamMembers, users, type BlockerReason } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { getProjectForUser, listMyProjects } from "./project";
import { listProjectBlockers } from "./blocker";
import { suggestHelpers } from "./collaboration";
import { BLOCKER_REASON_LABEL } from "./blocker-labels";
import { isActive, isInFlight, isInReview } from "./task-status";
import { today } from "./today";

// 项目健康度。
//
// 设计立场：健康度不是仪表盘，是待办清单。
// 给一个分数或一个红黄绿灯毫无用处——看的人知道了「项目有问题」，
// 却不知道问题在哪、该谁去动。故每一处风险都必须回答三件事：
//   为什么红（whyRed）／现在该做什么（action）／谁来做（ownerId）
// 少了任何一件，这条风险就只是噪声。
//
// 检测全部走确定性规则，不碰 AI：规则可单测、可复现、不会误报。
// AI 只在最后一步把这些条目译成人话，且它改不了一个数字、换不掉一个人名。

/** 判定阈值。集中于此，写进报告时可当作设计参数讨论。 */
export const STALE_DAYS = 7;
export const OVERLOAD_IN_FLIGHT = 5;
export const REVIEW_LATENCY_DAYS = 3;
/** 新建任务的头两天没有负责人不算风险——刚排上的活还没派出去是常态，
 *  立刻报警只会让人对警报脱敏。 */
export const UNASSIGNED_GRACE_DAYS = 2;
/** 逾期超过这几天算高危 */
export const OVERDUE_HIGH_DAYS = 3;

export type HealthSignal =
  | "overdue"
  | "unassigned"
  | "stale"
  | "overload"
  | "blocked"
  | "review_latency";

export type HealthIssue = {
  signal: HealthSignal;
  severity: "high" | "medium";
  /** 为什么红 */
  whyRed: string;
  /** 现在该做什么 */
  action: string;
  /** 谁来做。null 表示该由谁来做本身就需要人判断 */
  ownerId: string | null;
  ownerName: string | null;
  /** 涉及的任务，供界面下钻 */
  taskIds: string[];
  /** 支撑这条判断的具体事实，界面据以列出任务名 */
  evidence: string[];
};

export type HealthTaskInput = {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  updatedAtMs: number;
  submittedAtMs: number | null;
  createdAtMs: number;
};

export type HealthBlockerInput = {
  id: string;
  taskTitle: string | null;
  raisedByName: string | null;
  reason: BlockerReason;
  ageHours: number;
};

export type HealthMember = { id: string; name: string };

export type HealthInput = {
  tasks: HealthTaskInput[];
  blockers: HealthBlockerInput[];
  members: HealthMember[];
  /** YYYY-MM-DD，由调用方传入以便单测 */
  today: string;
  nowMs: number;
  /** 项目 admin 的 userId：无人负责的任务由他定夺 */
  adminId: string | null;
  adminName: string | null;
  /** 阻塞类的「谁来做」由协作推荐给出。blockerId → 推荐人 */
  blockerHelpers?: Record<string, { userId: string; name: string }>;
};

const DAY_MS = 86_400_000;

function daysBetween(aMs: number, bMs: number): number {
  return Math.floor((aMs - bMs) / DAY_MS);
}

/** 从 "YYYY-MM-DD" 到今日的天数差。已经比过字符串，此处只算差值。 */
function overdueDays(dueDate: string, todayStr: string): number {
  const d = Date.parse(`${dueDate}T00:00:00Z`);
  const t = Date.parse(`${todayStr}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(t)) return 0;
  return Math.floor((t - d) / DAY_MS);
}

/**
 * 确定性规则。纯函数——不碰库、不取系统时钟，故可逐条单测。
 *
 * 六类信号各自独立成条，不合并成一个分数：合并会丢掉「哪一件事该谁做」，
 * 而那恰恰是这张面板存在的全部理由。
 */
export function evaluateProjectHealth(input: HealthInput): HealthIssue[] {
  const { tasks: list, blockers: bl, members, today: day, nowMs } = input;
  const issues: HealthIssue[] = [];
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  // --- 逾期 ---
  const overdue = list.filter((t) => isActive(t.status) && t.dueDate && t.dueDate < day);
  if (overdue.length > 0) {
    const worst = Math.max(...overdue.map((t) => overdueDays(t.dueDate!, day)));
    const owner = overdue.find((t) => t.assigneeId) ?? null;
    issues.push({
      signal: "overdue",
      severity: worst >= OVERDUE_HIGH_DAYS ? "high" : "medium",
      whyRed: `${overdue.length} 项已过截止日，最久的一项超期 ${worst} 天`,
      action: owner ? "找负责人确认还差什么，必要时重排截止日" : "先指定负责人，再定新的截止日",
      ownerId: owner?.assigneeId ?? input.adminId,
      ownerName: owner?.assigneeName ?? input.adminName,
      taskIds: overdue.map((t) => t.id),
      evidence: overdue.slice(0, 3).map((t) => `${t.title}（${t.dueDate}）`),
    });
  }

  // --- 无人负责（过宽限期才算）---
  const unassigned = list.filter(
    (t) =>
      isInFlight(t.status) &&
      !t.assigneeId &&
      daysBetween(nowMs, t.createdAtMs) >= UNASSIGNED_GRACE_DAYS,
  );
  if (unassigned.length > 0) {
    issues.push({
      signal: "unassigned",
      severity: "medium",
      whyRed: `${unassigned.length} 项任务建了 ${UNASSIGNED_GRACE_DAYS} 天以上仍无人负责`,
      action: "在组会上认领，或直接指派给合适的人",
      ownerId: input.adminId,
      ownerName: input.adminName,
      taskIds: unassigned.map((t) => t.id),
      evidence: unassigned.slice(0, 3).map((t) => t.title),
    });
  }

  // --- 长期未更新 ---
  const stale = list.filter(
    (t) => isActive(t.status) && daysBetween(nowMs, t.updatedAtMs) >= STALE_DAYS,
  );
  if (stale.length > 0) {
    const worst = Math.max(...stale.map((t) => daysBetween(nowMs, t.updatedAtMs)));
    issues.push({
      signal: "stale",
      severity: "medium",
      whyRed: `${stale.length} 项任务已 ${STALE_DAYS} 天以上没有任何更新，最久 ${worst} 天`,
      action: "请负责人回一句进展；若其实没在推进，就把状态改回去或换人",
      ownerId: stale[0].assigneeId,
      ownerName: stale[0].assigneeName,
      taskIds: stale.map((t) => t.id),
      evidence: stale.slice(0, 3).map((t) => `${t.title}（${daysBetween(nowMs, t.updatedAtMs)} 天未动）`),
    });
  }

  // --- 成员负荷 ---
  const loadBy = new Map<string, number>();
  for (const t of list) {
    if (t.assigneeId && isInFlight(t.status)) {
      loadBy.set(t.assigneeId, (loadBy.get(t.assigneeId) ?? 0) + 1);
    }
  }
  const overloaded = [...loadBy.entries()].filter(([, n]) => n >= OVERLOAD_IN_FLIGHT);
  if (overloaded.length > 0) {
    issues.push({
      signal: "overload",
      severity: "medium",
      whyRed: overloaded
        .map(([id, n]) => `${nameOf.get(id) ?? "某位成员"}手上压着 ${n} 个在办任务`)
        .join("；"),
      action: "把其中几项转给当前较空的人，或推迟到下一阶段",
      // 调配是组长的活，不是过载者自己的——告诉当事人「你太忙了」没有用
      ownerId: input.adminId,
      ownerName: input.adminName,
      taskIds: list.filter((t) => t.assigneeId && loadBy.get(t.assigneeId)! >= OVERLOAD_IN_FLIGHT).map((t) => t.id),
      evidence: overloaded.map(([id, n]) => `${nameOf.get(id) ?? "某成员"}：${n} 项在办`),
    });
  }

  // --- 阻塞 ---
  if (bl.length > 0) {
    const oldest = Math.max(...bl.map((b) => b.ageHours));
    const helper = input.blockerHelpers?.[bl[0].id] ?? null;
    issues.push({
      signal: "blocked",
      severity: "high",
      whyRed: `${bl.length} 条求助尚未解决，最久的一条悬了 ${Math.floor(oldest / 24) || 1} 天`,
      action: helper
        ? `请 ${helper.name} 搭把手；解决后把求助标记为已解决`
        : "看一眼别人卡在哪，能搭手就搭手；解决后标记为已解决",
      // 这一条是健康度与协作推荐的交汇点：「谁来做」不查表填名字，
      // 而是直接取推荐的排序结果
      ownerId: helper?.userId ?? null,
      ownerName: helper?.name ?? null,
      taskIds: [],
      evidence: bl
        .slice(0, 3)
        .map((b) => `${b.raisedByName ?? "某成员"}：${BLOCKER_REASON_LABEL[b.reason]}`),
    });
  }

  // --- 验收延迟 ---
  const slowReview = list.filter(
    (t) =>
      isInReview(t.status) &&
      t.submittedAtMs !== null &&
      daysBetween(nowMs, t.submittedAtMs) >= REVIEW_LATENCY_DAYS,
  );
  if (slowReview.length > 0) {
    const worst = Math.max(...slowReview.map((t) => daysBetween(nowMs, t.submittedAtMs!)));
    issues.push({
      signal: "review_latency",
      severity: "medium",
      whyRed: `${slowReview.length} 项交付已等验收 ${REVIEW_LATENCY_DAYS} 天以上，最久 ${worst} 天`,
      action: "组长或教师尽快判一下：通过就结，要改就写清改什么",
      // 球在验收人脚下，故催的是 admin——这正是待验收任务不再催负责人的理由
      ownerId: input.adminId,
      ownerName: input.adminName,
      taskIds: slowReview.map((t) => t.id),
      evidence: slowReview.slice(0, 3).map((t) => `${t.title}（交了 ${daysBetween(nowMs, t.submittedAtMs!)} 天）`),
    });
  }

  // 严重者居前，同级按信号固定次序，保证同一份数据每次渲染顺序一致
  const order: HealthSignal[] = ["blocked", "overdue", "review_latency", "unassigned", "stale", "overload"];
  return issues.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1) ||
      order.indexOf(a.signal) - order.indexOf(b.signal),
  );
}

export type HealthResult = {
  issues: HealthIssue[];
  tasksScanned: number;
  healthy: boolean;
};

// 取数壳：把库里的行喂给纯函数。
export async function getProjectHealth(
  actorId: string,
  projectId: string,
): Promise<HealthResult> {
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();

  const [rows, members, openBlockers] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        assigneeId: tasks.assigneeId,
        assigneeName: users.name,
        dueDate: tasks.dueDate,
        updatedAtMs: sql<number>`extract(epoch from ${tasks.updatedAt}) * 1000`,
        submittedAtMs: sql<number | null>`case when ${tasks.submittedAt} is null then null else extract(epoch from ${tasks.submittedAt}) * 1000 end`,
        createdAtMs: sql<number>`extract(epoch from ${tasks.createdAt}) * 1000`,
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(eq(tasks.projectId, projectId)),
    db
      .select({ id: teamMembers.userId, name: users.name, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, access.project.teamId)),
    listProjectBlockers(actorId, projectId, { status: ["open"] }),
  ]);

  const admin = members.find((m) => m.role === "admin") ?? null;

  // 阻塞那条的「谁来做」取自协作推荐：没有关联任务的阻塞，
  // 用其第一条所述原因去问推荐算法
  const blockerHelpers: Record<string, { userId: string; name: string }> = {};
  for (const b of openBlockers) {
    const [top] = await suggestHelpers(actorId, {
      projectId,
      taskId: b.taskId,
      reason: b.reason,
    });
    if (top) blockerHelpers[b.id] = { userId: top.userId, name: top.name };
  }

  const issues = evaluateProjectHealth({
    tasks: rows.map((r) => ({
      ...r,
      updatedAtMs: Number(r.updatedAtMs),
      submittedAtMs: r.submittedAtMs === null ? null : Number(r.submittedAtMs),
      createdAtMs: Number(r.createdAtMs),
    })),
    blockers: openBlockers.map((b) => ({
      id: b.id,
      taskTitle: b.taskTitle,
      raisedByName: b.raisedByName,
      reason: b.reason,
      ageHours: b.ageHours,
    })),
    members: members.map((m) => ({ id: m.id, name: m.name })),
    today: today(),
    nowMs: Date.now(),
    adminId: admin?.id ?? null,
    adminName: admin?.name ?? null,
    blockerHelpers,
  });

  return { issues, tasksScanned: rows.length, healthy: issues.length === 0 };
}

/** 一个项目一行，供跨项目总览。只为排序与计数，不带逐条明细。 */
export type ProjectHealthSummary = {
  projectId: string;
  projectName: string;
  teamName: string;
  issueCount: number;
  highCount: number;
  topIssue: string | null;
};

// 跨项目：组长与教师扫一眼「哪个组需要我说话」。
//
// 沿用 listMyProjects 的聚合范式：先取我所在的团队，一次批量查，
// 不在循环里逐个项目发查询——项目一多就是 N+1。
export async function listProjectsHealth(actorId: string): Promise<ProjectHealthSummary[]> {
  const mine = await listMyProjects(actorId);
  if (mine.length === 0) return [];

  const projectIds = mine.map((p) => p.id);
  const day = today();
  const nowMs = Date.now();

  const [rows, adminRows, blockerRows, memberRows] = await Promise.all([
    db
      .select({
        projectId: tasks.projectId,
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        assigneeId: tasks.assigneeId,
        assigneeName: users.name,
        dueDate: tasks.dueDate,
        updatedAtMs: sql<number>`extract(epoch from ${tasks.updatedAt}) * 1000`,
        submittedAtMs: sql<number | null>`case when ${tasks.submittedAt} is null then null else extract(epoch from ${tasks.submittedAt}) * 1000 end`,
        createdAtMs: sql<number>`extract(epoch from ${tasks.createdAt}) * 1000`,
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(inArray(tasks.projectId, projectIds)),
    db
      .select({ projectId: projects.id, teamId: projects.teamId })
      .from(projects)
      .where(inArray(projects.id, projectIds)),
    db
      .select({
        projectId: blockers.projectId,
        id: blockers.id,
        reason: blockers.reason,
        ageHours: sql<number>`floor(extract(epoch from (now() - ${blockers.createdAt})) / 3600)::int`,
      })
      .from(blockers)
      .where(and(eq(blockers.status, "open"), inArray(blockers.projectId, projectIds)))
      .orderBy(desc(blockers.createdAt)),
    db
      .select({ id: teamMembers.userId, name: users.name, teamId: teamMembers.teamId, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id)),
  ]);

  const adminByTeam = new Map<string, { id: string; name: string }>();
  for (const m of memberRows) {
    if (m.role === "admin" && !adminByTeam.has(m.teamId)) {
      adminByTeam.set(m.teamId, { id: m.id, name: m.name });
    }
  }
  const teamOfProject = new Map(adminRows.map((p) => [p.projectId, p.teamId]));

  return mine
    .map((p) => {
      const myTasks = rows.filter((r) => r.projectId === p.id);
      const myBlockers = blockerRows.filter((b) => b.projectId === p.id);
      const admin = adminByTeam.get(teamOfProject.get(p.id) ?? "") ?? null;
      const teamMembersOfProject = memberRows
        .filter((m) => m.teamId === teamOfProject.get(p.id))
        .map((m) => ({ id: m.id, name: m.name }));

      const issues = evaluateProjectHealth({
        tasks: myTasks.map((r) => ({
          ...r,
          updatedAtMs: Number(r.updatedAtMs),
          submittedAtMs: r.submittedAtMs === null ? null : Number(r.submittedAtMs),
          createdAtMs: Number(r.createdAtMs),
        })),
        blockers: myBlockers.map((b) => ({
          id: b.id,
          taskTitle: null,
          raisedByName: null,
          reason: b.reason,
          ageHours: Number(b.ageHours),
        })),
        members: teamMembersOfProject,
        today: day,
        nowMs,
        adminId: admin?.id ?? null,
        adminName: admin?.name ?? null,
      });

      return {
        projectId: p.id,
        projectName: p.name,
        teamName: p.teamName,
        issueCount: issues.length,
        highCount: issues.filter((i) => i.severity === "high").length,
        topIssue: issues[0]?.whyRed ?? null,
      };
    })
    .sort((a, b) => b.highCount - a.highCount || b.issueCount - a.issueCount);
}
