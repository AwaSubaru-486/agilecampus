# 网页交接主流程重构进度

工单来源：`docs/superpowers/plans/2026-10-02-handoff-first-web-luna-workorders.md`

---

## W00 — 接管现状与验证读取层

工单：W00
状态：验收通过
起点 HEAD：`bc0b28dada127fca1efb37455fa7b9991b95b7a0`（branch: `feat/risk-aware-closure`，ahead of origin 37）

### 本单修改文件

- `docs/reviews/2026-10-02-handoff-web-progress.md`（新建，本文件）

### 保留的他人未提交文件

以下文件为其他执行者未提交改动，本单未触碰：

```
 M AGENTS.md
 M README.md
 M src/lib/approval.ts
 M vscode-extension/src/views/project-view-provider.ts
 M vscode-extension/webview/src/App.tsx
?? docs/reviews/2026-10-02-handoff-console.md
?? docs/superpowers/plans/2026-10-02-handoff-first-web-luna-workorders.md
?? src/lib/collaboration-console.ts
?? tests/collaboration-console.test.ts
```

`src/lib/collaboration-console.ts` 和 `tests/collaboration-console.test.ts` 系他人未提交工作，本轮不接管、不重写、不混进提交。

### 核对事实（工单第 1、2 节）

| 对象 | 实际路径 | 状态 |
| --- | --- | --- |
| 任务、交接契约、认领、提交、验收 | `src/lib/task.ts` | ✅ 已有，含 `claimTask / declineTask / submitTask / reviewTask / updateTask` |
| 交接细节 | `src/lib/handoff.ts` | ✅ 存在 |
| 交付证据 | `src/lib/evidence.ts` | ✅ 存在 |
| 行动排序、优先分组、主动作规则 | `src/lib/collaboration-console-view.ts` | ✅ 已有，纯函数，无 DB 依赖，测试 26 项全通过 |
| 鉴权只读投影（任务/Run/事件/会话/证据/审批） | `src/lib/collaboration-console.ts` | ⚠️ **未跟踪**（untracked，非本轮新建）— 内容完整，测试 6 项全通过，可读取，但尚未提交 |
| 阻塞 | `src/lib/blocker.ts` — `listProjectBlockers / resolveBlocker` | ✅ 存在 |
| 会话/Fork | `src/lib/agent/conversation.ts` — `listProjectConversations / getConversationForUser / listConversationMessages` | ✅ 存在 |
| 上下文包 | `src/lib/context-pack.ts` — `getContextPackForUser / ContextPackBuilder UI` | ✅ 存在；Builder UI 在 `src/app/(app)/projects/[projectId]/context-pack-builder.tsx` |
| 审批 | `src/lib/approval.ts`（未提交改动）+ `getApprovalRequestForUser / listApprovalRequests` | ⚠️ 有未提交 diff，功能可用，本轮不修改 |
| 网页默认项目视图 | `src/lib/project-space.ts` `DEFAULT_SPACE = "live"` | ❗ 当前默认进旧概览，W01 将规范化为 `space=work` |
| 任务界面 | `_work/work-space.tsx` 挂载旧 `Board` | ❗ 仍是看板卡片，非交接工作面，W02 重建 |
| AI 页面 | `chat-panel.tsx` 在 `src/app/(app)/projects/[projectId]/chat-panel.tsx` | ❗ 独立会话中心，W06 迁移至任务内 "会话与分支" |
| `task-card.tsx` 深链自动开编辑框 | `deepLinked = canWrite && searchParams.get("task") === task.id` → `setEditing(true)` | ❗ 已确认 BUG，W01 修复：`?task=` 只查看，不自动开编辑层 |
| `page.tsx` 同时挂 TaskDrawer | 存在 | ❗ 与 task-card 编辑框可能叠层，W01/W02 拆分 |
| `_console/` 目录 | `src/app/(app)/projects/[projectId]/_console/` | 不存在，W02 新建 |

### 读取层可用性结论

