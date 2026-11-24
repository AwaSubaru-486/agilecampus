import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  agentRuns,
  agents,
  projects,
  teamMembers,
  users,
  type AgentRuntime,
  type AgentStatus,
} from "@/db/schema";
import { createApiToken } from "./api-token";
import { AppError, ForbiddenError } from "./errors";
import { getTeamMembership } from "./team";

// AI agent 作为团队成员。
//
// agent 是 users 的一行 + agents 的一行：身份与人在同一张表，因此
// 它能被指派任务、能出现在活动流、能被写进贡献记录——全部复用既有代码；
// agent 特有的东西（provider、能力、状态、并发上限）落在 agents 扩展表。
//
// 它不占 team_members 的席位：成员管理页列的是人，agent 另有一页。

const AGENT_EMAIL_DOMAIN = "agents.local";

export type AgentInput = {
  name: string;
  /** 跑在什么上：claude-code / codex / cursor / custom */
  provider: string;
  runtime?: AgentRuntime;
  /** 会做什么。派活时据以推荐 */
  capabilities?: string[];
  maxConcurrent?: number;
};

// 注册一个 agent。仅 admin 可操作——与建项目同口径，
// 因为 agent 一旦被注册就能接活、能写库，这是团队级的决定。
export async function createAgent(actorId: string, teamId: string, input: AgentInput) {
  const membership = await getTeamMembership(actorId, teamId);
  if (!membership || membership.role !== "admin") throw new ForbiddenError();

  const name = input.name.trim();
  if (!name) throw new AppError("请给这个 agent 起个名字");
  if (!input.provider.trim()) throw new AppError("请指明它跑在什么上");

  const created = await db.transaction(async (tx) => {
    // 合成邮箱：users.email 非空唯一，而 agent 没有真实邮箱。
    // 它同时也没有 passwordHash，故登不进来（auth.ts 另有两道闸门）。
    const [user] = await tx
      .insert(users)
      .values({
        email: `agent-${crypto.randomUUID()}@${AGENT_EMAIL_DOMAIN}`,
        kind: "agent",
        name,
        passwordHash: null,
      })
      .returning();

    // agent 同时占一个 team_members 席位，角色 student。
    //
    // 这一步是关键：既有的整套权限层（requireProjectAccess / requireTaskWrite /
    // requireTaskExecution）全部以 team_members 为准，让 agent 入席，
    // 这些一行都不用改它就能认领任务、提交成果、写活动流。
    //
    // 刻意取 student 而非 teacher：agent 干活，但不参与验收。
    // 判断「做出来的对不对」是人的活，这一条是本项目的立场，不是疏漏。
    await tx.insert(teamMembers).values({ teamId, userId: user.id, role: "student" });

    const [agent] = await tx
      .insert(agents)
      .values({
        userId: user.id,
        teamId,
        provider: input.provider.trim(),
        runtime: input.runtime ?? "local",
        capabilities: input.capabilities ?? [],
        maxConcurrent: input.maxConcurrent ?? 1,
        ownerId: actorId,
        status: "offline",
      })
      .returning();

    return { agent, user };
  });

  // 顺手发一枚 Personal API Token——agent 也是 user，既有的令牌层原样适用。
  // 明文只此一次返回，注册页要当场显示给用户，让他贴进 agent 的配置里。
  const token = await createApiToken(created.user.id, `${name} 的接入令牌`);

  return {
    ...created.agent,
    name: created.user.name,
    email: created.user.email,
    token: token.token,
  };
}

/** 给某个 agent 重发一枚令牌（原令牌丢了或泄露时用）。 */
export async function reissueAgentToken(actorId: string, agentUserId: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.userId, agentUserId));
  if (!agent) throw new AppError("该 agent 不存在");
  if (actorId !== agent.ownerId) {
    const membership = await getTeamMembership(actorId, agent.teamId);
    if (!membership || membership.role !== "admin") throw new ForbiddenError();
  }
  const [user] = await db.select().from(users).where(eq(users.id, agentUserId));
  const token = await createApiToken(agentUserId, `${user?.name ?? "agent"} 的接入令牌`);
  return { token: token.token };
}

export type AgentRow = {
  userId: string;
  name: string;
  provider: string;
  runtime: AgentRuntime;
  capabilities: string[];
  status: AgentStatus;
  maxConcurrent: number;
  ownerId: string | null;
  ownerName: string | null;
  lastSeenAt: Date | null;
  /** 此刻正在跑几件活。与 maxConcurrent 比较即知它满没满 */
  runningCount: number;
  createdAt: Date;
};

/** 同一张 users 表要 join 两次（agent 本人、它的主人），故后者取别名。 */
const owner = alias(users, "owner");

