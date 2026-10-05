# Luna 下一阶段工单：真实采集、记忆草稿与交接准备

日期：2026-10-05。状态：计划已制定，尚未施工。

> 范围更新：用户随后明确只做会话记忆个人模块。该模块执行[会话记忆核心 C00–C05 工单](2026-10-05-memory-core-luna-workorders.md)，首批 C00–C02；本文件保留为全组链路参考，不再作为个人接管服务端、前端或 worktree 的授权。

## 0. 从这里开始

本计划承接 H00–H02 的代码验收，细化旧 M03/H03。技术总约束继续使用 [M00–M08](2026-10-02-session-memory-publish-luna-plan.md)，交互约束使用 [H00–H07](2026-10-03-session-memory-ux-luna-plan.md)。发生批次冲突时，以本计划为准。

首次施工只执行 N00–N02，完成后提交结果并停下验收。N03–N06 是已列明的后续批次，不在第一次施工中提前上线。N01 外部条件不足时可以完成不依赖真实来源的 N02，但必须标记实机验收未通过。不得将下一阶段设想写成现有功能。

用户主线：**A 开发 → 自动留下会话事件 → 整理接班记忆 → 人工核对 → 发布指定版本 → B 获取该版本 → 核对代码 → B 的 Agent 继续。**

本阶段的交付终点是“真实来源生成的、可编辑、有出处的记忆草稿”。私有材料传输与 B 端接收沿用 M04–M06，另行验收。草稿生成不代表交接完成。

## 1. 已实现和未实现的边界

规划时 HEAD 为 `6fd4258`，工作区有大量已验收但未提交的文件。以施工当天的工作区为准，不恢复到这个 HEAD，不清理现有改动。新增的 `scripts/seed-checkpoints-demo.mjs` 和 `.vsix` 文件是已有用户工作，本计划不删除或覆盖。

已实现并经过代码检查：

- 本机会话绑定、不可变事件、去重、锁与游标恢复。
- Codex Hook adapter、配置管理、分页记录面板及本机状态。
- 多个来源的失败分别保留；超大输入独立告警；全局告警不依赖任务选择，过期响应丢弃。
- 旧检查点摘要发布、指定成员交接、手动导入/导出、接续预检与启动新 Codex 会话，有可复用代码。
- 会话记忆共享 schema、服务端基础表、受权限控制的会话/发布索引读取。

2026-10-03 最近一次验收：扩展 26 文件、143 项测试及构建通过；另有定向模拟验证失败隔离、告警恢复和异步状态。本计划制定时没有重跑这些检查。真实 Extension Host + 真实 Hook 的完整证据仍缺失。

还不能宣称完成：

- 任意 Codex/Claude 对话的自动、完整采集；现有绑定候选仍依赖已验证的 Entire 适配器。
- 自动提炼接班记忆、人工修订保护、记忆条目定位到来源。
- 新会话记忆包的私有仓库发布、远端原文读取、B 端一键获取。
- 从 A 的真实会话出发，B 在独立环境中实际接续的全流程。

## 2. 分工与可修改范围

完整的产品解释、当前状态、分工交付物和团队验收顺序见[小组说明与责任划分](../../design/session-memory-team-brief.md)。本节是本工单的执行边界；若执行者是 Luna，由用户在施工前把四条责任线映射给实际成员。

- **会话/记忆负责人（用户主线）**：负责来源边界、`ExtractionInputV1`/`MemoryDocumentV1` 语义、事件出处、记忆质量样例和最终 A→B 验收；主要负责 `vscode-extension/src/session-memory/**` 与经共同冻结的 `shared/session-memory/**`。不独自承担所有服务端、worktree 与界面实现。
- **身份/服务端负责人**：负责 human/agent 与 admin/teacher/student 权限矩阵，AI 提炼 API、作业幂等、草稿修订、发布版本和对应数据库测试；主要负责 `src/db/schema-session-memory.ts`、`src/lib/session-memory/**` 与新增的 memory API。复用现有鉴权和 `getModel()`。
- **Worktree/接收端负责人**：先审查现有 `worktree-service.ts` 与 `fork-attempt`/`resume-checkpoint`/`compare-attempts`，再接入记忆版本和接收核验；负责独立工作区、branch、repository identity、`baseSha`、`attemptId` 与 Agent 启动回执，不重写现有 worktree、不自动合并。
- **前端负责人**：按冻结 API 展示记录范围、来源缺口、记忆草稿和出处、发布/接收状态；主要负责扩展 Webview 与经确认的记忆页面。不能用静态样例冒充真实发布/接收，不能在前端自行决定访问权限。
- **Codex/Luna 实施约定**：每个负责人交付自己模块的代码和测试；Luna 可按以上文件边界协助施工，Codex 审核跨模块集成。`shared/session-memory/**` 是共同契约，未经共同确认不得单方面变更。

