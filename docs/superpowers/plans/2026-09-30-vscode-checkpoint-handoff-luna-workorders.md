# 个人负责模块：VS Code 工作台、检查点与人–Agent 接续

状态：E00–E08 已逐单实现并提交；E06–E08 自动检查通过，E07 的 Codex CLI context-only 流程已在一次性仓库完成真实 Agent 验证，E08 两 worktree 已由自动 Git 集成测试验证；扩展宿主 UI 仍待统一人工验收。当前用户已明确授权连续施工至仓库范围内可完成项。Entire 原生 session resume unsupported。E00–E02 真实 PAT 路径尚待验收。本文仍是专项工单，进度以 `docs/reviews/vscode-checkpoint/progress.md` 为准。
核查基线：2026-09-30，HEAD `e6723a7`。执行时从最新 HEAD 开始，禁止重置到此提交。
负责人：用户本人负责本模块，Luna 负责按单实现；共享后端由主线负责人协调。

## 0. 执行口令与停止点

读完本文及仓库 `AGENTS.md` 后，按 E00–E10 顺序推进。正常情况下每项独立验收；用户明确授权连续多单时可连续执行，最后统一报告自动检查、宿主实测和未完成项。不得自动推送、发布扩展或部署服务。

每次用户说“继续”，只执行进度文件中列出的下一单；每单独立检查、独立提交、停下来验收。用户明确授权连续多单时除外。不要创建额外任务或子 Agent；不要自动推送、发布扩展或部署服务。

某单的外部工具不可用时，记录实际失败原因。可以完成该单中不依赖该工具的代码和测试，但不能把模拟测试等同于真实 Agent 验收，也不能擅自换另一套架构。

## 1. 唯一主线

> 团队成员在 VS Code 中把一次人与 Agent 的工作保存为可追溯检查点；经人工选择分享后，队友能够取得所需材料，在匹配的代码版本上接续，或从共同起点分别探索方案，最后回到平台人工验收。

网页负责项目、分工、权限、版本目标、方案比较和验收。扩展负责本地仓库、真实 session 的接入、检查点、接续前检查和执行回执。不要另造一个聊天产品。

名词必须区分：

| 对象 | 含义 | 不能冒充 |
| --- | --- | --- |
| Task | 已有任务及其交接要求 | session 或 Git branch |
| Context Pack | 已有的冻结资料包 | 本机工作目录备份 |
| Checkpoint | 一次冻结的工作交接记录，绑定代码基线与已选材料 | AI 内部状态、运行中进程快照 |
| Session | 来源工具真实的会话记录 | 平台网页聊天天然等于开发 Agent 会话 |
| Attempt | 从检查点出发的一次独立方案尝试 | 默认覆盖或重开原任务 |
| 接续 | 原生恢复，或携带上下文启动新会话；两者明确区分 | “打开网页”或“复制提示词”就表示 Agent 已运行 |

本模块所说“版本迭代”先关联已有 `projectId/taskId/milestoneId`。Git SHA 是代码版本；milestone 是里程碑，不改名冒充正式 Release。第一版不另造 release 表。

## 2. 已核实的仓库事实

先读以下文件，不要只按标题猜功能：

| 文件 | 当前事实 |
| --- | --- |
| `vscode-extension/src/extension.ts` | 注册 Webview 和少量命令 |
| `vscode-extension/src/agilecampus/api-client.ts` | 已读取现有项目、任务详情 GET API；无检查点/交接写 API |
| `vscode-extension/src/views/project-view-provider.ts` | 已显示项目任务和详情，网页跳转含 projectId/taskId；Agent 工作入口仍只跳网页 |
| `vscode-extension/src/auth/github-session.ts` | GitHub 登录辅助函数；不是 AgileCampus 身份认证 |
| `vscode-extension/src/github/github-client.ts` | 仓库读取封装，不是本机 Git 或 session 管理 |
| `vscode-extension/webview/src/App.tsx` | 项目任务列表和详情 Webview；无检查点保存 UI |
| `src/lib/agent/conversation.ts` | 已有共享/私密会话和从消息边界 fork |
| `src/lib/context-pack.ts` | 已有上下文包预览、创建、冻结、权限检查 |
| `src/lib/task.ts` | 已有契约版本、认领、提交、人工验收 |
| `src/lib/agent-run.ts` | Agent 上报记录；不是本地 Agent 启动器 |
| `THIRD_PARTY_NOTICES.md` | Lody 会话树规则适配；没有移植 Daemon/ACP/worktree 内核 |

