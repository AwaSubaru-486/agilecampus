// 演示数据种子。直接写 SQL 而非调 lib 函数，为的是把时间戳回填到过去。
//
// 若用 createTask/claimTask 那些真函数跑一遍，所有事件都会落在「此刻」，
// 于是健康度里既没有「逾期 5 天」也没有「14 天没动」——恰恰是最该被看见的几类。
// 时间可回填，是这份脚本唯一必须手写 SQL 的理由。
//
// 不触碰任何既有团队：演示数据自成一个团队，跑之前先清掉上一轮的演示团队。
//
// 用法：node scripts/seed-demo.mjs
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim();
  } catch {
    /* 落到下面的默认值 */
  }
  return "postgres://agilecampus:agilecampus_dev@localhost:5432/agilecampus";
}

const sql = postgres(databaseUrl());

const DEMO_TEAM_NAME = "演示实验室（可删）";
const DEMO_PASSWORD = "demo1234";
const DAY = 86_400_000;
const HOUR = 3_600_000;

const now = Date.now();
const at = (days, hours = 0) => new Date(now - days * DAY - hours * HOUR);
// 日期列用本地时区的 YYYY-MM-DD（与 lib/today.ts 同口径）
const dayStr = (ms) => new Date(ms).toLocaleDateString("sv-SE");
const daysAgoStr = (d) => dayStr(now - d * DAY);

// 固定 id：脚本可重复执行，且清库时有据可依
const TEAM = "d0000000-0000-4000-8000-000000000001";
const P = {
  zhou: "d0000000-0000-4000-8000-000000000102",
  lu: "d0000000-0000-4000-8000-000000000103",
  zhang: "d0000000-0000-4000-8000-000000000104",
  teacher: "d0000000-0000-4000-8000-000000000105",
};
const PROJECT = "d0000000-0000-4000-8000-000000000201";
const M = {
  kickoff: "d0000000-0000-4000-8000-000000000301",
  mid: "d0000000-0000-4000-8000-000000000302",
};
const T = {
  survey: "d0000000-0000-4000-8000-000000000401",
  crawler: "d0000000-0000-4000-8000-000000000402",
  finetune: "d0000000-0000-4000-8000-000000000403",
  ui: "d0000000-0000-4000-8000-000000000404",
  report: "d0000000-0000-4000-8000-000000000405",
  recruit: "d0000000-0000-4000-8000-000000000406",
  deploy: "d0000000-0000-4000-8000-000000000407",
  refs: "d0000000-0000-4000-8000-000000000408",
  meeting: "d0000000-0000-4000-8000-000000000409",
  compute: "d0000000-0000-4000-8000-000000000410",
  clean: "d0000000-0000-4000-8000-000000000411",
  // 交给 AI 成员的两件活
  api: "d0000000-0000-4000-8000-000000000412",
  docs: "d0000000-0000-4000-8000-000000000413",
};
const L = {
  risk: "d0000000-0000-4000-8000-000000000501",
  hard: "d0000000-0000-4000-8000-000000000502",
};
// AI 成员。id 定义提到这里，是因为清理逻辑要用到它们
const AG = {
  codegen: "d0000000-0000-4000-8000-000000000701",
  writer: "d0000000-0000-4000-8000-000000000702",
};
const B = {
  blocked: "d0000000-0000-4000-8000-000000000601",
  waiting: "d0000000-0000-4000-8000-000000000602",
  doneGpu: "d0000000-0000-4000-8000-000000000603",
  agentBlocked: "d0000000-0000-4000-8000-000000000604",
};

