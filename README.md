# AgileCampus 敏捷校园

**面向高校团队的人机协作现场。** 不替学生做项目，而是让团队在人与 AI 之间交接工作时，不丢背景、不丢责任、不丢证据。

> **共享工作区协作分工（先读）**：Codex 负责业务核心、AI 数据链路、任务状态与最终验收；Antigravity 负责可见 UI、响应式和视觉 QA。完整边界见 [`AGENTS.md`](AGENTS.md)。

> 它和普通项目管理工具的区别：普通工具问「有哪些任务、各在什么状态」；AgileCampus 问「**这件事现在停在谁手上、他为什么要接着做、做完了谁认账**」。

## 五个核心对象

界面围绕这五个对象组织，不围绕「仪表盘 / 看板 / 聊天」组织。详见 [`docs/design/product-language.md`](docs/design/product-language.md)。

| 对象 | 回答的问题 |
|---|---|
| **行动** Action | 现在该我做什么？ |
| **交接** Handoff | 这件事谁接住了？ |
| **上下文** Context | AI 或同伴需要知道什么？ |
| **决策** Decision | 为什么最后选了这个？ |
| **证据** Evidence | 做成了什么，凭什么算数？ |

## 功能特性

### 人机同席

- **AI 成员**：注册后与人在同一张表里，可被指派任务、能接活、能汇报、能卡住求助、能交付待验收
- **接住 / 接不住**：活被派下来，接不住的人（或 AI）当场说得出口——而不是拖到 deadline 才暴露
- **agent 干活，但不参与验收**：判断「做对了没有」是人的活
- **agent 协议**：`GET /api/agent/inbox` 领活、`POST /api/agent/runs` 汇报，认证复用 Personal API Token

### 过程可见

- **工作现场**：正在发生（人与 AI 混排的实时状态）、接力（一件工作怎么在人与 AI 之间流转）、里程碑（自动记录的功勋墙）
- **项目健康度**：六类风险，每条都答「为什么红 / 该做什么 / 谁来做」——不是仪表盘，是待办清单
- **阻塞上报**：一键「我卡住了」，自动推荐可能帮得上的人（推荐带理由）
- **项目活动流**：append-only 的过程账本，人机混排、分得清谁做的

### 闭环与沉淀

- **任务承诺与验收**：认领时写下「我打算怎么做」；做完只能推到「待验收」，判完成权在组长或教师
- **贡献记录零填写**：全部从活动流算出，**没有任何一格需要人填**；刻意不产出「贡献总分」
- **项目档案**：老师反馈、文档、成果链接，落在同一处
- **里程碑自动记录**：达成自己判定，值得记住的事自己长出来

### 基础设施

- **团队与角色**：admin / teacher / student 三级权限
- **项目四模式**：现场 / 工作 / 协同室 / 记录（见产品语言文档）
- **资源占用登记**、**时间线甘特**、**飞书通知与提醒**

## 设计文档

- 原创性审计（与原版的逐项差异）：[`docs/design/originality-audit.md`](docs/design/originality-audit.md)
- 产品语言（术语、路由、骨架）：[`docs/design/product-language.md`](docs/design/product-language.md)
- 施工计划：[`docs/superpowers/plans/`](docs/superpowers/plans/)
- 技术债备案：[`docs/BACKLOG.md`](docs/BACKLOG.md)

## 来源说明

