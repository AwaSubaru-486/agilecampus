import postgres from "postgres";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import "dotenv/config";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const sql = postgres(dbUrl);

async function seed() {
  console.log("正在初始化全流程演示数据...");

  const passwordHash = await bcrypt.hash("password123", 10);

  // 1. 创建三位基础用户（组长、组员、导师）
  const users = [
    { email: "leader@campus.edu", name: "安和队长 (Leader)", role: "admin" },
    { email: "member@campus.edu", name: "李组员 (Member)", role: "student" },
    { email: "teacher@campus.edu", name: "王导师 (Teacher)", role: "teacher" },
  ];

  const createdUserIds = {};

  for (const u of users) {
    const [existing] = await sql`SELECT id FROM users WHERE email = ${u.email}`;
    if (existing) {
      createdUserIds[u.email] = existing.id;
      console.log(`用户已存在: ${u.name} (${u.email})`);
    } else {
      const [inserted] = await sql`
        INSERT INTO users (email, password_hash, name, kind)
        VALUES (${u.email}, ${passwordHash}, ${u.name}, 'human')
        RETURNING id
      `;
      createdUserIds[u.email] = inserted.id;
      console.log(`已创建用户: ${u.name} (${u.email})`);
    }
  }

  // 2. 创建敏捷团队
  const teamName = "敏捷开发示范小组 (Agile-Team-01)";
  let teamId;
  const [existingTeam] = await sql`SELECT id, invite_code FROM teams WHERE name = ${teamName}`;
  if (existingTeam) {
    teamId = existingTeam.id;
    console.log(`团队已存在: ${teamName} (邀请码: ${existingTeam.invite_code})`);
  } else {
    const inviteCode = "AGILE2026";
    const [insertedTeam] = await sql`
      INSERT INTO teams (name, invite_code)
      VALUES (${teamName}, ${inviteCode})
      RETURNING id, invite_code
    `;
    teamId = insertedTeam.id;
    console.log(`已创建团队: ${teamName} (邀请码: ${inviteCode})`);
  }

  // 3. 关联成员角色
  for (const u of users) {
    const uid = createdUserIds[u.email];
    const [mem] = await sql`SELECT id FROM team_members WHERE team_id = ${teamId} AND user_id = ${uid}`;
    if (!mem) {
      await sql`
        INSERT INTO team_members (team_id, user_id, role)
        VALUES (${teamId}, ${uid}, ${u.role})
      `;
      console.log(`已添加成员至团队: ${u.name} -> 角色: ${u.role}`);
    }
  }

  // 4. 创建示范项目
  const projectName = "敏捷校园 AgileCampus 全流程实训";
  let projectId;
  const [existingProj] = await sql`SELECT id FROM projects WHERE team_id = ${teamId} AND name = ${projectName}`;
  if (existingProj) {
    projectId = existingProj.id;
    console.log(`项目已存在: ${projectName}`);
  } else {
    const [insertedProj] = await sql`
      INSERT INTO projects (team_id, name, description, status, start_date, end_date)
      VALUES (
        ${teamId},
        ${projectName},
        '面向高校团队的 Agent 驱动敏捷项目管理与协同实训项目',
        'active',
        '2026-10-01',
        '2026-10-30'
      )
      RETURNING id
    `;
    projectId = insertedProj.id;
    console.log(`已创建项目: ${projectName}`);
  }

  // 5. 创建里程碑
  let milestoneId;
  const [existingMs] = await sql`SELECT id FROM milestones WHERE project_id = ${projectId} AND title = 'M1: 敏捷框架与权限闭环'`;
  if (existingMs) {
    milestoneId = existingMs.id;
  } else {
    const [insertedMs] = await sql`
      INSERT INTO milestones (project_id, title, target_date, status)
      VALUES (${projectId}, 'M1: 敏捷框架与权限闭环', '2026-10-15', 'open')
      RETURNING id
    `;
    milestoneId = insertedMs.id;
    console.log("已创建里程碑: M1: 敏捷框架与权限闭环");
  }

  // 6. 创建初始敏捷任务卡片
  const tasksToSeed = [
    {
      title: "实现基于 RBAC 的角色分工与权限守卫组件",
      status: "review",
      priority: "high",
      assigneeId: createdUserIds["member@campus.edu"],
    },
    {
      title: "敏捷看板拖拽与状态机流转联调",
      status: "doing",
      priority: "medium",
      assigneeId: createdUserIds["member@campus.edu"],
    },
    {
      title: "编写项目架构设计文档与单元测试",
      status: "done",
      priority: "medium",
      assigneeId: createdUserIds["leader@campus.edu"],
    },
    {
      title: "组织全组开展 Sprint 迭代闭环评审",
      status: "todo",
      priority: "high",
      assigneeId: createdUserIds["leader@campus.edu"],
    },
  ];

  for (const t of tasksToSeed) {
    const [existingTask] = await sql`SELECT id FROM tasks WHERE project_id = ${projectId} AND title = ${t.title}`;
    if (!existingTask) {
      await sql`
        INSERT INTO tasks (project_id, milestone_id, title, status, priority, assignee_id)
        VALUES (${projectId}, ${milestoneId}, ${t.title}, ${t.status}, ${t.priority}, ${t.assigneeId})
      `;
      console.log(`已添加任务卡片: [${t.status}] ${t.title}`);
    }
  }

  console.log("\n==========================================");
  console.log("🎉 演示数据初始化完毕！");
  console.log("可用账号与初始密码（统一密码：password123）：");
  console.log("1. 组长 (Leader/Admin): leader@campus.edu");
  console.log("2. 组员 (Member/Student): member@campus.edu");
  console.log("3. 导师 (Teacher): teacher@campus.edu");
  console.log("团队邀请码: AGILE2026");
  console.log("==========================================\n");

  await sql.end();
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
