# AgileCampus 人机协作工作现场 V1：下游 AI 执行计划

> 本文是可以直接交给下游 AI 逐项执行的实施计划。它以当前仓库真实代码为基线，不是概念稿，也不是重新搭一个演示壳。

> **2026-09-20 更新：** 本文继续作为总体路线图；真正施工时，以
> [`2026-09-20-agilecampus-original-product-and-ai-collaboration.md`](./2026-09-20-agilecampus-original-product-and-ai-collaboration.md)
> 为产品结构、原创界面、AI 协同数据模型和逐提交顺序的最高优先级执行规范。若两份文档冲突，以 09-20 文档为准。

## 0. 执行契约（开始前必须完整阅读）

### 0.1 基线

- 仓库：`AwaSubaru-486/agilecampus`
- 本地目录：`/Users/qwsdjivc/agilecampus-ai`
- 目标基线分支：`feat/risk-aware-closure`
- 编写本计划时的 HEAD：`a047b57`
- 上游老师项目仅用于理解原始任务背景：`sdiver/agilecampus`
- 开始执行时若 HEAD 已前进，不要回退；先确认当前提交包含 `a047b57`，然后从最新提交继续。

执行前：

```bash
cd /Users/qwsdjivc/agilecampus-ai
git status --short --branch
git log --oneline --decorate -12
git merge-base --is-ancestor a047b57 HEAD
```

只有第三条命令返回 0，才能按本计划继续。若工作区有未提交修改，先识别修改归属，不覆盖、不 stash、不 reset。

### 0.2 强制边界

1. **抛弃老师范本的 UI。** 不复刻其颜色、布局、导航、卡片、首页或交互；它只说明课程最初的业务题目。
2. **不能推翻当前分支重做。** 当前分支已经有完整业务地基，后续工作是收敛、重组、补闭环。
3. **AI 不能成为不受控的自动管理员。** AI 可以读取、解释、生成草案、执行被明确授权的任务；改任务、分配成员、验收、删除和归档等关键动作必须保留权限检查与人工确认。
4. **事实计算必须确定性。** 健康风险、逾期、阻塞、负荷、里程碑达成、贡献事实由代码/数据库计算；模型只能转述，不能篡改事实。
5. **学生不能自证完成。** `todo → doing → review → done` 是唯一任务状态源。学生/Agent 提交到 `review`，管理员或教师验收后才进入 `done`。
6. **不做学生排名或贡献分。** 贡献页只陈列可验证行为与不可测事项，不生成“谁更努力”的总分。
7. **不把平台做成聊天软件、Jira 或 BI 大屏。** V1 聚焦项目推进中最难的瞬间：接不接得住、卡在哪里、谁能帮忙、交付是否被验收、过程如何复用。
8. **不整体搬入外部仓库。** 可借鉴 Kaneo、Agila、OpenKanban 的交互模式，若复制非平凡代码必须保留许可证与来源；不要引入它们的整套后端、状态模型或设计系统。
9. **遵守 `AGENTS.md`。** 本项目为 Next.js 16；改路由、缓存、Server Action、`params/searchParams` 或表单行为前，先阅读 `node_modules/next/dist/docs/` 中对应文档。
10. **一次只完成一个可验证的小闭环。** 每个任务先写/更新测试，再实现，再运行局部测试与全量检查，再提交。

### 0.3 产品北极星

> 打开项目后，成员能在 10 秒内知道“现在谁在做什么、什么卡住了、下一步该谁行动”；人和 AI 都必须明确接活、回报进度、暴露接不住，并把协作证据自动沉淀为项目档案。

这句话是所有取舍的最高判断标准。不能直接改善这句话的功能，默认不进 V1。

---

## 1. 当前雏形盘点：哪些已经有了

下游 AI 不得重复实现以下能力。

### 1.1 任务执行闭环

- 单一状态源：`src/lib/task-status.ts`
- 四态：`todo / doing / review / done`
- 接活：被指派不等于已承诺；负责人需填写做法与预估时长。
- 接不住：负责人可说明拒绝原因，而不是静默拖延。
- 提交：负责人填写完成说明后进入 `review`。
- 验收：管理员/教师通过或退回；只有通过才能 `done`。
- 关键入口：
  - `src/app/(app)/projects/[projectId]/actions.ts`
  - `src/lib/task.ts`
  - `src/app/(app)/projects/[projectId]/task-card.tsx`
  - `tests/commitment.test.ts`
  - `tests/task-status.test.ts`

### 1.2 人与 Agent 同队协作

- `users.kind = human | agent`，Agent 是真实团队成员，不是悬浮聊天按钮。
- Agent 可轮询收件箱、领取任务、汇报运行、上报阻塞、提交待验收。
- Agent 完成任务后也不能绕过人类验收。
- Agent token 只展示一次，库内只保存 hash。
- 关键入口：
  - `src/lib/agent-member.ts`
  - `src/lib/agent-run.ts`
  - `src/lib/agent-auth.ts`
  - `src/app/api/agent/inbox/route.ts`
  - `src/app/api/agent/runs/route.ts`
  - `src/app/(app)/teams/[teamId]/agents/`
  - `tests/agent-member.test.ts`
  - `tests/agent-run.test.ts`

### 1.3 工作现场与人机接力

- “正在发生”把人和 Agent 混排，表达 working/stuck/awaiting/idle。
- “接力”从活动事件重建谁把什么交给了谁。
- 里程碑自动达成并自动生成事实型亮点。
- 关键入口：
  - `src/lib/workspace.ts`
  - `src/lib/relay.ts`
  - `src/lib/milestone.ts`
  - `src/app/(app)/projects/[projectId]/workspace-view.tsx`
  - `tests/relay.test.ts`
  - `tests/milestone.test.ts`

