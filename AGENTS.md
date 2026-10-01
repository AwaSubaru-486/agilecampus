# AgileCampus 当前协作分工（先读）

> 这是共享工作区的最高优先级协作说明。开始改代码前先确认自己负责的区域；不要覆盖另一位 Agent 的未提交改动。

## 当前优先入口：网页交接主线（2026-10-02）

用户本轮要求 **Codex 只写工单，由 Luna 施工**。执行网页重构请先读 [人–Agent 交接网页工单](docs/superpowers/plans/2026-10-02-handoff-first-web-luna-workorders.md)，首次完成 W00–W03 的可见工作面后停下来验收。该工单对本轮网页导航、组件挂载和交付批次优先；Luna 获准修改其中列出的网页 UI/导航文件，原 Antigravity 边界不再阻挡这些具体文件。其他执行者未提交改动仍须保留，不接管 VS Code 或未签收共享后端。本文下方“首次 E00–E02”仅适用于独立扩展专项，不适用于这次网页工单。

## 用户个人模块：Luna 执行入口

[VS Code 工作台、检查点与接续专项工单](docs/superpowers/plans/2026-09-30-vscode-checkpoint-handoff-luna-workorders.md)用于用户负责的版本迭代协同模块。执行此专项时，先读该工单；其 E00–E10 顺序优先于网页执行台工单，不表示接管网页重构。首次只做 E00–E02，完成后停下来验收。

允许范围是 `vscode-extension/**` 及该专项的文档/测试。共享 schema、任务状态机、API 与网页仍由原负责人负责；E09 先提交后端契约评审，不能擅自修改共享后端。其他执行者的未提交改动必须保留。

## Codex（总负责人）

负责业务真相、权限和 AI 数据链路：

- 任务状态机与动作链：认领 → 提交成果 → 人工验收；
- 拖拽安全：状态分组不可拖拽，服务端拒绝拖拽修改 `status`；
- Context Pack：schema、preview/create/get/freeze API、权限、私密隔离、过期判断、裁剪；
- Handoff Contract：交接目标、完成条件、证据要求、响应期限、上下文包关联；
- Agent orchestrator、Agent API、数据库同步、领域测试、构建与最终合并。

Codex 维护的文件边界：

```text
src/db/schema.ts
src/lib/context-pack.ts
src/lib/handoff.ts
src/lib/task.ts
src/lib/task-status.ts
src/lib/agent/**
src/app/api/**
src/app/(app)/projects/[projectId]/actions.ts
src/app/(app)/projects/[projectId]/board.tsx
src/app/(app)/projects/[projectId]/task-card.tsx
src/app/(app)/projects/[projectId]/_work/work-space.tsx
tests/**
```

## Antigravity（视觉负责人）

负责可见 UI 的 polish、响应式和可访问性，不改变业务状态和服务端接口：

- `/today` 行动队列；
- `/library` 工程索引；
- 顶部工作带 `src/app/(app)/_shell/top-workbar.tsx`；
- 项目模式切换 `src/app/(app)/projects/[projectId]/_shared/space-tabs.tsx`；
- 现场页、记录页和协同室的 class、间距、空态、错误态、焦点状态；
- 提供桌面/窄屏截图和视觉改动说明。

Antigravity 禁止修改：

```text
schema、API route、orchestrator、task-status、任务 action、拖拽状态逻辑、测试 fixtures
```

## 共同规则

1. 从当前分支的最新 HEAD 开始工作，不回退到旧提交。本轮网页重构先读 [`2026-10-02 交接主线工单`](docs/superpowers/plans/2026-10-02-handoff-first-web-luna-workorders.md)，以其导航、挂载和批次要求为准；[`2026-09-30 逐单施工手册`](docs/superpowers/plans/2026-09-30-collaboration-console-execution-runbook.md)与[`产品与架构计划`](docs/superpowers/plans/2026-09-30-human-agent-collaboration-console-rebuild.md)保留领域语义和权限约束。2026-09-29 文案规则继续有效；2026-09-28 双端计划保留为长期规划。本页顶部已明确授权的网页文件可由 Luna 修改，其余跨边界修改仍须协调。
2. 一次只改自己负责的文件；跨边界前先说明，不直接覆盖。
3. 每项独立提交：`feat(ui): ...`、`fix(core): ...` 或 `docs: ...`。
4. 禁止 `git reset --hard`、删除测试、覆盖未提交改动。
5. Codex 负责最终合并以及 `npm run lint`、`npm run build`、相关 Vitest 验收。

详细说明：`docs/reviews/2026-09-20-agent-work-split.md`。