async function main() {
  const owner = await sql`select id, name from users where email = '13950150783@163.com'`;
  if (owner.length === 0) {
    console.error("未找到账号 13950150783@163.com，请先在网页上注册后再跑本脚本。");
    process.exit(1);
  }
  const ownerId = owner[0].id;

  // 先清掉上一轮的演示团队。只删自己建的这一个 id，不碰任何既有团队。
  await sql`delete from teams where id = ${TEAM}`;
  // 演示成员与 AI 成员的 users 行要显式删：users 不随团队级联，
  // 留着会让下一次重跑撞主键。主公自己的账号不在其列。
  await sql`delete from users where id in ${sql([...Object.values(P), ...Object.values(AG)])}`;
  await sql`delete from team_members where team_id = ${TEAM}`;

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  // 四个演示成员用固定 id 新建；主公是你自己的账号，id 由上面查出，不动它。
  const people = [
    [P.zhou, "zhouyu@demo.local", "周瑜"],
    [P.lu, "lusu@demo.local", "鲁肃"],
    [P.zhang, "zhangzhao@demo.local", "张昭"],
    [P.teacher, "zhugejin@demo.local", "诸葛瑾"],
  ];
  for (const [id, email, name] of people) {
    await sql`
      insert into users (id, email, password_hash, name)
      values (${id}, ${email}, ${hash}, ${name})
      on conflict (email) do nothing
    `;
  }

  await sql`insert into teams (id, name, invite_code) values (${TEAM}, ${DEMO_TEAM_NAME}, 'demo1234')`;
  await sql`
    insert into team_members (team_id, user_id, role) values
      (${TEAM}, ${ownerId}, 'admin'),
      (${TEAM}, ${P.zhou}, 'student'),
      (${TEAM}, ${P.lu}, 'student'),
      (${TEAM}, ${P.zhang}, 'student'),
      (${TEAM}, ${P.teacher}, 'teacher')
  `;

  await sql`
    insert into projects (id, team_id, name, description, status, start_date, end_date, created_at)
    values (${PROJECT}, ${TEAM}, '赤壁演习 · 智能问答系统',
            '面向课程知识库的问答系统，中期需交付可演示版本。',
            'active', ${daysAgoStr(24)}, ${dayStr(now + 18 * DAY)}, ${at(24)})
  `;
  await sql`
    insert into milestones (id, project_id, title, target_date, status, created_at) values
      (${M.kickoff}, ${PROJECT}, '需求与数据就绪', ${daysAgoStr(10)}, 'done', ${at(24)}),
      (${M.mid}, ${PROJECT}, '中期可演示', ${dayStr(now + 4 * DAY)}, 'open', ${at(24)})
  `;
  await sql`
    insert into labels (id, team_id, name, color) values
      (${L.risk}, ${TEAM}, '阻塞风险', 'red'),
      (${L.hard}, ${TEAM}, '硬骨头', 'amber')
  `;

  // ---- 任务 ----
  // 字段：id, 标题, 状态, 负责人, 里程碑, 建于几天前, 最后更新于几天前, 截止于几天前(null=不设)
  const tasks = [
    // 已完整走完闭环：认领 → 提交 → 通过
    [T.survey, '完成需求调研问卷', 'done', P.zhou, M.kickoff, 24, 15, 16],
    [T.crawler, '搭建数据采集脚本', 'done', P.lu, M.kickoff, 22, 11, 12],
    // 已提交、等验收三天 → 触发「验收积压」
    [T.finetune, '模型微调实验', 'review', P.zhou, M.mid, 18, 3, 4],
    // 逾期两天
    [T.ui, '前端问答界面', 'doing', P.lu, M.mid, 16, 8, 2],
    // 逾期五天（高危），且十四天没动 → 同时触发「长期未动」
    [T.report, '撰写中期报告', 'doing', P.zhang, M.mid, 20, 14, 5],
    // 无人负责且建了四天 → 触发「无人负责」
    [T.recruit, '用户测试招募', 'todo', null, null, 4, 4, null],
    // 以下四项都压在周瑜身上，连同 deploy 凑够五项在办 → 触发「负荷过重」
    [T.deploy, '部署到实验室服务器', 'doing', P.zhou, M.mid, 21, 6, 1],
    [T.refs, '补充参考文献', 'todo', P.zhou, null, 13, 6, null],
    [T.meeting, '整理每周组会纪要', 'doing', P.zhou, null, 12, 5, null],
    [T.compute, '对接学院算力申请', 'todo', P.zhou, null, 10, 5, null],
    [T.clean, '清洗问答对数据', 'todo', P.zhou, M.mid, 9, 4, null],
  ];

  for (const [id, title, status, assignee, milestone, created, updated, due] of tasks) {
    await sql`
      insert into tasks (id, project_id, milestone_id, title, status, priority, assignee_id,
                         created_by_id, start_date, due_date, sort_order, created_at, updated_at)
      values (${id}, ${PROJECT}, ${milestone}, ${title}, ${status},
              ${status === 'review' ? 'high' : 'medium'},
              ${assignee}, ${ownerId},
              ${daysAgoStr(created)}, ${due === null ? null : daysAgoStr(due)},
              ${created}, ${at(created)}, ${at(updated)})
    `;
  }

  // 承诺与验收的诸字段，回填到各自动作发生的时刻
  await sql`update tasks set commitment_note = '先出提纲再发问卷，目标回收 60 份', estimated_hours = 8,
            committed_at = ${at(23)} where id = ${T.survey}`;
  await sql`update tasks set completion_note = '回收 63 份有效问卷，原始数据已上传共享盘',
            submitted_at = ${at(16)}, reviewed_at = ${at(15)}, reviewed_by_id = ${P.teacher},
            review_note = '样本结构合理' where id = ${T.survey}`;
  await sql`update tasks set commitment_note = '用现成爬虫框架改，两天能跑通', estimated_hours = 6,
            committed_at = ${at(21)} where id = ${T.crawler}`;
  await sql`update tasks set completion_note = '采集 1.2 万条问答对，脚本在仓库 scripts/',
            submitted_at = ${at(12)}, reviewed_at = ${at(11)}, reviewed_by_id = ${ownerId}
            where id = ${T.crawler}`;
  await sql`update tasks set commitment_note = '先跑通基线，再调学习率', estimated_hours = 20,
            committed_at = ${at(17)} where id = ${T.finetune}`;
  await sql`update tasks set completion_note = '第一版微调完成，准确率 71%，日志与权重在共享盘',
            submitted_at = ${at(3)} where id = ${T.finetune}`;
  await sql`update tasks set commitment_note = '先做能用的一版，样式后补', estimated_hours = 14,
            committed_at = ${at(15)} where id = ${T.ui}`;
  await sql`update tasks set commitment_note = '按学院模板写，三天出初稿', estimated_hours = 10,
            committed_at = ${at(18)}, reject_count = 1, review_note = '实验部分太薄，补一组对比'
            where id = ${T.report}`;
  await sql`update tasks set commitment_note = '我先把服务跑起来，模型再换', estimated_hours = 4,
            committed_at = ${at(19)} where id = ${T.deploy}`;
  await sql`update tasks set commitment_note = '用模板套，每次十分钟', estimated_hours = 2,
            committed_at = ${at(12)} where id = ${T.meeting}`;
  await sql`update tasks set commitment_note = '先问清楚流程再填表', estimated_hours = 3,
            committed_at = ${at(10)} where id = ${T.compute}`;
  await sql`update tasks set commitment_note = '写脚本跑一遍，人工抽查', estimated_hours = 5,
            committed_at = ${at(9)} where id = ${T.clean}`;

  await sql`insert into task_labels (task_id, label_id) values
    (${T.report}, ${L.risk}), (${T.finetune}, ${L.hard}), (${T.deploy}, ${L.hard})`;

  // ---- 求助：两条悬着、一条已解 ----
  await sql`
    insert into blockers (id, project_id, task_id, raised_by_id, reason, detail, help_needed,
                          status, resolved_by_id, resolution_note, resolved_at, created_at) values
      (${B.blocked}, ${PROJECT}, ${T.finetune}, ${P.zhou}, 'tech',
       '调了三版学习率都不收敛，loss 卡在 2.3 下不去',
       '想找人一起看一眼训练日志，或推荐一组可用的超参',
       'open', null, null, null, ${at(2, 6)}),
      (${B.waiting}, ${PROJECT}, ${T.ui}, ${P.lu}, 'dependency',
       '前端要的接口字段和后端定的对不上，等确认',
       '希望后端同学今天确认一下返回结构',
       'open', null, null, null, ${at(0, 20)}),
      (${B.doneGpu}, ${PROJECT}, ${T.crawler}, ${P.lu}, 'resource',
       '本机跑不动，需要一张显卡',
       '借一台带显卡的机器跑两天',
       'resolved', ${P.zhou}, '实验室那台空着，我把账号给他了', ${at(13)}, ${at(14)})
  `;
  await sql`insert into blocker_invites (blocker_id, invitee_id, invited_by_id, score, reasons, created_at)
            values (${B.blocked}, ${P.zhang}, ${P.zhou}, 0.62, ${sql.json(["在同一里程碑下完成过 2 个任务"])}, ${at(2, 6)})`;

  // ---- 活动流：与上面每个动作一一对应，时间戳即动作发生的时刻 ----
  const ev = (type, actor, task, summary, payload, atMs) => [
    PROJECT, task, actor, type, summary, payload === null ? null : JSON.stringify(payload), atMs,
  ];
  const events = [
    ev("project_created", ownerId, null, "创建了项目「赤壁演习 · 智能问答系统」", { name: "赤壁演习 · 智能问答系统" }, at(24)),
    ev("milestone_created", ownerId, null, "新建里程碑「需求与数据就绪」", { title: "需求与数据就绪" }, at(24)),
    ev("milestone_created", ownerId, null, "新建里程碑「中期可演示」", { title: "中期可演示" }, at(24)),
    ev("task_created", ownerId, T.survey, "创建了任务「完成需求调研问卷」", { title: "完成需求调研问卷" }, at(24)),
    ev("task_created", ownerId, T.crawler, "创建了任务「搭建数据采集脚本」", { title: "搭建数据采集脚本" }, at(22)),
    ev("task_created", ownerId, T.report, "创建了任务「撰写中期报告」", { title: "撰写中期报告" }, at(20)),
    ev("task_created", ownerId, T.deploy, "创建了任务「部署到实验室服务器」", { title: "部署到实验室服务器" }, at(21)),
    ev("task_created", ownerId, T.finetune, "创建了任务「模型微调实验」", { title: "模型微调实验" }, at(18)),
    ev("task_created", ownerId, T.ui, "创建了任务「前端问答界面」", { title: "前端问答界面" }, at(16)),
    ev("task_created", ownerId, T.refs, "创建了任务「补充参考文献」", { title: "补充参考文献" }, at(13)),
    ev("task_created", ownerId, T.recruit, "创建了任务「用户测试招募」", { title: "用户测试招募" }, at(4)),
    ev("task_created", ownerId, T.meeting, "创建了任务「整理每周组会纪要」", { title: "整理每周组会纪要" }, at(12)),
    ev("task_created", ownerId, T.compute, "创建了任务「对接学院算力申请」", { title: "对接学院算力申请" }, at(10)),
    ev("task_created", ownerId, T.clean, "创建了任务「清洗问答对数据」", { title: "清洗问答对数据" }, at(9)),

    ev("task_claimed", P.zhou, T.survey, "认领「完成需求调研问卷」，承诺先出提纲再发问卷，目标回收 60 份", { title: "完成需求调研问卷", commitmentNote: "先出提纲再发问卷，目标回收 60 份", estimatedHours: 8 }, at(23)),
    ev("task_submitted", P.zhou, T.survey, "提交了「完成需求调研问卷」待验收", { title: "完成需求调研问卷", assigneeId: P.zhou }, at(16)),
    ev("task_accepted", P.teacher, T.survey, "验收通过「完成需求调研问卷」", { title: "完成需求调研问卷", assigneeId: P.zhou, reviewerId: P.teacher }, at(15)),
    ev("task_claimed", P.lu, T.crawler, "认领「搭建数据采集脚本」，承诺用现成爬虫框架改，两天能跑通", { title: "搭建数据采集脚本", commitmentNote: "用现成爬虫框架改，两天能跑通", estimatedHours: 6 }, at(21)),
    ev("task_submitted", P.lu, T.crawler, "提交了「搭建数据采集脚本」待验收", { title: "搭建数据采集脚本", assigneeId: P.lu }, at(12)),
    ev("task_accepted", ownerId, T.crawler, "验收通过「搭建数据采集脚本」", { title: "搭建数据采集脚本", assigneeId: P.lu, reviewerId: ownerId }, at(11)),

    ev("blocker_raised", P.lu, T.crawler, "求助：缺资源或设备，需要借一台带显卡的机器跑两天", { reason: "resource", helpNeeded: "借一台带显卡的机器跑两天", inviteeIds: [] }, at(14)),
    ev("blocker_resolved", P.zhou, T.crawler, "解决了一次求助（缺资源或设备）", { note: "实验室那台空着，我把账号给他了", raisedById: P.lu }, at(13)),

    ev("task_claimed", P.zhou, T.finetune, "认领「模型微调实验」，承诺先跑通基线，再调学习率", { title: "模型微调实验", commitmentNote: "先跑通基线，再调学习率", estimatedHours: 20 }, at(17)),
    ev("task_claimed", P.zhang, T.report, "认领「撰写中期报告」，承诺按学院模板写，三天出初稿", { title: "撰写中期报告", commitmentNote: "按学院模板写，三天出初稿", estimatedHours: 10 }, at(18)),
    ev("task_submitted", P.zhang, T.report, "提交了「撰写中期报告」待验收", { title: "撰写中期报告", assigneeId: P.zhang }, at(9)),
    ev("task_rejected", ownerId, T.report, "退回「撰写中期报告」：实验部分太薄，补一组对比", { title: "撰写中期报告", note: "实验部分太薄，补一组对比", assigneeId: P.zhang, reviewerId: ownerId }, at(8)),
    ev("task_labeled", ownerId, T.report, "为「撰写中期报告」贴上标签：阻塞风险", { labelNames: ["阻塞风险"] }, at(8)),

    ev("task_claimed", P.lu, T.ui, "认领「前端问答界面」，承诺先做能用的一版，样式后补", { title: "前端问答界面", commitmentNote: "先做能用的一版，样式后补", estimatedHours: 14 }, at(15)),
    ev("task_claimed", P.zhou, T.deploy, "认领「部署到实验室服务器」，承诺我先把服务跑起来，模型再换", { title: "部署到实验室服务器", commitmentNote: "我先把服务跑起来，模型再换", estimatedHours: 4 }, at(19)),
    ev("task_assigned", ownerId, T.refs, "将「补充参考文献」指派给 周瑜", { title: "补充参考文献", toName: "周瑜" }, at(13)),
    ev("task_claimed", P.zhou, T.meeting, "认领「整理每周组会纪要」，承诺用模板套，每次十分钟", { title: "整理每周组会纪要", commitmentNote: "用模板套，每次十分钟", estimatedHours: 2 }, at(12)),
    ev("task_claimed", P.zhou, T.compute, "认领「对接学院算力申请」，承诺先问清楚流程再填表", { title: "对接学院算力申请", commitmentNote: "先问清楚流程再填表", estimatedHours: 3 }, at(10)),
    ev("task_claimed", P.zhou, T.clean, "认领「清洗问答对数据」，承诺写脚本跑一遍，人工抽查", { title: "清洗问答对数据", commitmentNote: "写脚本跑一遍，人工抽查", estimatedHours: 5 }, at(9)),
    ev("task_labeled", ownerId, T.finetune, "为「模型微调实验」贴上标签：硬骨头", { labelNames: ["硬骨头"] }, at(5)),

    ev("task_submitted", P.zhou, T.finetune, "提交了「模型微调实验」待验收", { title: "模型微调实验", assigneeId: P.zhou }, at(3)),
    ev("blocker_raised", P.zhou, T.finetune, "求助：技术难题，需要想找人一起看一眼训练日志，或推荐一组可用的超参", { reason: "tech", helpNeeded: "想找人一起看一眼训练日志，或推荐一组可用的超参", detail: "调了三版学习率都不收敛，loss 卡在 2.3 下不去", inviteeIds: [P.zhang] }, at(2.25)),
    ev("blocker_raised", P.lu, T.ui, "求助：在等别人配合，需要希望后端同学今天确认一下返回结构", { reason: "dependency", helpNeeded: "希望后端同学今天确认一下返回结构", inviteeIds: [] }, at(0.83)),
  ];

  for (const e of events) {
    await sql`
      insert into activity_events (project_id, task_id, actor_id, type, summary, payload, created_at)
      values (${e[0]}, ${e[1]}, ${e[2]}, ${e[3]}, ${e[4]}, ${e[5]}, ${e[6]})
    `;
  }

  // ---- AI 成员：人机混排的演示 ----
  // agent 也是 users 的一行（kind='agent'、无密码、合成邮箱），
  // 同时占一个 team_members 席位（角色 student），这样既有权限层原样适用。
  for (const [id, name, provider, caps] of [
    [AG.codegen, "小码", "claude-code", ["写接口", "写测试"]],
    [AG.writer, "小文", "codex", ["整理文档", "写纪要"]],
  ]) {
    await sql`
      insert into users (id, email, password_hash, kind, name)
      values (${id}, ${`agent-${id}@agents.local`}, null, 'agent', ${name})
    `;
    await sql`insert into team_members (team_id, user_id, role) values (${TEAM}, ${id}, 'student')`;
    await sql`
      insert into agents (user_id, team_id, provider, runtime, capabilities, status,
                          max_concurrent, owner_id, last_seen_at)
      values (${id}, ${TEAM}, ${provider}, 'local', ${caps}, ${id === AG.codegen ? 'idle' : 'blocked'},
              1, ${ownerId}, ${at(0, 0.2)})
    `;
  }

  // 交给 agent 的两件活：一件它交了等人验收，一件它卡住了
  await sql`
    insert into tasks (id, project_id, milestone_id, title, description, status, priority,
                       assignee_id, created_by_id, start_date, due_date, sort_order,
                       commitment_note, committed_at, estimated_hours,
                       completion_note, submitted_at, created_at, updated_at)
    values
      (${T.api}, ${PROJECT}, ${M.mid}, '实现问答接口', '按前端给的字段定义写三个端点',
       'review', 'high', ${AG.codegen}, ${ownerId},
       ${daysAgoStr(6)}, ${daysAgoStr(1)}, 30,
       '先定 schema，再写三个端点，最后补测试', ${at(6)}, 6,
       '三个端点都通了，含 12 个单测。接口字段可能还要按前端反馈微调',
       ${at(1)}, ${at(6)}, ${at(1)}),
      (${T.docs}, ${PROJECT}, ${null}, '整理中期材料', '把散在各处的材料汇总成一份',
       'doing', 'medium', ${AG.writer}, ${ownerId},
       ${daysAgoStr(5)}, ${null}, 31,
       '按学院模板汇总，边写边补缺口', ${at(5)}, 4,
       ${null}, ${null}, ${at(5)}, ${at(2)})
  `;
  await sql`
    insert into agent_runs (agent_id, task_id, status, priority, dispatched_at, started_at,
                            finished_at, result, created_at)
    values
      (${AG.codegen}, ${T.api}, 'completed', 10, ${at(6)}, ${at(6)}, ${at(1)},
       ${sql.json({ files: ["src/api/qa.ts", "tests/qa.test.ts"], tests: "12 passed" })}, ${at(6)}),
      (${AG.writer}, ${T.docs}, 'running', 5, ${at(5)}, ${at(5)}, ${null},
       ${sql.json({ progress: "已汇总 6 份材料，缺实验数据一节" })}, ${at(5)})
  `;
  // 小文卡住了——agent 的阻塞走同一套求助机制，于是它自动进协作推荐与健康度
  await sql`
    insert into blockers (id, project_id, task_id, raised_by_id, reason, detail, help_needed,
                          status, resolved_by_id, resolution_note, resolved_at, created_at)
    values (${B.agentBlocked}, ${PROJECT}, ${T.docs}, ${AG.writer}, 'unclear',
            '实验数据那一节该写什么，翻遍材料也没有',
            '希望有人告诉我中期要交哪些实验数据',
            'open', null, null, null, ${at(2, 3)})
  `;

  // 人机混排的账本：agent 的动作与人并列，靠 actor 是 agent 区分
  const agentEvents = [
    ev("task_created", ownerId, T.api, "创建了任务「实现问答接口」", { title: "实现问答接口" }, at(6, 2)),
    ev("task_assigned", ownerId, T.api, "将「实现问答接口」指派给 小码", { title: "实现问答接口", toName: "小码" }, at(6, 1)),
    ev("task_claimed", AG.codegen, T.api, "认领「实现问答接口」，承诺先定 schema，再写三个端点，最后补测试", { title: "实现问答接口", commitmentNote: "先定 schema，再写三个端点，最后补测试", estimatedHours: 6 }, at(6)),
    ev("task_submitted", AG.codegen, T.api, "提交了「实现问答接口」待验收", { title: "实现问答接口", assigneeId: AG.codegen }, at(1)),
    ev("task_created", ownerId, T.docs, "创建了任务「整理中期材料」", { title: "整理中期材料" }, at(5, 2)),
    ev("task_assigned", ownerId, T.docs, "将「整理中期材料」指派给 小文", { title: "整理中期材料", toName: "小文" }, at(5, 1)),
    ev("task_claimed", AG.writer, T.docs, "认领「整理中期材料」，承诺按学院模板汇总，边写边补缺口", { title: "整理中期材料", commitmentNote: "按学院模板汇总，边写边补缺口", estimatedHours: 4 }, at(5)),
    ev("blocker_raised", AG.writer, T.docs, "求助：需求不清楚，需要希望有人告诉我中期要交哪些实验数据", { reason: "unclear", helpNeeded: "希望有人告诉我中期要交哪些实验数据", detail: "实验数据那一节该写什么，翻遍材料也没有", inviteeIds: [] }, at(2, 3)),
  ];
  for (const e of agentEvents) {
    await sql`
      insert into activity_events (project_id, task_id, actor_id, type, summary, payload, created_at)
      values (${e[0]}, ${e[1]}, ${e[2]}, ${e[3]}, ${e[4]}, ${e[5]}, ${e[6]})
    `;
  }

  const counts = await sql`
    select (select count(*) from tasks where project_id = ${PROJECT}) as tasks,
           (select count(*) from activity_events where project_id = ${PROJECT}) as events,
           (select count(*) from blockers where project_id = ${PROJECT}) as blockers
  `;

  console.log("\n演示数据已就绪\n");
  console.log(`  团队：${DEMO_TEAM_NAME}`);
  console.log(`  项目：赤壁演习 · 智能问答系统`);
  console.log(`  ${counts[0].tasks} 个任务 / ${counts[0].events} 条过程记录 / ${counts[0].blockers} 条求助`);
  console.log("\n  登录：用你自己的账号 13950150783@163.com（已是该团队管理员）");
  console.log(`  也可用其他角色登录，密码统一是 ${DEMO_PASSWORD}：`);
  console.log("    zhouyu@demo.local     周瑜    学生（手上最忙）");
  console.log("    lusu@demo.local       鲁肃    学生");
  console.log("    zhangzhao@demo.local  张昭    学生");
  console.log("    zhugejin@demo.local   诸葛瑾  教师（可验收，不能编辑）");
  console.log("  另有 2 个 AI 成员：小码（已交活待验收）、小文（卡住了，发了求助）");
  console.log("  看 AI 成员：团队 → 成员 → 管理 AI 成员");
  console.log("\n  删除：psql -U agilecampus -d agilecampus -c \"delete from teams where id = 'd0000000-0000-4000-8000-000000000001'\"\n");
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
