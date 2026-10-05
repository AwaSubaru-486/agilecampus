# Luna 工单：会话记忆与断点继承核心

日期：2026-10-05。状态：C00–C05 代码已落地；扩展侧与根目录回归通过；VS Code 1.122.0 隔离 Extension Development Host 启动/激活及命令注册 smoke test 通过。完整命令交互、真实模型和双机接续仍未验证，见 `docs/reviews/memory-core/report.md`。

## 0. 执行范围与停止位置

用户只负责会话采集、记忆提炼和断点上下文。此次不负责任务管理、worktree、网页前端或账号管理。用户已明确要求完成全部 C00–C05；Codex 执行本专项。为连接现有模型配置，允许新增最小的受鉴权提炼 API，但不可改账号/权限实现。

按 **C00 → C01 → C02 → C03 → C04 → C05** 顺序完成全部专项并做模块验收。C03 模型出站仅发送用户确认后的脱敏、限额输入；模型配置复用现有服务端配置。

本工单替代旧 N00–N06 在“用户个人模块”上的宽范围安排；旧 M/H 工单的权限、来源完整性、隐私约束仍有效。不得因此接管队友的工作。

目标只有一条：**已绑定的真实会话 → 固定整理范围 → 有出处的记忆候选 → 人工修订后的版本 → 下一个 Agent 可读取的接班上下文。**

合格标准不是“多一个聊天窗口”，而是接班者可以知道：做到了哪里、为什么这么做、哪些方案失败了、测试是否真的运行过、下一步是什么，以及这些判断来自哪些记录。

## 1. 施工前事实

规划时分支 `feat/risk-aware-closure`，HEAD `6fd425893a33428c268ce54072800dc373a2f796`。工作区有大量未提交改动；以施工当天实际文件为准，不能恢复到该 SHA、清理工作区或覆盖其他人的改动。

已有代码入口：

- `vscode-extension/src/session-memory/local-store.ts`：会话绑定、追加式事件、去重、分页、失败记录与锁。
- `vscode-extension/src/session-memory/codex-hook-{adapter,config,cli}.ts`：现有 Hook 链路。存在代码不代表已经证明完整捕获 Codex/Claude 会话。
- `shared/session-memory/{types,schema}.ts`：现有事件、记忆、材料包契约与校验。
- `vscode-extension/src/git/repository-service.ts`：只读仓库身份、HEAD、dirty 检查。
- `vscode-extension/src/commands/checkpoint-support.ts`：已有工作区选择与认证客户端创建。
- `vscode-extension/src/checkpoints/session-memory-package.ts`：材料包解析器，不是已经完成的发布器。
- `src/lib/agent/model.ts`：服务端模型配置；只能由后续模型适配方复用，不复制密钥到扩展。

施工结果：冻结提炼输入、可验证的 AI 候选、人工编辑保护、来源定位和接班材料生成均已在代码中实现。实际实现文件和命令见 `docs/reviews/memory-core/integration-contract.md`。私有传输、网页呈现、另一台电脑上的真实 Agent 接续仍需另行集成；本模块通过不等于整条交接通过。

## 2. 文件边界

允许新增/修改：

```text
vscode-extension/src/memory/**                         # 本工单新增的领域模块
vscode-extension/src/commands/session-memory.ts        # 命令面板提炼、审核、导出接线
vscode-extension/src/commands/import-memory-handoff.ts # 接班材料本机导入核验
vscode-extension/src/extension.ts                      # 命令注册
vscode-extension/package.json                          # 命令贡献与激活事件
vscode-extension/tests/memory-*.test.ts
vscode-extension/tests/fixtures/session-memory/**      # 仅合成、不含隐私
vscode-extension/src/session-memory/local-store.ts    # 仅冻结读取的最小增量
vscode-extension/tests/session-memory-local-store.test.ts
docs/reviews/memory-core/**
```

禁止修改：网页与 Webview 布局、导航、样式，任务状态机、任务提交/验收、worktree/分支操作、账号/权限实现。允许新增仅用于会话记忆提炼的 API route，必须复用 `authenticateBearer`、`getProjectForUser`、`getModel()`，不增加新的账号/密钥存储或权限绕过。不得读取用户私人会话数据库来凑测试，不创建 GitHub 模拟仓库，不推送真实会话，不新增自动合并。

