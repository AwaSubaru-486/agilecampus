工单：00–01
状态：验收未通过，待修正（原提交 72ae472）
起点 HEAD：4a84d20
修改文件：
- `src/lib/collaboration-console-view.ts`
- `tests/collaboration-console-view.test.ts`
- `docs/reviews/2026-09-30-collaboration-console-progress.md`
- `docs/reviews/2026-09-30-collaboration-console-gaps.md`

检查命令和退出码：
- `npx vitest run tests/collaboration-console-view.test.ts tests/project-space.test.ts tests/conversation-selection.test.ts`：0
- `npx tsc --noEmit`：0
- `npm run lint`：0
- `git diff --check`：0
实际结果：已建立任务行动分组、Agent Run 排序、状态标签和主动作规则；共 13 个新规则测试，连同相关既有测试共 31 个通过；未接入数据库、路由或页面。
未解决问题：只读数据投影尚未实现；浏览器启动 Agent 的真实入口尚未找到，不能显示开始/继续假动作。
下一个工单：先修正工单 01 的启动条件、运行状态文案、失败排序、运行标签一致性和错误查看能力判断，并补工单 00 的数据/权限映射表，再进入工单 02。

## 用户追加：标题下副文案清理

范围：今日、项目任务、会话、项目资料、档案、决策、风险、活动、复盘、资源页和任务抽屉。

内容：删除静态模块介绍和重复说明；任务动作改为“认领任务”“提交成果”“拒绝认领”；保留真实数据、用户填写的描述、错误和权限说明。已将规则写入两份计划，并将已删除的典型文案加入 check:ui-copy。

此项为独立文案改动，不表示工单 00–01 的逻辑审查问题已修复。

检查：check:ui-copy、tsc --noEmit、next build、git diff --check 均通过；lint 退出码 0，存在 .codex-ppt-build 下 3 条已有 unused-vars 警告，本次修改文件无警告。

浏览器验证未完成：内置浏览器的项目页显示 ERR_CONNECTION_REFUSED，curl 确认 localhost:3000 拒绝连接。本次没有启动服务或更改登录状态。
