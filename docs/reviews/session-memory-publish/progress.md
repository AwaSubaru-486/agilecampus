# 会话自动记忆与一键发布施工记录

计划：[session-memory-publish-luna-plan.md](../../superpowers/plans/2026-10-02-session-memory-publish-luna-plan.md)

## M00：能力与基线

状态：PASS（能力盘点）。Codex/Claude 合成 Hook 样例映射的可执行测试随 M01 共享 schema 一并通过。真实 Hook 采集测试归 M02。

工作区基线：

- 分支：`feat/risk-aware-closure`
- HEAD：`c1b53cf7717ced0036af70c37c81680ea95b2722`
- 启动盘点时既有 unstaged/untracked 改动摘要 hash：`git diff --binary | shasum -a 256` 为 `49f9bd624bc345b5874380de20ba2097156fcd3c070c2665704a13553f1b3078`；`git status --short | shasum -a 256` 为 `d85b0e21b1a044a083c062e2048a4e1d671df02754f4cf78af3ef585cd151f30`。该摘要包含当时原有工作，不包含本次随后新增的基线文档。
- 盘点开始时有多项本地修改及未跟踪的 R03 交接实现；未覆盖。修改明细可由对应 hash/历史状态复核。
- CLI 探测命令：`codex --version`、`codex exec --help`、`claude --version`、`claude --help`、`entire --version`、`entire status --json`。
- 结果：Codex `0.153.4`；Claude Code `2.1.185`；Entire `0.11.3`，在此 repo 未启用。
- `codex exec --help` 提供 JSONL events，但仅是本项目可控制启动进程的输出方式，不证明可连接现有交互 Session。
- 官方文档确认 Codex/Claude Hooks 是适合的可安装接入接口；Codex transcript 格式不稳定。细项和链接见 [capabilities.md](capabilities.md)。
- 没有安装/信任 Hook，没有读取任何真实会话，没有调模型或访问 GitHub，不触及用户开发数据库。

本轮检查：CLI help/status 成功取得；Entire status 明确返回未配置。没有运行数据库测试、没有创建模拟任务、没有声称 Hook Extension Host 已通过。

遗留：M02 需要两种来源分别用真实、独立 Extension Host 验证接收、重启、掉线和 gap 行为。服务端私有记忆仓库凭据及 repo 配置尚未核实。

### M00 样例测试矩阵

详见 [cases.csv](cases.csv)。Codex/Claude 合成 payload 映射由 M01 共享 schema 测试覆盖；M02 的真实 Extension Host 用例仍未执行。

## M01：统一会话记忆格式与校验

状态：PASS（共享格式、TypeScript 运行时校验及其测试）；服务端基础部分施工中。

实现：`shared/session-memory/` 为扩展与根项目共享的唯一类型/schema；v1 事件、记忆文档、manifest 和 package 的校验器覆盖证据引用、哈希/大小、来源缺口、序号连续、代码 SHA、父版本上下文、父链循环和未知字段/版本拒绝。扩展加 Node SHA-256 适配入口。`vscode-extension/tsconfig.json` 的 rootDir 调到仓库根；`tsc --noEmit` 与 esbuild 已验证，运行时产物入口保持不变。

测试证据（完整明细见 [M01 代码进度](m01-code-progress.md)）：共享契约测试 7 项、旧分享包兼容测试 8 项通过；会话记忆数据库 schema 在 `.env.test` 隔离库应用成功；reset/schema/access 测试 3 文件 22 项通过；根 TypeScript 检查通过。无真实 Hook、模型 API、GitHub 请求或 transcript 正文读取。