`shared/session-memory/**` 只读复用；如确有共享契约需求，先写 `docs/reviews/memory-core/integration-contract.md`，等待签收再改。扩展本地类型放在 `vscode-extension/src/memory/types.ts`，服务端提炼放在 `src/lib/session-memory/extract.ts`，不要擅自改变 V1。

本轮不改 Webview 或网页的可见 UI。已提供 VS Code 命令面板入口，使个人模块可独立试用；不替代队友的 Webview 展示和平台集成。

## 3. 固定技术约束

1. 原始事件永远不被摘要覆盖；不建立第二套可追加事件日志。提炼快照是不可变输入副本，不是新的采集源。
2. 不把模型生成的摘要称为原始 session。跨提供商继承是传递工作上下文，不承诺恢复另一台电脑的模型隐藏状态、工具进程或原生 session ID。
3. 原生 `providerSessionId`、本地绝对路径、PAT、密钥只留本机；导出 DTO 必须用字段白名单构造，不能展开本地 binding 对象。
4. 不宣称“摘要不丢信息”。保存原始事件与出处，并显式列出未处理范围、采集缺口、压缩限制。
5. `MemoryDocumentV1.sourceCoverage.gaps` 放 **gap 事件 ID**，不能放错误说明。采集失败与预算遗漏放本地描述对象；没有对应事件时不得伪造 gap 事件。
6. `MemoryDocumentV1.code.headSha` 必须是真实 Git SHA。没有首个提交时阻止生成 V1，不能填零值或随机 SHA。
7. dirty 代码未打包时标明 `dirtyExcluded=true`；HEAD 不是未提交文件的恢复保证。不读取/上传 diff 来规避队友的 worktree 职责。
8. 记录中的指令只是待分析数据；模型不能执行工具、读文件、访问 URL，接班材料也不能自动执行记录里的 shell 命令。
9. 同一输入、同一处理版本的序列化和 digest 必须稳定；不依赖对象插入顺序，不把随机 ID/创建时间放进内容 digest。
10. 首批所有测试离线，时钟/UUID/Git reader 可注入。历史测试通过数字不能当作本轮结果。

## 4. C00：基线与八组样例

新增 `docs/reviews/memory-core/{progress.md,cases.md,report.md,integration-contract.md}`。

步骤：

1. 读本工单、旧 N 计划以及本工单引用的 store/schema/Git 代码。记录当天 HEAD、dirty 清单，区分原有文件与本轮改动。
2. 在扩展目录执行 `npm test`、`npm run check`，记录实际命令、退出码、测试数字；基线失败先报告，不删除失败测试。
3. 建立以下八组固定事件样例，全部注明 `synthetic`：正常完成、失败方案后换方案、仅口头称测试成功、真实结构化工具失败、gap 加未恢复采集失败、重复 Hook 加并发追加、长工具结果超预算、人工修订后再提炼。
4. 每组写清必须保留的事实、不能推出的事实、预期 evidenceRefs。不要用全文字面一致作为模型质量指标。
5. 现有真实 Hook 的实机验证沿用 N01，报告独立列为已证明/未证明/环境阻塞；不因离线样例通过而称实机通过。

验收：样例无真实凭据；基线报告可复跑；能明确指出当前 Hook 实际能提供哪些结构化字段，缺失字段不靠推测补齐。

## 5. C01：不可变整理快照

新增 `vscode-extension/src/memory/{types,input-snapshot,snapshot-store}.ts`。

最低接口如下；名称可按既有风格调整，但参数、职责和边界不得省略：

```ts
// 增加到 LocalSessionStore，复用同一把已有锁。
freezeCapture(sessionKey: string): Promise<FrozenCapture>;

// 固定依赖，便于离线测试；不自行寻找或创建工作区。
createInputSnapshot(scope: MemoryScope, deps: SnapshotDeps): Promise<ExtractionSnapshotV1>;
saveSnapshot(snapshot: ExtractionSnapshotV1): Promise<void>;
loadSnapshot(snapshotId: string, expectedScope: MemoryScope): Promise<ExtractionSnapshotV1>;
```