本文编写时以下文件是上一段施工留下的未提交改动：

```text
src/lib/approval.ts
src/lib/collaboration-console.ts
tests/collaboration-console.test.ts
```

保留、不修改、不一起提交。执行时用 git status 再查当前状态；不要假设它们已经合并，也不要将它们当插件可直接调用的 HTTP 接口。

## 3. 负责范围与禁止事项

Luna 可以修改：

```text
vscode-extension/**
docs/reviews/vscode-checkpoint/**
docs/superpowers/plans/2026-09-30-vscode-checkpoint-handoff-luna-workorders.md
```

需要共享后端支持时，只先写 `docs/reviews/vscode-checkpoint/backend-contract.md`，通知用户/主线负责人。不得顺手修改 `src/db/schema.ts`、`src/lib/task.ts`、`src/lib/agent/**`、`src/app/api/**` 或网页 UI。本专项工单不转移 Antigravity/主线文件所有权。

禁止：

- 改写任务状态机、跳过证据直接置 done、用 human token 伪装 Agent 上报。
- 在实际项目上自动安装 Git hooks、开启 session 自动推送、运行测试恢复命令。
- 自动扫描整个 home 下的所有聊天；默认上传完整 session、代码、工具日志、环境变量。
- 使用 shell 拼接分支名/路径/命令；从导入包执行任意命令或 npm scripts。
- 自动 stash/reset/checkout、清理用户 worktree，或覆盖未提交修改。
- 将 token 放 settings.json、Webview、日志、Git 或导出包。
- 为“看起来完整”加入假数据、假的 running、假的测试通过、假的原生恢复。

## 4. 技术路线与第三方复用

### 第一条路线（默认）

现有平台 + VS Code Extension Host + Entire CLI 适配器 + Git/simple-git。

- Entire 候选来源：<https://github.com/entireio/cli>，MIT。负责采集和读取支持工具的 session/checkpoint。
- Git 操作封装候选：<https://github.com/steveukx/git-js>，MIT。调用真实 Git，不自己实现分支合并算法。
- Lody：<https://github.com/LodyAI/Lody>，Apache-2.0。重点参考 session fork、worktree 隔离、共享权限边界；第二条执行后端路线，不与 Entire 同时整套引入。
- ACP SDK：<https://github.com/agentclientprotocol/typescript-sdk>，Apache-2.0。后续直接驱动 Agent 的候选；第一版不因“以后用得上”而预装。

研究时看到的上游 main：Entire `620afd5f9a83b818a0827ba3805bd32f3945b481`，Lody `e10e5226991595c52babbeb742b85bb80c9daa55`。这些是研究快照，不作为安装指令。正式接入必须记录实际 release/tag、commit、许可证和工具版本，不能依赖浮动 latest。不要把主分支源码接口当发布版稳定接口。

注意：Entire 研究时文档的 `strategy_options.push_sessions` 默认 true。E03 在一次性测试仓库核实关闭方法及是否实际生效；还要核实遥测、摘要服务和外部请求。未确认之前禁止真实仓库 enable 或上传记录。

原生 session 恢复与跨工具上下文接续分别验收。不能假设工具 A 的 session 文件能被工具 B 原样恢复。不能承诺 Codex 桌面、CLI、Claude 等任意来源都支持；以实际选择的一种工具、精确版本验证。

复用时保留许可证和版权通知。新增依赖只在 `vscode-extension/package.json` 和该目录 lockfile 中；不要修改根包和框架。新增 `vscode-extension/THIRD_PARTY_NOTICES.md` 记录包/版本/用途/许可证/改编文件。复制源码还要列原始文件与 commit。

## 5. 已有 HTTP 接口（只能按真实返回读取）

认证：`Authorization: Bearer <AgileCampus Personal API Token>`，复用 `/settings/tokens` 手动生成的令牌。它当前代表用户权限，不是细粒度 read-only scope；插件只读不等于令牌本身只读。GitHub token 不能替代它。