### 1.4 风险与求助闭环

- 成员可说明阻塞原因、细节、需要什么帮助，并邀请可能的协作者。
- Agent 上报 blocked 时会生成真实 blocker。
- 健康度是透明规则集合，不是模糊分数；包含阻塞、逾期、验收积压、无人负责、长期未动、负荷过重。
- 每条风险回答“为什么、谁处理、下一步做什么”。
- 关键入口：
  - `src/lib/blocker.ts`
  - `src/lib/health.ts`
  - `src/app/(app)/projects/[projectId]/blocker-strip.tsx`
  - `src/app/(app)/projects/[projectId]/health-panel.tsx`
  - `src/app/(app)/health/page.tsx`
  - `tests/blocker.test.ts`
  - `tests/health.test.ts`

### 1.5 Lody 式共享上下文

- 一个项目可有多个 AI 会话。
- 会话可关联任务，可设团队可见或私人草稿。
- 从任意 AI 回复分叉，并保留父会话、分叉点、消息来源。
- 续聊会真正携带继承历史，不只是复制界面。
- AI 写操作先生成草案，再由人确认落库。
- 关键入口：
  - `src/lib/agent/conversation.ts`
  - `src/lib/agent/orchestrator.ts`
  - `src/lib/agent/commit.ts`
  - `src/app/(app)/projects/[projectId]/chat-panel.tsx`
  - `src/app/(app)/projects/[projectId]/draft-cards.tsx`
  - `src/app/api/conversations/`
  - `tests/agent-conversation.test.ts`
  - `tests/agent-commit.test.ts`

### 1.6 零填写复盘

- 活动事件 append-only，普通成员不可篡改历史。
- 自动贡献事实、求助与协作、验收数据、活跃天数。
- 明确列出“平台无法测量”的贡献，禁止用单一分数评价学生。
- 关键入口：
  - `src/lib/activity.ts`
  - `src/lib/activity-feed.ts`
  - `src/lib/contribution.ts`
  - `src/app/(app)/projects/[projectId]/activity/page.tsx`
  - `src/app/(app)/projects/[projectId]/retrospective/page.tsx`
  - `tests/activity.test.ts`
  - `tests/contribution.test.ts`

---

## 2. 当前真正的问题

### P0：信息架构没有收口

`src/app/(app)/projects/[projectId]/page.tsx` 当前依次渲染项目摘要、工作现场、健康度、求助、看板、AI 会话。能力很多，但成为了一条很长的模块瀑布。用户很难理解哪个区域是主入口，也会重复看到同一任务的状态。

**结论：** 先把“完整”变成“清楚”，再增加功能。

### P0：任务卡承载了太多流程

卡片同时负责拖拽、承诺、拒绝、提交、验收、标签、依赖、日期、Agent 状态。继续加字段会让看板从扫视工具退化为表单墙。

**结论：** 卡片保留扫描信息，操作进入任务详情抽屉；高频动作仍可就地完成。

### P0：AI 会话与实际工作流仍然分离

会话能分支、有上下文，但入口在页面底部。用户遇到任务、阻塞、风险时不能自然地“带着当前对象去问 AI”，AI 的建议也没有清晰回到任务/风险/决策证据链。

**结论：** AI 不是单独模块，而应成为每个工作对象的上下文操作。

### P1：Agent 技术闭环已有，使用闭环不够

已有注册、token、inbox、run API，但新用户还需要自己理解轮询协议；工作现场也缺少“多久没心跳”“为什么离线”“当前 run 发生了什么”的诊断入口。

### P1：风险能被发现，但处置路径还不够短

健康项提供原因和建议，却仍可能停在“看见风险”。需要把每条风险直接连到对应任务、责任人和可执行动作。

### P1：沉淀有数据，缺少可交付档案

课程项目最终需要报告、答辩、作品集、简历描述和成果链接。当前有活动与复盘，但缺少项目成果对象与一键导出。

### P1：文档与演示数据滞后

README 仍主要描述旧看板和旧 Agent 写入 API，未准确呈现当前的人机成员、风险闭环和验收机制。种子数据虽丰富，但还要成为固定的演示剧本与验收基准。

---

## 3. 目标产品结构

### 3.1 项目内只保留四个一级视图

项目页标题下设置 URL 驱动的四个视图，避免本地状态导致刷新丢失：

| 参数 | 名称 | 回答的问题 | 默认角色 |
| --- | --- | --- | --- |
| `?view=live` | 现场 | 现在谁在做什么？哪里卡住？下一步是谁？ | 全员，默认 |
| `?view=tasks` | 任务 | 所有工作分别处于什么状态？ | 全员 |
| `?view=ai` | AI 协作 | 讨论过什么？上下文怎样继承？哪些建议待确认？ | 全员 |
| `?view=archive` | 沉淀 | 做成了什么？过程证据、成果和复盘在哪里？ | 全员 |

四个视图共享一个紧凑项目头，不重复项目名称和总指标。

### 3.2 每个视图的最小构成

#### 现场（默认）

1. 顶部“今天最需要行动的 1～3 件事”，只显示需人处理的内容。
2. 正在发生：人和 Agent 混排。
3. 当前求助与风险：每项必须有直接动作。
4. 最近接力：展示工作如何在人和 AI 间流转。
5. 下一里程碑：只展示最近一个未完成里程碑及缺口。

#### 任务

1. 看板/列表/时间线视图切换。
2. 搜索、筛选、分组和“我的任务”。
3. 列内快速新增。
4. 任务详情抽屉。
5. 教师/管理员的待验收队列。

#### AI 协作

