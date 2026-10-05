# DeepSeek × AgileCampus 项目模拟测试报告

状态：模拟项目首轮报告；后续已完成 R00–R02 后端修复。完整端到端验收尚未完成：网页模型、VS Code API 接线、材料导入、真实 Agent 接班和并行均未验收。

## 1. 一句话结论

项目可以构建，任务详情的证据数组类型错误已修复；checkpoint/handoff 后端已通过隔离真实 HTTP 流程验证。真实 DeepSeek 调用仍未启动，VS Code 扩展仍未调用服务端交接 API。因此，目前不能证明通过产品界面的跨成员 A→B 接班、DeepSeek Agent session 恢复或完整平台链路可用。

## 2. 被测版本和隔离

- 产品 HEAD：c1b53cf7717ced0036af70c37c81680ea95b2722，分支 feat/risk-aware-closure。
- 另包含已存在的 agent-run rail 未提交改动，patch SHA-256 为 5f445bb21e1f16b6799471a5811293dd2f8b5856b9d2bf1a8e5141988c8ef11c；报告与模拟测试文件没有加入产品测试副本。
- 临时副本运行在 localhost:3100。用户原有 localhost:3000 服务未停止或使用。
- 测试使用独立 PostgreSQL 实例与两个新库 ac_sim_20261002161059、ac_test_20261002161059；现有 agilecampus 与 agilecampus_test 未用于本轮测试。
- Node v26.8.1、npm 11.19.0、Git 2.50.1、VS Code 1.122.0、Codex CLI 0.153.4、Entire CLI 0.11.3。
- GitHub 登录身份为 AwaSubaru-486。新建的 private 模拟仓库只包含合成代码、需求和测试。
- Reviewer、A、B、Outsider 四个合成账号通过网页注册；A/B 加入测试团队。它们在同一个 in-app browser profile 中通过登出/登录顺序操作，不是四个同时独立浏览器环境。

## 3. 模型连接

网页副本中的 DEEPSEEK_API_KEY 当前为空；本机进程环境、仓库忽略的 env 文件和 Keychain 也没有可用 Key。本轮没有向 DeepSeek 发送请求，没有消耗模型额度。请求模型别名配置为 deepseek-v4-flash，但未获得实际服务返回。

网页 DeepSeek：BLOCKED，真实聊天和工具草案未测。

VS Code 本地 Agent：插件通过 codex exec 启动 Codex CLI，没有发现 DeepSeek Provider 配置。没有运行本地 Agent，也没有使用其他模型服务的额度。

环境已准备好，等用户把 Key 写入 private temporary clone 的 .env.local。该文件已被 Git 忽略，不在产品仓库中。

## 4. 项目过程与代码仓库

