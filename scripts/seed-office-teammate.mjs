import "dotenv/config";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Explicitly local and clearly labelled: no real teammate credentials or tasks.
const connection = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(connection.hostname)) throw new Error("模拟队友仅用于本地数据库");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const email = "office-simulation-teammate@demo.invalid";
try {
  const requested = process.argv.find(value => value.startsWith("--project="))?.slice(10);
  const projects = requested
    ? await sql`select id,name,team_id from projects where id=${requested} and status='active'`
    : await sql`select id,name,team_id from projects where status='active' order by created_at desc limit 2`;
  if (projects.length !== 1) throw new Error("请用 --project=<项目 UUID> 指定一个活动项目");
  const project = projects[0];
  const [existing] = await sql`select id,name from users where email=${email}`;
  if (existing && existing.name !== "小橙（模拟队友）") throw new Error("模拟账号标识已被其他记录使用，未覆盖");
  const user = await sql.begin(async tx => {
    const [user] = await tx`insert into users(email,name,tutorial_progress) values(${email},'小橙（模拟队友）',${tx.json({ status: "dismissed", completed: [], active: null })}) on conflict(email) do update set name=excluded.name returning id,name`;
    await tx`insert into team_members(team_id,user_id,role) values(${project.team_id},${user.id},'student') on conflict(team_id,user_id) do nothing`;
    await tx`insert into home_profiles(owner_id,pet,working_team_id,working_project_id) values(${user.id},${tx.json({ name: "橙橙（模拟奶龙）", kind: "placeholder", petId: `web:${user.id}` })},${project.team_id},${project.id}) on conflict(owner_id) do update set pet=excluded.pet,working_team_id=excluded.working_team_id,working_project_id=excluded.working_project_id,updated_at=now()`;
    return user;
  });
  const runtime = path.resolve(".runtime", "web-pets", createHash("sha256").update(user.id).digest("hex"));
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, "desk-pet-config.json"), JSON.stringify({ preset: "nailong", name: "橙橙（模拟奶龙）", customImageUrl: "", soundEnabled: false, webPetVisible: false }), "utf8");
  console.log(JSON.stringify({ project: project.name, projectId: project.id, teammate: user.name, userId: user.id, pet: "橙橙（模拟奶龙）", state: "已在工位工作", url: `http://127.0.0.1:3000/projects/${project.id}` }, null, 2));
} finally { await sql.end(); }
