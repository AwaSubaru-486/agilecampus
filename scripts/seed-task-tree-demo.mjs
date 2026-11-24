// Synthetic local UI fixture. Run seed-demo.mjs first; never modifies existing stages.
import postgres from "postgres";
import "dotenv/config";

const sql = postgres(process.env.DATABASE_URL);
try {
  const [project] = await sql`select id from projects where name = '敏捷校园 AgileCampus 全流程实训'`;
  if (!project) throw new Error("请先运行 node scripts/seed-demo.mjs");
  const existing = await sql`select id from task_stages where project_id = ${project.id}`;
  if (existing.length) throw new Error("项目已有阶段，本脚本不会覆盖现有数据");
  const [leader] = await sql`select id from users where email = 'leader@campus.edu'`;
  const [member] = await sql`select id from users where email = 'member@campus.edu'`;
  await sql.begin(async (tx) => {
    const [brief] = await tx`insert into project_briefs (project_id, content, created_by_id) values (${project.id}, '演示数据：实现任务规划、成员执行和导师评审。', ${leader.id}) returning id`;
    const specifications = [
      { title: "基础能力与权限", status: "completed", task: "完成三角色权限边界", taskStatus: "done" },
      { title: "任务生成与交付", status: "active", task: "完善任务生成与交付页面", taskStatus: "doing" },
      { title: "联调与阶段验收", status: "locked", task: "执行三角色联调验收", taskStatus: "todo" },
    ];
    for (const [index, item] of specifications.entries()) {
      const [stage] = await tx`insert into task_stages (project_id, source_brief_id, title, position, status) values (${project.id}, ${brief.id}, ${item.title}, ${index + 1}, ${item.status}) returning id`;
      const [task] = await tx`insert into tasks (project_id, stage_id, source_brief_id, title, description, status, assignee_id, created_by_id, priority, done_criteria, sort_order) values (${project.id}, ${stage.id}, ${brief.id}, ${item.task}, '演示任务：检查页面入口、服务端权限与失败反馈。', ${item.taskStatus}, ${member.id}, ${leader.id}, 'high', ${tx.json(["页面入口与角色一致", "越权操作返回错误"])} , ${index}) returning id`;
      if (index === 0) {
        await tx`insert into task_deliveries (task_id, branch_name, test_summary, submitted_by_id) values (${task.id}, 'demo/permissions', '演示材料，不代表真实 CI 测试', ${member.id})`;
        await tx`insert into stage_integrations (stage_id, branch_name, submitted_by_id, decision, review_note) values (${stage.id}, 'demo/integration', ${leader.id}, 'accepted', '演示审核记录')`;
      }
    }
    const payload = {
      summary: "演示草案：下一轮补充导师评审与回归检查。",
      stages: [{ title: "下一轮：评审体验", tasks: [{ key: "review", parentKey: null, title: "优化导师阶段评审材料", description: "整理分支与测试摘要，使导师能明确给出审核结论。", assigneeId: member.id, priority: "medium", doneCriteria: ["导师可以查看集成材料", "退回操作保留原因"] }] }],
    };
    await tx`insert into task_tree_drafts (project_id, brief_id, payload, created_by_id) values (${project.id}, ${brief.id}, ${tx.json(payload)}, ${leader.id})`;
  });
  console.log(`演示任务树已创建：/projects/${project.id}/task-tree`);
} finally {
  await sql.end();
}
