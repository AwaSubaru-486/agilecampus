import {beforeEach,describe,it,expect} from "vitest";
import {eq} from "drizzle-orm";
import {db} from "@/db";
import {users,tasks} from "@/db/schema";
import {getTutorialProgress,updateTutorialProgress,recordTutorialCreation} from "@/lib/tutorials/progress";
import {buildTutorialCourses} from "@/lib/tutorials/catalog";
import {createUser} from "@/lib/user";
import {createTeam,joinTeam,updateMemberRole} from "@/lib/team";
import {createProject} from "@/lib/project";
import {generateTutorialTaskTreeDraft,publishTaskTreeDraft} from "@/lib/task-tree";
import {claimTask,submitTask} from "@/lib/task";
import {resetDb} from "./helpers";
const user=(name:string)=>createUser({name,email:`${name}@tutorial.test`,password:"password123"});
const sample={id:"00000000-0000-4000-8000-000000000001",teamId:"00000000-0000-4000-8000-000000000002",name:"项目",role:"admin" as const};
async function journey(actorId:string){
  await updateTutorialProgress(actorId,{type:"restart-example"});
  const team=await createTeam(actorId,"教学团队");await recordTutorialCreation(actorId,"team",team.id);
  await updateTutorialProgress(actorId,{type:"save",courseId:"welcome",step:2,projectId:null});
  const project=await createProject(actorId,team.id,{name:"教学示例：校园活动报名页"});
  await recordTutorialCreation(actorId,"project",project.id);return{team,project};
}
describe("教程课程与账号进度",()=>{
 beforeEach(resetDb);
 it("所有角色可从原页面开始示例，独立功能课程仍按角色过滤",()=>{
  const leader=buildTutorialCourses(sample)[0];expect(leader.steps).toHaveLength(18);
  expect(buildTutorialCourses(null)[0]).toEqual(leader);expect(buildTutorialCourses({...sample,role:"teacher"})[0]).toEqual(leader);
  expect(buildTutorialCourses(sample).find(c=>c.id==="planning")?.roles).toEqual(["admin"]);
 });
 it("首次提醒、跳过隔离以及不存在的账号",async()=>{
  const a=await user("a"),b=await user("b");expect((await getTutorialProgress(a.id)).status).toBe("new");
  await updateTutorialProgress(a.id,{type:"dismiss",actorId:b.id});expect((await getTutorialProgress(a.id)).status).toBe("dismissed");expect((await getTutorialProgress(b.id)).status).toBe("new");
  await expect(updateTutorialProgress(sample.id,{type:"dismiss"})).rejects.toThrow();
 });
 it("暂停持久化，继续不重建已有团队与项目",async()=>{
  const a=await user("a");const {project}=await journey(a.id);
  await updateTutorialProgress(a.id,{type:"save",courseId:"welcome",step:3,projectId:project.id});await updateTutorialProgress(a.id,{type:"pause"});
  const paused=await getTutorialProgress(a.id);expect(paused.active?.paused).toBe(true);
  const resumed=await updateTutorialProgress(a.id,{type:"save",courseId:"welcome",step:3,projectId:project.id});expect(resumed.active?.paused).toBeUndefined();expect(resumed.journey).toEqual(paused.journey);
 });
 it("不同课程并发完成不丢失、重复完成幂等，完整主线不能提前完成",async()=>{
  const a=await user("a");await Promise.all([updateTutorialProgress(a.id,{type:"complete",courseId:"teams"}),updateTutorialProgress(a.id,{type:"complete",courseId:"settings"})]);
  await updateTutorialProgress(a.id,{type:"complete",courseId:"teams"});expect((await getTutorialProgress(a.id)).completed.sort()).toEqual(["settings","teams"]);
  await expect(updateTutorialProgress(a.id,{type:"complete",courseId:"welcome"})).rejects.toThrow();
 });
 it("拒绝未知课程、越界步骤和无权限项目，导师不能启动组长规划课程",async()=>{
  const a=await user("a"),t=await user("teacher"),b=await user("outsider");const team=await createTeam(a.id,"项目团队");
  await joinTeam(t.id,team.inviteCode);await updateMemberRole(a.id,team.id,t.id,"teacher");const project=await createProject(a.id,team.id,{name:"项目"});
  await expect(updateTutorialProgress(a.id,{type:"save",courseId:"fake",step:0,projectId:null})).rejects.toThrow();
  await expect(updateTutorialProgress(a.id,{type:"save",courseId:"settings",step:9,projectId:null})).rejects.toThrow();
  await expect(updateTutorialProgress(b.id,{type:"save",courseId:"welcome",step:0,projectId:project.id})).rejects.toThrow();
  for(const courseId of ["planning","execution"]) await expect(updateTutorialProgress(t.id,{type:"save",courseId,step:0,projectId:project.id})).rejects.toThrow();
 });
 it("创建时只绑定当前原表单步骤，其他账号与普通项目不能冒充教学项目",async()=>{
  const a=await user("a"),b=await user("b");const team=await createTeam(a.id,"普通团队");await recordTutorialCreation(a.id,"team",team.id);
  expect((await getTutorialProgress(a.id)).journey).toBeUndefined();
  await expect(recordTutorialCreation(b.id,"team",team.id)).rejects.toThrow();
  const project=await createProject(a.id,team.id,{name:"普通项目"});await expect(generateTutorialTaskTreeDraft(a.id,project.id,"制作一个校园活动报名页面")).rejects.toThrow();
 });
 it("服务端必须实际创建、生成、发布、认领与提交，不能靠点击下一步伪造结果",async()=>{
  const a=await user("a");await updateTutorialProgress(a.id,{type:"restart-example"});
  await expect(updateTutorialProgress(a.id,{type:"save",courseId:"welcome",step:1,projectId:null})).rejects.toThrow("创建示例团队");
  const {project}=await journey(a.id);
  await expect(updateTutorialProgress(a.id,{type:"save",courseId:"welcome",step:5,projectId:project.id})).rejects.toThrow("生成任务");
  const generated=await generateTutorialTaskTreeDraft(a.id,project.id,"制作校园活动报名页，支持必填校验");
  await expect(updateTutorialProgress(a.id,{type:"save",courseId:"welcome",step:7,projectId:project.id})).rejects.toThrow("发布任务");
  await publishTaskTreeDraft(a.id,generated.draft.id);
  const [task]=await db.select().from(tasks).where(eq(tasks.projectId,project.id)).orderBy(tasks.sortOrder);
  expect((await getTutorialProgress(a.id)).journey?.taskId).toBe(task.id);
  expect((await updateTutorialProgress(a.id,{type:"save",courseId:"welcome",step:9,projectId:project.id})).journey?.taskId).toBe(task.id);
  await expect(updateTutorialProgress(a.id,{type:"save",courseId:"welcome",step:10,projectId:project.id})).rejects.toThrow("接住任务");
  await claimTask(a.id,task.id,{commitmentNote:"确认执行校验练习"});
  await expect(updateTutorialProgress(a.id,{type:"complete",courseId:"welcome"})).rejects.toThrow("提交练习");
  await submitTask(a.id,task.id,{completionNote:"练习证据：核对缺少必填字段和正常提交的验收场景"});
  const progress=await updateTutorialProgress(a.id,{type:"complete",courseId:"welcome"});expect(progress.completed).toEqual(["welcome"]);
  expect(progress.journey?.projectId).toBe(project.id);expect(progress.status).toBe("completed");
 });
 it("旧独立练习与旧长路线暂停到新版原页面第零步，保留其他课程",async()=>{
  const a=await user("a");await db.update(users).set({tutorialProgress:{status:"completed",completed:["welcome","teams"],active:{courseId:"welcome",step:10,projectId:null,journeyVersion:2}}}).where(eq(users.id,a.id));
  const progress=await getTutorialProgress(a.id);expect(progress.completed).toEqual(["teams"]);expect(progress.active).toEqual({courseId:"welcome",step:0,projectId:null,paused:true,journeyVersion:3});
 });
 it("重新开始只解除路线绑定，原有实际项目和其他功能记录仍保留",async()=>{
  const a=await user("a");const {project}=await journey(a.id);await updateTutorialProgress(a.id,{type:"complete",courseId:"teams"});
  const progress=await updateTutorialProgress(a.id,{type:"restart-example"});expect(progress.journey?.projectId).toBeNull();expect(progress.completed).toEqual(["teams"]);
  const {getProjectForUser}=await import("@/lib/project");expect(await getProjectForUser(a.id,project.id)).toBeTruthy();
 });
});
