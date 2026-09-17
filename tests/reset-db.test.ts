import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { listProjectActivity } from "@/lib/activity-feed";
import { resetDb, TRUNCATED_TABLES } from "./helpers";

// 守卫测试。新增表却忘了加进 resetDb 的 TRUNCATE 列表时，
// 失败形态是「跨用例脏数据导致的偶发红」而非明确报错——最贵的调试形态。
// 这两条断言把它变成一次明确的失败。

async function tableNames(): Promise<string[]> {
  const res = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return (res as unknown as { tablename: string }[]).map((r) => r.tablename);
}

async function countOf(table: string): Promise<number> {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`);
  return (res as unknown as { n: number }[])[0].n;
}

describe("resetDb 表清单", () => {
  it("覆盖库中所有业务表", async () => {
    const all = await tableNames();
    const missing = all.filter((n) => !(TRUNCATED_TABLES as readonly string[]).includes(n));
    // 有遗漏即在此报出表名，不必等某天冒出一条莫名其妙的红
    expect(missing).toEqual([]);
  });

  it("清单里的表在库中确实存在，无笔误", async () => {
    const all = await tableNames();
    const ghost = TRUNCATED_TABLES.filter((t) => !all.includes(t));
    expect(ghost).toEqual([]);
  });
});

describe("resetDb 清空效果", () => {
  beforeEach(resetDb);

  it("活动流表随 resetDb 清零", async () => {
    const owner = await createUser({
      email: "owner@example.com",
      password: "password123",
      name: "owner",
    });
    const team = await createTeam(owner.id, "东吴实验室");
    const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
    await createTask(owner.id, project.id, { title: "甲" });
    expect((await listProjectActivity(owner.id, project.id)).length).toBeGreaterThan(0);

    await resetDb();
    expect(await countOf("activity_events")).toBe(0);
  });

  it("join 团队亦被清空", async () => {
    const owner = await createUser({
      email: "owner@example.com",
      password: "password123",
      name: "owner",
    });
    const team = await createTeam(owner.id, "东吴实验室");
    const guest = await createUser({
      email: "guest@example.com",
      password: "password123",
      name: "guest",
    });
    await joinTeam(guest.id, team.inviteCode);
    expect(await countOf("team_members")).toBe(2);

    await resetDb();
    expect(await countOf("team_members")).toBe(0);
  });
});
