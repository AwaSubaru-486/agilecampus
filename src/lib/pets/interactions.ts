import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { homeProfiles, petInteractions } from "@/db/schema";
import { getProjectForUser } from "@/lib/project";
import { AppError, ForbiddenError } from "@/lib/errors";
import { requireHomePet } from "./home-pet-provider";
import type { PetInteractionKind } from "./interaction-contract";

export async function listPetInteractions(actorId: string, projectId: string) {
  if (!await getProjectForUser(actorId, projectId)) throw new ForbiddenError();
  return db.select().from(petInteractions).where(and(eq(petInteractions.projectId, projectId), gte(petInteractions.createdAt, new Date(Date.now() - 12000)))).orderBy(desc(petInteractions.createdAt)).limit(100);
}
export async function sendPetInteraction(actorId: string, projectId: string, targetId: string, kind: PetInteractionKind) {
  if (actorId === targetId) throw new AppError("请选择另一位伙伴");
  for (const userId of [actorId, targetId]) {
    if (!await getProjectForUser(userId, projectId)) throw new ForbiddenError("只能与当前项目的成员互动");
    const [home] = await db.select().from(homeProfiles).where(eq(homeProfiles.ownerId, userId));
    if (home?.workingProjectId !== projectId || !home.pet.petId?.startsWith("web:")) throw new AppError("双方需要先带网页桌宠在当前项目开始工作");
    await requireHomePet(userId, home.pet.petId);
  }
  return db.transaction(async tx => {
    await tx.delete(petInteractions).where(and(eq(petInteractions.projectId, projectId), lt(petInteractions.createdAt, new Date(Date.now() - 86400000))));
    const [event] = await tx.insert(petInteractions).values({ projectId, actorId, targetId, kind }).returning();
    return event;
  });
}
