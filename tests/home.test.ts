import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { homeProfiles, teamMembers, users } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { ensureHome, getHomeView, moveHomePet, saveHome } from "@/lib/home";
import { homeSaveSchema } from "@/lib/home-contract";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { resetDb } from "./helpers";

async function setup() {
  const [owner, neighbor, stranger] = await db.insert(users).values([
    { email: "owner@home.test", name: "小鱼" },
    { email: "neighbor@home.test", name: "小鹿" },
    { email: "stranger@home.test", name: "陌生人" },
  ]).returning();
  const team = await createTeam(owner.id, "星星小队");
  await joinTeam(neighbor.id, team.inviteCode);
  return { owner, neighbor, stranger, team };
}

describe("家园：保存、访问与伙伴所在位置", () => {
  beforeEach(resetDb);

  it("首次访问创建家园，重复访问保留已保存的布局与名字", async () => {
    const { owner } = await setup();
    const original = await ensureHome(owner.id);
    const saved = await saveHome(owner.id, { ...original, title: "鱼的院子", theme: "sunset", furniture: [{ ...original.furniture[0], x: 5, y: 5 }] });
    const refreshed = await getHomeView(owner.id);
    expect(refreshed.home.title).toBe("鱼的院子");
    expect(refreshed.home.furniture).toEqual(saved.furniture);
    expect(refreshed.home.revision).toBe(1);
  });

  it("队友可以访问开放家园，陌生人不能通过 owner 参数越权访问", async () => {
    const { owner, neighbor, stranger } = await setup();
    await ensureHome(owner.id);
    const visited = await getHomeView(neighbor.id, { view: "members", owner: owner.id });
    expect(visited.home.ownerId).toBe(owner.id);
    await expect(getHomeView(stranger.id, { view: "members", owner: owner.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("关闭来访后，队友不可访问且列表不泄露私有家园名字和伙伴", async () => {
    const { owner, neighbor, team } = await setup();
    const home = await ensureHome(owner.id);
    await saveHome(owner.id, { ...home, title: "不公开的名字", visibility: "private" });
    await expect(getHomeView(neighbor.id, { view: "members", owner: owner.id })).rejects.toBeInstanceOf(ForbiddenError);
    const list = await getHomeView(neighbor.id, { view: "members", team: team.id });
    expect(list.members[0]).toMatchObject({ visitable: false, pet: null });
    expect(JSON.stringify(list.members)).not.toContain("不公开的名字");
  });

  it("不能通过提交 ownerId 改写别人的家园", async () => {
    const { owner, neighbor } = await setup();
    const home = await ensureHome(owner.id);
    await saveHome(neighbor.id, { ...home, ownerId: owner.id, title: "我的布置" });
    expect((await ensureHome(owner.id)).title).toBe(home.title);
    expect((await ensureHome(neighbor.id)).title).toBe("我的布置");
  });

  it("旧版本保存被拒绝，避免两个窗口互相覆盖", async () => {
    const { owner } = await setup();
    const home = await ensureHome(owner.id);
    await saveHome(owner.id, { ...home, title: "新布置" });
    await expect(saveHome(owner.id, { ...home, title: "旧窗口" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("伙伴一次只在一处；进入庭院后家中不重复展示，召回后庭院移除", async () => {
    const { owner, neighbor, team } = await setup();
    await moveHomePet(owner.id, team.id);
    expect((await getHomeView(owner.id)).residents).toHaveLength(0);
    const yard = await getHomeView(neighbor.id, { view: "courtyard", team: team.id });
    expect(yard.residents.map(p => p.ownerId)).toEqual([owner.id]);
    await moveHomePet(owner.id, null);
    expect((await getHomeView(owner.id)).residents).toHaveLength(1);
    expect((await getHomeView(neighbor.id, { view: "courtyard", team: team.id })).residents).toHaveLength(0);
  });

  it("陌生人不能进入其他团队庭院，离队后宠物也不会继续出现在该庭院", async () => {
    const { owner, stranger, team } = await setup();
    await expect(moveHomePet(stranger.id, team.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getHomeView(stranger.id, { view: "courtyard", team: team.id })).rejects.toBeInstanceOf(ForbiddenError);
    await moveHomePet(owner.id, team.id);
    await db.delete(teamMembers).where(and(eq(teamMembers.userId, owner.id), eq(teamMembers.teamId, team.id)));
    const { neighbor } = { neighbor: (await db.select().from(users).where(eq(users.email, "neighbor@home.test")))[0] };
    expect((await getHomeView(neighbor.id, { view: "courtyard", team: team.id })).residents).toHaveLength(0);
  });

  it("拒绝重叠家具、重复编号与越界位置", async () => {
    const { owner } = await setup();
    const home = await ensureHome(owner.id);
    const item = home.furniture[0];
    expect(homeSaveSchema.safeParse({ ...home, furniture: [item, { ...item, id: "other" }] }).success).toBe(false);
    expect(homeSaveSchema.safeParse({ ...home, furniture: [item, { ...item, x: 9 }] }).success).toBe(false);
    expect(homeSaveSchema.safeParse({ ...home, furniture: [{ ...item, y: 9 }] }).success).toBe(false);
    expect((await db.select().from(homeProfiles)).length).toBe(1);
  });
});