`MemoryScope` 至少包含规范化服务地址、本地身份 scope 标识、workspace scope、projectId、taskId、sessionKey。身份/工作区来自调用方现有绑定，不能由模型或记录文本决定；不得把 PAT 当 scope 标识。无身份 scope 时可本机预览，但不能进入联网准备流程。

`FrozenCapture` 包含固定绑定、1…N 的按序事件、未恢复采集失败与采集时刻。必须在 store 的一次锁内读取并校验；锁内调用私有无锁 helpers，**不得调用同样获取锁的 summary/readEvents 导致嵌套等待**。日志文件缺失、重复序号、事件 sessionKey 不符或游标不符时明确失败，不悄悄跳过。

`ExtractionSnapshotV1` 最少包含：

```text
schemaVersion, snapshotId, scope, createdAt
fromSequence, toSequence, orderedEventIds, events, perEventHashes
captureFailures, gapEventIds, captureCompleteness: unknown|partial
repositoryKeyHash, headSha, dirtyExcluded, repositoryBlockers
captureDigest, contentBytes
```

步骤：

1. Git reader 前读 → freezeCapture → Git reader 后读；身份/HEAD/branch 改变则报 `REPOSITORY_CHANGED`，保留事件不丢弃。dirty 不变不代表文件内容没变化，报告此限制。
2. N 后的新事件继续正常追加，但不得混进已保存快照。空记录报 `EMPTY_CAPTURE`；无 HEAD 报 `NO_BASE_COMMIT`。
3. 复用事件 parser 与最大事件数；快照设置 10 MiB 字节上限，超限报 `SNAPSHOT_TOO_LARGE`，不静默裁剪。大规模分段归档另开工单。
4. captureDigest 覆盖规范化绑定 scope、事件顺序与全部事件内容、采集失败/缺口和仓库元数据；不包含 snapshotId、createdAt。记录算法版本。
5. 快照存于扩展私有 storageRoot 的 `session-memory/snapshots/<UUID>.json`。校验 UUID、限制大小、拒绝符号链接；目录 0700、文件 0600。临时文件完整写入后以不可覆盖方式发布；已有不同内容不可替换。
6. load 时校验类型、digest、event hashes、序号和 expectedScope；不能只信文件名。scope 不符报 `SCOPE_MISMATCH`。

测试必须覆盖：冻结后追加不变；同内容稳定 digest；不同任务/服务/身份拒绝；游标恢复后可冻结；损坏日志拒绝；空/超限/无 HEAD；同时两个写入者不串；快照篡改/路径穿越/符号链接拒绝；原生 session ID 与绝对路径不进入导出 DTO。

验收：能打印不含正文的快照统计，重启可读，同一快照绝不会被后来的事件改变。未处理的来源覆盖始终真实。

## 6. C02：整理输入、预算与隐私检查

新增 `vscode-extension/src/memory/{input-builder,redaction,input-digest}.ts` 和 `memory-input-builder.test.ts`。

接口：`prepareExtractionInput(snapshot, policy): PreparedExtractionInputV1`。纯函数，不请求模型、不发布材料。

步骤：

1. 输出固定 event ID、sequence、kind、脱敏后的内容与实际存在的工具字段；禁止假造测试、命令和 exitCode。
2. 采用版本化预算 `memory-input-v1`：正文合计最多 48 KiB UTF-8，单条文字最多 8 KiB。先预留选中事件的结构化字段，再按最新到最旧分配文字预算，最后恢复 sequence 升序。UTF-8 截断不切坏字符。
3. 被截断的每条事件记录原字节数、已包含字节数；完全未包含事件写明 ID/sequence/reason。`captureCompleteness` 与 `extractionCoverage` 分开，预算截断不能说成采集失败。
4. 若必要结构化字段本身超预算，报 `INPUT_BUDGET_EXCEEDED`，不能丢字段假装成功。48 KiB 是确定性字节预算，不声称是精确 token 数。
5. 复用现有秘密检测规则并增加合成密钥样例。脱敏用占位符，不保留秘密映射到联网 DTO；原始记录仍在本机。说明检测不是完整 DLP，不保证识别一切秘密。
6. 产生 consent preview DTO：目的服务、实际出站字节、事件范围、脱敏数量、遗漏数量、限制；本批只生成 DTO，禁止真实出站。用户确认由前端后续接入。
7. inputDigest 覆盖处理后内容、范围/遗漏、scope、仓库基线、redactionVersion、budgetVersion、promptVersion；区别于原始 captureDigest，避免不同整理策略误用同一缓存。