const SELECT_AGENT = {
  userId: agents.userId,
  name: users.name,
  provider: agents.provider,
  runtime: agents.runtime,
  capabilities: agents.capabilities,
  status: agents.status,
  maxConcurrent: agents.maxConcurrent,
  ownerId: agents.ownerId,
  ownerName: owner.name,
  lastSeenAt: agents.lastSeenAt,
  createdAt: agents.createdAt,
};

async function runningCounts(agentIds: string[]): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const rows = await db
    .select({ agentId: agentRuns.agentId, count: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(and(inArray(agentRuns.agentId, agentIds), inArray(agentRuns.status, ["dispatched", "running"])))
    .groupBy(agentRuns.agentId);
  return new Map(rows.map((r) => [r.agentId, r.count]));
}

export async function listTeamAgents(actorId: string, teamId: string): Promise<AgentRow[]> {
  const membership = await getTeamMembership(actorId, teamId);
  if (!membership) throw new ForbiddenError();

  const rows = await db
    .select(SELECT_AGENT)
    .from(agents)
    .innerJoin(users, eq(agents.userId, users.id))
    .leftJoin(owner, eq(agents.ownerId, owner.id))
    .where(eq(agents.teamId, teamId))
    .orderBy(agents.createdAt);

  const counts = await runningCounts(rows.map((r) => r.userId));
  return rows.map((r) => ({ ...r, runningCount: counts.get(r.userId) ?? 0 }));
}

/** 某项目可用的 agent = 其所属团队的 agent。 */
export async function listProjectAgents(actorId: string, projectId: string): Promise<AgentRow[]> {
  const [project] = await db
    .select({ teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new AppError("项目不存在");
  return listTeamAgents(actorId, project.teamId);
}

// 指派前的归属校验：被指派的 id 要么是本团队成员，要么是本团队的 agent。
//
// 既有的 validateAssignee 只认 team_members，agent 不在那张表里，
// 故此处单开一路。两者合起来才是完整的「这个人/这个 agent 确实能接这活」。
export async function isTeamAgent(userId: string, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: agents.userId })
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.teamId, teamId)));
  return Boolean(row);
}

// 心跳与状态回报。agent 每隔一会儿调一次，人不调。
//
// 允许 agent 自己调（凭它自己的令牌），也允许其主人或团队 admin 代为调——
// agent 崩了的时候，总得有人能把它标成 error 或 offline。
export async function reportAgentStatus(
  actorId: string,
  agentUserId: string,
  input: { status: AgentStatus; capabilities?: string[] },
) {
  const [agent] = await db.select().from(agents).where(eq(agents.userId, agentUserId));
  if (!agent) throw new AppError("该 agent 不存在");

  // 三种人可改：agent 自己、它的主人、团队 admin
  if (actorId !== agentUserId && actorId !== agent.ownerId) {
    const membership = await getTeamMembership(actorId, agent.teamId);
    if (!membership || membership.role !== "admin") throw new ForbiddenError();
  }

  const [updated] = await db
    .update(agents)
    .set({
      status: input.status,
      ...(input.capabilities !== undefined && { capabilities: input.capabilities }),
      // 只要来报到就算活着，无论报的是什么状态。
      // 「在线且正在干活」「在线但卡住了」都是活着；offline 由心跳超时判定，不由它自己声明。
      lastSeenAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(agents.userId, agentUserId))
    .returning();
  return updated;
}

// 把久未心跳的 agent 标为离线。供页面读取时顺手调用，
// 免得界面上显示一个昨天就跑掉的 agent 还在「在线」。
export async function sweepOfflineAgents(teamId: string, staleMinutes = 5): Promise<number> {
  const rows = await db
    .update(agents)
    .set({ status: "offline", updatedAt: sql`now()` })
    .where(
      and(
        eq(agents.teamId, teamId),
        sql`${agents.status} <> 'offline'`,
        sql`(${agents.lastSeenAt} is null or ${agents.lastSeenAt} < now() - interval '1 minute' * ${staleMinutes})`,
      ),
    )
    .returning({ userId: agents.userId });
  return rows.length;
}

export async function deleteAgent(actorId: string, agentUserId: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.userId, agentUserId));
  if (!agent) throw new AppError("该 agent 不存在");
  const membership = await getTeamMembership(actorId, agent.teamId);
  if (!membership || membership.role !== "admin") throw new ForbiddenError();

  // 删 users 行，agents 与 agent_runs 随之级联；
  // 它经手过的任务 assigneeId 置空（外键 set null），历史事件保留
  await db.delete(users).where(eq(users.id, agentUserId));
}

/** 给界面用：把一批 userId 分成人和 agent。 */
export async function classifyMembers(
  userIds: string[],
): Promise<Map<string, "human" | "agent">> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, kind: users.kind })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.id, r.kind]));
}
