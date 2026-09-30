工单：00–01
状态：进行中（原提交 72ae472 的五项审查问题已修正，待用户验收）
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

## 继续施工：规则修复与数据盘点

起点 HEAD：0221853。

修改文件：collaboration-console-view.ts、其测试，以及新增的数据权限映射 `docs/reviews/2026-09-30-collaboration-console-data-map.md`。

实际结果：
- 启动动作同时要求真实能力、当前用户执行权限、Agent 负责人、todo/doing 状态、版本一致的认领契约及已冻结上下文；缺省权限或冻结信息时不开放。
- completed 文案改为“执行完成”，不宣称任务已经提交。
- 最新失败且无活动运行时进入阻塞优先组；已完成任务不被历史失败重新归入阻塞。
- 运行标签使用与运行选择一致的排序。
- 查看错误遵守 canViewAgentRun；未知状态不会读取对象原型属性。
- 完成读取来源、权限边界、写入入口及缺口映射。

检查：相关 3 个测试文件共 44 项通过；tsc --noEmit、check:ui-copy、next build、git diff --check 均退出码 0；lint 退出码 0（PPT 构建脚本仍有 3 条已有警告）。

范围说明：本段没有接入页面或数据库，没有改变任务写接口，没有实现启动/恢复进程，没有推送远端。工单 02 尚未实施。本段先停下来供用户验收，不把纯规则测试通过说成完整产品闭环验收通过。

下一个工单：02，只读投影；先实现项目鉴权、分页和批量摘要，然后测试外项目任务/运行、私密会话、空项目及分页，不提前改 UI。
