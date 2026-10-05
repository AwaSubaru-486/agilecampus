import postgres from "postgres";
import { readFileSync } from "node:fs";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
    if (line) return line.slice("DATABASE_URL=".length).trim();
  } catch {}
  return "postgres://agilecampus:agilecampus_dev@localhost:5432/agilecampus";
}

const sql = postgres(databaseUrl());

const PROJECT = "d0000000-0000-4000-8000-000000000201";
const TASK_UI = "d0000000-0000-4000-8000-000000000404";
const P = {
  owner: "d0000000-0000-4000-8000-000000000101", // 孙权
  zhou: "d0000000-0000-4000-8000-000000000102",  // 周瑜
  lu: "d0000000-0000-4000-8000-000000000103",    // 鲁肃
};

const CHECKPOINT_ID = "d0000000-0000-4000-8000-000000000901";
const HANDOFF_ID = "d0000000-0000-4000-8000-000000000921";
const ATTEMPT_1 = "d0000000-0000-4000-8000-000000000931";
const ATTEMPT_2 = "d0000000-0000-4000-8000-000000000932";
const MEM_1 = "d0000000-0000-4000-8000-000000000951";
const MEM_2 = "d0000000-0000-4000-8000-000000000952";
const MEM_3 = "d0000000-0000-4000-8000-000000000953";
const MEM_4 = "d0000000-0000-4000-8000-000000000954";