本项目 fork 自 [`sdiver/agilecampus`](https://github.com/sdiver/agilecampus)，`upstream` remote 与原许可证原样保留。
产品结构与交互对象为重新设计，借鉴的第三方代码按许可证署名。

## 技术栈

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · PostgreSQL 16 + Drizzle ORM · Auth.js v5 (JWT) · Vercel AI SDK v5 (DeepSeek / openai-compatible) · Tailwind CSS v4 · Vitest

## 本地启动

```bash
docker compose up -d          # 启动 Postgres（首次自动建 dev 与 test 两库）
cp .env.example .env          # 填入 AUTH_SECRET（openssl rand -base64 32）与 DATABASE_URL
npm install
npm run db:push               # 推送 schema 到开发库
npm run db:push:test          # 推送 schema 到测试库
npm run dev
```

> `scripts/init-test-db.sql` 仅在 Postgres 数据卷**首次初始化**时执行。若改过 init 脚本或测试库缺失，需 `docker compose down -v` 重建数据卷再 `up`（会清空本地开发数据）。
> 本机若用 colima 提供 Docker：先 `colima start`。

测试：`npm test`

## 生产部署（一键全栈）

`docker-compose.prod.yml` 编排 `db` + `migrate`（自动建表）+ `app` 三服务，同网络起，无需手动推 schema。

```bash
cp .env.example .env
# 填齐生产密钥：
#   AUTH_SECRET=$(openssl rand -base64 32)
#   POSTGRES_PASSWORD=<强密码>          # db 密码，compose 变量插值单一来源
#   AGILECAMPUS_URL=https://<对外域名>   # 飞书 OAuth 回调据此拼跳转
#   DEEPSEEK_API_KEY / FEISHU_APP_ID / FEISHU_APP_SECRET=<真值>
#   FEISHU_REDIRECT_URI=https://<对外域名>/api/auth/feishu/callback
#   CRON_SECRET=$(openssl rand -hex 32)
nano .env

docker compose -f docker-compose.prod.yml up -d --build
```

`migrate` 服务待 `db` healthcheck 通过后跑 `db:push` 建表，成功退出后 `app` 方启动。`app` 内 `DATABASE_URL` 由 compose 指向服务名 `db`，覆盖 `.env` 的 localhost 值（无需改 `.env`）。

**定时提醒**（临期/逾期私信）须由宿主 crontab 每日打一次 cron 端点：

```bash
( crontab -l 2>/dev/null; \
  echo '0 9 * * * curl -fsS -X POST http://localhost:3000/api/cron/reminders -H "Authorization: Bearer <CRON_SECRET>" >/dev/null 2>&1' \
) | crontab -
```

> NAS 部署：本机 `rsync -az --delete --exclude node_modules --exclude .next --exclude .git ./ root@<nas>:/volume1/docker/agilecampus/`，再 ssh 上去于该目录执行上述 `up` 命令。
> 飞书应用后台须将 `FEISHU_REDIRECT_URI` 加入重定向白名单，绑定方能成。

## 主要路由

| 路由 | 说明 |
|---|---|
| `/teams` | 我的团队（创建/加入） |
| `/teams/[teamId]/members` | 成员管理（admin 改角色） |
| `/teams/[teamId]/projects` | 项目列表（admin 创建） |
| `/teams/[teamId]/resources` | 资源占用登记 + 时长统计 |
| `/teams/[teamId]/labels` | 团队标签管理（admin 增删改，成员只读） |
| `/projects` | 所有项目总览（跨团队聚合 + 任务统计） |
| `/projects/[projectId]` | 项目详情：里程碑 + 看板 + 任务 + AI 协作空间 |
| `/projects/[projectId]/timeline` | 项目时间线甘特 |
| `/settings/tokens` | 个人访问令牌（生成/撤销） |

---

## Agent 写入 API

供 Claude Code 等浏览器之外的程序，以用户身份写入 AgileCampus。

### 认证

所有 `/api/agent/*` 端点用 **Personal API Token** 认证（区别于浏览器 session）：

```
Authorization: Bearer <token>
```

在网页「设置 → 个人访问令牌」生成，明文只显示一次；库中仅存 sha256 hash。令牌权限等同本人：只能操作有权限的团队/项目，越权返回 `403`。约定两个环境变量：

- `AGILECAMPUS_URL` — 站点地址，如 `http://localhost:3000`
- `AGILECAMPUS_TOKEN` — 令牌明文

### `POST /api/agent/tasks` — 新建任务

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `projectId` | uuid | 是 | 目标项目 |
| `title` | string | 是 | 任务标题 |
| `description` | string | 否 | 描述 |
| `assigneeId` | uuid | 否 | 负责人（须为团队成员） |
| `startDate` | string | 否 | 起始日 `YYYY-MM-DD`（供时间线排期） |
| `dueDate` | string | 否 | 截止日 `YYYY-MM-DD` |
| `milestoneId` | uuid | 否 | 里程碑（须属该项目） |
| `priority` | `low`\|`medium`\|`high` | 否 | 默认 `medium` |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/tasks" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<uuid>","title":"撰写调研问卷","startDate":"2026-07-01","dueDate":"2026-07-08","priority":"high"}'
# → { "id": "...", "title": "撰写调研问卷", "status": "todo" }
```

### `POST /api/agent/tasks/complete` — 提交成果待验收

将任务置为 `review`（待验收）并附完成说明。任务不会由执行者直接标记为完成；组长或教师通过 `POST /api/agent/tasks/review` 完成验收。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `taskId` | uuid | 是 | 目标任务 |
| `completionNote` | string | 是 | 完成说明 |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/tasks/complete" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<uuid>","completionNote":"已跑通全部演武"}'
# → { "id": "...", "status": "review" }
```

### `POST /api/agent/resource-usage` — 登记资源占用

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `teamId` | uuid | 是 | 目标团队 |
| `resourceName` | string | 是 | 资源名，如 `GPU-01` |
| `purpose` | string | 否 | 用途 |
| `startTime` | ISO 8601 | 是 | 开始时间，如 `2026-07-22T14:00:00Z` |
| `endTime` | ISO 8601 | 否 | 结束时间；省略 = 占用中 |

```bash
curl -X POST "$AGILECAMPUS_URL/api/agent/resource-usage" \
  -H "Authorization: Bearer $AGILECAMPUS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"<uuid>","resourceName":"GPU-01","purpose":"训练模型","startTime":"2026-07-22T14:00:00Z"}'
# → { "id": "...", "resourceName": "GPU-01", "active": true }
```

### 响应与错误

| 状态 | 含义 |
|---|---|
| `200` | 成功，返回创建/更新后的精简对象（含 `id`） |
| `400` | 请求格式无效（缺字段、类型错、时间非法） |
| `401` | 令牌缺失、畸形、伪造或已撤销 |
| `403` | 越权——令牌主人对目标项目/团队无权限 |
| `500` | 服务器错误，可重试 |

### 安全说明

- 令牌库中只存 sha256 hash，明文只在生成时返回一次，泄露即在设置页撤销。
- 外部写入一律不被信任：`token → userId → lib 权限校验`，越权由业务层拒绝。

### Claude Code 集成

项目内置 `.claude/skills/agilecampus/` skill，封装上述端点调用——配置好 `AGILECAMPUS_TOKEN` 与 `AGILECAMPUS_URL` 后，即可在 Claude Code 里用自然语言「给项目 X 加任务 Y」「提交任务 Z 等待验收」「登记我占用了 GPU-01」。完整契约另见 [`docs/agent-api.md`](docs/agent-api.md)。

---

## 文档

- 设计与作战图：`docs/superpowers/`
- Agent 写入 API：`docs/agent-api.md`
- AI 协作空间设计与开源参考：`docs/ai-collaboration.md`
- 技术债备案：`docs/BACKLOG.md`
