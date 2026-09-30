工单：00–01
状态：完成，停下来等待验收
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
下一个工单：02（只读数据投影）。