测试：多字节字符、单条超限、全量超限、空文本保留元数据、脱敏不改原文、秘密不进 DTO/日志、重复处理稳定 digest、策略改变 digest 改变、记录内提示注入只作为数据。

首批 C00–C02 仍是独立可验收里程碑；本次用户已授权继续，因此完成后直接进入 C03–C05。不得用假模型摘要或显示“交接已完成”。

## 7. C03：AI 候选生成与证据校验（第二批）

新增 `vscode-extension/src/memory/{extraction-prompt,candidate-validator,extractor}.ts`、`src/lib/session-memory/extract.ts` 和 `src/app/api/extension/v1/projects/[projectId]/session-memory/extract/route.ts`。API 只接收脱敏限额输入，复用现有 bearer 鉴权和模型配置，不持久化原始事件；禁止记录请求/响应正文到日志。

接口：

```ts
interface MemoryExtractorPort {
  extract(input: PreparedExtractionInputV1, signal: AbortSignal): Promise<unknown>;
}
generateCandidate(input, port, signal): Promise<ValidatedMemoryCandidate>;
```

模型适配由新增的窄提炼入口连接现有 `getModel()`。port 未连接时返回 `EXTRACTOR_NOT_CONFIGURED`，不能悄悄改用固定模板并说是 AI 提炼。测试注入 fake port 并注明合成；生产调用前必须先在 VS Code 展示出站预览并获用户确认。

固定 promptVersion `memory-extract-v1`，要求结构化候选，仅返回 goal/constraints/completed/remaining/decisions/rejectedApproaches/blockers/nextActions/tests。模型不能填写 scope、SHA、revision、memory ID、usage 或来源完整性；这些由可信程序填充。

每个抽取条目要有输入中实际出现的 evidenceRefs；不存在/未提供的引用拒绝。记录口头声称的测试归类 reported；只有对应结构化工具命令和 exitCode 可核对时才接受 captured。字段校验不能证明模型语义正确，需保留人工审核。

候选须区分观察事实、作者说法和推测；冲突记录并列保留，不让模型代替人确定最终方案。禁止原文里的“忽略系统规则”等文本改变输出约束。

同 inputDigest + extractorVersion 单机去重运行；取消/超时保留旧草稿，失败不自动无限重试。延迟响应只保存为独立候选，不写入当前草稿。没有服务端幂等证明时不得称“全局只收费一次”。

测试覆盖：虚构 evidenceRefs、假 captured 测试、工具结果与说法冲突、错误 JSON、字段超长、取消/超时、晚到响应、重复点击。真实模型测试必须事先具备明确出站确认与隔离数据，记录真实 usage/响应，不把 fake 算进去。

## 8. C04：可修订记忆，不覆盖人的修改（第三批）

新增 `vscode-extension/src/memory/{draft-store,draft-reducer,provenance}.ts`。

接口：`createDraft(candidate)`、`applyDraftPatch(id, expectedRevision, patch)`、`mergeCandidate(id, expectedRevision, candidate)`、`resolveEvidence(snapshotId, eventId, expectedScope)`。

1. 草稿正文沿用 `MemoryDocumentV1`；额外维护本地 envelope：revision、人工编辑标记、删除 tombstones、候选来源、inputDigest、scope。不要往现有 strict V1 塞未知字段。
2. patch 只接受白名单字段，不允许改 scope、code 和 provenance 来源。采用同一草稿粒度的跨进程锁与 expectedRevision；冲突报 `REVISION_CONFLICT`，旧版本不可变。
3. 人工文字标 origin=human；保留已有合法出处。人工无出处的文字明确为人工补充，不能伪装 extracted/captured。
4. 新候选只产生待核对 diff；已经人工改写、删除的条目不能自动复活或覆盖。匹配不确定时新增候选，不靠模糊文本相似度自动裁决；人工删除标记跟随草稿谱系而非当前数组位置。
5. resolveEvidence 返回快照中的原始事件，限长分页由调用方处理；需 exact scope 验证。缺失引用报 `EVIDENCE_UNAVAILABLE`，不能临时搜索另一个项目的相似文本。
6. 重启恢复最后已落盘版本；写入中断保留上一版。删除候选不删除原始事件。