对接的稳定标识至少包含：`projectId`、`taskId`、`checkpointId/handoffId`、`memoryVersionId`、`repositoryIdentity`、`baseSha`、材料引用、`attemptId` 与接收端 `sessionKey`。本地绝对路径只留本机。

状态责任必须分开：worktree 成功不等于记忆已继承；包下载成功不等于 Agent 已启动；只有启动回执才表示 Agent 已启动。任务验收仍由人负责。不要把任务状态机、自动合并或全站导航扩入本工单。

## 3. 必须复用的代码

| 职责 | 现有入口 |
| --- | --- |
| 本地事件、错误状态 | `vscode-extension/src/session-memory/local-store.ts` |
| Hook 转换与配置 | `vscode-extension/src/session-memory/codex-hook-{adapter,config,cli}.ts` |
| 候选会话与导出 | `vscode-extension/src/adapters/entire-adapter.ts` |
| 侧栏与消息校验 | `vscode-extension/src/views/{project-view-provider,webview-message}.ts` |
| 记录面板 | `vscode-extension/src/views/session-record-panel.ts`、`webview/src/record-view.ts` |
| 共享契约 | `shared/session-memory/{types,schema}.ts` |
| Git 基线 | `vscode-extension/src/git/repository-service.ts` |
| 已有秘密检查 | `vscode-extension/src/checkpoints/share-package.ts` 中 `findObviousSecrets` |
| API 身份、项目权限 | `src/lib/extension-auth.ts`、`src/lib/project.ts` |
| 模型 SDK 配置 | `src/lib/agent/model.ts` 的 `getModel()` |
| 会话、提炼作业、草稿表 | `src/db/schema-session-memory.ts` |
| 检查点/接班 | `vscode-extension/src/commands/{save-checkpoint,send-handoff,resume-checkpoint}.ts` 及 `src/handoff/**` |

`getGitWorkspaceSnapshot` 只有展示信息，不替代 `readRepositorySnapshot` 的 SHA/dirty 检查。`findObviousSecrets` 只是已有检测规则，不是完整脱敏器。`EntireAdapter.capture` 导出非空文本也不证明完整归档；须遵守旧计划的来源/范围校验。

## 4. N00：冻结验收基线与运行说明

新增 `docs/reviews/session-memory-next/{progress.md,cases.md,report.md,evidence/README.md}`。修改本模块文档中的过时状态，不改无关产品描述。

1. 记录分支、HEAD、dirty 清单、运行端口及扩展构建方式；先确认数据库是测试实例，再做任何测试写入。
2. 读完本计划、原 M/H 计划与当前 provider/store/schema。列出上表中存在的入口，以及本阶段新增入口。
3. 使用 `vscode-extension/.vscode/launch.json` 中已有 Extension Development Host 启动配置；若与当前 VS Code 环境不兼容，修复配置并记录实际启动参数。
4. 将“143 项已通过”写为历史代码验收；新运行结果单独记日期与命令。`.vsix` 是否存在不是运行证据。

完成条件：另一个人按说明能构建并打开同一开发扩展，知道真实采集尚有哪些条件。先输出文件/责任边界，再动实现。

## 5. N01：真实记录链路验收

目标：在专用非敏感工作区和测试任务里，证明“人在 Codex 输入 → Hook → 本地事件 → VS Code 查看”。

1. 使用独立 VS Code profile/user-data 和测试仓库，记录 Codex/Entire/扩展版本。按 `EntireAdapter` 的实际版本门槛检查候选枚举。失败显示具体依赖，不能放宽校验或伪造候选。
2. 通过扩展真实入口选择任务、关联真实会话、启用记录。Hook 安装与信任沿用已有用户确认流程；核查实际生效配置与脚本/存储路径，不能自动点击信任或替用户变更日常全局配置。
3. 提示词固定为非敏感验收任务：创建一个只处理非负整数的 `sum` 函数，保留该约束；先讨论再实现，实际运行一个成功和一个失败的检查。使用来源支持的真实工具，不手工冒充 Hook 请求。
4. 在记录面板核对用户文本、实际工具输入/结果、最后助手答复；写清中间答复、多模态等未覆盖内容。Hook 记录均只代表已收到字段。
5. 重启扩展，再生成新事件；旧序号、内容不变，新事件接续。另开工作区和未绑定会话，确认不会写入所选绑定。
6. 关闭/重新打开侧栏、无任务选择、历史分页及新事件提示按真实 UI 操作验收。故障注入另用合成用例验证：多来源失败、8 MiB 告警、清除与旧响应竞争；不要要求模型真实输出巨量内容来造故障。
7. 截图包括侧栏、分页内容、重启后的记录与来源覆盖说明。证据不得含真实凭据/私人会话。记录精确点击路径，区分真实会话与合成故障。

