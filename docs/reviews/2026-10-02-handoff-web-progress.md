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

<!-- 后续每单在此追加 -->
