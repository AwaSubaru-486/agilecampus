# 检查点交接后续施工进度

日期：2026-10-02
计划：[handoff-integration-next-luna-plan.md](../../superpowers/plans/2026-10-02-handoff-integration-next-luna-plan.md)
初始模拟报告：[DeepSeek 项目模拟报告](../deepseek-project-simulation/20261002-161059/report.md)

## R00 — 验收基线：完成

修改：

- vitest.config.ts 将根 Vitest 收集范围限制在 tests/**；扩展测试仍由 vscode-extension 自己运行。
- vscode-extension/tests/attempt-store.test.ts 的跨进程 worker 通过测试模块 URL 定位 store 源码，不依赖启动目录。
- tests/helpers.ts 把 attempt_receipts、checkpoint_indices、handoff_records 加入 resetDb 清单。
- tests/reset-db.test.ts 用领域方法创建 checkpoint、handoff、attempt，执行 reset 后逐表检查计数为零。

验证：

| 命令 | 结果 |
| --- | --- |
| npm test | 58 个文件：57 通过、1 跳过；619 项：617 通过、2 跳过 |
| npm --prefix vscode-extension test | 13 个文件、87 项通过 |
| attempt-store worker 回归 | 1 个文件、14 项通过 |
| npm run lint | 通过，保留 3 条既有 warning |

## R01 — 任务交接证据类型：完成

修改：

- 协同执行台的 requiredEvidence 统一为 EvidenceType[] | null，数据库 JSONB 边界逐项校验枚举值。
- 编辑器用数组初始化 checkbox；任务切换时草稿按任务 ID 隔离，不沿用上一任务勾选。
- 详情页用中文证据标签展示数组；null/空数组不产生空内容。
- tests/handoff.test.ts 覆盖 null、空数组、合法类型和非法旧数据。

浏览器复测：

1. 在隔离平台 localhost:3100 打开原失败任务 a2fd27d0-fb36-4161-b6a7-0c22a8a9de10，详情正常显示“外部链接、单测日志”。
2. 打开编辑器，两项 checkbox 均选中；追加“演示证据”并保存，任务契约版本从 v2 更新为 v3。
3. 刷新页面、重开编辑器，三项证据标签和选中状态保持一致。

自动检查：

| 命令 | 结果 |
| --- | --- |
| npm test -- tests/reset-db.test.ts tests/handoff.test.ts | 2 个文件、14 项通过 |
| npm run build | 通过 |
| npm run check:ui-copy | 通过 |
| npm --prefix vscode-extension run check | 通过 |

## 当前改动边界

- R00–R02 未修改数据库 schema 或 Agent 编排；R03 为插件接收人选择新增只读成员 API，未改数据库 schema。R04–R06 未开始。
- 用户原有 agent-run-rail.tsx 未提交修改仍保留，未覆盖。
- 模拟项目的任务现为契约 v3，requiredEvidence 为 link/test/demo；数据只在隔离模拟库。
- 真实 DeepSeek 请求、Extension Host 命令交互、服务端 A→B 交接及并行 Agent 仍未验证。
- 复测通过 Codex 的浏览器辅助功能确认页面与 checkbox 状态；本轮没有将截图保存为文件。

## 下一步门槛

R00–R02 已完成。R03 的摘要发布、成员目录和交接发起代码及自动检查已完成；下一门槛是在真实 Extension Host 中完成 A 发布、A→B 发起记录核验。R03 的 action body 必须使用当前契约 `{ expectedHandoffVersion, reason? }`。缺少 DeepSeek Key 只会阻断 R05 的模型调用。

## R02 — 共享后端契约：实现及隔离验证完成

用户继续施工后，本批仅进入 R02；R03 插件接线未开始。

修改范围：

- `src/lib/checkpoint.ts`：发起 handoff 时事务内重新核验双方成员身份；锁定任务行检查契约版本和任务更新时间；相同幂等键比较项目、任务、检查点、接收者、任务时间和版本；并发重复键由数据库唯一约束兜底，随后按相同载荷返回原记录，否则 409。
- `resolveHandoff` 在事务内锁定交接行并重查当前成员资格和动作主体；accept 检查并锁定任务行，防止校验后任务契约被并发更新；状态写入带 `state=offered` 和版本条件，竞争失败返回 409。
- `src/lib/extension-auth.ts` 新增 JSON 请求体解析；空 body 只在 preflight 被允许，非法 JSON/Zod 字段错误返回 400，不再吞错后继续执行。action v1 body 现在要求 `expectedHandoffVersion`，只允许 `reason` 作为额外字段。
- `tests/checkpoint-api.test.ts` 增加成员撤权、旧契约、动作版本、非法 JSON、预检字段、同键并发幂等和 accept/withdraw 并发回归。
- `tests/reset-db.test.ts` 中领域层 `resolveHandoff` 调用补上必要交接版本。
- `docs/reviews/vscode-checkpoint/backend-contract.md` 标注实际 v1 行为，避免插件端沿用旧提案字段。

阶段检查：

| 检查 | 结果 |
| --- | --- |
| `npm test -- tests/checkpoint-api.test.ts` | 1 文件、12 项通过 |
| `npm test -- tests/checkpoint-api.test.ts tests/reset-db.test.ts` | 2 文件、17 项通过 |
| 实际隔离 HTTP 服务 `localhost:3111` | A/B/旁观者操作、手递交与回执、旧契约、非法 JSON、成员撤权、accept/withdraw 竞争全部符合预期；退出码 0，详情见 `evidence/r02-http-smoke.md` |
| `npm run build` | 通过 |
| `npm run lint` | 通过，3 条既有 extension-test warning |
| `npm run check:ui-copy` | 通过 |
| `npm --prefix vscode-extension run check` | 通过 |
| `npm --prefix vscode-extension test` | 13 文件、87 项通过 |
| 根 `npm test -- --no-file-parallelism --maxWorkers=1` | 58 文件：57 通过、1 跳过；622 项：620 通过、2 跳过 |
| 普通 `npm test`（配置 `maxWorkers: 1` 后） | 58 文件：57 通过、1 跳过；622 项：620 通过、2 跳过 |

所有服务验证使用 `/tmp/agilecampus-sim-20261002-iWsfTm/repo` 隔离副本。测试库 `ac_test_20261002161059`；HTTP smoke 使用 `ac_sim_20261002161059` 并清理合成账号/团队/项目。无 Key、Authorization、真实 session 或原始材料写入证据。临时 HTTP 服务已停止；用户原 localhost:3000 未触碰。Vitest 配置补 `maxWorkers: 1` 后，普通 `npm test` 全量通过。

## R03 — 检查点摘要发布与交接发起：实现完成，待 Extension Host 实测

本次继续施工新增共享后端只读成员端点，并完成扩展端 handoff 发起命令。代码与自动测试完成；Extension Host 与真实服务端交接验收仍未做。

- `GET /api/extension/v1/projects/{projectId}/members` 由 bearer token 鉴权，并通过 `getProjectForUser` 每次请求核验调用者当前仍是项目成员；只返回当前项目的人类成员 `{ userId, displayName, role }`，不返回 email，设置 `Cache-Control: private, no-store`。系统 Agent 不列为 VS Code 人类接收者。
- `tests/checkpoint-api.test.ts` 覆盖有效成员、无 token 401、非成员 403、成员离队后立即拒绝/不再列出及无效 UUID 400。
- 成员 API 合约现已可供插件调用。扩展端须从目录读取接收人，排除当前用户；不得要求用户输入或猜测接收人 ID。

成员端点检查：隔离副本 `npm test -- tests/checkpoint-api.test.ts` 退出码 0（1 文件、15 项通过）；`npm run build` 退出码 0；根全量测试 58 文件、623 项通过、2 项跳过；`npm run lint` 退出码 0，保留 3 条原有 warning；`npm run check:ui-copy` 通过。隔离副本路径见下表的阶段验证。

已改主工作树文件（未提交）：

- `vscode-extension/src/agilecampus/api-client.ts`：增加 checkpoint 创建、分页列表/详情、当前 actor、项目成员列表和 handoff 创建 API；成员 `role` 仅接受 `admin | teacher | student`，其余字段强校验；handoff 响应严格核对 project/task/from/to/checkpoint/更新时间/契约版本/幂等 key 和合法状态。复用 SecretStorage PAT、10 秒超时及 `redirect: "error"`。401 引导重连，403 保留本地数据并提示无权限，409 提示刷新任务契约。
- `vscode-extension/src/checkpoints/index-payload.ts`：只把用户确认的共享范围、摘要、SHA、哈希化仓库身份、会话来源类型及材料 ID/类型/hash/大小转为索引请求。transcript 原文、session ID、绝对路径、分支、密钥、dirty 代码和 rejectedApproaches 不进入远端请求；rejectedApproaches 保留在本地检查点/导出包。
- `vscode-extension/src/checkpoints/server-mapping.ts`：以 `serverOrigin/projectId/taskId/localCheckpointId` 为键，持久化 `serverCheckpointId` 映射。
- `vscode-extension/src/checkpoints/handoff-mapping.ts`：为 server/project/task/local checkpoint/recipient 持久化预发起操作、原始契约时间与版本、server checkpoint ID、UUID 幂等键及成功后的 handoff ID；超时重试复用完全相同的请求载荷和 key。
- `vscode-extension/src/commands/publish-checkpoint.ts`：新增显式“发布检查点摘要”；发布前预览范围、摘要、SHA、材料元数据并要求确认。已有映射先取服务端详情核对，禁止重复创建。网络/5xx/响应解析不确定时只读列表分页并拉取详情逐字段核对，唯一匹配才恢复映射；零条、多条和核对失败均不自动重发。409 时刷新任务并显示当前契约版本。
- `vscode-extension/src/commands/send-handoff.ts`：新增“交接给成员”。从 `/me` 与当前成员列表读取身份，过滤自己；接收人不接受手工 UUID。只能选择具备本地—服务端映射且详情与本地摘要逐字段相符的检查点。发送前刷新任务和成员资格，契约版本/更新时间与 checkpoint 基线不一致则停止。`assignee` 可见检查点只允许交给当前任务负责人或 `admin`，否则提示按项目可见范围重新发布/走正常改派流程。先持久化新 UUID 幂等操作再 POST；不确定时再次执行复用原 key/原载荷。成功严格核对服务端 project/task/from/to/checkpoint/time/version/key/state 后保存 handoff ID。
- `vscode-extension/src/commands/handoff-policy.ts`：集中实现私有 checkpoint 接收人读取权限判断；未知 member role 在 API 解析阶段 fail closed。
- `vscode-extension/src/commands/handoff-send-flow.ts`：新 handoff 必须在用户确认后先持久化幂等请求，再发 HTTP；取消时不写 pending 映射。
- 命令回执只表述服务端交接记录及状态，明确不代表材料到达接收者本机或 Agent 已继续执行；已确认 handoff ID 的检查点/接收人组合不会重复创建。
- `vscode-extension/src/commands/save-checkpoint.ts`：网络错误或 5xx 时可从既有本地检查点选取历史任务快照继续离线保存；认证失败、403、404 等明确 HTTP 错误不会降级为离线授权。填写期间服务不可用时，只有明确确认“仅本地保存”才继续。历史版本明确标注，后续发布仍要服务端复核。
- `vscode-extension/src/extension.ts`、`vscode-extension/package.json`：注册并暴露“AgileCampus: 发布检查点摘要”和“AgileCampus: 交接给成员”到命令面板及项目视图菜单。
- 新增 `vscode-extension/tests/checkpoint-index-payload.test.ts`、`vscode-extension/tests/server-checkpoint-mapping.test.ts`、`vscode-extension/tests/handoff-mapping.test.ts`、`vscode-extension/tests/handoff-policy.test.ts`、`vscode-extension/tests/handoff-send-flow.test.ts`，并扩展 `vscode-extension/tests/api-client.test.ts`。

检查记录（源码在主工作树；隔离副本仅用于复用已安装依赖）：

| 命令 | 工作目录 | 结果 |
| --- | --- | --- |
| `npm --prefix vscode-extension run check` | `/Users/qwsdjivc/agilecampus-ai` | 退出码 127；主工作树无扩展依赖，`tsc: command not found`。 |
| `npm run check` | `/tmp/agilecampus-sim-20261002-iWsfTm/repo/vscode-extension` | 退出码 0；TypeScript、扩展 bundle、webview bundle 成功。 |
| `npm test` | 同上 | 退出码 0；19 个测试文件、111 项通过（包括成员 role 校验、handoff 响应身份/版本核对、幂等映射恢复、assignee 可见检查点 ACL，以及取消不写 pending/确认后先持久化再发送）。 |
| `npm test -- tests/api-client.test.ts tests/server-checkpoint-mapping.test.ts tests/checkpoint-index-payload.test.ts tests/handoff-mapping.test.ts` | 同上 | 本轮实现后由全量 `npm test` 覆盖通过；未单独重跑该子集。 |
| `git diff --check` | `/Users/qwsdjivc/agilecampus-ai` | 退出码 0。 |

未完成与阻塞：

1. 未在真实 Extension Host + 服务端做 A 发布/B 接收实测；目前证据为 compile、单元测试与实现核查，不能表述成端到端接续验收。
2. 初版 checkpoint POST 没有服务端幂等键的问题已由下方 R03 补修记录处理；双工作区 Extension Host 实测仍未完成。
3. 本轮没有提交，R04–R06 未开始；用户已有 `agent-run-rail.tsx` 改动未触碰。

## R03 补修 — 发布重试、父级映射与并发幂等

修复本轮验收发现的三处风险。代码仍未提交；产品数据库未修改。

- checkpoint 发布现在带稳定幂等 UUID。服务端以 `(creatorId, idempotencyKey)` 唯一索引兜底；同键同载荷返回原记录，同键不同载荷返回 409，并处理并发插入竞争。扩展在发送前持久化完整待发布 payload；重启/断网重试继续使用原共享范围与原幂等键。服务端回放在任务后续更新后仍先按已存记录解析，不会重复插入。
- checkpoint 服务端现核对 `taskUpdatedAt` 与当前任务时间一致，拒绝拿旧任务快照新建检查点；已成功操作的幂等重试不受后续任务更新时间影响。
- 交接请求改用稳定幂等 UUID；同一发起人/本地检查点/接收人并发时服务端收到相同 key，使用既有唯一索引只保留一条交接记录。
- 交接包升为 v2，新增经摘要校验的 `sourceServerCheckpointId`；继续兼容 v1 包。导出端写出已登记的服务端 ID，导入端在线核对后保存“本地来源 ID → 服务端 ID”映射；发布子检查点时只传服务端父 ID，缺映射会停止并给出明确原因，不再把本机 UUID 当作服务端 UUID。
- 验证均在 `/tmp/agilecampus-sim-20261002-iWsfTm/repo` 隔离副本进行：`npm run db:push:test` 完成测试库新增列/唯一索引；根 `npm run build` 退出码 0；根 `npm run lint` 退出码 0、3 条既有 warning；根 `npm test -- tests/checkpoint-api.test.ts` 17 项通过，覆盖同键重放、载荷冲突与并发只创建一条；扩展 `npm run check` 通过；扩展全量测试 21 文件、115 项通过；`git diff --check` 通过。
- 未运行真实 Extension Host A 发布 / B 导入交接。主工作树连接的开发数据库没有迁移；要在该数据库运行新 endpoint 前需执行 `npm run db:push`。R04–R06 未开始。