完成条件：有真实事件与截图对应、重启不重复、范围不串、可说明来源覆盖。若来源/信任/窗口访问不可用，记录 `BLOCKED-ENV` 与具体缺项，继续 N02 的独立工作；不能标 H02/M02 全部通过。

## 6. N02：冻结本次整理范围与本机预览

新增建议路径：`vscode-extension/src/memory/{input-snapshot,input-preview}.ts`；只补 `LocalSessionStore` 必要的有界读取接口。不要创建第二套事件日志。

1. 增加任务下某一会话的“整理记忆”入口。用户无需重新填写目标/完成情况；Host 根据已绑定任务和会话获取来源，Webview 不传本地路径。
2. 先冻结本地 `ExtractionInputV1`：`snapshotId`、服务地址/本机 workspace scope、`sessionKey/projectId/taskId`、任务快照与版本、`fromSequence/toSequence`、按序事件 ID/内容 hash、代码基线、未恢复失败、来源覆盖、创建时间。
3. 同一次锁保护中固定事件上限 N；之后只处理 ≤N 的不可变事件。读取前后校验连续性、事件 hash 和当前绑定。采集可以继续，N 之后的记录显示“有新记录，未加入本次整理”。禁止游标边读边前进。
4. 通过 `readRepositorySnapshot` 固定 repository identity/HEAD/dirty 排除情况；无可确认 HEAD 时不编造 SHA。报告缺项并保留本地记录。
5. 预览区显示任务、来源会话、记录范围、待处理故障、代码 SHA、准备发送的数据范围。没有完整来源归档就明确写“仅已采集事件”；gap/失败不可以因为用户清除了通知就转换为完整归档。
6. 第一批仅保存本机快照和展示预览，不放假“生成成功/已发布”按钮；N03 完成后才挂真实生成动作。无记录和损坏日志给出具体恢复入口。
7. 快照写入复用当前原子写和锁策略，保存于扩展私有目录。重开后按 snapshotId 读取；不得将正文写入 Webview setState、日志或提交到仓库。

完成条件：用户能看懂将整理哪个任务、哪段会话、有何缺口；记录继续增长不改变已打开的快照。

**第一批 N00–N02 到此停下。交付截图、点击路径、测试结果和未完成项。以下为下一批。**

## 7. N03：AI 提炼服务与防重复调用

依赖：N02 代码通过；真实来源门槛未过时只允许合成开发验证，不能宣布真实记忆可用。

新增建议路径：扩展 `src/memory/{extract-client,redact-input,context-budget}.ts`；服务端 `src/lib/session-memory/{extract,extract-prompt,extract-jobs,evidence-check}.ts`；共享 `shared/session-memory/extraction.ts`。API client 沿用扩展 PAT，模型密钥只由服务端 `getModel()` 读取。

### 7.1 输入与输出

- 提炼前在本机扫描任务文本、选中事件、前版记忆和人工修改；相同秘密使用稳定占位符，保存替换清单到本机。外发事件的 `sourceRef` 改为包内事件引用，去除供应商会话 ID、绝对路径及令牌。不能安全处理的内容保留本地并阻止发送。
- 首次说明发送到哪个服务器/模型、发送哪些材料和服务端草稿存储范围。复用已保存且范围未变化的同意；新风险需重新预览。模型处理同意和未来团队分享同意分开，不能用已连接项目代替两者。
- `inputDigest` 对固定键序序列化的脱敏输入计算 SHA-256，包含事件范围/正文、任务与代码基线、前版记忆修订、脱敏/提示词/预算策略版本。服务端重新计算；模型配置参与去重。没有提供的 token 用量记 null。
- 模型只返回语义字段候选：`goal/constraints/completed/remaining/decisions/rejectedApproaches/blockers/nextActions/tests`。最终 `MemoryDocumentV1` 的身份、SHA、coverage、revision、provenance 由程序填写，再用 `parseMemoryDocumentV1` 和有效事件 ID 集合校验。
- `sourceCoverage.gaps` 记录来源缺口和模型未读范围的具体原因；另存本机 input descriptor 区分二者。不得为了现有 schema 通过而把 partial 说成 complete。

