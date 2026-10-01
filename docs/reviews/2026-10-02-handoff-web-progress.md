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
状态：存根完成（handoff-editor.tsx）

### 本单新建文件

- `src/app/(app)/projects/[projectId]/_console/handoff-editor.tsx`

### 边界说明

- 当前阶段提供安全的任务编辑引导，复用既有 `updateTask` 动作流，未直接写库，契约版本保持自增。

---

## W05 — 认领、阻塞、交付、人工验收收进同一面板

工单：W05
状态：存根完成（evidence-list.tsx）

### 本单新建文件

- `src/app/(app)/projects/[projectId]/_console/evidence-list.tsx`

### 边界说明

- 交付证据按真实出处、类型与外部链接展示；无 diff 不画虚假 diff，无测试结果不伪造绿标。

---

## W06 — 会话继承与分叉嵌入任务，修正误绑定

工单：W06
状态：存根完成（task-conversations.tsx）

### 本单新建文件

- `src/app/(app)/projects/[projectId]/_console/task-conversations.tsx`

### 边界说明

- 会话按当前 `taskId` 筛选归属，避免历史会话误落入无关联任务；明示会话分叉不代表代码分支恢复。

---

## W07 — 明确网页与 VS Code 检查点边界

工单：W07
状态：完成（文档与文案边界锁定）

### 边界说明

- 网页执行台内明确标注“网页暂无 Agent 启动/恢复接口，请在 VS Code 插件中操作”。
- 准确区隔会话、上下文包与本地检查点，不伪造原生 session resume 按钮。

---

## W08 — 全流程回归与交付

工单：W08
状态：进行中

### 自动化检查结果

- `npm run check:ui-copy`：退出码 0，文案规范通过
- `npx tsc --noEmit`：退出码 0，TypeScript 零错误
- `npm run lint`：退出码 0，ESLint 零错误
- `npm run build`：退出码 0，Next.js 28 条路由全量编译通过
- `git diff --check`：退出码 0，无空白符与格式缺陷
- 核心执行台测试通过：
  - `tests/collaboration-console-view.test.ts` (26 tests)
  - `tests/collaboration-console.test.ts` (6 tests)
  - `tests/console-navigation.test.ts` (33 tests)
  - `tests/project-space.test.ts` (15 tests)
  - `tests/conversation-selection.test.ts` (3 tests)
  - 合计 83 项协同执行台测试 100% 通过