1. 会话列表、可见范围、关联任务。
2. 消息与来源作者。
3. 分支血缘与分支入口。
4. 上下文包预览。
5. AI 产生的待确认动作草案。

#### 沉淀

1. 里程碑及自动亮点。
2. 活动时间线。
3. 团队复盘与贡献事实。
4. 成果链接/附件元数据。
5. 周报与项目档案导出。

### 3.3 四条不可破坏的业务链

```text
指派 → 待回应 → 接住 / 接不住 → 执行 → 提交 → 人工验收 → 完成 / 退回

遇阻 → 说明具体问题 → 邀请协作者 → 获得响应 → 记录解决办法 → 风险消失

Agent 收件 → 明确领取 → 汇报运行 → 上报阻塞 / 提交结果 → 人工验收

任务/风险发起 AI 会话 → 继承可解释上下文 → 分支探索 → 生成草案 → 人工确认 → 写入活动证据
```

任何 UI 重构都必须用端到端测试或手工验收证明这四条链仍然完整。

---

## 4. 开源参考如何使用

| 来源 | 只借鉴什么 | 明确不带入什么 |
| --- | --- | --- |
| Kaneo（MIT） | 清晰的 workspace shell、低噪任务卡、侧边详情、视图切换、筛选层级 | 它的后端、完整数据模型、品牌与整套样式 |
| Agila（MIT） | 看板/列表的信息密度、延迟出现的 hover actions、快捷键思路、WIP 表达 | 企业级字段、复杂配置和管理概念 |
| OpenKanban（MIT） | 列内快速新增、明确空状态、Enter/Escape 操作、简单拖拽反馈 | 整体页面与现成视觉皮肤 |
| Lody（Apache-2.0） | 会话是一等对象、明确 Turn 分支、来源关系、会话与执行证据同屏 | 本机 daemon、ACP、Worktree、远程控制成员电脑 |

实施约定：

- 先把参考交互写成行为描述，再用本项目现有栈重新实现。
- 若确实复制超过零碎片段，创建 `THIRD_PARTY_NOTICES.md`，记录仓库 URL、许可证、提交号和文件映射。
- 不为了“像某产品”增加阴影、玻璃、渐变、大标题或无意义动效。

---

## 5. 分阶段实施任务

## Phase 0：冻结基线并建立可靠验收

**目标：** 让后面每个改动都能证明没有破坏现有闭环。

**修改文件：**

- `README.md`
- `docs/BACKLOG.md`
- `.env.example`（仅在确有缺项时）
- `scripts/seed-demo.mjs`
- 必要时 `tests/reset-db.test.ts`

- [ ] 阅读完整 `AGENTS.md` 和本计划。
- [ ] 从 `feat/risk-aware-closure` 新建实现分支：

```bash
git switch -c feat/workspace-productization
```

- [ ] 启动数据库并确认 dev/test 两库存在：

```bash
docker compose up -d
docker compose exec db psql -U agilecampus -lqt
npm ci
npm run db:push
npm run db:push:test
```

- [ ] 运行当前基线：

```bash
npm test
npm run lint
npm run build
```

- [ ] 若失败，只修复与环境或当前分支直接相关的问题；先记录失败输出，不能借机重构。
- [ ] 更新 README 的功能清单、路由、Agent 协议：旧的“Agent 可直接 complete 为 done”描述必须改为“提交到 review，人工验收后 done”。
- [ ] 确认 `scripts/seed-demo.mjs` 可重复执行两次，第二次不会碰真实用户/团队，也不会主键冲突。
- [ ] 记录演示账号、密码、固定项目 ID 和预期风险数量到 README 的“本地演示”章节。

**验收：**

- 全量测试、lint、build 均通过。
- 执行两次 seed 后只有一套演示团队。
- README 与当前行为一致。

**提交：**

```bash
git add README.md docs/BACKLOG.md scripts/seed-demo.mjs
git commit -m "docs: 固化人机协作雏形的运行与验收基线"
```

---

## Phase 1：重组项目页为四视图工作区

**目标：** 消除长页面堆叠，建立稳定的产品主结构；本阶段不改业务规则。

**新建文件：**

- `src/lib/project-view.ts`
- `src/app/(app)/projects/[projectId]/project-tabs.tsx`
- `src/app/(app)/projects/[projectId]/live-view.tsx`
- `src/app/(app)/projects/[projectId]/tasks-view.tsx`
- `src/app/(app)/projects/[projectId]/archive-view.tsx`
- `tests/project-view.test.ts`

**修改文件：**

- `src/app/(app)/projects/[projectId]/page.tsx`
- `src/app/(app)/projects/[projectId]/project-summary.tsx`
- `src/app/globals.css`

### 1.1 URL 状态

- [ ] 在 `src/lib/project-view.ts` 定义：

```ts
export const PROJECT_VIEWS = ["live", "tasks", "ai", "archive"] as const;
export type ProjectView = (typeof PROJECT_VIEWS)[number];
export function parseProjectView(value: unknown): ProjectView;
```

- [ ] 缺省、数组、未知值均回退到 `live`。
- [ ] `tests/project-view.test.ts` 覆盖四个合法值与全部回退情况。
- [ ] tab 必须使用真实链接 `?view=...`，保留能够共存的筛选参数；不能只用客户端 `useState`。
- [ ] 当前 tab 使用 `aria-current="page"`，键盘焦点可见。

### 1.2 服务端按视图取数