async function main() {
  console.log("正在为演示项目注入交接契约、检查点、并行 Attempts 与项目记忆...");

  // 1. 更新任务的交接契约
  await sql`
    update tasks
    set
      handoff_version = 2,
      handoff_brief = '实现支持流式输出与思考过程折叠的问答界面，接入向量库返回的检索证据卡片。',
      done_criteria = ${JSON.stringify([
        "实现 Markdown 与代码块高亮渲染",
        "支持 SSE 流式 Token 输出并自适应滚动",
        "检索召回证据悬浮卡片展示",
        "单测覆盖异常断网与重试逻辑",
      ])}::jsonb,
      required_evidence = ${JSON.stringify(["link", "test", "demo"])}::jsonb
    where id = ${TASK_UI}
  `;

  // 2. 清理可能存在的旧演示交接数据
  await sql`delete from attempt_receipts where task_id = ${TASK_UI}`;
  await sql`delete from handoff_records where task_id = ${TASK_UI}`;
  await sql`delete from checkpoint_indices where task_id = ${TASK_UI}`;
  await sql`delete from project_memories where project_id = ${PROJECT}`;

  // 3. 注入检查点索引 Checkpoint
  const headSha = "a8362c64b5e28d1f7c0a9b8e7d6c5b4a3f2e1d0c";
  await sql`
    insert into checkpoint_indices (
      id, project_id, task_id, creator_id, task_handoff_version, task_updated_at,
      repository_key_hash, head_sha, source, handoff_summary, materials, created_at
    ) values (
      ${CHECKPOINT_ID}, ${PROJECT}, ${TASK_UI}, ${P.owner}, 2, now(),
      'sha256:redcliff-qa-frontend', ${headSha},
      ${JSON.stringify({ provider: "codex-cli", providerVersion: "0.153.4", captureMode: "context-only" })}::jsonb,
      ${JSON.stringify({
        goal: "完成问答界面骨架与流式接收组件",
        completed: ["搭建 SSE 客户端通道", "基础 Markdown 渲染器集成"],
        remaining: ["思考过程折叠组件", "证据卡片浮层交互", "响应式适配与单测"],
        blocker: null,
        nextAction: "请接班同学在 VS Code 运行 preflight 核对基线，在独立分支继续完善并跑单测",
      })}::jsonb,
      ${JSON.stringify([
        {
          id: "d0000000-0000-4000-8000-000000000911",
          kind: "context",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          byteLength: 4280,
          transferred: true,
        },
      ])}::jsonb,
      now() - interval '2 days'
    )
  `;

  // 4. 注入交接记录 Handoff
  await sql`
    insert into handoff_records (
      id, project_id, task_id, checkpoint_id, from_user_id, to_user_id,
      expected_task_updated_at, expected_handoff_version, state, idempotency_key, created_at, resolved_at
    ) values (
      ${HANDOFF_ID}, ${PROJECT}, ${TASK_UI}, ${CHECKPOINT_ID}, ${P.owner}, ${P.lu},
      now() - interval '2 days', 2, 'accepted', 'idemp-handoff-921',
      now() - interval '2 days', now() - interval '1 day'
    )
  `;

  // 5. 注入并行 Attempts（同源并行方案）
  await sql`
    insert into attempt_receipts (
      id, handoff_id, checkpoint_id, task_id, actor_id, base_sha, branch_name, kind, provider, state, receipt, created_at, updated_at
    ) values
    (
      ${ATTEMPT_1}, ${HANDOFF_ID}, ${CHECKPOINT_ID}, ${TASK_UI}, ${P.lu}, ${headSha},
      'feat/ui-stream-reasoning', 'continuation', 'codex-cli', 'finished',
      ${JSON.stringify({
        sessionId: "codex-sess-931",
        headSha: "b4d5389a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f",
        changedPaths: ["src/components/chat-stream.tsx", "src/components/reasoning-panel.tsx", "tests/chat-stream.test.ts"],
        tests: [
          { commandLabel: "npm test -- tests/chat-stream.test.ts", exitCode: 0, source: "captured" },
          { commandLabel: "npm run check:ui-copy", exitCode: 0, source: "captured" }
        ],
      })}::jsonb,
      now() - interval '1 day', now() - interval '4 hours'
    ),
    (
      ${ATTEMPT_2}, ${HANDOFF_ID}, ${CHECKPOINT_ID}, ${TASK_UI}, ${P.zhou}, ${headSha},
      'feat/ui-virtualized-chat', 'parallel', 'codex-cli', 'finished',
      ${JSON.stringify({
        sessionId: "codex-sess-932",
        headSha: "c1b53cfa1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f",
        changedPaths: ["src/components/virtual-list.tsx", "src/components/chat-bubble.tsx"],
        tests: [
          { commandLabel: "npm test -- tests/virtual-list.test.ts", exitCode: 1, source: "captured" }
        ],
      })}::jsonb,
      now() - interval '18 hours', now() - interval '2 hours'
    )
  `;

  // 6. 注入有效项目记忆 Project Memories
  await sql`
    insert into project_memories (
      id, project_id, task_id, creator_id, confirmed_by_id, category, title, content, status, code_ref_sha, created_at
    ) values
    (
      ${MEM_1}, ${PROJECT}, ${TASK_UI}, ${P.owner}, ${P.owner}, 'constraint',
      '前端流式传输禁止使用轮询接口，必须保持 SSE 规范',
      '经压测长轮询会导致服务器网关连接数打满，流式返回必须使用标准 HTTP SSE 协议且支持客户端重连指数退避。',
      'active', 'a8362c64b5e28d1f', now() - interval '3 days'
    ),
    (
      ${MEM_2}, ${PROJECT}, ${TASK_UI}, ${P.zhou}, ${P.owner}, 'decision',
      'Markdown 代码块高亮采用 Shiki 静态渲染',
      '相比运行时 PrismJS 方案，服务端/静态提取能减少客户端 120KB JS 运行时体积，首屏渲染加速 30%。',
      'active', 'b4d5389a1c2d3e4f', now() - interval '2 days'
    ),
    (
      ${MEM_3}, ${PROJECT}, ${TASK_UI}, ${P.lu}, ${P.owner}, 'rejected_approach',
      '直接使用原生 textarea 自动拉伸高度方案（已废弃）',
      '在部分移动端浏览器上软键盘弹出时会出现光标跳动与遮挡问题，已重构成可自适应 height 的容器组件。',
      'superseded', null, now() - interval '1 day'
    ),
    (
      ${MEM_4}, ${PROJECT}, ${TASK_UI}, ${P.lu}, ${P.owner}, 'learned',
      '移动端 iOS Safari 必须显式处理 safe-area-inset-bottom',
      '底栏输入框在 iPhone 全面屏设备若无 env(safe-area-inset-bottom) 会与系统手势横条重叠导致误触。',
      'active', null, now() - interval '12 hours'
    )
  `;

  console.log("演示交接数据注入成功！");
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error(e);
    await sql.end();
    process.exit(1);
  });