| 函数 | 可用 | 说明 |
| --- | --- | --- |
| `listConsoleTasks` | ✅ | 鉴权、cursor 分页、Run/Blocker 批量摘要，页内排序 |
| `listConsoleRuns` | ✅ | 按任务 + 项目双重校验，时间倒序分页 |
| `listConsoleEvents` | ✅ | 任务活动，同类校验 |
| `getConsoleRun` | ✅ | 按 project + task + run 三重校验 |
| `getConsoleTask` | ✅ | 含 context/evidence/approvals/runs/events |
| `getConsoleConversation` | ✅ | projectId + taskId 严格匹配，private 隔离 |
| `listProjectConversations` | ✅ | 存在，W06 接入 |
| `listProjectBlockers` / `resolveBlocker` | ✅ | 存在，W05 接入 |

**接口缺口（真实不可用）：**

- 无网页侧可调用的 Agent 启动/停止/恢复控制接口 → W03 不渲染相关按钮
- 无 `/api/extension/...` 共享检查点接口（E09 未签收）→ W07 仅展示说明文字，无 "恢复执行" 按钮

### 用户现在可点击的入口和变化

本单不修改任何网页文件，无新入口。

### 实际复用函数/API

- `listConsoleTasks` / `listConsoleRuns` / `listConsoleEvents` / `getConsoleRun` / `getConsoleTask` / `getConsoleConversation` — 均在 `src/lib/collaboration-console.ts`
- `sortTaskRows` / `toTaskRowModel` / `taskPriorityGroup` / `taskPrimaryAction` — 在 `src/lib/collaboration-console-view.ts`
- `getProjectForUser` — 鉴权入口，被 collaboration-console 内部使用

### 验证命令与退出码

```bash
# 测试库：agilecampus_test（与开发库 agilecampus 独立）
npm test -- tests/collaboration-console-view.test.ts tests/collaboration-console.test.ts
# 退出码：0
# Tests: 32 passed (view: 26, console: 6)
# Duration: 1.60s
```

### 尚未实现 / 未验证

- `console-navigation.ts` — W01 新建
- `execution-console.tsx` 及 `_console/` 下全部文件 — W02 新建
- `agent-run-rail.tsx` — W03 新建
- E09 共享后端契约 — 超出本轮范围

### 下一单

W01 — 统一选择和路由，修掉叠层

---

## W01 — 统一选择和路由，修掉叠层

工单：W01
状态：验收通过
起点 HEAD：`bc0b28d`（W00 完成后为 `6b1c20f`）
本单提交：`1dc0b9c`

### 本单修改文件

- `src/lib/console-navigation.ts`（新建）
- `tests/console-navigation.test.ts`（新建，33 项单元测试全通过）
- `src/lib/project-space.ts` — `DEFAULT_SPACE = "work"`
- `tests/project-space.test.ts` — 更新默认 space 断言为 `"work"`
- `src/app/(app)/projects/[projectId]/page.tsx` — 使用 `normalizeConsoleParams`，移除全局 `TaskDrawer` 叠加，避免与详情层重叠
- `src/app/(app)/projects/[projectId]/task-card.tsx` — 修复 `deepLinked` 自动打开 `setEditing(true)` 弹窗的 BUG，`?task=` 仅查看
- `src/app/(app)/projects/[projectId]/_work/work-space.tsx` — 增加 `selectedTaskId` / `view` / `normalized` 支持

### 用户现在可点击的入口和变化

- 打开 `/projects/:id` 或旧 `?space=live` → 自动规范化并跳转至 `?space=work`（协同执行台）
- 点击任务卡片仅在详情层展示，不再双层弹出编辑对话框
- `console-navigation.ts` 纯函数支持选择任务时清空旧 `run`/`conversation`/`approval` 参数，避免跨任务状态泄漏

### 验证命令

```bash
npm test -- tests/console-navigation.test.ts tests/project-space.test.ts
# 退出码：0，全部通过
```

---

## W02 — 挂载任务列表和交接主面板

工单：W02
状态：代码完成待实测
起点 HEAD：`1dc0b9c`

### 本单修改/新建文件

- `src/app/(app)/projects/[projectId]/_console/execution-console.tsx`（新建）
- `src/app/(app)/projects/[projectId]/_console/console-shell.tsx`（新建）
- `src/app/(app)/projects/[projectId]/_console/task-list.tsx`（新建）
- `src/app/(app)/projects/[projectId]/_console/task-contract-panel.tsx`（新建）
- `src/app/(app)/projects/[projectId]/_work/work-space.tsx`（更新挂载 ExecutionConsole）
- `src/app/(app)/projects/[projectId]/page.tsx`（传递 normalized & view 参数）