- [ ] 重构 `page.tsx`，先取 access/project，再根据 view 拉取所需数据。
- [ ] 不允许四个视图始终把所有数据全查一遍。
- [ ] `live` 只取现场、风险、求助、接力、下一里程碑所需数据。
- [ ] `tasks` 取 tasks/members/milestones/dependencies/labels/agents/busy runs。
- [ ] `ai` 取 conversations/messages/members/milestones/tasks。
- [ ] `archive` 取 milestones/activity/contribution/artifacts（成果对象在 Phase 6 加入前先放现有内容）。
- [ ] 继续用 `Promise.all` 合并互不依赖的查询，禁止组件内 N+1 查询。

### 1.3 统一项目头

- [ ] `ProjectSummary` 收敛成紧凑项目头：名称、状态、日期、最近里程碑、一个主动作。
- [ ] 不在项目头堆六张数字卡；详细风险与进度进入对应视图。
- [ ] 手机端 tab 横向滚动，项目头不横向溢出。
- [ ] 现有 `timeline`、`activity`、`retrospective` 路由暂时保留兼容；增加通往新 view 的入口，不立刻删除旧路由。

**验收：**

- 打开 `/projects/:id` 默认仅见现场，不再向下出现完整看板和聊天面板。
- 四个 URL 可刷新、可复制、可前进后退。
- 权限与现有 server action 无变化。
- `npm test -- tests/project-view.test.ts`、全量测试、lint、build 通过。

**提交：**

```bash
git add src/lib/project-view.ts 'src/app/(app)/projects/[projectId]' src/app/globals.css tests/project-view.test.ts
git commit -m "refactor: 将项目页收敛为四视图工作区"
```

---

## Phase 2：任务详情抽屉与低噪看板

**目标：** 看板负责扫视与推进，详情抽屉负责完整操作。

**新建文件：**

- `src/app/(app)/projects/[projectId]/task-drawer.tsx`
- `src/app/(app)/projects/[projectId]/task-detail-sections.tsx`
- `src/lib/task-transition.ts`
- `tests/task-transition.test.ts`

**修改文件：**

- `src/app/(app)/projects/[projectId]/board.tsx`
- `src/app/(app)/projects/[projectId]/task-card.tsx`
- `src/app/(app)/projects/[projectId]/new-task-form.tsx`
- `src/app/(app)/projects/[projectId]/filter-bar.tsx`
- `src/app/(app)/projects/[projectId]/actions.ts`
- `src/lib/board-columns.ts`
- `src/app/globals.css`

### 2.1 卡片表面信息

- [ ] 默认只显示：标题、负责人/Agent、截止风险、一个关键流程状态、最多两个标签。
- [ ] 下列状态优先级从高到低，只显示最高优先的一项：阻塞、待验收、待回应、已拒绝、Agent 正在运行、逾期。
- [ ] 描述、承诺、完成说明、验收记录、依赖、全部标签进入详情抽屉。
- [ ] 触屏设备不能依赖 hover 才能发现关键按钮。

### 2.2 抽屉结构

- [ ] 点击卡片打开右侧抽屉，URL 写入 `task=<uuid>`，关闭后移除参数。
- [ ] 抽屉内按顺序展示：概述、承诺/拒绝、执行与求助、提交/验收、依赖与标签、活动、带此任务问 AI。
- [ ] 抽屉打开后焦点进入标题；Escape 关闭；关闭后焦点回到原卡片。
- [ ] 抽屉使用 `role="dialog"`、`aria-modal="true"` 和可访问名称。
- [ ] 服务端仍然是权限真相源，按钮隐藏不能替代权限校验。

### 2.3 拖拽预判与回滚

- [ ] `src/lib/task-transition.ts` 提供纯函数，输入当前状态、目标状态、角色、是否本人负责人，输出 `{ allowed, reason }`。
- [ ] 拖动开始后，对不允许的列显示禁用态和原因，而不是 drop 后才报错。
- [ ] 合法移动采用乐观更新；server action 失败时准确回滚到原列并显示原因。
- [ ] 加入 `KeyboardSensor`，保证不使用鼠标也能移动卡片。
- [ ] `prefers-reduced-motion` 下关闭拖拽弹跳/位移动画。
- [ ] 不能用拖拽跳过“接活”“提交”“验收”的必填表单。

### 2.4 列内新增

- [ ] 每列末尾保留轻量“＋ 添加”。
- [ ] Enter 提交，Shift+Enter 换行，Escape 取消。
- [ ] 非 `todo` 列新增时仍要遵守状态规则：不允许凭新增直接制造 `done`；建议统一先创建 `todo`，再通过合法动作推进。

**验收：**

- 学生无法拖入 `done` 绕过验收。
- 教师能验收但不能编辑普通任务字段或随意拖拽。
- 卡片在 320px 宽度下无字段挤压。
- 键盘可以打开/关闭抽屉并移动允许的任务。
- 原有 `tests/commitment.test.ts`、`tests/task-status.test.ts` 全绿，新状态矩阵测试全绿。

**提交：**

```bash
git add 'src/app/(app)/projects/[projectId]' src/lib/task-transition.ts src/lib/board-columns.ts src/app/globals.css tests/task-transition.test.ts
git commit -m "feat: 以任务抽屉承载承诺验收与上下文操作"
```

---

## Phase 3：把“工作现场”变成行动入口

**目标：** 现场不是仪表盘，而是能立即推进工作的首页。

**新建文件：**

- `src/lib/next-actions.ts`
- `src/app/(app)/projects/[projectId]/next-actions.tsx`
- `tests/next-actions.test.ts`

**修改文件：**

- `src/lib/workspace.ts`
- `src/app/(app)/projects/[projectId]/workspace-view.tsx`
- `src/app/(app)/projects/[projectId]/health-panel.tsx`
- `src/app/(app)/projects/[projectId]/blocker-strip.tsx`

### 3.1 确定性“下一步”

