# AgileCampus 双 Agent 协作分工

更新时间：2026-09-20  
当前分支：`feat/risk-aware-closure`  
当前基线：`e913b48 fix: prevent status changes through board drag`

## 总负责人：Codex（当前任务）

我负责所有会影响业务真相、权限和 AI 可复现性的改动：

- 任务状态机与动作链：认领、提交、验收、退回、重开；
- 拖拽安全边界：状态分组关闭拖拽，`moveTaskAction` 拒绝携带 `status`；
- Context Pack：schema、preview/create/get/freeze API、权限、私密会话隔离、过期判断、裁剪上限；
- Orchestrator：只把 frozen snapshot 交给模型，并把 `contextPackId` 写入消息审计；
- 数据库同步、领域层测试、构建与合并；
- 最终验收与冲突处理。

我当前维护的文件边界：

```text
src/db/schema.ts
src/lib/context-pack.ts
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

## 视觉负责人：Antigravity

反重力负责可见 UI 的视觉与交互打磨，但不改变业务状态和服务端接口：

- `/today` 行动队列的密度、键盘焦点、空态和错误态；
- `/library` 工程索引的排版、筛选反馈和响应式布局；
- 顶部工作带：`src/app/(app)/_shell/top-workbar.tsx`；
- 项目模式切换：`src/app/(app)/projects/[projectId]/_shared/space-tabs.tsx`；
- 现场页和记录页的视觉微调，仅限 class、文案层级、间距和可访问性；
- 协同室的视觉 QA：可以调整 CSS/class，但不能删除 context pack 选择器、人工确认边界或权限提示；
- 每次修改至少提供桌面和窄屏截图，并注明改了哪些状态。

反重力不要修改：

```text
数据库 schema、API route、orchestrator、task-status、任务 action、拖拽状态逻辑、测试 fixtures
```

## 协作规则

1. 先同步到 `e913b48`，再开始自己的部分。
2. 一次只改自己负责的文件；需要跨边界时先在任务说明里提出，不直接覆盖。
3. 每个功能独立提交，提交信息写清 `feat(ui): ...` 或 `fix(ui): ...`。
4. 禁止 `git reset --hard`、覆盖他人未提交改动、删除测试来“过验收”。
5. Codex 负责最终合并、`npm run lint`、`npm run build` 和相关 Vitest；反重力提交截图与视觉说明即可。

## 发给 Antigravity 的任务

> 基于 `e913b48` 做 UI polish。只改 `/today`、`/library`、顶部导航、项目模式切换，以及现场/记录页的 class 与可访问性。不要改 schema、API、orchestrator、任务状态机和拖拽逻辑。保留“状态列不接受拖拽”的提示、任务动作链和协同室 context pack 选择。完成后给出桌面/窄屏截图、改动文件清单和 commit hash。
