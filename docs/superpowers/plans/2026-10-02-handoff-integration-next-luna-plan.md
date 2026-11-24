# Luna 下一阶段工单：打通检查点交接与 Agent 接续

> 后续优先工单：[自动会话记忆与一键发布 M00–M08](2026-10-02-session-memory-publish-luna-plan.md)。旧 R00–R03 的实现继续复用；新工单替代 R04 的手递文件主路径、承接 R05 的真实接班，R06 并行展示后置。以下状态保留原阶段记录，不能当作新工单已完成。

状态：R00–R02 已完成；R03 的检查点摘要发布、成员目录 API 与扩展端交接发起代码/自动检查已完成。真实 Extension Host 中 A 发布、A→B 服务端记录核验尚未做；R04–R06 尚未开始。成员接口为 `GET /api/extension/v1/projects/{projectId}/members`（Bearer 鉴权、仅当前项目的人类成员 ID/显示名/角色、无邮箱、no-store）。详见 [`progress.md`](../../reviews/handoff-integration-next/progress.md)。
基线：c1b53cf7717ced0036af70c37c81680ea95b2722。开始时重读 AGENTS.md、两份现有网页/扩展专项工单及本轮 audit.md。若 HEAD 已变化，先核对本文件涉及的实现，已修部分验收后跳过。

## 目标与边界

用户主线：A 在本地保存代码基线与可分享的会话材料，主动交给 B；B 取得同一代码与材料，核对后启动新 Agent session；同一检查点可开两份 worktree 比较方案，最后由人选用和验收。

平台只保存用户确认分享的摘要、索引和交接/执行记录。代码走 GitHub，完整会话文件本轮通过显式导出/导入传递。没有文件传输时显示“材料未到达”。接续模式如实标记 context-only；不能宣称恢复模型隐藏状态。

本轮不新增自动合并、云端代码执行、全量会话上传、自动项目经理或视觉重构。沿用现有命令、列表、表单和业务状态机。

Codex 负责共享后端与任务领域验收；Luna 负责扩展及已授权网页范围。R02 涉及共享后端，按现有分工由 Codex 施工或在 AGENTS.md 明确签收后施工；Luna 可先补复现和契约建议，不擅自越界。本计划本身不自动改写分工。

## 施工顺序与检查点

R00 → R01 → R02 → R03 → R04 → R05 → R06。
首次批次 R00–R01 已完成；用户要求继续后进入 R02，R02 已完成并记录验证。后续逐单推进，R02 通过后由 Luna 从 R03 开始；每单记录文件、命令、退出码、证据、遗留问题，前置验收失败不得把依赖项标完成。

## R00：建立可重放的验收基线

修改范围：本计划的配套记录、隔离测试脚本、tests/helpers.ts、tests/reset-db.test.ts、vitest.config.ts、vscode-extension/tests/attempt-store.test.ts。

1. 记录当前 HEAD、dirty 文件及差异 hash；保留 agent-run-rail.tsx 的已有改动。新建隔离工作区和独立模拟库/回归库，验证实际连接库名。旧临时目录仅作可选恢复来源，不能假定仍存在。
2. reset 清单加入 attempt_receipts、checkpoint_indices、handoff_records；保留 CASCADE 和清单守卫。通过正常领域方法造出三类记录后 reset，证明实际清空。
3. 根 vitest.config.ts 明确 include 为 tests/**/*.test.ts，扩展测试继续用扩展自身配置独立执行；不能把扩展测试从总验收中省掉。
4. 扩展跨进程 worker 源码路径改为基于测试文件位置解析，不再依赖 process.cwd()；保留原并发/锁断言。
5. 创建 docs/reviews/handoff-integration-next/progress.md、cases.csv、evidence/。日志记录命令、cwd、开始/结束、退出码和脱敏结果；禁止记录 token、授权头或真实用户材料。

验收：根测试与扩展测试各自通过；清理守卫覆盖全部业务表；报告能分清两个测试集合。发现其他失败原样登记，不删断言。

## R01：修复任务契约的证据类型

修改入口：src/app/(app)/projects/[projectId]/_console/{console-shell,execution-console,handoff-editor,task-contract-panel}.tsx；必要的页面数据映射、既有 action 和领域测试。领域语义以 src/lib/handoff.ts 为准。

1. SelectedTaskDetail.requiredEvidence 使用 EvidenceType[] | null；删除 execution-console 中 as string 断言。JSONB 边界做运行时类型检查并沿用领域枚举，别用强制断言掩盖不一致。
2. HandoffEditor 直接从数组初始化复选项；编辑另一任务或取消重开时不得残留上一任务的勾选。表单提交可以继续用多值字段，持久化保持数组。
3. 详情用中文证据类型标签显示；空数组/null 不出现伪内容。非法旧数据明确报错或经记录的边界处理，不默默改验收要求。
4. 添加有实际价值的回归：null、空数组、多证据类型的加载—保存—重新打开；修改证据后 handoffVersion 正常递增，认领失效规则不变。
5. 真实浏览器重放：创建任务 → 指派 A → 勾选外部链接/单测日志 → 保存 → 打开详情 → 刷新 → 再编辑。确认数据与勾选一致、控制台无运行时异常。

