# 会话记录与接班体验施工记录

更新时间：2026-10-03

## 基线

- 施工起点：`6fd425893a33428c268ce54072800dc373a2f796`
- 起点已有改动：`AGENTS.md`、`README.md`、`docs/superpowers/plans/2026-10-02-session-memory-publish-luna-plan.md` 已修改；`docs/superpowers/plans/2026-10-03-session-memory-ux-luna-plan.md` 未跟踪。以上不是本轮代码施工造成，均保留。
- 起点相关测试：VS Code 扩展 `session-memory-local-store` 与 `project-view-provider` 两组共 11 项通过。
- 真实 VS Code Extension Host 截图：尚未采集。本记录不以合成夹具代替真实 IDE 验收。

## 当前发现

1. `EntireAdapter` 能在支持的 Entire CLI 工作区枚举 Codex CLI session；该能力不覆盖任意 Codex Desktop/IDE 对话。
2. `LocalSessionStore` 已提供本地绑定、不可变事件追加、来源去重和缺口保护，但原先没有分页读取及 UI 接线。
3. 扩展此前未消费 Codex Hook 输入，因此“绑定”本身不能证明正在采集。
4. Codex Hook 可提供 session、workspace、turn、用户 prompt、工具输入/输出与停止时最后一条助手答复；transcript 文件格式不稳定，不作为解析接口。
5. Claude Code 目前没有本地实现或真实 Extension Host 验证。本批不把 Codex 适配描述为 Claude 支持。

## H00–H02 进度

| 工单 | 状态 | 证据 |
| --- | --- | --- |
| H00 入口与状态基线 | 文档/代码基线完成；真实 UI 目视验收待补 | `interaction-contract.md`、`cases.md`、`evidence/README.md` |
| H01 关联会话与侧栏状态 | 实现及自动化测试完成；真实 UI 目视验收待补 | `ProjectViewProvider`、`App.tsx`、扩展测试；143 项通过 |
| H02 Codex Hook 与分页记录 | 实现、合成事件测试及打包完成；真实采集待用户动作 | Codex adapter/config、记录面板、Hook bundle；真实 `/hooks` 审查/信任未执行 |

## 本批施工结果

- 任务上下文中可列出当前工作区的 Codex CLI session，由 VS Code 原生 Quick Pick 选择；原生 session ID 不进入 Webview。
- 增加 Codex `UserPromptSubmit`、`PostToolUse`、`Stop` 与 `SubagentStop` 本机 Hook adapter。仅匹配本机绑定的 session ID 和工作区路径后保存；不解析 `transcript_path`，没有上传路径。
- Hook 配置由用户在扩展确认后写入；扩展随后打开配置，用户仍须在 Codex `/hooks` 核查并信任。Hook 是用户级配置，会被每个 Codex 对应事件调用，但非绑定 session 不会落盘。
- 事件正文过大时明确写入 gap；日志超限或损坏时错误退出，不显示为正常记录。记录面板按 50 条读取，较早页前插时保留阅读位置，新事件不强制滚动。
- Hook 可通过侧栏禁用按钮或命令面板恢复；只移除 AgileCampus 管理的处理器，不删历史、不改其他 Hook。未安装时禁用是明确无变化反馈。
- Webview 不展示真实 Hook payload、API 凭据或原生 session ID。隔离 Extension Host 已启动，但当前桌面自动化绑定在用户已有 VS Code 窗口，未对开发窗口做视觉检查；不以 AX 树/合成数据冒充截图验收。

## 自动化验证

在 `vscode-extension/` 执行：

| 命令 | 结果 |
| --- | --- |
| `npm test` | 26 个测试文件、143 项测试通过 |
| `npm run check` | TypeScript 检查、扩展/Hook/Webview 构建通过 |
| `git diff --check` | 通过 |

测试只证明合成 Hook payload、本地存储和消息流程。它不证明 Codex 已信任处理器，也不证明真实提示词已经落盘。

## 复审问题修复（2026-10-03）

针对复审提出的四项缺陷，本轮已完成代码修复：

1. Hook 安装状态现在按当前 VS Code profile 的脚本路径和扩展存储目录精确核对；发现 AgileCampus 管理的旧路径时会更新处理器命令，并避免把别的 profile 配置误报为当前 profile 已安装。
2. 会话摘要会显式标记采集缺口；Hook 写入失败会尝试保存本地失败状态，并在同一来源重试成功后清除。侧栏显示“部分记录”状态及可读错误信息，不把不完整会话显示成正常记录。
3. 工具事件大小限制按最终写入正文计算（工具名与输入合并后），避免输入刚好达到上限却因追加工具名而触发异常；缺失或超限内容保留为明确 gap。
4. 较早页读取失败后会重新启用“加载更早记录”按钮，允许重试。

本轮 `npm run check`（TypeScript 检查及扩展、Hook、Webview 构建）通过，`git diff --check` 通过。前述 143 项测试是在本轮复审修复之前通过的；本轮未重跑测试，因此上述修复尚未由测试套件回归验证。真实 VS Code UI 与 Codex Hook 信任/采集仍需用户环境验收。

## 二次复审修复（2026-10-03）

- Hook 写入失败按来源事件分别保存；恢复某个来源只清除该来源的失败状态，其他失败仍保留并在侧栏显示。旧版单条失败状态文件仍可读取，并在对应来源恢复后清除。
- 超过 Hook 输入 8 MiB 限制时，在本机保存独立故障提示；VS Code 侧栏显示时间与原因，用户确认处理后可逐条清除。此类输入超限无法可靠归属具体会话，因此提示按 Hook 全局展示。
- 更新超大工具输出测试中的旧文案断言。本轮没有新增或运行测试；复审时上一版套件结果为 142 项通过、1 项因旧断言失败。真实 VS Code 与 Codex Hook 实机流程仍未验证。

## 侧栏状态复审修复（2026-10-03）

- Hook 全局故障提示已独立于任务状态加载和轮询；打开扩展后即使未选任务也能看到，可逐条标记处理。
- Hook 提示读取增加请求代次校验；较早的异步响应不能覆盖之后的清除结果。
- `npm run check` 与 `git diff --check` 通过。本轮未运行测试；143 项全通过的结果来自上一轮代码。仍待真实 VS Code Extension Host / Codex Hook 操作验收。

## 验收结论

本批实现与已执行的检查完成，停在用户可检查的阶段。复审修复还需回归测试；真实 UI 目视验收、真实 Codex Hook 信任及实际 session 采集均待用户确认后完成；当前不能宣称端到端实机通过。未对真实 Codex `hooks.json` 执行安装/信任，也未读取私人对话。
