import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { homeProfiles, teamMembers, teams, users } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { DEFAULT_HOME_PET, homeSaveSchema, STARTER_FURNITURE, type HomePet, type HomePetDisplay, type HomeView } from "./home-contract";
import { listHomePets, requireHomePet, resolveHomePet } from "./pets/home-pet-provider";

async function displayPet(ownerId: string, saved: HomePet): Promise<HomePetDisplay> {
  const definition = saved.petId ? await resolveHomePet(ownerId, saved.petId) : null;
  return { ...saved, name: definition?.name ?? (saved.petId ? "桌宠暂不可用" : "未选择桌宠"), definition,
    status: definition ? "ready" : saved.petId ? "unavailable" : "unbound" };
}

export async function ensureHome(actorId: string) {
  await db.insert(homeProfiles).values({ ownerId: actorId, furniture: STARTER_FURNITURE, pet: DEFAULT_HOME_PET }).onConflictDoNothing();
  const [home] = await db.select().from(homeProfiles).where(eq(homeProfiles.ownerId, actorId));
  if (!home) throw new NotFoundError("家园不存在");
  return home;
}

async function myTeams(actorId: string) {
  return db.select({ id: teams.id, name: teams.name }).from(teams)
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id)).where(eq(teamMembers.userId, actorId)).orderBy(teams.createdAt);
}

export async function getHomeView(actorId: string, options: { view?: string; owner?: string; team?: string } = {}): Promise<HomeView> {
  if (options.owner && !z.uuid().safeParse(options.owner).success) throw new AppError("家园地址无效");
  const own = await ensureHome(actorId);
  const groups = await myTeams(actorId);
  const group = options.team ? groups.find(t => t.id === options.team) : groups[0];
  if (options.team && !group) throw new ForbiddenError("只能进入自己团队的庭院");
  const view = options.view === "courtyard" ? "courtyard" : options.view === "members" ? "members" : "mine";
  const roster = group ? await db.select({ id: users.id, name: users.name, home: homeProfiles }).from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId)).leftJoin(homeProfiles, eq(homeProfiles.ownerId, users.id))
    .where(and(eq(teamMembers.teamId, group.id), eq(users.kind, "human"))).orderBy(users.createdAt, users.id) : [];
  let home = own;
  const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorId));
  let ownerName = actor?.name ?? "我";
  if (view === "members" && options.owner && options.owner !== actorId) {
    const allGroupIds = groups.map(t => t.id);
    const [neighbor] = allGroupIds.length ? await db.select({ name: users.name, home: homeProfiles }).from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId)).leftJoin(homeProfiles, eq(homeProfiles.ownerId, users.id))
      .where(and(eq(users.id, options.owner), eq(users.kind, "human"), inArray(teamMembers.teamId, allGroupIds))).limit(1) : [];
    if (!neighbor || neighbor.home?.visibility === "private") throw new ForbiddenError("这座家园暂不对你开放");
    if (!neighbor.home) throw new AppError("这位成员还没有开启家园，过会儿再来看看吧");
    home = neighbor.home;
    ownerName = neighbor.name;
  }
  const members = await Promise.all(roster.filter(m => m.id !== actorId).map(async m => ({
    id: m.id, name: m.name, title: m.home?.visibility === "team" ? m.home.title : "暂未开放",
    visitable: Boolean(m.home && m.home.visibility === "team"),
    pet: m.home?.visibility === "team" ? await displayPet(m.id, m.home.pet) : null,
  })));
  const candidates = view === "courtyard" ? roster.filter(m => m.home?.petTeamId === group?.id).map(m => ({ ownerId: m.id, ownerName: m.name, pet: m.home!.pet }))
    : home.petTeamId ? [] : [{ ownerId: home.ownerId, ownerName, pet: home.pet }];
  const residents = await Promise.all(candidates.map(async resident => ({ ...resident, pet: await displayPet(resident.ownerId, resident.pet) })));
  return {
    actorId, view, home, ownerName, teams: groups, teamId: group?.id ?? null,
    ownPet: await displayPet(actorId, own.pet), ownPetTeamId: own.petTeamId,
    availablePets: await listHomePets(actorId), members,
    ownWorkingTeamId: own.workingTeamId,
    workstations: await Promise.all(roster.map(async member => ({
      ownerId: member.id, ownerName: member.name,
      working: member.home?.workingTeamId === group?.id,
      pet: member.home?.workingTeamId === group?.id && member.home ? await displayPet(member.id, member.home.pet) : null,
    }))),
    residents: residents.filter(resident => resident.pet.status === "ready"),
  };
}

export async function saveHome(actorId: string, input: unknown) {
  const settings = homeSaveSchema.parse(input);
  await ensureHome(actorId);
  const { revision, title, welcome, theme, visibility, furniture } = settings;
  // Pet binding is managed separately; a layout save must never overwrite it.
  const values = { title, welcome, theme, visibility, furniture };
  const [updated] = await db.update(homeProfiles).set({ ...values, revision: sql`${homeProfiles.revision} + 1`, updatedAt: new Date() })
    .where(and(eq(homeProfiles.ownerId, actorId), eq(homeProfiles.revision, revision))).returning();
  if (!updated) throw new ConflictError("家园已在其他页面更新，请刷新后再布置");
  return updated;
}

export async function moveHomePet(actorId: string, teamId: string | null) {
  const home = await ensureHome(actorId);
  // Always allow recall, including a deleted pet or a user who has left the team.
  if (teamId) {
    if (!home.pet.petId) throw new AppError("请先选择一只桌宠");
    await requireHomePet(actorId, home.pet.petId);
  }
  if (teamId) {
    const [membership] = await db.select({ id: teamMembers.id }).from(teamMembers)
      .where(and(eq(teamMembers.userId, actorId), eq(teamMembers.teamId, teamId)));
    if (!membership) throw new ForbiddenError("只能带伙伴进入自己的团队庭院");
  }
  const [updated] = await db.update(homeProfiles).set({ petTeamId: teamId, updatedAt: new Date() })
    .where(eq(homeProfiles.ownerId, actorId)).returning();
  return updated;
}

export async function selectHomePet(actorId: string, petId: string | null) {
  await ensureHome(actorId);
  const pet = petId ? await requireHomePet(actorId, petId) : null;
  const [updated] = await db.update(homeProfiles).set({
    pet: pet ? { name: pet.name, kind: "placeholder", petId: pet.id } : DEFAULT_HOME_PET,
    petTeamId: null, workingTeamId: null, revision: sql`${homeProfiles.revision} + 1`, updatedAt: new Date(),
  }).where(eq(homeProfiles.ownerId, actorId)).returning();
  return updated;
}

/** Explicit work declaration, independent of task status and courtyard visits. */
export async function setHomeWorking(actorId: string, teamId: string | null) {
  const home = await ensureHome(actorId);
  if (teamId) {
    const [membership] = await db.select({ id: teamMembers.id }).from(teamMembers)
      .where(and(eq(teamMembers.userId, actorId), eq(teamMembers.teamId, teamId)));
    if (!membership) throw new ForbiddenError("只能在自己的团队开始工作");
    if (!home.pet.petId) throw new AppError("请先选择一只桌宠");
    await requireHomePet(actorId, home.pet.petId);
  }
  const [updated] = await db.update(homeProfiles).set({ workingTeamId: teamId, updatedAt: new Date() })
    .where(eq(homeProfiles.ownerId, actorId)).returning();
  return updated;
}