验收：原模拟任务相同数组值不会再导致详情崩溃；类型检查、相关测试、UI 文案检查和构建通过。记录桌面截图与操作步骤。到此停下交回首批验收。

## R02：先验证、再修共享后端契约

负责人：共享后端负责人。入口：src/lib/checkpoint.ts、src/lib/extension-auth.ts、src/app/api/extension/v1/**、tests/checkpoint-api.test.ts 及相关领域测试。

1. 无请求体是否允许由接口契约明确；有请求体却 JSON 损坏/字段类型错误必须 400。preflight、accept/decline/withdraw 不得吞掉校验异常。错误版本不能被当作未提供版本。
2. resolveHandoff 在操作时复核当前项目成员权限与目标接收者/发起者身份。明确 expectedHandoffVersion 的必填/兼容策略并实际验证，任务版本变化返回冲突。
3. 接受/撤回等转换用事务或包含 state=offered 的条件更新；受影响记录为 0 返回冲突。补两个真实并发请求，证明最多一个成功且最终状态与成功方一致。复核任务版本读取与状态写入之间的竞争。
4. createHandoff 对相同幂等键：相同规范化载荷返回同一记录；不同版本、时间戳、接收者、检查点等行为必须一致并写入契约。并发创建依靠数据库约束及冲突处理保证不重复。检查 checkpoint/attempt 创建的超时重试能力：没有幂等机制前禁止客户端自动重试 POST；必要的契约/迁移由负责人实施。
5. 明确服务器 ready 只覆盖服务器能核验的信息；未接收的交接、缺少本地材料、未核对 Git 的情况不能在客户端显示“可启动”。
6. 对真实隔离 HTTP 服务，A/B/Outsider 用各自 PAT 测 /me、登记 checkpoint、发起 handoff、列表/详情、accept/decline/withdraw、preflight、attempt 登记/更新。请求载荷按现有 schema，不造新的假接口。

必须覆盖：正确身份成功；无 token 401；跨团队读写被拒；伪造 actor 不生效；B 离队后处理被拒；过期契约冲突；重复提交不重复建对象；accept/withdraw 竞争；非法 JSON/字段返回 400。接收交接不能隐式改派任务或完成任务。

验收：上述认证 HTTP 证据齐全，领域/路由测试通过。此单不依赖 DeepSeek Key。没有网络调用证据只能写路由测试通过。

## R03：插件登记检查点并发起交接

范围：vscode-extension/src/agilecampus/api-client.ts、commands/checkpoint-support.ts、commands/save-checkpoint.ts、extension.ts、package.json、checkpoints/types.ts 及新增的小型共享映射模块/测试。

1. 在现有 client 增加 method/body 与经过验证的 extension/v1 响应解析；沿用 SecretStorage PAT、超时和 redirect:error。401 要求重连；403 显示权限；409 保留输入并刷新契约。记录不足时不伪造成功。
2. 保留本地保存命令，新增显式“发布检查点摘要”“交接给成员”命令；只有用户确认发布才登记远端。离线保存仍可用，网络失败显示“本地已保存，未发布”。
3. 发布预览逐项列出摘要、SHA、材料清单与共享范围；正文 transcript、绝对路径、密钥和未提交代码均不附入索引请求。rejectedApproaches 等本地字段不能无说明丢弃，完整保留在交接包中。
4. 存映射：serverOrigin/projectId/taskId/localCheckpointId/serverCheckpointId。再次发布复用已确认记录；结果不确定按 R02 契约核对，不能循环新建。
5. 发起交接时调用 `GET /api/extension/v1/projects/{projectId}/members`，从当前服务端人类成员列表选择接收者并排除当前用户；API 每次 Bearer 请求复核调用者仍是项目成员。不得让用户猜 UUID。发送前刷新任务契约版本与更新时间；生成 UUID 幂等键并在同一请求的重试期间保持不变。

验收：实际 Extension Host 中 A 保存并发布，服务端出现一条对应索引；A 指定 B 后生成一条交接单；重新加载扩展仍能恢复映射。断网后本地文件完好，恢复后不会重复登记。

## R04：B 收到交接并确认材料实际到达

范围：扩展命令注册、现有 Webview、import/export-checkpoint、prepare-handoff、共享映射模块及测试；复用现有后端。

1. 增加“收到的交接”入口，列出任务、发起者、状态、时间，点击查看摘要/基线并接收或拒绝。A 可看发出记录和撤回；不再增加独立功能首页。
2. 接受只改变交接单。任务负责人变更通过既有授权流程完成；若引起契约版本变化，明确重新发布/确认交接的操作顺序，禁止替换旧记录中的版本骗过预检。
3. A 从现有导出功能生成交接包，经私有临时传递目录交给 B；默认不带全文对话，包含时保持已有预览确认。包不提交 GitHub。
4. B 导入时沿用 schema/hash/大小/路径校验；关联来源 checkpoint ID、本地导入 ID、服务端 ID、handoff ID。映射依据项目、来源、SHA、材料 hash，不能只按标题匹配。
5. 各 B 工作区根据实际文件重新计算“材料已到达”；服务端 transferred 标记、材料数量或 A 的存在状态都不能代替 B 的本地验证。缺失材料时保留交接单并明确缺哪项。
6. 并行做服务端预检与本地预检；启动条件要求当前授权、接收状态、契约、正确仓库/SHA、工作区状态、实际材料全部满足。弹窗确认后到 spawn 前再次取当前授权/契约。任一失败保留文件，显示具体原因。

验收：两个独立 VS Code profile、两个 clone；B 不读取 A 存储，能接收交接并导入对应包；坏 hash、错仓库、旧版本、撤权、缺失材料均阻止接续。展示服务端收到与本地收到两个可核验状态。

## R05：真实 Agent 接班与执行回执

前提：R04 通过，模型凭据与实际供应商可核实。网页 DeepSeek 与本地 codex exec 分别验收；网页 Key 可用不能作为本地 Agent 供应商证据。

1. 先小请求验证 DeepSeek 官方端点，再验证网页编排产生草案、人工确认后才改变项目事实。使用已有模拟需求和费用/回合上限，不扩大到真实项目。
2. 检查现有 Codex CLI 版本和供应商配置；只读获取必要配置，不记录凭据。需要 DeepSeek 适配时先验证该 CLI 版本支持的官方方案和输出协议，形成小型配置说明；不得假定 OpenAI-compatible 就能执行 Agent 工具，也不得改用户全局配置或放宽版本检查。
3. 在独立 Extension Host 中 A 实际完成部分任务，保存 SHA、可授权的真实 session 材料；B 从 R04 的包接续。B 先说明已完成/待完成，再写剩余代码并执行冻结测试。
4. 将本地 attempt 与远端 attempt ID 关联；仅回传必要状态、SHA、实际 session 标识和脱敏测试结果。上传失败显示“回执未同步”，不能覆盖本地执行事实。重启恢复与更新顺序遵守 R02 幂等/终态约束。
5. 成功必须有实际 session、完成事件与独立测试证据；Agent 结束不自动验收任务。纯手填摘要接班标明人工摘要，真实 transcript 接班标明会话材料，新 session 仍是 context-only。

验收：B 不额外询问 A 就能完成冻结需求的四个记忆检查点；输出来自真实 Agent，测试由执行者另跑，远端回执可追溯。缺 Key 时本单 BLOCKED，不能回写前四单都未测。

## R06：并行方案与最终项目验收

1. 同一检查点 SHA 分出 X/Y 两个扩展 worktree，确认不同路径/分支/attemptId。
2. 两个真实 Agent 运行时间有交集；同目录重复启动被锁拒绝，两个目录互不覆盖。分别运行同一份冻结测试。
3. 人在 compareAttempts 核对 diff 与测试后选方案；只对 private 模拟仓库提交、建 PR、审核合并。第三份干净 clone 从远端测试。PR 产出后附到当前任务。
4. 平台通过既有提交成果/人工验收动作闭环，保存 GitHub 链接；没有自动同步就明确人工关联。
5. 输出最终 report.md：逐项 PASS/FAIL/BLOCKED、关键截图、脱敏日志、代码 SHA、命令退出码、回执和 GitHub 链接；列出真实调用模型和用量（未提供用量则写未知）。
6. 撤销本次测试 PAT、停止本次拥有的临时服务/宿主，保留合成仓库与脱敏证据；给出复现说明，不清用户开发数据。

## 每单提交格式与总门槛

progress.md 每单记录：状态、实际修改文件、提交 SHA/dirty hash、用例结果、证据链接、未解决项、下一单是否具备前提。修复后用新的 runId，旧报告保持历史事实。

必要检查：npm run lint；npm run check:ui-copy；npm run build；连接独立回归库的 npm test（排除付费 Key）；npm --prefix vscode-extension run check；npm --prefix vscode-extension test。按修改范围运行相关测试，每阶段结束补其门槛，最终再跑完整集合。

最终允许的能力描述必须有对应证据：本地检查点持久化、共享交接登记、材料导入、context-only 接班、独立 worktree、真实并行、人工验收。单测成功、Host 激活、索引存在各自只能证明对应层，不能代替完整流程。