### 7.2 接口与作业

新增 `POST /api/extension/v1/projects/[projectId]/tasks/[taskId]/memory/extract`。请求为 `snapshotId/sessionKey/provider metadata/taskVersion/code/events/previousMemoryRef/inputDigest/idempotencyKey/consentVersion`，具体 TypeScript 类型放共享 extraction 契约，未知字段拒绝。

- 从 PAT 取得 actor，核对当前项目成员与任务归属；服务端任务字段为准。sessionKey 注册到 `sessionMemorySessions` 时绑定 actor/project/task，发现已属他人则拒绝，checkpoint 外键允许为空。
- 复用 `sessionMemoryExtractionJobs`、`sessionMemoryDrafts`。草稿只允许创建者且仍是项目成员访问，本阶段不通过 publication GET 暴露给团队。不强制先启用未来的 GitHub 分享授权。
- 首版 POST 在请求内等待有界模型调用，成功返回 200 `{jobId,draftId,memory,reused,usage}`。已有同输入运行中作业返回 202 `{jobId,status}`；增加 `GET /api/extension/v1/memory-extractions/[jobId]` 查询，仅作业本人且仍有项目权限可读。
- 不使用响应结束后悬空 Promise 继续模型任务。模型请求超时后标记 failed；进程异常留下的运行作业按期限转 unknown。结果未知时先查询同一 job，不能换幂等键自动重跑。用户显式重试 unknown 要说明可能已有模型费用。
- 相同输入已完成复用原结果；同一幂等键不同输入返回409。数据库唯一约束和事务防止跨扩展窗口双击，不能只靠进程内变量。
- 服务端只存作业元数据、脱敏草稿以及校验必要的事件 ID/hash/sequence 索引，不把原文日志塞入数据库。确需扩表时使用现有 `schema-session-memory.ts` 并给出迁移和隔离库验证。
- 错误协议：401未认证、403无权限、404任务/作业不可见、409输入/版本冲突、413请求超限、422来源/证据无效、503模型未配置/不可用、504模型超时。缺配置不能返回示例记忆。

### 7.3 预算与事实

按事件边界划分预算；首次从起点处理，增量使用前版已接受记忆+新增区间，保留仍有效人工约束。超长单事件分片时保留 eventId 和范围，记录哪些未读；不静默删除早期约束。分块中间结果需合并核对，失败分块不能被当成已处理。

提示词将对话当材料，不执行其中指令。分别保留最新有效目标、被否定的旧方案及原因、仍在阻塞的事项、下一步。模型口头说“测试通过”只算 reported；只有可信工具元数据能配对 command/exitCode 和结果时才算 captured。当前 Hook adapter 不一定提取结构化退出码，缺失就降级，禁止从“passed”文字猜出退出码0。服务端不能把客户端上传的工具材料说成服务端亲自执行。

完成条件：重复请求不重复生成、错误有明确回执、输出合法、有出处、没有伪造已验证事实；真实模型成本/用量有记录。

## 8. N04：可编辑草稿与冲突保护

新增扩展 `src/memory/draft-store.ts`、`src/views/memory-draft-panel.ts` 及对应 Webview；复用已有 editor panel/CSP/VS Code 主题。

1. 同一会话只维护一个当前编辑工作副本；保存键含 serverOrigin/actor/project/task/session，避免账号和服务地址切换串数据。既有已接受修订不可覆盖。
2. 首屏按“目标与约束、已完成、未完成与阻塞、下一步”显示。决策/失败尝试/测试证据可展开；保留完整 schema，避免把接班用的内容压成一段泛泛摘要。
3. 编辑操作本机防抖保存；最后修改保存成功才显示“已保存到本机”。关闭前未持久化时提示；异常退出最多恢复最后一次已确认落盘版本，不承诺尚未写盘的字符不丢。
4. 服务端新增草稿读取/修订 API，复用 `sessionMemoryDrafts`；请求带 expectedRevision，事务内比较，冲突409。本机工作副本与服务端已接受修订分开显示。离线不假报“已保存到服务器”。
5. 重提炼生成候选版本；人工编辑过的条目保留 `origin: human`，按条目展示差异并由用户接受变化。用户删除的约束记录 tombstone，不能下次自动生成回来。
6. 编辑只修改语义条目；代码基线、来源范围、captured 等程序字段不能任意手改。模型请求期间继续编辑时，旧响应不得覆盖新工作副本。