| 接口 | 当前返回/用途 |
| --- | --- |
| GET `/api/agent/projects` | `{projects:[{id,name,status,teamId,teamName,taskTotal,doneCount}]}` |
| GET `/api/agent/projects/:projectId` | 项目详情，包含 myRole、milestones、byStatus |
| GET `/api/agent/projects/:projectId/tasks` | `{tasks:[...]}`；支持 status、assigneeId、dueBefore；当前不分页 |
| GET `/api/agent/tasks/:taskId` | 单任务详情；读取后再次校验 projectId 与选定项目一致 |

当前没有供插件确定令牌 userId 的已确认 `/me` 接口。因此 E02 标题用“项目任务”，不凭本机 Git 用户/email 判断“我的任务”。需要“我的任务”时在 E09 提交身份接口需求。

目前不要接 `/api/agent/tasks/complete`：它的实现走 updateTask，不能仅凭名字认定与 submitTask 的证据校验完全一致。认领、上报阻塞、提交、验收第一版明确跳回对应网页，按钮命名为“在网页中…”，不是伪造插件写入成功。

服务地址默认 localhost:3000。多人电脑上的 localhost 各指自己，不能假装两人天然访问同一数据库。跨人演示前明确同一服务地址和网络可达性；不因此擅自部署云服务。

## 6. 本地数据契约（新建，不是已有实现）

放在 `vscode-extension/src/checkpoints/types.ts` 和运行时 schema 中。host 必须验证导入数据，不能只用 TypeScript 类型断言。

```ts
type WorkspaceBinding = {
  serverOrigin: string;
  projectId: string;
  workspaceUri: string;
  repositoryKey: string; // 不含账号凭据；无 remote 时是 local-only ID
};

type WorkCheckpoint = {
  schemaVersion: 1;
  id: string; // UUID
  parentCheckpointId: string | null;
  projectId: string;
  taskId: string;
  milestoneId: string | null;
  capturedAt: string; // ISO UTC
  handoffVersion: number;
  taskUpdatedAt: string;
  repository: {
    key: string;
    headSha: string;
    branch: string | null; // detached HEAD 合法
    dirty: boolean;
    dirtyPolicy: 'clean-only' | 'excluded';
  };
  session: {
    provider: string;
    providerVersion: string;
    sessionId: string | null;
    checkpointId: string | null;
    captureMode: 'native' | 'context-only';
  };
  handoff: {
    goal: string;
    completed: string[];
    remaining: string[];
    blocker: string | null;
    rejectedApproaches: string[];
    nextAction: string;
  };
  tests: Array<{
    command: string;
    exitCode: number | null;
    recordedAt: string;
    source: 'captured' | 'user-reported';
  }>;
  artifacts: Array<{
    id: string;
    kind: 'transcript' | 'context';
    relativePath: string;
    byteLength: number;
    sha256: string;
  }>;
};
```

字段为空时诚实标空。摘要仅来自可读材料和用户编辑，不要求或记录模型隐藏思维链。没有证据的测试结果必须 user-reported，不是自动验证成功。

存储：host 的 `context.globalStorageUri` 下按 server/project/checkpoint ID 分目录；路径不传 Webview、不进分享包。manifest 冻结后不原地改写；修改产生新 UUID，并保留 parentCheckpointId。临时文件写完、校验后原子 rename；失败不能出现半个有效记录。

包完整性不等于作者认证。SHA-256 只能校验内容是否一致；导入数据不授予任何项目权限。共享身份与权限由 E09 后端确认。

## 7. 接续状态（不得和 Task status 混用）

```text
imported → checking → ready → launching → running → finished / failed
                    ↘ blocked
launching → awaiting_confirmation（没有可靠执行回执）
```

- ready：仓库/提交/必需材料已验证，任务归属与契约版本在线检查通过。
- blocked：缺少提交、原生材料不可取得、任务已改派或版本变更等；显示具体原因。
- launching：用户确认后正在调用适配器；重复点击不产生第二个进程。
- running：收到真实 session ID 或可靠运行回执。仅打开终端不能置 running。
- 网络断开：显示 stale/offline 和最后更新时间；不凭断网把远端任务改为 failed。
- “携带上下文新建会话”与“原生恢复”必须分别标识；前者不能宣称恢复了原进程。

