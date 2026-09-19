import { db } from "@/db";
import { sql } from "drizzle-orm";

// 表清单在此，新增表务必加入——漏加的失败模式是「跨用例脏数据导致的偶发红」，
// 而非明确报错，属最贵的调试形态。tests/reset-db.test.ts 有一条守卫断言盯着它。
export const TRUNCATED_TABLES = [
  "project_entries",
  "milestone_highlights",
  "agent_runs",
  "agents",
  "blocker_invites",
  "blockers",
  "activity_events",
  "task_labels",
  "labels",
  "resource_usages",
  "api_tokens",
  "task_dependencies",
  "messages",
  "conversations",
  "tasks",
  "milestones",
  "projects",
  "team_members",
  "teams",
  "users",
] as const;

export async function resetDb() {
  await db.execute(
    sql`TRUNCATE ${sql.raw(TRUNCATED_TABLES.join(", "))} RESTART IDENTITY CASCADE`,
  );
}
