# 当前发现

## P1 — 打开任务时交接编辑器崩溃

复现：测试副本 3100 端口，以 Reviewer 登录；打开团队任务排期器，创建“实现任务排期器输入校验”，在编辑交接契约中指派 A 并选择“外部链接”和“单测日志”，保存后打开任务详情。

实际：服务端已保存契约（任务版本为 v2、负责人 A、requiredEvidence 为 JSON 数组 ["link","test"]），但详情页显示通用错误边界。隔离服务器日志为 TypeError: selectedTask.requiredEvidence.split is not a function，位置 src/app/(app)/projects/[projectId]/_console/handoff-editor.tsx:64。

原因线索：数据库 required_evidence 是 JSONB，保存时值为数组；HandoffEditor 初始化却对 selectedTask.requiredEvidence 调用字符串 split。需由产品负责人修复前后端类型约定后再验收。

影响：成员无法打开该任务详情继续认领或检查交接契约，直接中断测试项目主路径。保存动作已经成功，刷新后仍会在详情渲染失败。没有改代码绕过此问题。

## P1 — VS Code 扩展没有接入共享交接 API

复现：检查 vscode-extension/src/agilecampus/api-client.ts 与 src/commands/checkpoint-support.ts；前者只实现 /api/agent/projects、/api/agent/tasks/* 的读取，后者保存检查点时只写 CheckpointStore（本机 globalStorage）。扩展源码未调用 /api/extension/v1。

影响：服务端可以有 checkpoint/handoff/attempt 路由，但目前插件 UI 没有把 A 的交接登记到服务端，也不能在 B 的收件入口读取服务端 handoff。仅靠现有本地 JSON 导出/导入需要人为传包，不能演示自动共享或服务端追踪。

证据：被测源码 HEAD c1b53cf；静态检索结果见本报告 capability-map.md。待真实 Extension Host 交互补充截图。

## P2 — 测试库 reset 清理清单漏三张业务表

复现：在独立 ac_test_20261002161059 上运行 root Vitest。tests/reset-db.test.ts > resetDb 表清单 > 覆盖库中所有业务表 失败，未列入 TRUNCATED_TABLES 的表为 attempt_receipts、checkpoint_indices、handoff_records。

影响：新增交接数据可能跨测试残留，root test isolation 不完整。未修改该测试或业务代码。

## P2 — root npm test 会以错误工作目录执行扩展跨进程测试

复现：npm test 从产品根运行时也发现 vscode-extension/tests/attempt-store.test.ts。其中三个 worker 用 process.cwd() 拼 src/attempts/store.ts，实际从产品根寻找，报模块不存在。扩展目录单独运行 npm --prefix vscode-extension test 则 13 files / 87 tests 全过。

影响：合并测试命令失败；需要由测试负责人决定是否隔离 root Vitest include 或修正 worker 路径。未修改测试。

## BLOCKED — DeepSeek 与 Extension Host 端到端流程

当前环境没有 DEEPSEEK_API_KEY；用户已收到将其加入私有测试副本 .env.local 的请求。测试只会在收到“已配置”后继续真实调用。

已启动的 VS Code 测试进程使用独立 --user-data-dir 与 --extensions-dir，但 macOS CUA 只绑定到用户原有窗口，无法操作本次进程；没有将用户原窗口改作测试宿主。

## 首批修复复测状态

- I-01 任务详情 requiredEvidence 类型错误：已在当前工作树修复。详情加载、保存到契约 v3、刷新和再次编辑均通过；证据数组与 checkbox 状态一致。
- I-02 resetDb 表清理：清单已补 attempt_receipts、checkpoint_indices、handoff_records；用例通过领域方法创建三类记录后 reset 并确认计数为零。
- I-03 根 Vitest 工作目录：根配置只收集 tests/**；attempt-store worker 按测试模块 URL 定位源码。根套件与扩展套件独立通过。
- I-04 扩展未接入共享 API：仍未修复，属于下一阶段 R03。
- I-05 DeepSeek Key：仍缺失，真实付费调用未开始。

## R02 服务端修复复核

- I-06 非法 JSON/Zod 错误被吞：已修复。`parseExtensionJson` 对非法 JSON 返回 400；preflight 空 body 被明确允许，其他 required body 不允许为空。12 项 route-handler 测试和真实 HTTP smoke 均验证。
- I-07 handoff 状态竞争窗口：已修复。handoff 行事务锁 + `state=offered` 与版本条件更新；accept 同时锁定任务契约行。accept/withdraw 的并发真实 HTTP 请求只有一方返回 200，另一方 409。
- I-08 离队成员仍可能处理交接、expectedHandoffVersion 未使用：已修复。处理动作重查项目当前成员；v1 action body 必须提供 expectedHandoffVersion 并与交接记录相同；accept 还需任务当前契约版本未变化。HTTP 离队成员返回 403、过期契约返回 409。
- 同键不同 payload 过去被误当作幂等重试：已修复。完整比较项目/任务/检查点/接收人/任务时间/交接版本；唯一键冲突后查回并按 payload 判等。并发同键同载荷仅生成一条。

证据：[R02 HTTP smoke](../../handoff-integration-next/evidence/r02-http-smoke.md)、[R02 进度](../../handoff-integration-next/progress.md)。I-04 和 I-05 仍未解决。