完成条件：断网、关闭、重开能恢复已保存编辑；两个窗口保存发生冲突时不覆盖；重提炼不抹除人工约束。

## 9. N05：从记忆查出处，并形成接班材料

1. 每个记忆条目提供“查看依据”；Host 验证 eventId 属于当前 snapshot/session/task，再通过记录面板定位对应序号。补按 eventId/sequence 读取与高亮，不接受任意磁盘路径。
2. 从记忆跳到记录再返回时保留编辑和阅读位置。来源 unavailable 时直接说明；不能拿新的事件范围代替原草稿所引用的版本。
3. 将已接受草稿映射到已有检查点 handoff 字段，提取可调用服务，避免串行触发旧命令弹出多轮填写框。来源材料和代码基线保持关联，任务状态不随保存变化。
4. 本阶段只形成“待发布的接班草稿”。现有“发布检查点摘要”保持准确命名，不能改成“发布完整会话”。没有 M04 上传回读证据就不出现“队友已收到”状态。

完成条件：接班者能从每项结论定位证据，知道仍缺什么；另存检查点不丢约束、失败原因、待做事项。

## 10. N06：测试、演示与下一阶段出口

执行时使用隔离测试库，不清空用户数据库。扩展运行 `npm --prefix vscode-extension test` 和 `npm --prefix vscode-extension run check`；共享/服务端用现有 Vitest 配置运行受影响测试、TypeScript 检查及 build。先看 scripts，记录真实命令和退出码，不能复制旧通过数字。

必要用例：

| 场景 | 必须观察到的结果 |
| --- | --- |
| A目标后来被用户改为B | B为有效目标，A标记被替代并有依据 |
| 方案失败后换方案 | 失败原因保留，未完成不写成完成 |
| Agent声称测试通过但无工具证据 | reported，不能 captured |
| 长日志、早期约束、新增事件 | 约束保留；预算未读范围明确；冻结范围不漂移 |
| 多来源失败、超限全局提示 | 缺口不被其他成功事件或清除通知抹掉 |
| 双击生成、断网后重试、进程中断 | 稳定作业/版本，不隐式重复计费，unknown不伪装成功 |
| 模型返回期间人工编辑 | 编辑保留，候选单独展示 |
| 伪造事件引用、换任务/账号/项目 | 拒绝越界读取和保存 |
| 对话含提示词注入或秘密样本 | 无工具执行；秘密不进入请求、日志和报告 |
| 从出处返回、无任务全局提示 | 阅读/编辑状态保留，告警可见 |

至少8份预先写答案的合成材料；至少3份非敏感真实模型输入，逐条检查事实、约束、引用和下一步。Mock只验证流程，不能代替提炼质量。真实模型配置不可用时把相关条目标记 BLOCKED，不拿缓存充当新调用。

报告使用 `docs/reviews/session-memory-next/report.md`：每项列工单、文件、命令、结果、真实/合成来源、证据位置、未覆盖项；结论分代码通过/真实采集通过/模型质量通过。首批报告只填N00–N02结果。

演示顺序固定：选择任务 → 查看真实会话 → 冻结整理范围 → 生成草稿 → 打开依据 → 修改一条约束 → 重开确认保存。不得用此演示声称已完成异机交接。

## 11. 交接模块真正完成的最终门槛

N阶段后仍需 M04–M06/H04–H06：私有材料上传、回读完整性校验、网页查看、指定成员获取、接收预检及启动接线。复用已有交接/启动代码，不重造工作流。

最终验收必须是：**A 的真实会话留下已冻结材料，A 指定 B；B 在独立 clone/profile 中不依赖 A 的本地目录，取得同一版本、看见记忆与来源、核对代码后启动自己的 Agent，并产出后续记录。** 若在同一电脑两个隔离环境模拟，要明确写明，还不能叫双机实测。Agent 继承的是显式材料，不保证跨工具复制供应商内部 session 或隐藏推理。

记忆负责人、身份/服务端负责人、Worktree/接收端负责人和前端负责人共同验收上述链路后，这个模块才可以说完成。无需把自动排期、自动合并、所有模型适配或无限记忆都做完才交付。