- [ ] 用纯规则生成当前用户的下一步，禁止调用模型排序。
- [ ] 规则优先级：待我验收 > 我被邀请帮助的阻塞 > 分给我但未回应 > 我的逾期任务 > 我提交后被退回 > 即将到期 > 无人负责且我有管理权限。
- [ ] 最多展示 3 条；每条必须包含对象、原因、一个主动作和深链接。
- [ ] 没有待行动事项时展示“目前没有需要你处理的事”，不能用假数据填满页面。

### 3.2 正在发生

- [ ] 人和 Agent 使用同一行结构，只用小标识区分身份。
- [ ] 状态文案说人话：正在做、等验收、需要帮助、尚未回应、暂时空闲。
- [ ] Agent 行额外显示 `lastSeenAt` 相对时间；超过离线阈值说明“多久未连接”。
- [ ] 点击行打开对应任务抽屉；无任务时才进入成员/Agent 详情。

### 3.3 风险与求助直接处置

- [ ] 每个 blocker 提供：查看任务、我来帮忙/响应邀请、与 AI 讨论、解决（有权限时）。
- [ ] 每个 health issue 提供：查看受影响任务、筛选到看板、指定负责人或创建跟进任务（按权限）。
- [ ] 风险被解决后重新计算并消失，不能只改 UI 状态。
- [ ] 保留“无总分”的设计，不添加圆环健康分、红黄绿总分或团队排名。

**验收：**

- 演示账号登录后，顶部 3 条行动与其角色不同。
- 每条行动最多一次页面跳转即可进入可执行控件。
- 处理一个求助后，刷新页面 blocker 与 health 均一致更新。
- `tests/next-actions.test.ts` 覆盖角色、并列优先级、无事项、最多三条。

**提交：**

```bash
git add src/lib/next-actions.ts src/lib/workspace.ts 'src/app/(app)/projects/[projectId]' tests/next-actions.test.ts
git commit -m "feat: 将工作现场改造成角色化行动入口"
```

---

## Phase 4：完成 Agent 的可用闭环

**目标：** 没读过 API 文档的人也能把本地/云端 Agent 接进团队，并知道它是否真的在工作。

**修改文件：**

- `src/app/(app)/teams/[teamId]/agents/page.tsx`
- `src/app/(app)/teams/[teamId]/agents/agent-forms.tsx`
- `src/lib/agent-member.ts`
- `src/lib/agent-run.ts`
- `src/app/api/agent/inbox/route.ts`
- `src/app/api/agent/runs/route.ts`
- `docs/agent-api.md`
- `tests/agent-member.test.ts`
- `tests/agent-run.test.ts`
- `tests/agent-api.test.ts`

### 4.1 三步接入向导

- [ ] 第一步：命名 Agent、选择 provider/runtime、填写可做事项、并发上限。
- [ ] 第二步：生成 token，仅显示一次；提供可复制的环境变量与最小 curl 示例。
- [ ] 第三步：发送一次连接测试，页面显示“已连接/未连接”和排错信息。
- [ ] token 不得进入 URL、日志、React props 的长期状态或错误遥测。

### 4.2 运行可观测性

- [ ] Agent 列表显示当前任务、run 状态、最近心跳、最后错误。
- [ ] 一个任务同一时刻最多一个活动 run；并发上限由服务端强制。
- [ ] 重复 `completed`、`blocked` 回报必须幂等，不能生成重复 blocker/活动事件。
- [ ] 心跳过期后由确定性 sweep 标记 offline；重新请求可恢复。
- [ ] 工作现场仅在 `view=live` 可见时轮询刷新，建议 15 秒；页面隐藏时暂停，恢复时立即刷新一次。
- [ ] 首版不用 WebSocket；轮询足以支持课程演示并降低系统复杂度。

### 4.3 分派建议

- [ ] 可以按 capability 生成候选 Agent，但只给出“为什么匹配”的建议。
- [ ] 不自动分派，不把能力字符串匹配伪装成智能评分。
- [ ] 人工确认后才更改 assignee，并产生 `task_assigned` 活动。

**验收：**

- 新 Agent 从注册到收到首个任务不需要离开向导查文档。
- token 只显示一次，刷新后无法取回明文。
- Agent 上报 blocked 后工作现场出现求助；上报 completed 后任务进入 review，而非 done。
- 重放同一 run 回报不产生重复事件。

**提交：**

```bash
git add 'src/app/(app)/teams/[teamId]/agents' src/lib/agent-member.ts src/lib/agent-run.ts src/app/api/agent docs/agent-api.md tests
git commit -m "feat: 补齐 Agent 接入与运行可观测闭环"
```

---

## Phase 5：让 AI 会话嵌入任务和风险，而不是孤立聊天

**目标：** 用户从具体工作对象发起 AI 协作，并能解释上下文来自哪里、建议最终写回了什么。

**新建文件：**

- `src/lib/agent/context-pack.ts`
- `src/app/(app)/projects/[projectId]/context-preview.tsx`
- `src/app/(app)/projects/[projectId]/conversation-lineage.tsx`
- `tests/agent-context-pack.test.ts`

**修改文件：**

- `src/app/(app)/projects/[projectId]/chat-panel.tsx`
- `src/app/(app)/projects/[projectId]/draft-cards.tsx`
- `src/app/(app)/projects/[projectId]/task-drawer.tsx`
- `src/app/(app)/projects/[projectId]/health-panel.tsx`
- `src/app/(app)/projects/[projectId]/blocker-strip.tsx`
- `src/lib/agent/snapshot.ts`
- `src/lib/agent/conversation.ts`
- `src/lib/agent/orchestrator.ts`
- `src/app/api/projects/[projectId]/conversations/route.ts`