本次真实 GitHub 仓库：[agilecampus-sim-20261002-161059](https://github.com/AwaSubaru-486/agilecampus-sim-20261002-161059)，当前 private。初始主分支基线为 dbe8b41。

仓库定义 TypeScript rankTasks API、固定日期、排序规则、2 项 smoke 测试和 6 项完整 contract tests。基线 smoke 2/2 通过。contract 基线为 1/6 通过、5 项失败，符合模拟任务尚未完成的状态。A/B Agent 尚未开始接手或并行实现；没有模拟 PR。

网页端使用 Reviewer 账号创建团队和“团队任务排期器”项目；A/B 加入团队。Reviewer 手工创建 T1 并尝试冻结交接要求，任务记录实际保存成功：负责人 A、契约 v2、requiredEvidence 为 ["link","test"]。打开任务详情时页面崩溃（问题 I-01），无法继续认领和接手。

Outsider 登录后访问已知项目 URL，页面返回 404；未加入团队的用户不能从网页读取该项目。

## 5. 用例结果

详细状态见 cases.csv。修复复测后的当前计数：PASS 16，FAIL 0，BLOCKED 9，NOT_RUN 1，PARTIAL 3，EXPECTED_FAIL 1。PARTIAL 与 EXPECTED_FAIL 不计入 PASS 比例。初始模拟中三项 FAIL 分别为任务详情崩溃、reset 表清理遗漏、根目录测试工作目录错误；本轮 R00–R01 已修复并复测通过。

主要命令与结果：

| 检查 | 结果 |
| --- | --- |
| npm run lint | exit 0，3 条 ESLint warning |
| npm run check:ui-copy | 通过 |
| npm run build | 通过 |
| 根目录 npm test | 修复后 58 个文件中 57 通过、1 跳过；619 项中 617 通过、2 跳过 |
| npm --prefix vscode-extension run check | 通过 |
| npm --prefix vscode-extension test | 13 个文件、87 项通过 |
| tests/checkpoint-api.test.ts | 9 项通过；此测试直接调用 route handler，不等于真实 HTTP 鉴权写链路 |
| HTTP 未授权探测 | GET /api/extension/v1/me 与 GET /api/agent/projects 均返回 401 |
| 网页 Agent 无 Key 失败体验 | 合成会话内提交只读分析请求；明确返回“DeepSeek 未配置”，API 为 400，无助手答复，未显示成功草案 |
| 独立 VS Code Extension Host | process 启动成功，日志确认 agilecampus.agilecampus-vscode 激活；没有操作命令和 PAT 连接 |
| 模拟项目 smoke | 2 项通过 |
| 模拟项目 contract 基线 | 1 项通过，5 项按设计失败 |

根目录 Vitest 已限定在 tests/**；扩展测试单独执行，attempt-store worker 通过测试文件 URL 定位源码。resetDb 清单包含全部业务表，并有真实 checkpoint/handoff/attempt 记录清除用例。详见后续施工记录。

## 6. A→B 记忆和接班

尚未开始 Agent 执行，不能判断记忆是否足以让 B 接班。模拟需求明确要求 B 不读取 A 私有目录，只取得代码 SHA 与显式交接材料；本轮无 session transcript，也没有结构化 checkpoint。

当前实现边界已查明：扩展保存的检查点写入本机 globalStorage；文件导出/导入需要人工传递。后端有 checkpoint、handoff、attempt 路由，但扩展 API client 没有对应请求。团队共享交接入口未接通。

## 7. 并行方案

未运行并行 Agent。已有真实 GitHub 仓库的两个独立 clone；这不等于 VS Code 扩展创建了 worktree，也不等于 Agent 进程重叠。X/Y 的运行证据尚不存在。

## 8. 页面入口与断点

- 已走通：注册 Reviewer、创建团队、创建项目、注册 A/B/Outsider、A/B 加入团队、生成测试 PAT、网页创建一个人工任务。
- Outsider 项目访问已拒绝。
- 任务详情崩溃已修复：requiredEvidence 以 EvidenceType[] 通过服务端投影；网页已重放保存、刷新、重开检查，证据标签与勾选状态一致。
- 真实模型草案入口未走通，因为 DeepSeek Key 未配置。
- 无 Key 失败体验已走通：会话保留，发送失败后页面明确提示配置缺失，没有伪造回答或草案。
- 插件命令通过 Extension Host 加载并激活，但没有通过 UI 操作 connect/save/export/import/resume 命令。
- 扩展没有调用 /api/extension/v1，服务端交接写入与插件本地 checkpoint 仍是两条链。

## 9. 缺陷

- I-01，P1：HandoffEditor 将 JSON 数组 requiredEvidence 当作字符串调用 split，任务详情崩溃。网页关键任务流程中断。
- I-02，P2：resetDb 测试 helper 漏掉 attempt_receipts、checkpoint_indices、handoff_records，可能造成测试数据残留。
- I-03，P2：根 npm test 包含扩展测试，三个跨进程测试因 worker 相对路径从根目录解析而失败。
- I-04，P1：扩展未接入现有服务端 checkpoint/handoff/attempt API；普通用户不能从插件把本地检查点登记并交给另一个成员。
- I-05，BLOCKED：DeepSeek Key 缺少，未测真实聊天链与 provider 使用。

## 10. 目前可演示与不可宣称

目前可以演示隔离平台注册和建项、团队成员加入、陌生用户被拒绝访问、GitHub private 模拟仓库、真实 build 与扩展单测通过。

当前不可宣称 DeepSeek 已在产品链路连接、VS Code 插件已使用 DeepSeek、A 的 Codex 对话可被 B 原生恢复、服务端能自动给 B 传送完整 session、扩展交接 API 已接好、并行 Agent 已真实执行、PR 自动合并或平台整链已经验收。

## 11. 资源

private 模拟仓库保留：[agilecampus-sim-20261002-161059](https://github.com/AwaSubaru-486/agilecampus-sim-20261002-161059)。本地隔离平台服务器、两个 VS Code 临时 profile 和专用 PostgreSQL 仍运行，以便后续测试。模拟任务的契约已更新为 v3，证据要求为 link/test/demo。用户现有 3000 服务没有停止。另有“模拟任务排序 Agent 测试”空会话；无 Key 失败请求没有生成回答。

模拟账号密码与 PAT 不写入报告；PAT 只在 CUA 进程内捕获，用于测试，测试结束需撤销。原始日志和临时数据库未推到 GitHub。

## 12. 下一步

要完成真实模型验收，需要在隔离副本的 .env.local 配置 DeepSeek Key，然后重启/确认 3100 服务读取到模型配置。随后先跑直连小请求，再走网页聊天、工具草案和人工确认。

DeepSeek 是否可用与共享交接是两条独立验收线。I-01 已在 R01 修复，I-04 的扩展共享 API 接线仍阻断通过产品界面演示完整 A→B 流程；应先完成 R03–R04，再继续 T05–T09。

## 13. R02 后端复验更新（2026-10-02）

R00–R02 施工与复验明细见 [后续施工进度](../../handoff-integration-next/progress.md)，真实 HTTP 状态码明细见 [R02 HTTP smoke 证据](../../handoff-integration-next/evidence/r02-http-smoke.md)。R02 不是 DeepSeek 或 VS Code 的端到端验收。

- 根目录 Vitest 普通 `npm test`（固定单 worker）：58 个文件中 57 通过、1 跳过；622 项中 620 通过、2 跳过。
- `tests/checkpoint-api.test.ts`：12 项通过；包含非成员/离队成员拒绝、任务合同过期冲突、JSON/版本字段验证、同键并发幂等和 accept/withdraw 竞争。
- 实际 Next.js HTTP 服务使用隔离模拟库运行 A/B/Outsider 流程：认证、checkpoint、handoff、列表、详情拒绝、accept、attempt 回执、preflight、过期合同、撤权及并发转换均按预期；合成数据已删除，临时服务已停止。
- 扩展自身仍缺 extension/v1 客户端接线（I-04）；没有 Extension Host 命令级验证、材料导入、DeepSeek Key 或真实 Agent session。不能因 API HTTP 通过而声称产品主路径已完成。
