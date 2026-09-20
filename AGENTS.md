# AgileCampus 当前协作分工（先读）

> 这是共享工作区的最高优先级协作说明。开始改代码前先确认自己负责的区域；不要覆盖另一位 Agent 的未提交改动。

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

1. 从基线 `cef1d42` 开始工作。
2. 一次只改自己负责的文件；跨边界前先说明，不直接覆盖。
3. 每项独立提交：`feat(ui): ...`、`fix(core): ...` 或 `docs: ...`。
4. 禁止 `git reset --hard`、删除测试、覆盖未提交改动。
5. Codex 负责最终合并以及 `npm run lint`、`npm run build`、相关 Vitest 验收。

详细说明：`docs/reviews/2026-09-20-agent-work-split.md`。