权限边界：E01–E08 的本地试验不能声称已完成“平台正式分配给我”。项目可读不代表允许替某个任务执行或上报；当前用户身份/接手授权在 E09 接入前，E07 仅允许用户确认的本地尝试，不更改共享任务、不伪造接手者身份。正式跨人分配与执行闭环以第四轮验收为准。

## 8. 工单清单

### E00：建立边界与可重复开发环境

修改：`vscode-extension/README.md`、该目录 `.vscode/launch.json`/`tasks.json`（缺失才建）、`docs/reviews/vscode-checkpoint/progress.md`、`capabilities.md`。

1. 记录 git status、HEAD、Node/npm/VS Code 版本，保护已有改动。
2. 按已有 lockfile 安装并执行 `npm --prefix vscode-extension ci`、`npm --prefix vscode-extension run check`。不要升级整套依赖。
3. 验证 F5 的 Extension Development Host 配置实际能找到 dist/extension.js；不把文档里“按 F5”当已有 launch 配置。
4. 检查 `contributes.views`：现有 provider 是 WebviewViewProvider，声明须带正确的 `type: "webview"`，否则修复 manifest。校验 JS/CSS 都生成并能加载。
5. 保留现有 webview 骨架；文案改为“项目任务”“上报阻塞”，移除营销副标题。

验收：扩展正常激活、侧栏可打开；无连接时不假装有任务。没有可运行的 VS Code 时记录“编译通过、宿主未验证”，不能说 F5 成功。

提交：`chore(vscode): establish checkpoint workbench development baseline`。

### E01：真实身份与本地项目绑定

修改/新增：`src/auth/token-store.ts`、`src/agilecampus/api-client.ts`、`src/workspace/binding-store.ts`、`src/commands/connect.ts`、`src/extension.ts`、`package.json`、对应测试，均在扩展目录。

1. 注册 `agilecampus.connect`、`agilecampus.disconnect`、`agilecampus.selectProject`。
2. 通过 password input 输入已有 PAT，存 VS Code SecretStorage；按服务 origin 与 workspace URI 隔离，避免一个工作区断开影响另一个工作区。日志只记录状态码和端点路径，不能记录 Authorization/body。
3. 校验 URL：只接受 http/https；拒绝 URL username/password、query、fragment。明文 HTTP 仅允许 loopback；其他地址要求 HTTPS。
4. fetch 使用 timeout + AbortController、`redirect: "error"`；禁止把 token 随重定向发给另一域。403 不当空列表，401 清掉登录态但不删本地检查点。
5. 调已有 GET projects 验证身份并让用户选项目。GitHub 登录在此阶段不调用。
6. 多根 workspace 必须先选工作目录；绑定保存 workspaceState，不写进仓库 settings。没有 Git 允许看任务，禁用检查点/分支，不假装读到代码。
7. 切换 origin、项目、workspace 时撤销旧请求；旧结果不得覆盖新项目。断开清凭据和 UI 内存，不删除用户历史文件。

测试：401/403/500、超时、跨域 redirect、恶意 URL、服务与 workspace 令牌隔离、两个目录绑定隔离、切换请求竞态、Webview payload 中无令牌。

提交：`feat(vscode): connect authenticated project workspace`。

### E02：显示真实任务并正确跳转（第一轮到此停）

修改：api-client.ts、types.ts、project-view-provider.ts、webview/src/App.tsx、commands/open-web.ts、commands/continue-ai.ts 及测试。

1. 读取选定项目详情和 tasks；host 映射最小 DTO，Webview 不直接请求服务端。
2. 项目任务显示标题、状态、负责人、截止日；点击读取真实详情：交接目标、完成条件、证据要求。没有字段显示未填写，不生成占位任务。
3. 明确区分 loading/empty/error/offline；失败保留旧数据时加“上次更新于…”，不可将旧数据显示成最新。
4. 修正深链接：`/projects/{projectId}?space=work&task={taskId}`；会话入口使用 studio。没有 projectId 时只打开项目列表，不能拼错误路径。
5. 旧 continueAiWork 命令 ID 可保留兼容，但标题先叫“在网页中查看 Agent 工作”。原生接续未实现前不叫“恢复执行”。
6. 新建 host/webview 双向 runtime message 校验；拒绝未知 command、任意 URL、任意路径和任意 shell 字符串。持有正确项目 ID 不等于有执行权限。
7. 使用 VS Code 原生主题变量和普通列表，不做三块巨型彩色卡片、不加标题下解释性标语。保留错误、权限及危险操作说明。