### 5.1 上下文包

- [ ] 从任务发起时只默认带：项目目标摘要、任务字段、承诺/验收状态、关联依赖、开放 blocker、最近相关事件。
- [ ] 从风险发起时带：规则类型、确定性证据、受影响任务、当前负责人、已有 blocker。
- [ ] 用户发送前可展开“AI 将看到什么”，逐项取消非必要上下文。
- [ ] 私人会话不得进入团队成员或其他 Agent 的 context pack。
- [ ] 上下文有明确字符/条目上限，截断时告诉模型和用户发生了截断。

### 5.2 分支血缘

- [ ] 会话头显示父会话与分支起点，可点击返回来源。
- [ ] 每条继承消息保留 `sourceMessageId`，UI 用轻量标记说明来源，不复制成无来源的新消息。
- [ ] 模型运行中禁止重复分支；失败后允许重试且不产生空分支。
- [ ] 分支只继承分支点及此前历史，不继承父会话后续消息。

### 5.3 AI 写回

- [ ] AI 只能生成结构化草案：新任务、任务字段修改、里程碑、风险跟进建议、会议纪要/周报草案。
- [ ] 草案卡明确展示“将修改什么”；用户逐项确认。
- [ ] 提交时重新校验权限与目标对象最新状态，防止基于过期上下文覆盖新修改。
- [ ] 确认成功后写活动事件，payload 记录来源 conversation/message，但不要保存隐藏提示词或密钥。
- [ ] 删除、验收、成员角色变更、token 操作不开放为 AI 草案动作。

**验收：**

- 从任务抽屉点击“带此任务问 AI”后直接进入 `view=ai` 并选中/创建关联会话。
- 上下文预览能解释每项数据来源。
- 私人会话对其他成员返回 404/403，不能仅靠前端隐藏。
- 从一条回复分支后，父会话后续消息不会泄漏进新分支。
- 过期草案确认失败并提示刷新，不能静默覆盖。

**提交：**

```bash
git add src/lib/agent 'src/app/(app)/projects/[projectId]' src/app/api/projects tests/agent-context-pack.test.ts
git commit -m "feat: 将可分支 AI 上下文嵌入任务与风险闭环"
```

---

## Phase 6：补齐成果与项目档案

**目标：** 项目结束后能直接拿到可复用的过程资产，而不是再去聊天记录和网盘拼材料。

### 6.1 数据模型

**修改文件：**

- `src/db/schema.ts`
- `tests/helpers.ts`

**新建文件：**

- `src/lib/artifact.ts`
- `tests/artifact.test.ts`

- [ ] 新增 `project_artifacts`：
  - `id`
  - `projectId`
  - 可选 `taskId`
  - 可选 `milestoneId`
  - `title`
  - `type`: `document | code | demo | dataset | report | other`
  - `url`
  - 可选 `description`
  - `createdById`
  - `createdAt / updatedAt`
- [ ] V1 只存成果链接和元数据，不在数据库存大文件。
- [ ] URL 只允许 `http:`/`https:`，防止 `javascript:` 等危险协议。
- [ ] 创建、修改、删除都做项目权限校验并记录活动。
- [ ] 任务/里程碑删除时采用 `set null`，不连带删除项目成果。

### 6.2 沉淀视图

**新建文件：**

- `src/app/(app)/projects/[projectId]/artifacts-section.tsx`
- `src/app/api/projects/[projectId]/export/route.ts`
- `src/lib/project-export.ts`
- `tests/project-export.test.ts`

**修改文件：**

- `src/app/(app)/projects/[projectId]/archive-view.tsx`
- `src/lib/activity.ts`

- [ ] 沉淀视图顺序：成果 → 里程碑亮点 → 项目时间线 → 团队复盘 → 导出。
- [ ] 成果可关联任务/里程碑，并在已验收任务旁提示补成果链接。
- [ ] 导出 Markdown 和 JSON 两种格式；服务端实时生成，不必先持久化 export 表。
- [ ] 导出内容必须包括：项目信息、里程碑、任务与验收事实、阻塞与解决记录、活动时间线、共享 AI 会话索引、成果链接、贡献事实及“不可测量事项”声明。
- [ ] 私人 AI 会话不进入团队项目档案。
- [ ] Markdown 中对用户文本做安全转义，避免标题/表格结构被破坏。
- [ ] AI 可另生成“报告摘要草案”，但必须标注为 AI 草案；事实部分仍来自确定性导出。

**验收：**

- 新建成果后可从任务、里程碑、沉淀页定位。
- 删除任务不删除已提交成果。
- 普通项目成员不能导出其他项目。
- 导出内容不含 token、私有会话、隐藏模型上下文、密码 hash。
- 同一数据两次导出除生成时间外结构稳定，适合版本比较。

**提交：**

```bash
git add src/db/schema.ts tests/helpers.ts src/lib/artifact.ts src/lib/project-export.ts 'src/app/(app)/projects/[projectId]' src/app/api/projects tests/artifact.test.ts tests/project-export.test.ts
git commit -m "feat: 增加成果链接与可追溯项目档案导出"
```

---

## Phase 7：教师视角与跨项目风险收口

**目标：** 老师只看需要介入的事项，不把教师端做成复杂管理后台。

**修改文件：**

- `src/app/(app)/health/page.tsx`
- `src/app/(app)/projects/page.tsx`
- `src/lib/health.ts`
- `src/lib/project.ts`
- `tests/health.test.ts`
- `tests/my-projects.test.ts`

