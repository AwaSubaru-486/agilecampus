# Luna 施工工单：自动记录会话、一键发布记忆、跨工作区接续

日期：2026-10-02。状态：施工中（M00 通过、M01 服务端基础通过、M02 本地存储基础施工中），本文不代表端到端功能已实现。

## 0. 先读这一节，再开始

用户确定的方向：由插件读取已绑定任务的真实 Agent 会话，AI 自动整理成统一记忆，一键发布；保留人工修订入口。队友可以在网页查看共享会话，在自己的 VS Code 中取得对应材料并继续工作。

本轮只完成这条路径：

```text
A 绑定任务与 Codex 会话
→ 本地持续记录
→ 点击「发布工作断点」
→ 自动提炼并发布分享版本
→ B 在网页找到并阅读
→ B 在独立 VS Code 工作区下载并核对
→ 新 Agent 接续并回传结果
→ 产生关联原断点的下一份断点
```

不要把「手工填表」「上传摘要索引」「导出文件后自己传给队友」当成本轮最终完成。不要宣称恢复模型隐藏状态。本轮继续采用 context-only：给新会话提供可追溯的工程上下文。

先完整阅读 AGENTS.md、本工单、旧接线计划以及 docs/reviews/handoff-integration-next/progress.md。旧计划的 R00–R03 能力继续复用；本工单替代旧 R04 的手工传包主流程，并承接 R05 的真实接班验证。R06 的完整并行比赛后置，不作为本轮完成门槛。

执行顺序固定：M00 → M01 → M02 → M03 → M04 → M05 → M06 → M07 → M08。用户启动施工后按顺序推进；阶段失败先修复，不把下一阶段标成完成。只在需要外部凭据、共享文件冲突无法绕开或明确收到暂停指令时停下。缺外部条件时仍完成不依赖它的契约、实现和离线测试，并如实标记未验证项。

本工单仅授权对应功能的扩展、后端和网页接线。不得重写任务状态机、自动验收、自动合并 PR、修改全站主题，或同时再造一个 Agent 编排系统。只制定计划的本次任务不启动 Luna，不调用模型，不创建或推送远端仓库。

## 1. 已核对的起点

核对 HEAD：c1b53cf7717ced0036af70c37c81680ea95b2722；工作树存在大量未提交改动。实施时以当时实际源码为准，不能仅 checkout 此 SHA 丢掉现有成果。