测试：真实返回形状的脱敏 fixtures、空任务、长标题、未知状态、403、恶意 postMessage、错误项目深链、切换项目旧响应。

手工验收：用户输入 PAT → 选项目 → 看到数据库中真实任务 → 网页改标题后手动刷新可见 → 打开同一任务的正确网页。测试完成后停止，等用户验收。

提交：`feat(vscode): display real project tasks and safe navigation`。

### E03：独立验证 Entire，不碰真实工作仓库

新增：`src/adapters/session-adapter.ts`、`src/adapters/entire-adapter.ts`、`docs/reviews/vscode-checkpoint/entire-spike.md`、fixtures 和测试。

1. 读取已安装工具的 --help/--version，未安装时向用户说明需安装什么及影响；只选一个用户实际使用且工具明确支持的 Agent。
2. 在 `mktemp -d` 的一次性 Git 仓库做验证；不得 enable 当前 agilecampus 仓库。不复制用户 .env、历史聊天、登录资料到试验仓库。
3. 记录实际安装版本/下载源/许可证；验证自动 session push 被关闭，以及无未经同意的云端摘要或遥测。
4. 做最小真实会话：修改一个测试文件 → 形成检查点 → 枚举/读取 → 结束会话 → 验证支持的接续方式。原生恢复可能 checkout 分支，必须限定在临时工作目录。
5. 若命令无 JSON 输出或依赖内部不稳定目录，原样记录，不凭空编造 CLI 命令。适配器只调用核实过的接口，未知版本 fail closed。
6. 在 capabilities.md 逐项标 `verified/unsupported/unverified`：capture、read、export、nativeResume、crossMachineResume、fork、cancel。缺一项不代表其他项失败，但不能全部置 true。

适配器接口固定为 inspectCapabilities、listSessions、capture、readCheckpoint、prepareResume。每项返回结构化成功或错误；缺能力返回 unsupported。实际启动使用另一项 launch，必须经过 E07 人工确认，prepareResume 不得启动进程。

验收：真实工具记录+脱敏 fixtures；只写 mock 时此单不能完成。未证明跨机器恢复时只能标 unverified，先继续做 context-only 的本地包，不伪造原生兼容。

提交：`feat(vscode): add verified session capture adapter`。

### E04：代码状态与本地检查点

新增：`src/git/repository-service.ts`、`src/checkpoints/{types,schema,store,capture}.ts`、`src/commands/save-checkpoint.ts` 及测试。

1. 选择并锁定兼容 Extension Host Node 版本的 simple-git 发布版；不将 raw 任意命令暴露给 Webview。所有操作限定可信 workspace 的 Git 根目录。
2. 读 realpath、HEAD、branch、remote、dirty；清除 remote 中凭据。未提交代码/未跟踪文件不自动 stage/commit。
3. 第一版代码恢复只支持 clean-only。dirty 时默认阻止“可恢复代码检查点”；用户可以明确选择“仅保存交接记录，未提交修改不包含”，则 dirtyPolicy=excluded，之后不能显示可无损恢复。子模块/LFS 等材料未验证时标 blocked。
4. 调 E03 adapter 读取用户选中的单条 session，不扫描所有会话。材料不足时只允许 context-only，明确说明范围。
5. 用户预览并编辑 handoff，确认后保存冻结 manifest。保存前后再次读取 HEAD/dirty；有变化则取消本次捕获，请用户重试，不形成假一致检查点。
6. 不自动执行 tests.command；只记录有出处的结果。禁用无来源的绿色成功图标。
7. 保存后侧栏能查看目标、卡点、SHA、记录时间、恢复方式；不把原始会话全部塞入列表 DTO。

