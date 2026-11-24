# 会话记忆契约 v1

本文冻结会话事件、提炼记忆、分享包及计划中的 API 边界。TypeScript schema 的唯一来源是 `shared/session-memory/`；扩展端只通过 `vscode-extension/src/checkpoints/session-memory-package.ts` 注入 SHA-256 实现，不维护第二份字段定义。版本值不匹配、未知枚举、未知字段、无效引用和超出大小限制均拒绝。

## 本地 Hook 到统一事件

Codex/Claude Hook 的公共输入先由来源适配器映射，不能把原始 Hook JSON 直接当作稳定的分享格式。适配器只收当前已绑定会话：

| Hook 内容 | 标准事件 | 规则 |
| --- | --- | --- |
| `UserPromptSubmit.prompt` | `user` | `text` 原样留在本地；发布前脱敏和用户选择范围。 |
| `PostToolUse` 的工具名、输入 | `tool_call` | 分配稳定 `toolCallId`；命令/参数只作证据，不执行。 |
| 明确存在的工具返回 | `tool_result` | 与调用使用同一 `toolCallId`；无明确退出码则为 `null` 或省略。 |
| Stop 中可用的最终助手文本 | `assistant` | 仅保存 Hook 实际提供的文本。 |
| PreCompact、SessionEnd、来源轮转或漏事件 | `gap` | 写明缺口；不伪造对话正文。 |
| Git 检查点 | `git_snapshot` | 仓库相对路径；禁止绝对路径和 `..` 路径段。 |

Claude 的 `PostToolUse.tool_response` 若不含明确退出码，统一映射成 `tool_result.exitCode: null`；Codex `tool_output.exit_code` 只有在 payload 明确给出时才采用。两个供应商的 `session_id`、`cwd`、`transcript_path` 都不写进标准分享事件。Stop 没有 `last_assistant_message` 时记录缺口，不用空文本制造助手回复。

`id` 在同一来源事件重读时稳定，但必须含原事件标识或来源位置；内容相同的独立事件仍各自保留。原生 session ID、绝对 transcript 路径和工作区绝对路径不进入分享事件。`sourceRef` 是本机/包内的可追溯引用；分享时改为包内引用。

事件按 `sequence` 正序。每个 `tool_result` 必须可由调用关联检查；规范层要求有 `toolCallId`，业务校验负责检查调用配对。发现来源缺口时记录 `gap` 事件并把其 ID 列入 `sourceCoverage.gaps`。没有退出码时不把测试标成已验证。

## 记忆字段和证据等级

`MemoryDocumentV1` 固定包含目标、约束、已完成、未完成、决策、失败方案、阻塞、下一步、测试、Git 基线和提炼来源。所有条目 ID 唯一；`evidenceRefs` 只接受包内事件 ID。`captured` 测试必须有非空退出码和事件证据；来源无法证明的结论使用 `reported` 或 `inferred`，矛盾项可用 `uncertain`。数组允许为空。

自动提炼不得改写程序采集的代码基线和工具退出码。人工修订以新 revision 保存，使用 `origin: "human"`，并保留旧事件及旧 revision。字段变更冲突应保留双方并标记不确定；不能覆盖原文。

## 分享包与尺寸

分享包格式为 `agilecampus-session-memory`，当前仅接受 `schemaVersion: 1`。清单固定包/会话/记忆/本地检查点 ID，项目/任务 ID，父包 ID，Git SHA，任务契约版本与更新时间、事件覆盖范围，以及片段相对路径、SHA-256、字节数、序号范围和事件 ID。

- 单个事件片段最多 256 KiB；整个包最多 10 MiB；事件上限 20,000；片段上限 200。
- 路径必须是包内相对路径且位于 `events/`；不能有绝对路径、空段、`.`、`..` 或反斜杠。
- 片段内事件与片段间序号必须连续；丢失区间必须由占据对应序号的 `gap` 事件表示，并完整列入覆盖缺口。父包存在时必须提供解析出的父包信息；项目/任务/记忆 ID 必须匹配，父 revision 必须小于当前 revision。接收方已走过的祖先列表用于拒绝包图循环。
- manifest 的 `codeHeadSha` 必须与记忆文档的 `code.headSha` 相同；项目、任务、会话及覆盖范围也必须与记忆文档一致。
- 校验顺序是结构/大小、片段路径与范围、SHA-256、事件类型、引用关系、记忆与项目/任务范围。
- 子包不能指向自身。解析已解析的父包时，还要比对 parent package/memory/project/task，并要求父 revision 小于当前 revision。完整历史循环检查由服务端/存储图层执行。
- 非法 hash、重复 ID/序号、未知证据引用、跨任务内容或覆盖缺口未说明时拒绝。

