import { beforeEach, describe, expect, it, vi } from "vitest";
const petSource = vi.hoisted(() => ({ listOwned: vi.fn(), getOwned: vi.fn() }));
vi.mock("@/lib/pets/home-pet-source", () => ({ homePetSource: petSource }));
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { homeProfiles, teamMembers, users } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { ensureHome, getHomeView, moveHomePet, saveHome, selectHomePet, setHomeWorking } from "@/lib/home";
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
  await selectHomePet(owner.id, `pet:${owner.id}`);
  return { owner, neighbor, stranger, team };
}

describe("家园：保存、访问与伙伴所在位置", () => {
  it("工作状态独立于庭院位置，开始才入座，结束后保留空工位", async () => {
    const { owner, neighbor, team } = await setup();
    await moveHomePet(owner.id, team.id);
    const view = () => getHomeView(neighbor.id, { view: "courtyard", team: team.id });
    expect((await view()).workstations.find(s => s.ownerId === owner.id)).toMatchObject({ working: false, pet: null });
    await setHomeWorking(owner.id, team.id);
    const working = await view();
    expect(working.workstations.find(s => s.ownerId === owner.id)).toMatchObject({ working: true, pet: { status: "ready" } });
    await setHomeWorking(owner.id, null);
    expect((await view()).workstations.map(s => s.ownerId)).toEqual(working.workstations.map(s => s.ownerId));
    expect((await view()).workstations.find(s => s.ownerId === owner.id)).toMatchObject({ working: false, pet: null });
  });

  it("仅本团队成员可开工，清除桌宠会结束工作，离队后仍能结束", async () => {
    const { owner, stranger, team } = await setup();
    await expect(setHomeWorking(stranger.id, team.id)).rejects.toBeInstanceOf(ForbiddenError);
    await setHomeWorking(owner.id, team.id);
    await selectHomePet(owner.id, null);
    expect((await ensureHome(owner.id)).workingTeamId).toBeNull();
    await expect(setHomeWorking(owner.id, team.id)).rejects.toThrow("请先选择");
    await selectHomePet(owner.id, `pet:${owner.id}`);
    await setHomeWorking(owner.id, team.id);
    await db.delete(teamMembers).where(and(eq(teamMembers.userId, owner.id), eq(teamMembers.teamId, team.id)));
    await expect(setHomeWorking(owner.id, null)).resolves.toMatchObject({ workingTeamId: null });
  });
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const definition = (ownerId: string) => ({ id: `pet:${ownerId}`, ownerId, name: "自定义桌宠", appearance: { type: "image", src: "/pets/test.png", width: 96, height: 96 } });
    petSource.listOwned.mockImplementation(async (ownerId: string) => [definition(ownerId)]);
    petSource.getOwned.mockImplementation(async (ownerId: string, petId: string) => petId === `pet:${ownerId}` ? definition(ownerId) : null);
  });

  it("首次访问创建家园，重复访问保留已保存的布局与名字", async () => {
    const { owner } = await setup();
    const original = await ensureHome(owner.id);
    const saved = await saveHome(owner.id, { ...original, title: "鱼的院子", theme: "sunset", furniture: [{ ...original.furniture[0], x: 5, y: 5 }] });
    const refreshed = await getHomeView(owner.id);
    expect(refreshed.home.title).toBe("鱼的院子");
    expect(refreshed.home.furniture).toEqual(saved.furniture);
    expect(refreshed.home.revision).toBe(original.revision + 1);
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
    await saveHome(neighbor.id, { ...await ensureHome(neighbor.id), ownerId: owner.id, title: "我的布置" });
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
    await selectHomePet(stranger.id, `pet:${stranger.id}`);
    await expect(moveHomePet(stranger.id, team.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getHomeView(stranger.id, { view: "courtyard", team: team.id })).rejects.toBeInstanceOf(ForbiddenError);
    await moveHomePet(owner.id, team.id);
    await db.delete(teamMembers).where(and(eq(teamMembers.userId, owner.id), eq(teamMembers.teamId, team.id)));
    const { neighbor } = { neighbor: (await db.select().from(users).where(eq(users.email, "neighbor@home.test")))[0] };
    expect((await getHomeView(neighbor.id, { view: "courtyard", team: team.id })).residents).toHaveLength(0);
  });

  it("只能绑定本人桌宠；普通布局保存不能覆盖桌宠关联", async () => {
    const { owner, neighbor } = await setup();
    await expect(selectHomePet(owner.id, `pet:${neighbor.id}`)).rejects.toThrow("暂不可用");
    const home = await ensureHome(owner.id);
    await saveHome(owner.id, { ...home, pet: { name: "伪造", kind: "cat", petId: `pet:${neighbor.id}` } });
    expect((await ensureHome(owner.id)).pet.petId).toBe(`pet:${owner.id}`);
  });

  it("旧的内置伙伴显示为未绑定；失效桌宠不再出现在庭院且仍可召回", async () => {
    const { owner, neighbor, team } = await setup();
    expect((await getHomeView(neighbor.id)).ownPet.status).toBe("unbound");
    await expect(moveHomePet(neighbor.id, team.id)).rejects.toThrow("请先选择");
    await moveHomePet(owner.id, team.id);
    petSource.getOwned.mockResolvedValue(null);
    expect((await getHomeView(owner.id)).ownPet.status).toBe("unavailable");
    expect((await getHomeView(neighbor.id, { view: "courtyard", team: team.id })).residents).toHaveLength(0);
    await moveHomePet(owner.id, null);
    expect((await ensureHome(owner.id)).petTeamId).toBeNull();
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