测试：两窗口同时编辑冲突；重新提炼不覆盖人工编辑/删除；数组排序不改变条目标识；取消后旧响应不覆盖；跨 scope 出处拒绝；重启与中断恢复；包 parser 仍接受合法的 V1。

## 9. C05：交给队友的接班材料接口（第四批）

新增 `vscode-extension/src/memory/handoff-material.ts` 与 `artifact-store.ts`，生成固定版接班材料并通过用户选择的 JSON 文件手动传递，不调用平台发布 API、不建 worktree、不改变任务状态。

`buildHandoffMaterial(acceptedDraft, snapshot, expectedRevision)` 返回：指定记忆版本、scope、repositoryKeyHash/baseSha、代码限制、未解决项、失败方案、测试证据、nextActions、出处索引、完整性说明与材料 hash。拒绝未接受草稿、错 scope、revision 不一致、缺来源和篡改 snapshot。

`buildResumeContext(material, receiverFacts)` 返回结构化上下文及兼容 Codex/Claude 的纯文本说明，不作工具调用。扩展导入命令提供当前本机 facts：仓库匹配/基线验证结果、工作区干净状态、接收版本、身份权限结果。缺项返回 blockers；不会为了继续而忽略核验。核验通过后仅复制文本，不会自动启动 Agent。

与队友对接写入 `integration-contract.md`：

- worktree 负责人提供基线与实际工作区核验，接收本模块材料；本模块不决定 branch 创建或合并。
- 前端负责人接入快照统计、出站确认、候选 diff、人工编辑、出处定位；展示本模块状态，不另造判断。
- 账号/服务端负责人提供鉴权模型 port 和受权限保护的传输；秘密留服务端，不把公共代码仓库当私人对话库。

对外状态分清 `captured / prepared / candidate / accepted / material-ready`；本模块不返回 `published / downloaded / agent-started / task-completed`。不能用一个绿色成功覆盖所有阶段。

测试用两个独立临时 storageRoot 模拟材料边界，标记 `synthetic`。缺 Git 基线、dirty 未包含、LFS/submodule 限制均传递给接收核验。真实异机 A→B 演示必须等队友链路完成，另行验收。

## 10. 每批报告与验收

在 `docs/reviews/memory-core/progress.md` 逐项标记未开始/施工中/代码通过/实机通过/阻塞；C00–C05 不用一个“完成”掩盖联调缺失。

每次报告包含：改动文件、复用入口、执行命令与退出码、样例实际结果、失败与限制、下一批前置条件。报告正文不得包含原始私人会话或秘密。

每批至少在扩展目录运行：

```sh
npm test
npm run check
```

随后在仓库根目录运行 `git diff --check`，检查改动没有越过本工单边界；相关已有共享 schema 测试仍需回归。不要为通过检查格式化整仓库或提交其他人的 dirty 文件。

首批演示只需证明：冻结 1…N → 追加 N+1 → 原快照不变 → 重启能加载 → 有出处与缺口 → 准备输入能说明脱敏/遗漏且没有联网。

最终本模块演示需证明：候选提炼 → 人工删改 → 再提炼不覆盖 → 来源可核对 → 固定版本材料交给接收端。此证明仍不等于真实另一台电脑的 Agent 已成功继续。

## 11. 可直接给 Luna 的启动指令

> 先读 AGENTS.md 和本工单。按 C00–C05 完成会话记忆专项；不改任务管理、worktree、网页前端或账号系统。保留共享工作区现有改动。复用 LocalSessionStore、共享 V1 校验、只读 Git snapshot 和现有模型配置。提炼只发送用户明确确认的脱敏、限额输入；私人原文不进日志。完成后执行模块测试并写完整报告。没有真实模型或异机证据就标为未验证，不得用合成测试冒充真实接班。