M01 当前已实现数据库基础表、项目分享授权状态与撤销、会话列表 API、publication 记忆索引 API 和项目/任务/检查点访问校验。仍需补发布登记及远端 manifest 验证相关权限/幂等接口；publication GET 当前没有 transcript 内容。由于 Drizzle `push` 的复合 FK 与唯一约束顺序不兼容，具体取舍见 [契约当前代码边界](contract.md#当前代码边界)。

下一步：M01 当前可交付的共享契约、DB 权限索引和只读 API 基础通过；远端 publication 写入/manifest 验证属于 M04 传输闭环。本轮已进入 M02，先实现绑定与本地增量记录基础。Codex 及 Claude 的官方 Hooks 均需在真实独立 Extension Host 中测试，不能以合成 payload 测试代替。Codex transcript parser 仍属不稳定 fallback。

## M02：本地绑定与追加式事件存储（实现增量）

状态：`IN_PROGRESS`。已实现扩展本地数据层，不代表 Hook 已安装、会话正在被捕获或真实 Extension Host 已通过。

新增 `vscode-extension/src/session-memory/local-store.ts`：

- 保存本地 provider session ID 与公开 `sessionKey` 的映射，绑定路径规范化到当前本地目录；同一原生会话不能重复绑定到另一个任务。
- 解除绑定只停止后续追加，历史事件仍保留。
- 事件经共享 `parseNormalizedEventV1` 校验后逐条写成不可变 JSON 记录；exclusive writer lock 串行化多个扩展写入端，游标单独持久化。
- `sourceRef` 唯一去重，冲突内容拒绝覆盖；如果事件文件已落盘但进程在游标更新前退出，下次写入会从不可变事件记录恢复游标。
- 使用扩展 globalStorage 下的本地记录；不包含联网调用，不读取真实 Codex/Claude 会话，也未更改或信任全局 Hook 配置。

新增 `vscode-extension/tests/session-memory-local-store.test.ts` 覆盖规范化绑定、跨任务重复绑定拒绝、解除后保留历史并停止写入、重复事件幂等、相同正文的不同事件保留、同引用冲突拒绝、游标崩溃恢复、并发写入序号与损坏日志 fail-closed。

验证（2026-10-02）：

| 命令 | 结果 |
| --- | --- |
| `npm --prefix vscode-extension test -- tests/session-memory-local-store.test.ts` | 退出码 0；1 文件、7 项通过。 |
| `npm --prefix vscode-extension test` | 退出码 0；22 文件、125 项通过。 |
| `npm --prefix vscode-extension run check` | 退出码 0；扩展 TypeScript 编译与既有 esbuild 输出通过。 |
| `git diff --check` | 退出码 0。 |

官方输入契约核对：[Codex Hooks](https://developers.openai.com/codex/hooks) 提供 session ID、cwd、hook event 和 prompt/tool event 字段，并明确 Codex transcript 文件格式不是稳定接口；[Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) 提供 session ID、cwd、transcript path 与 prompt/tool event 输入。该差异说明 Hook 事件只能作为受支持的增量来源之一，不能据此宣称取得完整 transcript。尚未把 hook schema 转成可运行采集器，也未启动 Hook receiver/命令 UI；完整原文必须走已验证的 Entire/官方来源及完整性核验。

下一步：接线「关联当前会话」扩展命令和项目任务选择；新增 provider Hook 输入适配/本地快速接收器并用合成 fixture 验证；随后在用户显式启用并信任项目级 Hook 后，用独立 Extension Host 走真实接收、扩展重启、接收器不可用和 gap 恢复测试。任何 Hook 子进程都不得发送网络请求。

### 复核缺陷修正（2026-10-03）

验收时复现并修正五项故障：

- 写入互斥改用现有 `GitRefLockStore` 的 Git compare-and-swap 引用锁，进程在锁初始化期间退出不会留下阻塞写入的 ownerless 目录。
- 锁键使用存储目录的真实路径；通过符号链接访问同一个 globalStorage 时仍争用同一把锁。
- 绑定初始化可重试：如果绑定索引已写入、事件目录或游标尚未创建就中断，同一绑定重试会从事件文件补建必要状态。
- 事件游标发现已提交事件缺失或序号数量不一致时停止写入并保留缺口，不再从余下事件重新编号；读取路径与写入共用锁。
- 每次追加前核对来源索引数量；索引缺失时从不可变事件恢复后再判断重试，避免重复插入同一来源事件。

本次修复后验证：`npm --prefix vscode-extension test` 通过（22 文件、127 项）；`npm --prefix vscode-extension run check` 通过（扩展 TypeScript 编译与扩展/Webview 打包）；`git diff --check` 通过。新增的回归用例覆盖符号链接锁竞争与绑定索引写入后的中断恢复。另以独立子进程复核持锁进程被终止后的恢复，并复测已提交事件缺失和来源索引丢失时的 fail-closed/去重行为。真实 Codex/Claude Hook、Extension Host、AI 提炼和远端传输仍待 M02 以后实施与验证。