测试：无 Git、unborn HEAD、detached HEAD、路径含空格、凭据 remote、dirty、捕获竞态、磁盘失败、重复 ID、哈希校验失败、没有 session 的降级。

提交：`feat(vscode): save immutable local work checkpoints`。

### E05：人工导出与导入（先不做云上传）

新增：`src/checkpoints/{export,import,share-policy}.ts`、对应命令和测试。

1. 第一版使用单个版本化 JSON 交接包：`{format:"agilecampus-checkpoint",version:1,manifest,artifacts:[{id,encoding:"base64",data}]}`，不引入 zip 解压。原始合计上限 10 MiB、包文件上限 15 MiB、单 artifact 5 MiB、最多 20 项；超限拒绝，不静默截断。
2. 默认只选 handoff/context；原始 transcript 必须单独勾选且可预览。不包括绝对路径、token、.env、SSH keys、凭据 remote、节点依赖目录。
3. 密钥模式检查只是告警，不能声称能识别所有秘密。命中明显凭据阻止导出，用户重新选择/编辑生成新的分享包；不偷偷修改原检查点。分享包另用新 ID，并记录来源 ID，避免同 ID 不同内容。
4. 原生恢复材料若被裁剪/脱敏导致格式不完整，降级 context-only，不再标 native。
5. 导入先验证 schema/version/大小/校验和/重复 ID，再在新目录落盘。拒绝 ../、绝对路径、反斜杠逃逸、symlink 和重复资源映射；文件名由 host 生成，不采用外部路径执行任何命令。
6. 包中 projectId/taskId 仅是待验证声明；在线查归属。当前没有成员验证能力时允许本地查看，不允许发布/执行。repository key 不匹配禁止自动接续。
7. 原生跨机器恢复若依赖 Entire 的其他 Git 元数据，不要声称仅发这个 JSON 就够；列出缺失材料并阻止 nativeResume。

验收：A 导出明确选中材料 → B 本地导入并看见同一 SHA 和交接记录；退出重开仍可读；恶意包不落盘、不执行、不发送网络请求。

提交：`feat(vscode): export and import reviewed checkpoint packages`。

### E06：接续前检查与接续材料

新增：`src/handoff/{preflight,resume-plan}.ts`、`src/commands/prepare-handoff.ts` 和测试。

preflight 顺序锁定：

1. workspace trusted、项目可访问、任务属于项目；
2. 当前交接契约版本和任务 updatedAt 与检查点比较；变化时展示差异并要求重新确认，不悄悄覆盖要求；
3. repository key 一致、base SHA 可在本地找到；不存在时提示用户取得代码，不自动联网 clone/fetch；
4. 必需 artifact 完整、恢复方式受支持、dirtyPolicy 允许；
5. 本地待使用工作区状态安全；不在有未提交修改的目录中自动恢复；
6. 准备人工审阅的接续计划，列目标目录、材料范围、恢复方式、预计进程和权限。

这里仅生成计划，不启动进程，不改 Task status。不将上次会话里的 shell 指令当作可直接执行命令。

测试：任务被删除/改派、权限失效、契约变更、缺 SHA、同名不同仓库、目录 dirty、材料不完整、未知 adapter 版本。

提交：`feat(vscode): validate checkpoint handoff preconditions`。

### E07：真实启动并记录回执

**前置门：E03R 精确原生恢复实验通过，或本次明确只交付 context-only 新会话。** `nativeResume` 能力必须与 `prepareResume` 实际可返回行为一致。不能仅因 Entire CLI 在单次临时实验能恢复 latest session，就将精确 checkpoint restore 标为 verified。

新增：`src/adapters/process-runner.ts`、`src/handoff/launch.ts`、`src/commands/resume-checkpoint.ts` 和测试。