- [ ] `/projects` 顶部提供角色化分组：待我验收、有人求助、临近里程碑、最近项目。
- [ ] 教师只看到自己有权访问团队的项目。
- [ ] 点击待验收项直达任务抽屉的验收段落。
- [ ] `/health` 保留跨项目风险事实，不增加综合排名。
- [ ] 风险卡显示数据更新时间与规则说明入口。
- [ ] 已归档项目默认折叠，不混入当前待办。
- [ ] 学生视角不出现教师专用措辞，但仍能看到与自己相关的风险。

**验收：**

- 教师登录后 3 分钟内可以完成“发现积压 → 查看证据 → 验收/退回”。
- 不同团队数据严格隔离。
- 归档项目不触发新的待办和风险提醒。

**提交：**

```bash
git add 'src/app/(app)/health/page.tsx' 'src/app/(app)/projects/page.tsx' src/lib/health.ts src/lib/project.ts tests/health.test.ts tests/my-projects.test.ts
git commit -m "feat: 收敛教师待办与跨项目风险入口"
```

---

## Phase 8：统一细节、可访问性与响应式

**目标：** 简洁不是少做状态，而是每个状态都清楚、克制、可操作。

**修改文件：**

- `src/app/globals.css`
- `src/app/(app)/app-navigation.tsx`
- 本计划前述全部交互组件

### 8.1 设计规则

- [ ] 只保留一套语义 token：canvas/surface/line/ink/primary，以及 todo/doing/review/done、risk/warning/success。
- [ ] 同一页面最多一个实心主按钮；其余用次级/文本按钮。
- [ ] 任务卡、风险卡、会话卡必须视觉可区分，但圆角、边框和间距使用统一 token。
- [ ] 不使用装饰性全大写英文标题；已有 `EXECUTION` 等字样替换为有信息价值的中文。
- [ ] 不使用虚构统计、随机头像或占位折线图。
- [ ] 动效只表达状态变化：拖拽、抽屉、保存、展开；持续 120～220ms。

### 8.2 状态完备

- [ ] 每个异步区有 loading、empty、error、success/complete 状态。
- [ ] 错误文案说明对象和下一步，不显示裸 `Error: ...`。
- [ ] 保存按钮防重复提交；失败后保留用户已输入内容。
- [ ] 删除、撤销 token、归档等破坏性操作显示对象名称并二次确认。
- [ ] 乐观更新必须有回滚和重新同步路径。

### 8.3 可访问性

- [ ] 所有 icon-only 按钮有 `aria-label`。
- [ ] 错误与成功通知使用合适的 live region。
- [ ] 焦点环在浅色背景上清晰可见。
- [ ] 色彩不是唯一状态通道，必须有文字或图标。
- [ ] 200% 缩放和 320px 宽度下不遮挡主动作。
- [ ] 完整支持 `prefers-reduced-motion`。

### 8.4 性能

- [ ] 用 React/Next Profiler 或浏览器 Performance 确认打开项目不会因四视图而加载所有 Client Component。
- [ ] 长活动流分页；默认不渲染 300 条完整 DOM。
- [ ] 搜索输入做轻量 debounce，筛选仍同步到 URL。
- [ ] 轮询只在需要的视图与可见标签页运行。

**验收：**

- 用键盘完成：切 tab、开任务、接活、提交、关闭抽屉、进入 AI 会话。
- 手机宽度可完成相同核心任务。
- Lighthouse Accessibility 不出现 critical error；人工检查焦点顺序。
- 页面没有横向整体滚动。

**提交：**

```bash
git add src/app
git commit -m "style: 统一工作区交互状态与可访问细节"
```

---

## Phase 9：演示剧本、回归与交付

**目标：** 用一个真实协作故事证明创新点，而不是逐页念功能。

**修改文件：**

- `scripts/seed-demo.mjs`
- `README.md`
- `docs/demo-script.md`
- `docs/BACKLOG.md`

### 9.1 固定演示数据

- [ ] 演示团队至少包含：admin 1、teacher 1、student 3、Agent 2。
- [ ] 必须有：未回应任务、已接活任务、被拒绝任务、待验收任务、已退回任务、开放 blocker、已解决 blocker、Agent running、Agent blocked、已完成里程碑、自动亮点、共享 AI 会话及其分支、私人会话、成果链接。
- [ ] 所有时间相对当前日生成，保证任何日期运行都能触发相同类型风险。
- [ ] seed 可重复执行并只删除固定 demo ID 范围的数据。

### 9.2 5～7 分钟演示故事

在 `docs/demo-script.md` 写出以下路径与台词重点：

1. 学生打开“现场”，立刻看到自己未回应的任务。
2. 学生判断接不住并说出原因，团队不再等到截止日才发现。
3. Agent 接下另一任务、汇报运行并上报阻塞。
4. 同学从求助进入任务，用带上下文的 AI 会话分析问题，从一条回复分支出两种方案。
5. AI 生成跟进任务草案，人确认后写入看板。
6. 学生提交，教师从待验收入口查看证据并通过。
7. 里程碑自动完成，沉淀页自动形成亮点、贡献事实与项目档案。

这个故事展示的创新点是“协作断点被系统显式接住”，不是“我们也有看板和 AI”。

### 9.3 最终检查

```bash
npm run db:push
npm run db:push:test
node scripts/seed-demo.mjs
npm test
npm run lint
npm run build
```

- [ ] 在 admin、teacher、student 三种账号分别完整走一遍核心流程。
- [ ] 用无效 token、撤销 token、越权项目 ID 验证 Agent API。
- [ ] 检查浏览器控制台和服务端终端，无未处理异常。
- [ ] 检查 git diff，不提交 `.env`、token、数据库文件、构建产物或截图缓存。
- [ ] 更新 README 截图和功能描述，但截图只展示真实 seed 数据。
- [ ] 将仍未完成且不阻塞 V1 的事项放入 BACKLOG，不留 `TODO` 伪装成完成。