### 原文归档与证据回溯

事件流与可读 transcript 是不同来源。新包附带 `sourceArchive` 描述和 `archiveSegments`，格式限定为 UTF-8、未压缩文本；`parserVersion: "opaque-text-v1"` 只表示逐字节文本档案，不代表已经理解或解析 Codex/Claude 的内部 transcript 结构。M01 不实现任何 provider parser。

- 每个归档片段使用严格 `source/` 相对路径、最多 256 KiB、独立 SHA-256 和发布字节范围；所有片段总计最多 5 MiB，源材料上限 10 MiB，完整会话包总计最多 10 MiB。片段必须连续覆盖声明的发布字节；源范围、缺口和明确排除范围必须连续覆盖声明的来源字节，不能隐式截断或出现重叠。
- 描述分开保留来源字节长度、已发布字节长度与已发布字节 SHA-256。原始未脱敏导出的 SHA-256 不进入共享包，避免服务器不可验证的源 hash 及内容关联侧信道；该 hash 如后续采集需要，只能保存在本机。服务器可重新计算并校验已发布片段 hash。
- `complete` 需要来源读取到 EOF、没有检测到截断、格式可安全作为不透明 UTF-8 文本读取、来源字节范围完整、发布字节 hash 有效且没有未披露缺口/排除。`partial` 必须显式记录源字节 gap、排除、截断，或每条未映射对话事件及原因；`unavailable` 不带原文负载，并列出未映射对话事件。完整发布只能包含 `complete` 原文档案。partial 发布全链路保留 partial 标记；unavailable 可以表示本机材料状态，但不能作为完整发布。
- `formatRecognized` 是客户端采集断言，不是服务端信任根。发布服务必须独立维护允许的 provider/adapter/adapterVersion 清单，对完整发布重新核对来源能力；未列入清单时拒绝 `complete`，不能根据客户端布尔值批准。M01 只定义包校验，不宣称此服务端核验已实现。
- `complete` 必须将每条 `user`、`assistant`、`tool_call`、`tool_result` 对话事件映射到唯一的包内 `archiveRecordId` 和源/发布字节范围，且范围落在已发布片段内。`partial` 可只映射实际存在于脱敏发布原文的对话事件；每个未映射事件必须列入 `unmappedEvents[{eventId,reason}]`，与 `eventRanges` 互斥。记忆 evidenceRef 指向这类事件时允许保留，但只能跳到标准事件，不能伪称能跳到 transcript；UI 必须显示“原文未包含（部分记录）”及未映射原因，并仍可查看该标准事件。`git_snapshot` 与由扩展合成的 `gap` / 状态事件不是 Agent transcript 原文，不强制伪造 transcript 坐标；它们仍可作为记忆证据，通过 `evidenceRefs → normalized event ID → event sourceRef` 定位到事件自身。`unavailable` 不含原文分片，必须显式列出所有未映射对话事件，且只能作为 partial。
- `archiveRecordId` 是分享包内随机/稳定的中性记录 ID，不允许使用 provider 原生 session ID、绝对路径或其他机器本地标识。对话事件 ID 只能映射一次；映射不得越过归档片段、越界到发布字节以外或重复使用同一个归档记录 ID。
- 项目范围的首次启用必须取得明确的 transcript 分享授权；普通发布由用户点击“发布”确认当前冻结内容，一次点击即可，不额外重复弹 modal。新增脱敏风险、分享范围变化或授权版本变化时再次确认。脱敏预览摘要用于防止确认后包内容变化；它不表示每次发布都需要单独的二次弹窗。无法识别/安全处理、未知 parser version、脱敏/发布未经用户确认、无效 hash、不可解释缺口或超过上限都必须保留本地原文并拒绝完整发布，不得静默删字段或截断。M01 只校验确认凭据，M04 必须落实项目首次授权、单击发布及风险变化再确认。
- 供应商原始导出与分享脱敏副本分别计量；包只携带分享副本的 hash/bytes。记忆证据先解析到标准事件；对话事件再由归档映射追到原文 record/range。完整链路 UI 需提供从记忆证据到归档字节范围的可读跳转。

既有 `agilecampus-checkpoint` 交接文件仍按原有 v1/v2 parser 读取；会话记忆是新的独立格式，不能通过重解释旧包实现升级。既有兼容回归测试保留在 `vscode-extension/tests/share-package.test.ts`。

## API 契约与当前接线

所有扩展请求通过 AgileCampus PAT 鉴权；作者身份从 PAT 推导，不能接收客户端提供的 `actorId`。网页请求使用登录会话，服务端采用相同项目成员与分享范围权限规则。GitHub 凭据仅存在服务端秘密配置，不进入浏览器、数据库明文、日志或包体。