### 用户现在可点击的入口和变化

- 打开项目默认 `?space=work` 呈现全新三栏协同执行台：
  - 左栏：任务列表，按行动优先级分组（待我验收 → 有阻塞 → 我的进行中 → 进行中 → 待办 → 已完成折叠），每行显示任务名、负责人、运行状态标签、阻塞计数
  - 中栏：交接工作面，显示任务目标、交接要求、完成条件、资料包（冻结状态与过期警示）、认领状态及契约版本
  - 右栏：执行记录侧轨（屏幕 ≥ 1120px 展示，窄屏提供抽屉按钮）
- 原看板模式保留并移至明确次要入口：`?space=work&view=board`，带返回协同执行链接

### 实际复用函数/API

- `listConsoleTasks`（批量 Run/Blocker 投影）
- `getConsoleTask`（任务详情与冻结上下文只读投影）
- `toTaskRowModel` / `sortTaskRows`（行动优先级排序模型）

---

## W03 — 接上真实执行记录，形成第一批可见交付

工单：W03
状态：代码完成待实测

### 本单修改/新建文件

- `src/app/(app)/projects/[projectId]/_console/agent-run-rail.tsx`（新建）

### 用户现在可点击的入口和变化

- 选定任务后在右栏（或窄屏抽屉）查看当前/历史 Run 摘要、待人工审批项与任务活动
- 明确提供“查看任务会话 →”入口，不虚假渲染“启动 Agent”“恢复执行”按钮（网页无底层执行器接口）
- 无 Run 时明确标注“暂无执行记录”

---

## W04 — 交接资料真正可保存、可绑定、可确认

工单：W04
状态：验收通过
起点 HEAD：`1dc0b9c`

### 本单修改/新建文件

- `src/app/(app)/projects/[projectId]/actions.ts`：实现 `updateTaskHandoffAction` 服务端 Action，支持接手人改派（改派自动重置承诺与认领）、`doneCriteria`（每行一条）、`requiredEvidence`（多类型解析）、`responseDueAt`、`contextPackId`；对 `review`/`done` 状态任务添加防篡改安全校验。
- `src/app/(app)/projects/[projectId]/_console/handoff-editor.tsx`：实现完整内联交接契约表单，支持团队成员与 Agent 下拉选择、交接背景说明、完成条件逐行编辑、5 项证据规范复选（`link`, `file`, `text`, `test`, `demo`）、响应截止时间、可用冻结资料包下拉绑定；展示契约版本与已认领版本；保存后自动刷新并收起。
- `src/app/(app)/projects/[projectId]/_console/task-contract-panel.tsx`：接入 `HandoffEditor`，向其注入 `members` 与 `availablePacks`。
- `src/lib/collaboration-console.ts`：`getConsoleTask` 聚合查询可用冻结资料包 `availablePacks`，严格隔离私密会话衍生的上下文包。
- `tests/collaboration-console.test.ts`：增加 `availablePacks` 任务与权限隔离性断言，通过。

### 用户现在可点击的入口和变化

- 选定任务后，在交接工作面点击“编辑交接”即可打开内联契约编辑器。
- 可直接选择团队中的人或 Agent 作为负责人；可选择已冻结的交接资料包；可勾选交付证据类型。
- 保存后页面自动刷新，契约版本自增，改派时自动重置旧认领，接手人需重新确认。

---

## W05 — 认领、阻塞、交付、人工验收收进同一面板

工单：W05
状态：验收通过

### 本单修改/新建文件

- `src/app/(app)/projects/[projectId]/_console/task-contract-panel.tsx`：中央面板内建直达动作表单：
  - 待办/未认领时：展示“认领任务”（需填写执行承诺与预估工时）与“接不住 / 拒绝认领”（退回并说明原因）。
  - 进行中时：展示“提交成果”（填写交付说明并提交待验收）。
  - 待验收时（且具有教师/管理员权限）：展示“验收任务”（通过/退回单选及验收意见）。
  - 待确认审批项直达跳转链接。