**提交：**

```bash
git add README.md scripts/seed-demo.mjs docs
git commit -m "docs: 固化人机协作闭环的演示与交付说明"
```

---

## 6. 测试矩阵（下游 AI 必须逐项覆盖）

| 领域 | 必测情形 |
| --- | --- |
| 权限 | outsider 无法读写；teacher 仅验收；student 仅执行允许动作；admin 管理项目 |
| 状态 | 未接活不能伪装 doing；student/Agent 不能直接 done；退回后能再次提交 |
| 并发 | 同任务重复提交、重复验收、重复 Agent 回报幂等或明确冲突 |
| Agent | token hash、撤销、离线、并发上限、blocked 生成 blocker、completed 进入 review |
| 求助 | 发起、邀请、响应、解决、取消、越权、健康风险同步消失 |
| AI 会话 | shared/private 隔离、关联任务、来源作者、分支边界、继承历史、过期草案 |
| 风险 | 六类风险证据准确、角色化下一步、归档项目排除、无综合排名 |
| 沉淀 | 活动不可篡改、里程碑自动达成、成果关联、私有数据不导出 |
| UI | URL 可恢复、抽屉焦点、键盘拖拽、手机宽度、reduced motion、失败回滚 |

测试文件规则：

- 业务规则优先放 `src/lib/` 纯函数，Vitest 直接覆盖。
- route 测试验证 auth、schema、状态码和响应，不只测 happy path。
- 组件交互若当前未引入组件测试框架，不要为了一个断言大规模换栈；先以纯逻辑测试 + 浏览器验收覆盖，是否引入 Playwright 单独立项。
- 每个阶段至少运行相关测试；合并前必须跑全部测试、lint、build。

---

## 7. 明确不做（V1 非目标）

- 不做复杂甘特排程、自动移动全部依赖任务。
- 不做需求/缺陷两套独立企业流程；课程项目的相关事项先用任务类型/标签表达。
- 不做自定义工作流设计器、字段设计器、BI 报表设计器。
- 不做视频会议、即时聊天、邮件替代。
- 不做 AI 自动验收、自动给学生打分、自动判定贡献高低。
- 不做远程控制成员电脑，也不照搬 Lody daemon/Worktree 架构。
- 不做未经确认的 AI 自动分派或自动修改截止日期。
- 不做花哨 3D、玻璃拟态、桌面窗口风、仿 Apple 系统 UI。
- 不以老师范本作为视觉或代码来源。

---

## 8. 合并顺序与停机点

建议拆成以下独立 PR；每个 PR 都应能单独运行与回滚：

1. `baseline-docs`：Phase 0
2. `workspace-ia`：Phase 1
3. `task-drawer`：Phase 2
4. `actionable-live-view`：Phase 3
5. `agent-onboarding`：Phase 4
6. `contextual-ai`：Phase 5
7. `project-archive`：Phase 6
8. `teacher-risk-view`：Phase 7
9. `ux-release-polish`：Phase 8～9

每个 PR 的停机条件：

- 同一个错误连续尝试三种实现仍未解决；
- 需要破坏现有四态任务模型；
- 需要新增超出本计划的数据权限；
- 发现当前工作区有无法归属的用户修改；
- 需要删除或重写大量已有活动/会话/任务数据。

遇到停机条件时，保留现场，输出：复现步骤、已尝试方案、最小错误日志、受影响文件、两个可选解法及权衡。不要 reset 或用大重构掩盖问题。

---

## 9. 完成定义

只有同时满足以下条件，才能宣布 V1 完成：

- [ ] 打开项目默认先看到“现场”，10 秒内可判断下一步行动。
- [ ] 项目页不再是多个完整模块的纵向堆叠。
- [ ] 学生、教师、管理员、Agent 四种身份的任务闭环均可运行。
- [ ] “接不住”和“被阻塞”都有低成本、非惩罚性的表达入口。
- [ ] Agent 的工作、错误、阻塞和提交在人类工作流中可见。
- [ ] AI 会话可从任务/风险发起，可解释上下文，可分支，可人工确认写回。
- [ ] 风险是确定性、可解释、可处置的，无黑箱总分。
- [ ] 里程碑、活动、贡献、成果和项目档案无需成员重复填写即可生成。
- [ ] 私有会话、token 和敏感信息不会进入项目档案或他人上下文。
- [ ] 桌面、手机、键盘操作和 reduced-motion 均可用。
- [ ] seed 演示能在 5～7 分钟完整证明核心创新。
- [ ] 全量测试、lint、build 通过，README 与实际行为一致。

---

## 10. 给下游 AI 的启动指令

将下面这段连同本文件路径交给执行者：

```text
你要在 /Users/qwsdjivc/agilecampus-ai 中执行
docs/superpowers/plans/2026-09-17-agilecampus-workspace-productization.md。

先完整阅读 AGENTS.md、该计划、README.md、docs/ai-collaboration.md，确认当前分支包含提交 a047b57。
不要参考或复刻老师范本 UI，不要重建项目，不要改写四态任务模型，不要让 AI 绕过人工验收。

从 Phase 0 开始，一次只执行一个 checkbox 可验证闭环。每个任务：先检查现有实现与测试，必要时阅读 Next.js 16 本地文档，写失败测试，做最小实现，运行局部测试，再运行该阶段要求的检查。使用小提交，保留用户现有修改，不使用 git reset --hard 或 checkout --。

每完成一个 Phase，汇报：改了什么、核心文件、测试结果、截图/手工验收结果、剩余风险。未经确认不要跳过阶段，也不要把 BACKLOG 项偷偷扩进 V1。
```
