import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, tasks, taskTreeDrafts } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { getProjectForUser } from "@/lib/project";
import { getTeamMembership } from "@/lib/team";
import { buildTutorialCourses, COURSE_IDS, INITIAL_TUTORIAL_PROGRESS, type TutorialProgress } from "./catalog";
import { getModelConfigStatus } from "@/lib/model-config";
import { EMPTY_JOURNEY, LEGACY_WELCOME_IDS, welcomeStepIndex, buildWelcomeSteps } from "./example-flow";

export const tutorialCommandSchema = z.discriminatedUnion("type",[
  z.object({type:z.literal("restart-example")}),
  z.object({type:z.literal("dismiss")}),z.object({type:z.literal("pause")}),
  z.object({type:z.literal("save"),courseId:z.enum(COURSE_IDS),step:z.number().int().min(0).max(200),projectId:z.uuid().nullable()}),
  z.object({type:z.literal("complete"),courseId:z.enum(COURSE_IDS)}),
]);
export type TutorialCommand=z.infer<typeof tutorialCommandSchema>;
function normalizeProgress(progress:TutorialProgress):TutorialProgress {
  if (progress.journey?.version === 5) return progress;
  if (progress.journey?.version === 4) {
    const oldId = LEGACY_WELCOME_IDS[progress.active?.step ?? 0] ?? "api";
    return { ...progress, journey: { ...progress.journey, version: 5 }, active: progress.active?.courseId === "welcome" ? { ...progress.active, step: welcomeStepIndex(oldId), paused: true, journeyVersion: 5 } : progress.active };
  }
  return {...progress,journey:progress.journey ? {...progress.journey,version:5} : undefined,completed:progress.completed.filter(id=>id!=="welcome"),status:progress.status==="completed"?"started":progress.status,
    active:progress.active?.courseId==="welcome"?{courseId:"welcome",step:0,projectId:null,paused:true,journeyVersion:5}:progress.active};
}
export async function getTutorialProgress(actorId:string):Promise<TutorialProgress> {
  const [user]=await db.select({progress:users.tutorialProgress}).from(users).where(eq(users.id,actorId));
  if(!user) throw new ForbiddenError();
  return withJourneyTask(actorId,normalizeProgress(user.progress ?? INITIAL_TUTORIAL_PROGRESS));
}
async function withJourneyTask(actorId:string,progress:TutorialProgress):Promise<TutorialProgress> {
  const journey=progress.journey;
  if(!journey?.projectId || !(await getProjectForUser(actorId,journey.projectId))) return progress;
  const [task]=await db.select({id:tasks.id}).from(tasks).where(and(eq(tasks.projectId,journey.projectId),eq(tasks.assigneeId,actorId))).orderBy(asc(tasks.sortOrder)).limit(1);
  return {...progress,journey:{...journey,taskId:task?.id ?? null}};
}
async function assertWelcomeReady(actorId:string,current:TutorialProgress,step:number) {
  const journey=current.journey;
  if(step>welcomeStepIndex("api") && !(await getModelConfigStatus(actorId)).ready) throw new Error("请先保存 API 配置");
  if(step>welcomeStepIndex("team") && (!journey?.teamId || !(await getTeamMembership(actorId,journey.teamId)))) throw new Error("请先创建示例团队");
  if(step<=welcomeStepIndex("project")) return;
  if(!journey?.projectId) throw new Error("请先创建示例项目");
  const access=await getProjectForUser(actorId,journey.projectId);
  if(!access || access.role!=="admin" || access.project.teamId!==journey.teamId) throw new ForbiddenError();
  const [drafts,projectTasks]=await Promise.all([
    db.select({id:taskTreeDrafts.id}).from(taskTreeDrafts).where(eq(taskTreeDrafts.projectId,journey.projectId)),
    db.select({status:tasks.status,committedAt:tasks.committedAt,assigneeId:tasks.assigneeId}).from(tasks).where(eq(tasks.projectId,journey.projectId)),
  ]);
  if(step>welcomeStepIndex("generate") && !drafts.length) throw new Error("请先生成任务草案");
  if(step>welcomeStepIndex("publish") && !projectTasks.length) throw new Error("请先确认发布任务");
  if(step>welcomeStepIndex("claim") && !projectTasks.some(task=>task.assigneeId===actorId && task.committedAt)) throw new Error("请先接住任务");
  if(step>welcomeStepIndex("submit") && !projectTasks.some(task=>task.assigneeId===actorId && ["review","done"].includes(task.status))) throw new Error("请先提交练习成果");
}
export async function updateTutorialProgress(actorId:string,raw:unknown):Promise<TutorialProgress> {
  const command=tutorialCommandSchema.parse(raw);
  const access=command.type==="save" && command.projectId?await getProjectForUser(actorId,command.projectId):null;
  if(command.type==="save" && command.projectId && !access) throw new ForbiddenError();
  const result=await db.transaction(async tx=>{
    await tx.execute(sql`select id from users where id=${actorId} for update`);
    const [user]=await tx.select({progress:users.tutorialProgress}).from(users).where(eq(users.id,actorId));
    if(!user) throw new ForbiddenError();
    const current=normalizeProgress(user.progress ?? INITIAL_TUTORIAL_PROGRESS);
    if(command.type==="save") {
      const project=access?{id:access.project.id,name:access.project.name,teamId:access.project.teamId,role:access.role}:null;
      const course=buildTutorialCourses(project,current.journey).find(course=>course.id===command.courseId);
      if(!course || course.needsProject && !project || course.roles && (!project || !course.roles.includes(project.role)) || command.step>=course.steps.length) throw new ForbiddenError();
      if(command.courseId==="welcome") {
        if(command.projectId && command.projectId!==current.journey?.projectId) throw new ForbiddenError();
        await assertWelcomeReady(actorId,current,command.step);
      }
    }
    if(command.type==="complete" && command.courseId==="welcome") await assertWelcomeReady(actorId,current,buildWelcomeSteps(EMPTY_JOURNEY).length);
    const progress:TutorialProgress=command.type==="restart-example"?{
      ...current,journey:{...EMPTY_JOURNEY},status:"started",completed:current.completed.filter(id=>id!=="welcome"),active:{courseId:"welcome",step:0,projectId:null,journeyVersion:5},
    }:command.type==="save"?{
      ...current,status:"started",active:{courseId:command.courseId,step:command.step,projectId:command.projectId,...command.courseId==="welcome"?{journeyVersion:5}:{}},
    }:command.type==="complete"?{
      ...current,status:command.courseId==="welcome"?"completed":current.status==="new"?"started":current.status,active:null,completed:[...new Set([...current.completed,command.courseId])],
    }:{...current,status:current.status==="new"?"dismissed":current.status,active:command.type==="pause" && current.active?{...current.active,paused:true}:null};
    await tx.update(users).set({tutorialProgress:progress}).where(eq(users.id,actorId));return progress;
  });
  return withJourneyTask(actorId,result);
}
// Called only after the existing authenticated creation forms create a resource.
export async function recordTutorialCreation(actorId:string,kind:"team"|"project",id:string) {
  const access=kind==="project"?await getProjectForUser(actorId,id):null;
  const membership=kind==="team"?await getTeamMembership(actorId,id):null;
  if(kind==="team"?membership?.role!=="admin":!access || access.role!=="admin") throw new ForbiddenError();
  return db.transaction(async tx=>{
    await tx.execute(sql`select id from users where id=${actorId} for update`);
    const [user]=await tx.select({progress:users.tutorialProgress}).from(users).where(eq(users.id,actorId));
    if(!user) throw new ForbiddenError();
    const current=normalizeProgress(user.progress);
    if(current.active?.courseId!=="welcome" || current.active.paused || current.journey?.version!==5) return;
    const journey=current.journey;
    if(kind==="team" && current.active.step===welcomeStepIndex("team") && !journey.teamId) journey.teamId=id;
    else if(kind==="project" && current.active.step===welcomeStepIndex("project") && !journey.projectId && access?.project.teamId===journey.teamId) journey.projectId=id;
    else return;
    await tx.update(users).set({tutorialProgress:{...current,journey,active:{...current.active,projectId:journey.projectId}}}).where(eq(users.id,actorId));
  });
}