- `src/app/(app)/projects/[projectId]/_console/evidence-list.tsx`：真实交付证据列表，展示类型、名称、说明、提交人、时间及外部代码/文档链接。无 diff 不画虚假 diff，无测试结果不伪造绿标。

### 用户现在可点击的入口和变化

- 用户在选定任务后，所有核心生命周期动作（认领、拒绝、交付、验收）均在中央交接工作面一站式完成，不再依赖多层弹窗。
- 交付成果后，证据列表实时展示提交内容。

---

## W06 — 会话继承与分叉嵌入任务，修正误绑定

工单：W06
状态：验收通过

### 本单修改/新建文件

- `src/lib/collaboration-console.ts`：`getConsoleTask` 聚合查询当前任务下当前用户可读的会话列表，严格按 `projectId` + `taskId` 过滤，排除其他成员的私密会话。
- `src/app/(app)/projects/[projectId]/_console/task-conversations.tsx`：嵌入任务会话列表；无会话时明确展示“该任务暂无会话”与“+ 为此任务发起会话”入口，绝不回落至其他任务的会话；提供直达协同室该会话链接；提示会话分叉仅保留上下文，不代表代码已恢复。
- `src/app/(app)/projects/[projectId]/_studio/studio-space.tsx`：默认复用协同执行台（`mode="studio"`，聚焦展示 Agent 任务与活动），并通过 `?space=studio&view=chat` 完整保留项目历史会话与 ChatPanel，提供清晰的返回 Agent 执行台导航。
- `tests/collaboration-console.test.ts`：增加 `memberView.conversations` 与 `ownerView.conversations` 任务作用域隔离性测试断言。

### 用户现在可点击的入口和变化

- 中央交接工作面底部“会话与分支”直接展示关联到当前任务的真实会话。
- 点击“+ 新建会话”自动带入当前任务上下文跳转至协同室。

---

## W07 — 明确网页与 VS Code 检查点边界

工单：W07
状态：验收通过

### 本单修改/新建文件

- `src/app/(app)/projects/[projectId]/_console/task-contract-panel.tsx`：新增折叠面板“本地检查点与接续说明（VS Code 插件）”，明确指出：
  - 网页未接入跨环境检查点共享接口（E09 待签收），网页无法枚举队友本地运行的会话或断点。
  - 标准接续流程：在 VS Code 插件中保存本地 Checkpoint → 选择材料导出 JSON → 队友导入 → 检查代码基线与交接契约 → 以新会话带入材料继续，或建立并行 worktree。
  - 明确区隔带材料启动新会话与原生恢复 session（native resume unsupported）；不添加虚假的“上传 session”或“恢复 Agent”按钮。

---

## W08 — 全流程回归与交付

工单：W08
状态：验收通过

### 自动化检查结果

- `npm run check:ui-copy`：退出码 0，文案规范通过
- `npx tsc --noEmit`：退出码 0，TypeScript 零错误
- `npm run lint`：退出码 0，ESLint 零错误
- `npm run build`：退出码 0，Next.js 28 条路由全量编译通过
- `git diff --check`：退出码 0，无空白符与格式缺陷
- 核心执行台测试通过：
  - `tests/collaboration-console-view.test.ts` (26 tests)
  - `tests/collaboration-console.test.ts` (6 tests)
  - `tests/console-navigation.test.ts` (34 tests)
  - `tests/project-space.test.ts` (15 tests)
  - `tests/conversation-selection.test.ts` (3 tests)
  - 合计 84 项协同执行台测试 100% 通过

### 交互细节与无障碍优化（终态补充）