| 当前入口 | 已有实现 | 本轮补齐 |
| --- | --- | --- |
| vscode-extension/src/adapters/entire-adapter.ts | 指定 Entire 版本的 Codex 会话发现、读取与能力检查 | 持久绑定、增量采集与可验证的自动记录 |
| commands/save-checkpoint.ts | 人工输入交接字段，可附 Entire transcript；附件进入 VS Code globalStorage 本地检查点 | AI 默认生成，人可修改；保留旧命令兼容；补可版本化来源归档和完整性状态 |
| checkpoints/types.ts、schema.ts、store.ts | 本地检查点、任务/Git 快照、材料 hash；已有 transcript artifact 的本地读写/校验 | 可迁移的记忆文档、会话事件及可分享 transcript 归档格式 |
| checkpoints/index-payload.ts | 发布摘要和材料元数据，transferred=false；当前发布不含 transcript 正文 | 独立材料发布与不可变远端定位；不能谎报已到达 B；新 transcript 需有受控传输和网页读取 API |
| commands/publish-checkpoint.ts、send-handoff.ts | 发布映射、幂等操作、成员目录与交接发起 | 组合为一个常用发布入口，复用现有服务 |
| commands/export-checkpoint.ts、import-checkpoint.ts | 分享包和完整性校验 | 网络传输后复用导入逻辑；手动包仅作备用 |
| handoff/launch.ts | 把选定材料拼入新会话，有字节上限 | 记忆优先、按需取原文，明确 token 预算 |
| commands/resume-checkpoint.ts、attempts/** | 本地启动、锁和尝试记录 | 接入服务端交接和实际材料下载，保留现有启动约束 |
| src/lib/checkpoint.ts、schema-checkpoint.ts | 检查点、交接、执行回执领域 | 会话索引、发布版本、远端材料关联 |

进度记录显示：真实 Extension Host A→B 全流程尚未验收。测试数字引用旧报告时必须注明旧 runId，不能写成此次测试结果。

## 2. 本轮决策已确定

### 2.1 存储职责

- A 本地：原始来源记录、标准事件、采集游标、待发布操作、个人未分享内容。存 VS Code globalStorage，不提交到代码仓库。复用现有 `save-checkpoint` → `EntireAdapter.capture` → `CheckpointStore` 原文本地保存和 hash 校验；不另造平行的本地 transcript store。
- 团队私有记忆仓库：经用户确认并脱敏的完整 transcript 归档、标准事件、结构化记忆、分享 manifest。固定使用独立 GitHub private 仓库；代码仍在现有代码仓库。不得复用当前只发布摘要/材料索引的 `publish-checkpoint` 来假装 transcript 已上传。
- AgileCampus 数据库：权限、任务关联、会话索引、材料定位、发布版本、交接及执行回执。原文正文不作为数据库常驻聊天记录。
- 数据库需记录项目级分享授权：私有记忆仓库数字 ID、固定 project scope、披露文案版本、授权人/时间、授权版本、撤销时间；不可存 GitHub credential。每个 publication 冻结其授权版本。成员撤权或授权撤销后服务端不得继续返回 publication。
- B 本地：下载并校验后的分享包、记忆、按需读取的 transcript/事件片段及新执行记录。

这里仍使用远端文本存储；节省的是完整工作区、运行环境和大文件备份，不是完全没有远端存储。首版只支持文本材料，每个分享版本总计最多 10 MiB，单片段最多 256 KiB；超限必须提示范围和原因，不能静默截掉。

私有 GitHub 仓库的读权限是仓库级：首版远端会话分享只开放给「项目共享」范围，要求记忆仓库读者属于允许共享的团队。原有 assignee 私有检查点保持原有行为，不允许把其正文偷偷放入团队共享仓库。平台成员撤权不能撤销已经下载的副本或独立 GitHub 授权，配置页必须明确这点；发布前核对仓库仍为 private。不要声称提供了 GitHub 不具备的逐材料权限。

GitHub 方案的服务端读权限必须一起落地，否则网页只能看到摘要，目标不成立：扩展使用用户 GitHub 身份写入；网页服务端用配置好的、仅限记忆仓库的只读凭据读取。凭据仅在服务端秘密配置，不能进入数据库明文、前端、日志或分享包。首版一个部署配置一个记忆仓库，支持多个项目路径；不建设完整 GitHub App 安装管理平台。未配置凭据时明确显示未配置，不能返回假原文。

### 2.2 记录与提炼时机

- 默认连续记录到本地，不默认连续上传。初始化一次绑定和分享配置后，每次「发布工作断点」只需一次点击；提供旁边的「预览／编辑」。
- 主要用 Codex/Claude 官方 Hook 事件驱动本地采集：用户输入、工具调用/结果、助手回合结束、压缩/退出等。Hook handler 只做本地快速写入，不调用模型、不联网、不阻塞 Agent。安装和首次信任由用户明确完成；AgileCampus 不能静默修改全局 Agent 配置。Hook event stream 只保证记录它实际提供的字段，不能单独证明队友能看到完整对话。
- 插件按低频节奏检查 Hook 丢失或扩展未运行的会话状态；轮询只用于检测/恢复，不能每 5 秒反复读和解析整个 transcript。
- Hook 提供的 transcript_path 可作为本机来源定位，但 Codex 官方明确其文件格式不是稳定接口。Hook 结构化事件是增量采集证据，不等于完整 transcript。Codex 优先复用现有 `EntireAdapter.capture` 的 `entire session info --transcript` 导出和 workspace/version 校验，不直接猜读 `~/.codex` 私有文件；Claude 只用已验证的官方导出/适配器。要发布完整对话，provider/version 适配器必须证明归档覆盖；不能把路径存在或事件数当作完整采集。
- 用户点击发布时，冻结已完成事件的末尾游标和 Git 基线，然后提炼。正在写入的半行、正在执行工具的未完成结果留到下一次。
- 会话结束时只提醒发布；首版不增加定时付费总结、后台自动共享或自动接班。
- 手动「重新提炼」才重算已有草稿；相同输入和配置复用结果，避免反复计费。

### 2.3 模型与真实性

- Codex 与 Claude Code 都有官方生命周期 Hook，可提供会话标识、工作目录、transcript 路径及事件级数据；由各自 Adapter 翻译为统一事件。Codex `codex exec --json` 适合 AgileCampus 自己启动的会话，不能当作读取任意既有交互会话的接口。
- CLI 会话文件未必是数据库。不得把读取供应商隐藏数据库作为主接入方式，不得遍历用户全部会话；只读取用户绑定的来源。M00 必须按本机版本和官方文档确认具体 Hook 事件、输入字段和信任要求。Hook event stream 可能缺少中间助手正文、完整工具输出或多模态内容，不能视作完整 transcript。
- 摘要模型复用服务端 src/lib/agent/model.ts 及现有 AI SDK，增加只生成结构化数据的独立提炼方法，不调用任务修改工具。供应商和模型从实际配置获取，不把当前默认模型名认作永久事实。
- 初始化明确告知：分享用对话会发往配置的摘要模型；如果选择启用团队 transcript 阅读，脱敏后的会话归档也会进入已配置的私有共享仓库和网页读取服务。原始本地记录不直接外发。无法安全处理的内容暂停该次发布。
- 不做模型微调。统一 schema、提炼提示词、事实校验和评测样本先解决格式与质量。

### 2.4 完整对话归档与发布门槛

标准化事件和完整对话归档是两种不同数据：事件供 AI 提炼、证据引用和增量同步；归档供队友在网页阅读原会话。二者都要保留，不能拿摘要或只有 Hook 可见的部分事件冒充“完整对话”。

- 本地只为已绑定会话保存追加式来源归档和标准事件。远端只存经本地版本化来源解析器处理、脱敏并经用户确认的分享归档；不得默默上传未经审查的原始本地文件。原生 session ID、绝对路径、账号信息、token/私钥等不进入远端包。
- 归档 manifest 必须记录 provider、来源/解析器版本、发布归档摘要、字节长度、分片摘要、对话事件序号/来源范围、解析覆盖状态以及脱敏或排除范围。user/assistant/tool_call/tool_result 等对话事件必须映射到归档中的稳定记录/范围；扩展生成的 `git_snapshot`、`gap` 等非对话事件保留在事件日志，不伪装成 transcript 原文。记忆条目先引用标准事件，再能定位到原文出处或明确标记为程序采集证据。
- 安全扫描必须覆盖 transcript 的完整结构和文本。可识别秘密先替换成包内稳定占位符，保留位置/范围记录；无法安全脱敏、多模态/未知字段不能保真、解析器版本未知或超过产品上限时，阻止“完整发布”，保留本地材料并给出具体原因。禁止按字节/行数静默截断。
- 发布前显示分享范围、脱敏命中和明确遗漏。首次启用某项目的 transcript 分享必须明确同意；无新增风险时后续发布可以一键。发现新秘密或覆盖变化时要求再次确认。手工修订记忆不应改写原文归档。
- 归档是不可变、可分页的共享版本。网页可逐段查看并从记忆证据跳到原会话范围；Agent 初始上下文只装入记忆和必要证据，按需拉取原文片段，不能把整段 transcript 默认塞进 prompt。
- 完整性至少分为 `complete`、`partial`、`unavailable`。只有来源解析/范围校验完整、没有未披露缺口、分享版 hash 可回读校验时，才能标 `complete`。`partial` 可本地保存和人工检查，但不得显示“队友已获得完整会话”或作为完整断点发布；缺少来源归档就是 `unavailable`。

## 3. 统一数据契约：M01 必须冻结

以下名称是拟新增接口，不是已有功能。共用无环境依赖的 TypeScript 契约放 shared/session-memory/，只依赖可在根项目及扩展编译的基础类型/校验器。若扩展 tsconfig 的 rootDir 不允许直接导入，建立一个本地共享包并正确打包；禁止复制两份 schema 后各自修改。

### 3.1 NormalizedEventV1

```ts
type NormalizedEventV1 = {
  schemaVersion: 1;
  id: string;                  // 同一来源事件重读时不变
  sessionKey: string;          // 平台生成的 UUID，不泄露本地 session 路径
  sequence: number;
  timestamp: string | null;    // 来源缺失不编造
  kind: "user" | "assistant" | "tool_call" | "tool_result" | "git_snapshot" | "gap";
  text: string;
  toolCallId?: string;
  command?: string;
  exitCode?: number | null;
  paths?: string[];            // 仓库相对路径
  sourceRef: string;           // 本地来源引用；分享后必须能映射到分享归档中的稳定记录/范围
};
```

采集游标另存 provider/session/workspaceIdentity/sourceIdentity/byteOffset/lastCompleteEventHash。游标只在事件成功持久化后推进。来源文件截断、轮转、替换不能沿用旧偏移；记录 gap 并提示，不能当作全量无遗漏。事件 ID 必须包含原始事件标识或来源位置，不能只 hash text，避免吃掉内容相同的真实重复操作。

### 3.2 MemoryDocumentV1

```ts
type MemoryItem = {
  id: string;
  text: string;
  evidenceRefs: string[]; // 分享事件 ID，不是凭空生成的引用
  origin: "extracted" | "human";
  support: "captured" | "reported" | "inferred";
  disposition: "active" | "superseded" | "uncertain";
  supersedes?: string;
};
type MemoryDocumentV1 = {
  schemaVersion: 1;
  id: string;
  sessionKey: string;
  projectId: string;
  taskId: string;
  parentMemoryId: string | null;
  revision: number;
  inputDigest: string;
  sourceCoverage: { fromSequence: number; toSequence: number; gaps: string[] };
  code: { repositoryKeyHash: string; headSha: string; dirtyExcluded: boolean };
  goal: MemoryItem[];
  constraints: MemoryItem[];
  completed: MemoryItem[];
  remaining: MemoryItem[];
  decisions: MemoryItem[];
  rejectedApproaches: MemoryItem[];
  blockers: MemoryItem[];
  nextActions: MemoryItem[];
  tests: Array<{
    command: string; exitCode: number | null; evidenceRefs: string[];
    support: "captured" | "reported";
  }>;
  provenance: {
    extractor: string; promptVersion: string; model: string;
    createdAt: string; editedBy: string | null;
    usage: { inputTokens: number | null; outputTokens: number | null };
  };
};
```

数组允许为空。未知测试退出码为 null；不存在的下一步不能伪装为事实，可以标 inferred。模型声称「测试通过」不能升级为 captured；只由匹配的工具结果和采集记录确认。存在引用也不代表结论语义一定正确，矛盾或不能自动核实的判断标 uncertain。

分享 manifest 必须含 schemaVersion/packageId/sessionKey/memoryId/checkpointLocalId/projectId/taskId/parentPackageId/codeHeadSha/taskHandoffVersion/taskUpdatedAt、每个事件片段和 transcript 归档片段的相对路径/hash/字节数/范围。归档另记 provider/parser 版本、分享摘要及 `complete/partial/unavailable` 状态；对话事件必须能反向定位到归档范围，程序生成的 Git/gap 事件不要求伪造 transcript 位置。所有引用都落在包内；缺失或排除的事件/归档范围需显式说明覆盖缺口。未知 schemaVersion 或未知来源 parser 版本拒绝 `complete` 状态，保留现有 v1/v2 检查点分享包读取支持，不偷偷重新解释旧数据。

### 3.3 不可变版本与修订

- 一次发布固定一个 memory revision、一个 packageId、一个 Git commit 和一个服务端 checkpoint。接收者读取绑定版本，不读取浮动分支最新内容。
- 人工修改生成新 revision，记录父版本、修改者、时间、差异，origin=human；原文只读。
- 后续提炼必须携带当前有效人工修订。新事件与人工修订冲突时保留两者并标 uncertain，不能静默覆盖。
- 改 summary 不修改已经发出的交接单。需要更新交接时沿用旧交接状态规则，生成新版本/交接，并展示原版本已被后续版本替代。

## 4. 模块、接口与发布事务

建议新增文件；名字可为适配当前目录小幅调整，职责不可省略。

| 区域 | 文件/目录 | 职责 |
| --- | --- | --- |
| 共享契约 | shared/session-memory/** | 事件、记忆、manifest、输入输出校验与版本 |
| 扩展采集 | vscode-extension/src/sessions/{binding-store,event-store,capture-service}.ts | 绑定、增量、恢复、订阅释放 |
| 扩展记忆 | vscode-extension/src/memory/{extract-client,draft-store,context-budget}.ts | 请求提炼、草稿修订、预算 |
| 扩展发布 | vscode-extension/src/memory/{publish-flow,github-transport}.ts | 上传、恢复、不可变定位 |
| 扩展命令 | commands/{bind-session,publish-workpoint,receive-workpoint}.ts | 一键入口，调用已有保存/导入/交接服务 |
| 后端 | src/lib/session-memory/**、src/db/schema-session-memory.ts | 提炼、索引、权限、受控 GitHub 读取 |
| API | src/app/api/extension/v1/**、src/app/api/projects/[projectId]/sessions/** | 双端鉴权，共用领域服务 |
| 网页 | src/app/(app)/projects/[projectId]/sessions/** | 列表、详情、修订、接续链接 |

不能让新命令通过连续触发旧命令制造十个弹窗。先将现有命令中的保存/发布/导入逻辑提取成可组合服务；旧命令继续可用。

M01 建立 contract.md，固定如下新接口，并逐个明确请求、响应、错误及身份来源：

- `POST /api/extension/v1/projects/{projectId}/tasks/{taskId}/memory/extract`：接收已脱敏增量事件、前版有效记忆、Git/任务基线、输入 digest、幂等键；返回校验后的草稿与真实模型用量。禁止客户端伪造作者身份。
- `POST /api/extension/v1/projects/{projectId}/tasks/{taskId}/session-publications`：接收现有 serverCheckpointId、packageId、记忆仓库数字 ID、commit SHA、manifestPath/hash、可验证的会话标题和来源；服务端验证远端 manifest 与已有 checkpoint 一致后才发布可见。
- `GET /api/extension/v1/projects/{projectId}/sessions?taskId=&cursor=`：游标分页，默认 30 条。
- `GET /api/extension/v1/session-publications/{publicationId}`：返回经过权限过滤的指定版本索引与记忆。
- `GET /api/extension/v1/session-publications/{publicationId}/events?after=&limit=`：返回 manifest 内已授权事件，默认 50 条；按 evidenceRefs 查询也必须限制在此包内。
- `GET /api/extension/v1/session-publications/{publicationId}/transcript?cursor=&limit=`：按归档顺序分页返回该不可变分享版本内的脱敏对话记录、工具调用/结果和出处范围；默认最多 50 条并限制响应字节。超长正文可继续按片段 cursor 读取，但不能静默省略尾部。响应携完整性状态和下一游标，不提供原始本机路径/session ID。
- 网页端使用现有登录会话认证的同领域接口/服务，不把插件 PAT 或 GitHub 凭据送到浏览器；两类入口不能出现不同权限判定。
- 人工修订：提供受版本检查约束的草稿修订接口，预期 revision 不符返回 409；已发布版本不就地覆盖。网页首版修订可保存为下一版草稿，由原发布者插件同步后发布；界面必须显示「草稿未发布」，不能假装队友已收到。

提炼接口同步请求首版设 60 秒超时，最多一次格式修复请求。以 actor/project/task/inputDigest/promptVersion/modelConfigurationDigest 缓存已完成结果，同输入并发只执行一个提炼作业；状态持久化，进程崩溃显示结果未知，需显式重试，不能无限计费。客户端超时先查询作业结果，不直接重复调用。M01 补充对应只读 job 状态接口。模型返回原始错误不直接回显可能含密钥的请求配置。

发布状态单独持久化：`local_saved → extracting → draft_ready → uploading → remote_written → index_registered → published`，另记 failed/cancelled、最后成功阶段、重试载荷和原因。分享过程中 GitHub 和数据库无法跨系统原子提交，必须实现可恢复流程：

1. 冻结本地包和配置，生成 packageId、digest 和稳定操作 ID；检查原工作区有未提交内容时默认停止发布，并提供明确的「仅发布已提交代码基线」选择。不得自动 commit/push 用户代码。
2. GitHub 路径固定 `projects/{projectId}/sessions/{sessionKey}/packages/{packageId}/`，内容含 manifest.json、memory.json、events 分片及脱敏 transcript 分片。归档按服务端和 GitHub API 可验证的大小上限分片，按需分页读取，不把长会话装进数据库行或单个超限 blob。使用 GitHub Git 数据 API 创建一个包含完整包的提交，按 ref 的当前值推进分支；并发冲突重新读取基线并保留他人路径，绝不 force push。
3. 写入后按 commit SHA 回读并校验。超时按固定路径/digest 查找，匹配则恢复，不重复生成 packageId。候选多条或内容不符停止并报告。
4. 复用现有 checkpoint 发布服务登记摘要；登记失败保留 remote_written，显示「材料已上传，平台登记未完成」。
5. 登记 publication，把不可变远端 manifest 与 checkpoint 关联。服务端验证项目/任务/代码 SHA/包 hash/任务版本和现有权限。服务端重试使用唯一键，重复同载荷返回原对象，不同载荷返回 409。
6. 只有登记成功才显示「已发布」。发起交接复用原 send-handoff 领域服务，不自动改派或自动接收。

远端已写入但未登记的包先保留恢复，不做自动删除历史的清理器。服务端读取只能访问配置仓库和服务端已登记的 commit/path，拒绝客户端任意 URL、路径跳转及跨项目访问。大小/hash 校验先于解析和显示。

## 5. 逐单施工

### M00：确认入口与建立隔离基线

1. 保存 HEAD、dirty 文件清单和 diff hash；阅读当前修改，记录所有将触及文件。禁止覆盖别人未提交代码，若重叠无法合并先提交具体冲突说明。
2. 运行无密钥的现有相关测试，创建 docs/reviews/session-memory-publish/{progress.md,contract.md,capabilities.md,cases.csv,evidence/}。
3. 核查实际 Codex、Entire、VS Code 版本和输出格式。查当时官方文档及本机 help，记录文档 URL、版本、检测命令、结果，不能照搬对话里的 Hooks 能力描述。
4. 用 Codex 和 Claude 官方 Hook schema 的合成输入映射到 NormalizedEventV1，覆盖用户输入、工具调用、工具结果、助手回合结束。不要为 M00 安装/信任 Hook，不读取真实用户会话；真实 Extension Host 采集在 M02 验收。
5. 盘点已有 Github/平台/摘要模型身份配置，只记录可用与否，不读取输出密钥。明确网页服务端能否读取拟用私有记忆仓库。

验收：capabilities.md 有真实版本、来源结构、工作区归属判定、采集方式、缺口和官方链接；合成 payload 映射证据在 M00 完成，真实事件采集在 M02 验收。旧测试失败独立登记，不删除断言。

### M01：契约、迁移和权限

1. 实现第 3 节 schema 和第 4 节接口契约。数据库建议独立 session/publication/extraction-job/草稿修订表，以外键关联 checkpoint/task，不修改任务状态含义。新包必须带可校验 transcript 归档描述和分片；没有原文归档的 Hook events 不得标记为完整发布。
2. 唯一约束覆盖发布操作、packageId 和版本；测试库 reset 清单加入新表。父记忆/父包跨项目、未来版本引用和循环引用拒绝。
3. extension TypeScript 与根项目导入同一契约；保留旧包兼容测试和 round-trip 测试。
4. GitHub 共享范围与平台成员关系配置必须显式绑定。查询、原文读取、提炼、修订、登记每次复核当前权限。

验收：合法例子能解析；非法版本、假 hash、未知引用、跨任务包和不匹配 SHA 被拒；撤权后 API 不再返回材料。新增迁移只在隔离库验证，记录应用/回滚方法，不改用户开发库。

当前进度：共享 schema、数据库会话/job/draft/publication/授权表、publication 只读 API、项目会话列表 API及权限测试已完成一部分；publication 写入和 GitHub manifest 服务器校验仍未实现。M01 进度及验证见 `docs/reviews/session-memory-publish/m01-code-progress.md`。

迁移工具说明：本仓库目前使用 `drizzle-kit push`，没有已落地的版本化 migration 目录。实测该版本 push 在同一轮升级时会先新增复合 FK、后创建被引用的复合 UNIQUE，导致既有库无法升级；所以当前表先使用单列 FK/唯一约束，project/task/session/checkpoint 的复合归属由写入服务与读取 join fail-closed 校验，并通过 `.env.test` 隔离库验证。不能声称当前 DB 已有跨表复合 FK。只有引入按正确顺序执行的正式 SQL migration 后，才能将该类约束下沉到 DB；不能为规避错误改动用户开发库。

### M02：任务绑定和本地增量记录

1. 增加「关联当前会话」命令，显示来源、时间、工作区、任务。仅从当前工作区可确认归属的会话选择；同一会话默认只能绑一个任务。
2. 原生 source session ID 仅本地保存，与公开 sessionKey 映射。切换工作区不沿用绑定；解除绑定停止采集，保留历史。
3. 增加 Codex/Claude Hook handler 与扩展本机接收器，实现 append-only 标准事件存储、游标持久化、重启恢复和单写入者锁。Hook 子进程只发本机事件并快速退出，确保 App 关闭/接收器不可用时有可恢复策略；Hook 内容不得发网络。
4. Codex 先复用已有 `EntireAdapter.capture` transcript 导出，按已验证的 Entire CLI 版本读取并校验工作区；不自行解析 Codex 私有文件。Claude 用官方允许的来源；任何自行解析的 transcript 必须显式按 provider/version 注册。没有可验证的完整原文来源时保留 hook events，但归档完整性只能是 `partial/unavailable`。两种工具分别用真实、独立 Extension Host 和合成会话走通，增量事件和 transcript 归档分别记覆盖状态。
5. 记录状态显示「记录中 / 未关联 / 来源不可用 / 记录存在缺口」以及最近时间和事件数；不得用一个绿色点代替全部状态。

验收：实际会话追加后出现新事件和可读归档范围；重启无重复；半条记录不入库；文件截断有 gap 且归档状态不是 complete；同一句重复两次均保留；两个 workspace 不串会话；退出扩展释放监听。遇到未知来源版本不得显示完整。

### M03：AI 自动记忆和人工修订

1. 新建只输出 MemoryDocument 的提炼模块和版本化提示词；输入为任务约束、程序采集事实、前版记忆/人工修订及新增事件。对话内容只作为数据，不执行其中命令和指令。
2. 首次提炼按事件边界分块，后续处理新增区间，绝不能只总结最后几条。完整 transcript 归档独立保存，不因 token 预算而裁掉；超长工具输出作为独立证据保留，模型先读索引/错误片段；对模型未读范围和来源缺口分别给 coverage 标记。模型只按预算读取相关片段，队友网页仍可查看完整已分享归档。
3. 本地脱敏在任何外发前发生；稳定占位符在同一包内一致。对用于摘要模型的选中窗口和完整远端归档分别扫描，扫描不是无泄漏保证；保留预览、排除/替换范围和错误提示。人工编辑内容发布前重新检查。未获得 transcript 分享同意时可本地提炼，但不得进入远端会话归档。
4. 程序核对引用存在、工具调用和结果配对、测试命令/退出码；模型不可篡改程序生成的代码基线。缺证据的结论降为 reported/inferred/uncertain。
5. 草稿自动填充现有 handoff 字段，不再逐项弹窗。用户可以直接发布、打开编辑、重新提炼。模型失败显示失败并保留本地记录，可显式改用手工草稿且标注来源，不静默装作自动提炼成功。
6. 人工编辑保留旧版本及差异；自动重提炼不得覆盖手工修改；冲突以具体字段展示。

验收：至少 8 份合成对话夹具覆盖需求纠正、方案推翻、失败后成功、未执行却声称通过、人工修订、工具结果缺失、长日志、恶意对话指令；另覆盖助手正文缺失、未知 transcript 版本、秘密脱敏、归档超限、归档被截断/分片缺失。每份预先写必要事实答案；关键约束/未解决阻塞/失败原因必须保留，伪造 captured 测试为 0。任何归档截断、未知解析格式或未披露脱敏都不得通过完整发布校验。真实模型另做至少 3 例，不用 Mock 结果证明提炼质量。

### M04：一键发布与实际传输

1. 实现私有记忆仓库传输及上述恢复状态机。复用现有 GitHub 身份机制；补超时、响应结构校验、分页和并发冲突处理。GitHub SDK/API 用法依实施时官方资料验证。
2. 初始化仅一次确认任务来源、分享范围、记忆仓库和摘要模型外发范围。之后「发布工作断点」自动完成本地保存、提炼、上传及平台登记；正常路径不连弹确认框。改分享目的地/范围后重新确认。
3. 侧边栏显示当前阶段和可重试错误；提炼失败无空包发布；GitHub 成功但平台失败可恢复；取消不删除已存在的远端数据。
4. 不连 GitHub 时仍可本地保存和编辑，状态必须为未发布；未配置摘要模型不伪造 AI 结果。
5. 同时完成网页服务端读取私有材料的凭据及读取服务，不能将“下载 URL”指向只能 A 本机访问的位置。

验收：真实 private 测试仓库有可校验分享包，包含完整可读的脱敏 transcript 和结构化记忆；公开代码仓库无新增会话文件；网页逐段读取 hash 校验通过。断网分别发生在模型响应后、GitHub 提交后、checkpoint 登记后、publication 登记后，重试最终只出现一个逻辑发布版本。服务端无权限、仓库变 public、跨项目、缺档、解析不支持、静默截断和超限包均失败且原因明确。

### M05：网页会话入口与阅读

1. 新增 `/projects/[projectId]/sessions` 列表和 `/projects/[projectId]/sessions/[sessionKey]?publicationId=...` 详情。显式传 publicationId 时始终展示该版本；未指定时可展示最近发布版本，并清楚显示版本。
2. 将「会话」放进现有可折叠侧边栏的项目二级导航；实施前追踪实际渲染链，不只改 nav-items.ts 中可能未挂载的配置。任务详情加关联会话链接，复用同一详情页。
3. 列表列：任务、会话标题、成员、Agent、发布时间、交接状态。支持任务/成员筛选和分页；不先做全文搜索或另建仪表盘。
4. 详情主区默认结构化记忆；同一位置可切换「对话」「版本」。对话视图分页呈现完整的已分享脱敏 transcript；点某条出处直接定位原文范围。显示来源 provider/parser 版本、完整性状态、脱敏/排除范围和 hash 校验状态。没有完整归档时明确显示部分/不可用，不能以事件摘要拼成“完整对话”。
5. 主操作「在 VS Code 中接续」，次操作「交接给成员」「编辑记忆」。初版网页编辑保存下一版草稿；显示未发布和返回插件发布入口。原文不允许编辑。
6. 深链接只携 server origin 的绑定标识、projectId、publicationId、handoffId；不携凭据、原始 prompt、任意命令或本地路径。插件核对当前连接的服务器、权限和目标工作区，不能信任 URL 直接 spawn。
7. 未安装插件给出安装与复制断点标识入口，不显示“已启动”。旧页面入口指向新统一详情，不平行复制会话数据。

设计约束：按 anti-ai-slop-ui 的 Developer Tool / CLI Companion 方向执行。用户已选定的 shadcn 中性风格优先，不能以技能要求为由重新设计全站。使用已有基础表格、按钮、侧栏和表单；只补业务数据和交互。

- 排版：UI 使用现有系统无衬线字体，代码/路径/日志用现有等宽字体；正文 14px、辅助信息 12px、页标题 18px，不添加标题下的宣传解释。
- 布局：现有侧边栏 → 会话列表 → 详情正文；列表选中后使用主详情区域，避免卡片里嵌卡片。桌面保持可读列宽；窄屏先列表、再详情，有明确返回并保留筛选。
- 色彩：复用 background/foreground/muted/border 语义变量，不新建暖灰、蓝底或渐变；状态用文字，颜色仅辅助。
- 间距 4/8/12/16/24px；表格行约 40px；控件沿用既有小圆角，正文区域不套大圆角卡片，阴影仅沿用浮层。
- 禁止彩色标题竖线、虚线装饰框、emoji、每项一个状态卡片、英文重复标题、拟人宣传句和装饰动画。动效仅必要展开/状态反馈，支持减少动态效果。
- 键盘能进入列表、打开详情、定位出处、关闭编辑区，焦点有反馈；状态和错误可被辅助技术读出。对话 Markdown 禁止原始 HTML/脚本及命令链接执行。

验收：真实浏览器截图至少 1440px 和 390px；从项目进入指定会话不超过两次点击；刷新/返回/分享 URL 正常；出处能定位；材料未登记/无权限/加载失败不是空白。按技能 rubric 报告实际视觉评分，不给尚未渲染的页面编分；本计划实现准备度自检 10/10（五项约束齐全），不等于 UI 验收分数。取舍是只做阅读与修订所需页面，不全站换肤。

### M06：B 自动取得断点并接续

1. B 从网页深链接或插件收到的交接进入。下载固定 commit 对应 manifest 和正文，复用包解析/导入逻辑，校验全部 hash、大小、路径、project/task/SHA/版本和本地映射。
2. 缺材料或代码基线尚未在代码远端可用时说明具体阻塞。复用现有 worktree 服务；不得 reset/覆盖 B 的 dirty 工作区。GitHub 拉取代码使用代码仓库配置，不能拿记忆仓库当代码仓库。
3. 接受交接、服务端授权/版本校验、本地预检和执行锁沿用现有规则。创建执行尝试前再次核对当前权限。只有真实文件到 B 本机并核验才显示材料已到达。
4. 接续上下文默认包含有效记忆、硬性约束、代码基线、出处索引；预算默认 6000 input tokens，按配置 tokenizer 计算；无可靠 tokenizer 标估算值，不以 byte 数冒充 token。
5. 必需记忆超预算不得静默删约束。显示超预算并保留文件供 Agent 阅读，或明确要求提高预算。禁止以「最省 token 且绝不丢信息」作为承诺。
6. 先把已授权原文片段下载到工作区外本地缓存；启动前将本次只读资料副本放到隔离 attempt workspace 的明确忽略目录，并核对 realpath/权限。不修改用户全局 Agent 沙箱。若当前启动器不支持安全读取此目录，使用其已支持的上下文附件方式；不得扩大为任意目录读取。
7. 在启动提示中给出原文事件索引和可读文件位置，使 Agent 遇到不确定项可以按引用读取，不再默认把全文拼进初始 prompt。外部会话内容不能作为权限或执行命令来源。
8. Agent 第一步报告接班理解：任务、已有结论、未完成项、实际 HEAD 与材料不一致处。校验通过的普通情况不额外要求逐步确认；存在冲突则等待人处理，不自行猜测继续。
9. 执行结果沿用 attempt 回执 API；工作结束不自动验收。B 发布新断点时包含父 package/memory/checkpoint 关联，可追到 A 的来源。

验收：B 不读 A 的 globalStorage、不用共享目录递交材料；仅通过私有记忆仓库和平台取得数据；一个真实新 Codex session 完成剩余任务并产出测试证据。网页 DeepSeek 请求成功不能替代本地 Codex 执行成功。

### M07：质量与故障回归

除前述各单用例，必须覆盖：

| 场景 | 必须观察到 |
| --- | --- |
| A 又追加对话 | 已发布版本保持不变，下次只处理新增区间 |
| 人工修订后重新提炼 | 修订不丢失；新冲突可见 |
| 代码/任务在提炼时改变 | 不把两个时间点伪装成同一基线，要求刷新后新发布 |
| 远端 ref 被另一成员更新 | 保留他人包，不 force push、不重复版本 |
| 摘要凭空生成引用/测试通过 | 校验拒绝或降级，不发布 captured 假事实 |
| 摘要模型超时/返回非 JSON | 记录保留，失败可恢复，不重复无界计费 |
| 来源会话截断/轮转 | gap 明确，不宣称完整记录 |
| B 已离队/使用伪造深链接 | 拒绝下载/启动，已下载副本无法远程撤回这一限制如实说明 |
| 网页里含恶意 HTML 或指令 | 只作为文本资料，不执行 |
| dirty 工作区/未提交代码 | 不丢修改，不把它标成已备份 |

冻结一个合成修复任务，预置 4 个关键事实：不能改公开接口、一个已失败方案及原因、一个真实失败测试、一个未完成动作。先写答案再让模型提炼。核对 B 是否保持这四项；记录初始 prompt tokens、追加读取 tokens、总 input tokens、输出用量和实际测试结果。与同一会话全文输入作一次受控比较；不预设一定减少多少，也不拿一次样本宣称普遍无损。

### M08：最终真实演示与交付

1. 使用两个独立 VS Code profile/globalStorage、两个独立 clone、两个平台成员身份、一个 private 合成代码仓库和独立 private 记忆仓库。首次真实模型验证限制为短任务，不使用生产对话作测试夹具。
2. 冻结需求和验收测试；A 实际执行一部分任务，产生真实对话与工具结果；一键发布，网页查看，B 获取并接班，独立执行测试，发布下一断点。
3. 至少证明一次点击出处、一次人工修订保留、一次断网重试恢复。没有人工给 B 补交接背景；必要额外提问需记录，不能掩盖记忆缺失。
4. report.md 写明每单 PASS/FAIL/BLOCKED、实际文件、命令/退出码、截图、来源版本、模型配置名称、材料 hash、父子断点及两端回执。访问密钥、真实用户全文和本地绝对隐私路径不写入报告。
5. 补 3 分钟 demo-script.md，逐步写“在哪个窗口点哪个按钮、看到什么、如何判断真的成功”。未验证的 Claude/原生恢复/全自动同步明确列为未支持。
6. 最终检查：根 npm run lint、npm run check:ui-copy、npm run build、隔离回归库 npm test；扩展 npm --prefix vscode-extension run check、npm --prefix vscode-extension test；git diff --check。记录真实退出码；检查失败不能标全验收。

## 6. 每单交付格式

progress.md 每项固定字段：状态（NOT_STARTED/IN_PROGRESS/PASS/FAIL/BLOCKED）、输入前提、修改文件、实际行为、执行命令与工作目录、退出码、证据链接、限制、下一单条件。阶段性自动测试通过与真实 Extension Host 测试通过分开写。

每个施工单完成一个范围清晰的提交；先审 staging，只提交本单内容，不顺手提交别人的 dirty 文件。没有明确远端推送要求时不自动推送主仓库。测试远端只使用已授权的私有合成仓库；缺仓库/凭据时报告精确缺口，不能转而上传公开仓库。

最终完成标准只有一个：A 不手填交接表，点击一次发布；B 能从网页读到带出处的真实会话记忆，在独立工作区取得同一版本材料，让新 Agent 完成剩余任务并留下下一断点。任何环节仍靠伪数据、手递文件或口头补充，都不算完整通过。