| 方法与路径 | 请求核心字段 | 成功响应 | 主要拒绝情况 |
| --- | --- | --- | --- |
| `POST /api/extension/v1/projects/{projectId}/tasks/{taskId}/memory/extract` | 脱敏增量事件、前版有效记忆、Git/任务基线、`inputDigest`、幂等键 | 已校验的 `MemoryDocumentV1` 草稿、模型实际 token 用量、提炼作业 ID | `400` 契约/引用无效；`401/403` 无效或失权；`409` 基线冲突；`413` 超限；`422` 模型输出不可校验；`429` 作业冲突/限流 |
| `GET /api/extension/v1/memory-extraction-jobs/{jobId}` | 无 | 作业状态 `queued/running/completed/failed/unknown`；完成时返回草稿 | `401/403` 无权；`404` 不存在；`409` 作业上下文已变 |
| `POST /api/extension/v1/projects/{projectId}/tasks/{taskId}/session-publications` | `serverCheckpointId`、`packageId`、记忆仓库数字 ID、commit SHA、manifest path/hash、会话标题和来源 | 不可变 publication ID、绑定 package/commit/path/hash、创建时间 | `400` 字段无效；`401/403` 无权；`404` 检查点或仓库不存在；`409` 重复键异载荷/任务基线冲突；`413` 超限；`422` manifest 与 checkpoint 不匹配 |
| `GET /api/extension/v1/projects/{projectId}/sessions?taskId=&cursor=` | 可选任务 ID、游标、最多 50 条 | 默认 30 条仍有项目授权的共享会话索引及下一游标 | `400` 参数/游标无效；`401/403` 无权或项目分享未启用 |
| `GET /api/extension/v1/session-publications/{publicationId}` | 无 | 指定不可变版本索引与结构化记忆 | `401/403` 无权；`404` 不存在、授权撤销/换版或版本不可见 |
| `GET /api/extension/v1/session-publications/{publicationId}/events?after=&limit=` | 序号游标；默认最多 50 条；可选 evidenceRefs 只能在同包解析 | 指定 publication 内事件页及下一游标 | `400` 参数无效；`401/403` 无权；`404` 不存在；`413` 请求范围过大 |
| `GET /api/extension/v1/session-publications/{publicationId}/transcript?cursor=&limit=` | 原文归档分页游标；服务端强制限制 page size | 脱敏归档文本页、页内 recordId/字节范围、`complete/partial/unavailable` 状态、明确 gap/未映射事件及下一游标 | `400` 游标无效；`401/403` 无权；`404` 不存在或不可见；`413` 范围超限；`422` 归档 hash/索引不一致 |

修订草稿使用 `expectedRevision` 做乐观并发控制。版本不符返回 `409`；已发布版本只读，修改必须产生新草稿/新 revision。重复幂等键、相同输入和相同配置返回既有结果；同键不同载荷返回 `409`。错误正文不包含模型原始请求配置或密钥。

## 当前代码边界

已实现：共享事件、记忆、manifest、包校验和 extension 端 SHA-256 适配器；数据库会话、提炼作业、草稿修订、publication 索引和项目分享授权表；基于当前项目成员、分享授权版本、session/task/checkpoint 对齐和 checkpoint 可见性的服务端读取校验；扩展 PAT 下的项目会话列表及 publication 记忆索引读取接口。项目授权表仅保存私有仓库的数字 ID、披露版本、授权人/时间、授权版本及撤销时间，不保存 GitHub 凭据。

持久层备注：仓库现行 schema 同步使用 `drizzle-kit push`，没有已落地的版本化迁移目录。当前 Drizzle push 会先尝试新增复合 FK、之后才加目标复合唯一约束，造成已有库升级失败；因此这里保留可由现有 push 稳定应用的单列 FK/唯一约束，并在会话记忆领域服务中对 project/task/session/checkpoint 组合进行 fail-closed 校验。通过 `.env.test` 的隔离测试库 schema push 与权限测试。若后续引入正式迁移管线，再将这些跨表组合约束迁入按顺序执行的 SQL migration；不可把当前服务层校验表述为数据库级复合 FK。

尚未实现：发布登记/远端 manifest 校验、提炼 API 与模型作业执行、事件和 transcript 分页读取、GitHub 仓库传输、Codex/Claude Hook Adapter、本机自动采集、网页 UI/会话详情、扩展 A→B 实际接续。当前 publication GET 只读服务端索引和记忆 JSON，不提供 transcript 正文，也不能证明远端材料已存在。