1. 仅从 E06 通过的计划发起；用户确认后重新检查关键状态，防止计划生成后目录已变。
2. adapter 使用已核验的程序和 argv，通过 execFile/spawn、shell=false；cwd 固定，不接受导入包提供的命令。进程结束、超时、取消要区分；无 cancel 能力不得显示停止成功。
3. 用户可选“原生恢复”（仅 verified）或“携带上下文新建会话”。后者传入 handoff、必要材料和代码基线，明确不是恢复原生 session。
4. 创建本地 attempt 记录：UUID、checkpointId、模式、开始时间、workdir 本地引用、真实 providerSessionId、状态、退出信息。没有可靠回执显示 awaiting_confirmation，不伪造 running。
5. 点击两次只发起一次，同一 attempt 不允许并发启动。重启扩展后仅 PID 存在不够证明原 Agent 还在，无法核实时标 unknown 并提示核对。
6. 接续会话产生新代码后记录实际提交和测试证据；不自动推送、不自动验收、不自动替用户提交所有文件。

验收：真实 Agent 从检查点材料继续修改一个测试文件，并能追到原检查点；另测错误码、无认证、用户取消、超时、重复点击。先在临时仓库执行。

提交：`feat(vscode): launch checkpoint continuations with execution receipts`。

#### E03R：精确恢复 checkpoint 的日志保护实验（E07 前置门）

在一次性仓库验证 Entire 0.11.3 对选中旧 checkpoint 的恢复语义。测试覆盖：保存 C1 后在同一 session 继续但不新建 checkpoint；本机存在 C2 后选择 C1；恢复中断或失败。只有能精确恢复到所选 checkpoint、先备份本机更新日志并能回滚、且不会把相邻 session 混入时，才将 adapter 的 `nativeResume`/`prepareResume` 标为 verified。若 CLI 无安全方式，明确保持 unsupported，按 E07 的 context-only 模式完成可用闭环；不得默默加 `--force` 或丢弃更新日志。

### E08：从同一检查点并行探索

新增：`src/git/worktree-service.ts`、`src/attempts/store.ts`、`src/commands/fork-attempt.ts` 和测试。

1. 只从 clean-only、已验证材料的检查点 fork；显式以该 checkpoint.headSha 为基线，不用当前分支 HEAD 偷换起点。
2. 每个 attempt 有独立 UUID/分支/worktree；分支使用 host 生成的 `agilecampus/attempt-<短UUID>`，冲突时生成新名称，不覆盖用户分支。
3. 同仓库创建使用本地互斥锁；worktree 目录在用户明确选择的专用父目录，realpath 校验，不创建在另一尝试内部。不自动执行 worktree 的 install/setup 脚本。
4. 两个尝试继承共同的 checkpointId，不复制或覆盖原始目录的 dirty 文件。Lody 参考行为是新 worktree 不自动带走未提交修改，本模块也不假装它们已继承。
5. 比较只展示真实 commit/diff/用户确认的结果和有出处的测试；不让模型编造“优于方案 B”。采纳第一版明确打开网页/PR人工处理，不自动 merge。
6. 清理必须显式选择目标且确认；dirty worktree 不自动删除。保留审计记录。

验收：A/B 同一起点、不同目录，各自修改同名文件互不影响；能比较真实结果。worktree 不是操作系统沙箱，Agent 仍可能访问其他路径，不能向用户宣传绝对隔离。

提交：`feat(vscode): isolate parallel checkpoint attempts`。

### E09：共享后端契约评审（协作门，不得独自改数据库）

产出 `docs/reviews/vscode-checkpoint/backend-contract.md`，交主线负责人确认后再分后端工单。以下是需求，不是已有 API：

- 当前用户身份：返回 actorId 和团队角色；不靠本地 Git 身份映射。
- 检查点索引：服务器确认 project/task 归属、创建者、可见范围、材料摘要、基线 SHA、来源/父关系；默认不存原始 session。创建者由认证身份决定，不信任请求 body。
- 交接：指定接手成员与任务；服务端验证成员/角色/当前任务版本，以幂等键和预期版本创建，不覆盖其他人的新交接。
- 接收/拒绝/撤回：条件状态转换；是否允许原负责人继续同一执行分支必须明确。并行探索必须显式创建两个 Attempt，而不是让两人误写同一分支。
- 执行回执：actor、真实 session ID、checkpointId、attemptId、代码证据；不能据客户端上报自行授予验收权限。
- 取材料：B 需有授权且拿到真实 artifact；只有 A 的本地路径并不能交接。V1 可以手工 JSON 包传递，服务器只保存其哈希和索引。若要自动传输，必须另选受控存储或经授权的远端方式，不能偷偷把公网仓库当附件库。
- 增量查询/事件订阅、撤权、删除/保留策略、大小限制、日志脱敏、审计与幂等。

