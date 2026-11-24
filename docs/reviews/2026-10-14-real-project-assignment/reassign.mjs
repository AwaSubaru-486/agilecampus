// One-project data repair authorized by the user. Dry-run unless --apply is given.
import postgres from "postgres";
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";

const projectId = "9f1b8e5b-1e54-4fa2-8d16-d12fdc40a04a";
const teamId = "ffe88690-3f16-4aa3-8c55-184ca4f6ebae";
const actorId = "9cbef0c4-c62b-46fb-9273-db2e3d95f9cb";
const names = ["鱼乐", "哈哈哈", "聂翔"];
const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  const result = await sql.begin(async tx => {
    const [project] = await tx`select p.id,p.name,te.name as team from projects p join teams te on te.id=p.team_id where p.id=${projectId} and p.team_id=${teamId} for update of p`;
    if (!project || project.name !== "表格" || project.team !== "汪汪队") throw new Error("实际项目不匹配，未写入");
    const [leader] = await tx`select user_id from team_members where team_id=${teamId} and user_id=${actorId} and role='admin' for share`;
    if (!leader) throw new Error("组长身份不匹配");
    const members = await tx`select u.id,u.name from team_members tm join users u on u.id=tm.user_id where tm.team_id=${teamId} and tm.role='student' and u.kind='human' and u.name in ${tx(names)} for share of tm,u`;
    const ordered = names.map(name => {
      const matches = members.filter(member => member.name === name);
      if (matches.length !== 1) throw new Error(`组员 ${name} 不唯一或不在当前团队`);
      return matches[0];
    });
    const rows = await tx`select t.*,s.position as stage_position from tasks t left join task_stages s on s.id=t.stage_id where t.project_id=${projectId} order by s.position nulls last,t.sort_order,t.id for update of t`;
    const pending = rows.filter(task => task.status === "todo" && !task.is_task_group);
    const historical = rows.filter(task => task.status !== "todo" || task.is_task_group);
    if (rows.length !== 46 || pending.length !== 45 || historical.length !== 1 || historical[0].status !== "done") throw new Error("任务状态或数量已变化，未写入");
    const assignments = pending.map((task, index) => ({ task, member: ordered[index % ordered.length] }));
    for (const { task, member } of assignments) {
      if (task.assignee_id !== actorId && task.assignee_id !== member.id) throw new Error("任务已由其他人改派，未覆盖");
    }
    const changed = assignments.filter(({ task, member }) => task.assignee_id !== member.id);
    if (apply && changed.length) {
      await mkdir(".runtime", { recursive: true });
      await writeFile(".runtime/real-project-assignment-2026-10-14-before.json", JSON.stringify({ projectId, teamId, rows }, null, 2), { flag: "wx" });
      for (const { task, member } of changed) {
        const updated = await tx`update tasks set assignee_id=${member.id}, committed_at=null, committed_handoff_version=null, commitment_note=null, estimated_hours=null, decline_reason=null, declined_at=null, declined_by_id=null, updated_at=now() where id=${task.id} and project_id=${projectId} and status='todo' and assignee_id=${actorId} returning id`;
        if (updated.length !== 1) throw new Error("任务已变化，全部回滚");
        await tx`insert into activity_events (project_id,actor_id,task_id,type,summary,payload) values (${projectId},${actorId},${task.id},'task_assigned',${`将「${task.title}」指派给 ${member.name}`},${tx.json({ title: task.title, to: member.id, toName: member.name, from: actorId, reason: "按用户要求修正实际项目的均匀分工" })})`;
      }
      const after = await tx`select t.*,s.position as stage_position from tasks t left join task_stages s on s.id=t.stage_id where t.project_id=${projectId} order by s.position nulls last,t.sort_order,t.id`;
      for (const { task, member } of assignments) {
        const actual = after.find(row => row.id === task.id);
        if (!actual || actual.assignee_id !== member.id || actual.status !== task.status || actual.handoff_version !== task.handoff_version || actual.stage_id !== task.stage_id) throw new Error("分配校验失败，全部回滚");
      }
      for (const task of historical) {
        if (JSON.stringify(after.find(row => row.id === task.id)) !== JSON.stringify(task)) throw new Error("完成记录发生变化，全部回滚");
      }
    }
    return { project: project.name, mode: apply ? "applied" : "dry-run", changed: changed.length, assignments: ordered.map(member => ({ name: member.name, tasks: assignments.filter(item => item.member.id === member.id).length })), preservedCompleted: historical.length };
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await sql.end(); }