- **容器宽度感知**：通过 `ResizeObserver` 精确区分 `<760px` 手机端（列表/详情切换）、`760px–1119px` 平板端（列表+详情并排、执行记录抽屉按钮）、`≥1120px` 桌面端（标准三栏 280 / 剩余 / 320）。
- **键盘焦点与无障碍 (a11y)**：执行记录侧抽屉与新建任务弹窗均接入 `dialog` + `aria-modal` + Tab/Shift-Tab 焦点陷阱环回 + Escape 键快捷关闭，关闭后自动恢复焦点至触发按钮。
- **分页与详情查看**：新增服务端动作 `loadConsoleRunsPage` 与 `loadConsoleEventsPage`，支持前端点击“加载更多”按游标追加历史 Run 和任务活动；新增 `buildSelectRunHref` 支持选中特定 Run 查看错误与结果。
- **契约重新确认**：当任务认领时的契约版本低于当前最新契约版本（或未记录）时，中央动作自动变为“重新确认交接承诺”与“确认新契约并继续”，确保接手人签署最新契约。

---

## B01 — 共享契约签收

工单：B01
状态：验收通过
起点 HEAD：`b4d5389`

### 本单修改文件

- `docs/reviews/vscode-checkpoint/backend-contract.md`：完成 E09 后端契约 8 项关键技术决策签署（身份鉴权、角色校验、Task 负责人不自动改派、同源多 Attempt 规则、V1 人工传递与材料哈希索引、幂等与游标分页）。

### 契约结论

1. 认证：复用通用 PAT，由 `authenticateBearer` 解析 `userId` 并逐请求查验项目成员角色；
2. 任务边界：接受 handoff 不自动改派任务负责人，不更改任务状态，作为独立 Attempt 推进；
3. 材料存储：V1 仅存摘要与材料 SHA-256 索引，原文通过用户导出的 JSON 包在客户端间流转。

---

## B02 — 小体积检查点共享与交接 API

工单：B02
状态：验收通过

### 本单修改/新建文件

- `src/db/schema-checkpoint.ts`（新建）：定义 `checkpoint_indices`、`handoff_records`、`attempt_receipts` 数据表与类型。
- `src/db/schema.ts`：导出检查点相关表与类型。
- `src/lib/errors.ts`：增加 `NotFoundError` (404) 与 `ConflictError` (409)。
- `src/lib/checkpoint.ts`（新建）：实现检查点索引创建与分页查询、交接单发起与状态流转（accept/decline/withdraw）、Attempt 创建与回执更新服务层。
- `src/lib/extension-auth.ts`（新建）：扩展认证与 REST 错误代码映射器。
- `src/app/api/extension/v1/me/route.ts`（新建）：`GET /api/extension/v1/me`。
- `src/app/api/extension/v1/projects/[projectId]/tasks/[taskId]/checkpoints/route.ts`（新建）：`POST` 登记检查点。
- `src/app/api/extension/v1/projects/[projectId]/checkpoints/route.ts`（新建）：`GET` 分页查询检查点。
- `src/app/api/extension/v1/checkpoints/[checkpointId]/route.ts`（新建）：`GET` 检查点详情。
- `src/app/api/extension/v1/projects/[projectId]/tasks/[taskId]/handoffs/route.ts`（新建）：`POST` 发起交接单。
- `src/app/api/extension/v1/handoffs/route.ts`（新建）：`GET` 收件箱/发件箱交接单列表。
- `src/app/api/extension/v1/handoffs/[handoffId]/route.ts`（新建）：`GET` 交接单详情。
- `src/app/api/extension/v1/handoffs/[handoffId]/[action]/route.ts`（新建）：`POST` 接受/拒绝/撤回交接。
- `src/app/api/extension/v1/handoffs/[handoffId]/attempts/route.ts`（新建）：`POST` 登记 Attempt。
- `src/app/api/extension/v1/attempts/[attemptId]/route.ts`（新建）：`PATCH` 更新 Attempt 回执。
- `tests/checkpoint-api.test.ts`（新建）：8 项端到端 API 测试全部通过。

### 自动化验证

- `npm test -- tests/checkpoint-api.test.ts`：8/8 通过 (100%)
- `npm test -- tests/checkpoint-api.test.ts tests/collaboration-console-view.test.ts tests/collaboration-console.test.ts tests/project-space.test.ts tests/conversation-selection.test.ts tests/console-navigation.test.ts`：92/92 通过 (100%)
- `cd vscode-extension && npm test`：87/87 通过 (100%)
- `npm run check:ui-copy && npx tsc --noEmit && npm run lint`：全部 0 错误通过
- `npm run build`：30/30 路由全量通过
- `git diff --check`：0 错误