建议将待设计接口放 `/api/extension/...` 命名空间，具体方法/请求/响应/状态码/权限矩阵在 backend-contract 中评审冻结后才实现；禁止 Luna 在插件里预埋假设这些接口已存在的“成功”响应。

没有后端契约签收时，E09 只完成文档，E10 的共享写同步不能开工；E01–E08 的已授权本地能力仍可以交付。

### E10：同步与发布验收

先在已有 API 上做自动刷新，再在 E09 后端真正提供能力后接共享事件：

1. V1 显式叫“自动刷新”，侧栏可见时每 15 秒读取、隐藏暂停，手动刷新立即；前次未结束不叠请求。
2. 超时失败退避 15/30/60 秒，带有限抖动，成功复位；401 停止重试并要求重连，403 显示权限变化；切换绑定/注销/卸载必须 dispose 定时器和进程监听。
3. GET 可以重试。发布检查点/接收交接等写操作在后端有幂等机制前禁止自动重试。离线允许保存本地草稿，不把它显示为已分配给队友。
4. 共享写请求保存基线版本；409 要用户处理，不静默最后写入覆盖。令牌变更或用户切换时不重放旧用户的待发送操作。
5. 真正推送/SSE/WebSocket 只在后端提供事件 ID、鉴权、断线补拉后接；不能把 15 秒轮询宣传为实时推送。
6. VSIX 打包只做本地验收；不发布商店。增加 README 的安装、连接、导出、接续、失败处理和卸载后数据位置说明。

最终演示：两台设备或两套明确隔离的开发环境、两个成员身份、同一个服务；A 保存 → 明确分享材料并分配 → B 取得且验证 → B 真正执行 → A/B 各分出方案 → 比较证据 → 网页人工验收。任一环没有真实验证就单列缺口。

## 9. 测试与产物规则

E00 新增扩展独立测试脚本和配置，测试不要依赖根目录 tests/setup.ts 或生产数据库。复用根项目现有 Vitest 版本作为参考，在扩展目录锁定版本。`src/**` 纯模块做单元测试，VS Code API 通过可替换接口做契约测试；Git 集成测试使用临时目录。mock API/Agent 的测试必须标清 mock，不能代替真实端到端。

每单最低命令：

```bash
npm --prefix vscode-extension run check
npm --prefix vscode-extension test
git diff --check
git status --short
```

新增 test 脚本前不声称命令已存在。修改 root 配置/业务不是本专项授权范围；最终集成回主线再由负责人运行根 lint/build/相关领域测试。

每次写进 `docs/reviews/vscode-checkpoint/progress.md`：

```text
工单 ID / 状态：未开始、进行中、代码完成待实测、验收通过、阻塞
起点 HEAD：
改动文件：
新增依赖与精确版本：
自动测试命令/退出码：
真实 VS Code / Agent / 跨机器验证：分别写通过、失败、未验证
证明材料：脱敏日志/实际存在的截图/commit
已知限制：
下一单：
本次停止点：
```

代码提交仅 add 本单文件；不提交 credentials、session 原文、测试 worktree、dist 或 node_modules。不修改或包含其他执行者未提交改动。用户未要求推送时不 push。

## 10. 用户验收清单

- 第一轮（E00–02）：我能在 VS Code 连接真实项目、看真实任务、打开正确页面；不是 demo 数据。
- 第二轮（E03–05）：我能保存检查点并人工导出，队友能导入看到交接信息；未分享的隐私不会被自动带走。
- 第三轮（E06–08）：我能核对代码基线后让真实 Agent 接续；两种方案各有独立目录和来源，任务不被偷偷标完成。
- 第四轮（E09–10）：网页与插件有明确一致的任务/交接状态；团队材料可取得；断网、重试、权限撤销不会制造假成功或重复写入。

不以页面漂亮或按钮齐全替代验收。完成标准是：另一位成员真的拿到了经过授权的材料，在可验证的代码状态上继续工作，并产出可追溯结果。
