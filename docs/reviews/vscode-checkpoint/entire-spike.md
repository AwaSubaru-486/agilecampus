# Entire CLI 真实验证记录（E03）

验证日期：2026-10-01
验证范围：Entire CLI + Codex CLI；只在一次性临时 Git 仓库进行。本文不包含真实 session ID、原始 prompt、transcript 或用户仓库路径。

## 环境与安装来源

- Entire CLI：`0.11.3`，通过官方 Homebrew tap `entireio/tap/entire` 安装；cask 下载地址指向该版本的 GitHub release 二进制包。许可证：MIT。参考：[v0.11.3 release](https://github.com/entireio/cli/releases/tag/v0.11.3)、[Entire CLI repository](https://github.com/entireio/cli)。
- Codex CLI：`0.153.4`。该版本高于 Entire README 所列最低 Codex CLI 版本 `0.124.0`。
- 实际执行 Agent：Codex CLI 默认模型（Entire 记录为 `gpt-5.6-luna`）。本次验证针对 Codex CLI，不代表 Codex Desktop 的 session 接入已验证。
- 可复核的命令格式：`entire version`、`entire status --json`、`entire session list --json`、`entire session info <session-id> --json/--transcript`、`entire checkpoint explain <checkpoint-id> --json/--transcript`、`entire session resume <branch>`。

## 隔离与隐私设置

测试仓库由 `mktemp -d` 创建，没有 remote；未复制 AgileCampus 的 `.env`、聊天历史、登录资料或代码，也没有在 AgileCampus 工作仓库执行 `entire enable`。测试仓库只含一个用于检查变更是否接续成功的文件。

仅在这个临时仓库中运行：

```sh
ENTIRE_TELEMETRY_OPTOUT=1 entire enable --agent codex --skip-push-sessions --local --no-init-repo
```

随后检查 `.entire/settings.local.json` 与 `entire status --json`，观察到：

- `strategy_options.push_sessions = false`；status 报告 `checkpoint_push_disabled = true`。
- `telemetry = false`；运行 Entire 子命令的 adapter 也固定注入 `ENTIRE_TELEMETRY_OPTOUT=1`。
- 检查点存储类型为 `git-refs`，并且测试仓库没有 remote。
- 没有执行 `entire checkpoint explain --generate`；Entire CLI 帮助明确说明该选项会调用配置的摘要服务并消耗 token，其他读取模式不生成摘要。
- 这次没有做数据包捕获，因此只能证明开关和命令路径按预期配置，不能宣称独立证明了“网络层零外连”。Codex 本身仍通过其正常模型服务完成了两轮最小测试会话。

Entire 的 transcript 接口返回原始 Agent JSONL，可能含 prompt、响应和工具交互；不能默认显示给团队、写入 AgileCampus 云端或随工单分享。Entire 自己也提示 checkpoint transcript 与 Git remote/公开仓库之间存在传播风险。参考：[Entire Security and Privacy](https://github.com/entireio/cli/blob/main/docs/security-and-privacy.md)。

### Hooks 确认边界

Entire 写入 `.codex/hooks.json`。Codex 初始状态为 `trust_review_needed`，正常产品流程必须让用户在 Codex 中审阅并批准 hooks。本次为了完成一次性真实 CLI 验证，先检查 hooks 配置，再仅对临时仓库中的两次 Codex 调用使用 `--dangerously-bypass-hook-trust`。这不是推荐用户日常采用的配置；正常的 Codex hook 授权界面尚未做手工验收。

## 最小真实流程与结果

1. 建立临时 Git 仓库和单文件基线；在该目录启用 Entire Codex hooks。
2. 让 Codex CLI 对测试文件做一次指定修改，并提交 Git commit。测试提交生成 Entire checkpoint。
3. `entire session list --json` 列出真实 Codex session；`session info --json` 可读元数据；`session info --transcript` 能读取原始 session transcript。
4. `checkpoint explain --json` 返回 checkpoint 元数据；`checkpoint explain --transcript` 读取该 checkpoint 的原始 transcript。
5. `entire session resume main` 在临时目录恢复同一 session 日志，并给出 Codex 接续命令。随后用 Codex CLI 继续修改同一测试文件、再次提交；第二个 checkpoint 生成，session 的 turn 数增加。
6. 全过程未给临时仓库配置 remote，未执行 push，也未运行 Entire 云端摘要生成。

原始 transcript 未复制到仓库。本仓 fixtures 使用合成 session/checkpoint ID 与最小化内容，避免把本次会话数据当作测试样本提交。

## 适配器实现边界

`vscode-extension/src/adapters/entire-adapter.ts` 只针对已验证的 Entire `0.11.3`；未知版本 fail closed。适配器仅以参数数组调用 CLI，不使用 shell；工作目录必须是绝对路径，读取仅限调用者明确给出的 session/checkpoint ID；错误不返回 stderr。Entire 的 session list 默认跨 worktree，因此 adapter 会将列表项的 `worktree_path` 与当前工作区规范路径比对；元数据缺少路径时 fail closed。单条 capture 也会二次校验归属。session list/info 中的 `last_prompt` 会被忽略，返回对象仅包含显式白名单字段。

Entire 原生 session resume 命令已在一次性仓库验证；但这不代表可安全恢复任意旧 checkpoint。Entire 0.11.3 帮助说明：默认不会覆盖已有本地 session 日志，只有 `--force` 才覆盖。用户在 checkpoint 后继续了同一 session、但尚未形成新 checkpoint 时，`last_checkpoint_id` 仍指向旧 checkpoint；直接执行普通恢复命令会保留较新的日志，无法保证 Agent 从选中的断点继续。加 `--force` 又会覆盖这份较新日志。

因此 adapter 的 `prepareResume` 目前在 checkpoint/session 元数据验证后仍返回 `unsupported`，不生成原生接续命令。后续需先设计并验证可恢复的本地日志备份/隔离流程，再开放针对 checkpoint 的恢复。若以后执行原生恢复，还要单独检查 Entire 可能切换分支及工作区 dirty 状态；本工单不执行任何恢复命令。

能力状态按“真实证据”解释：

- verified：当前版本下本机 session 捕获、session/checkpoint transcript 读取，以及临时分支上的 Entire CLI 原生 session resume 流程。
- unsupported（adapter 当前行为）：精确选择 checkpoint 并安全恢复；本机已有 session 日志时无法证明恢复上下文与所选断点一致，强制覆盖也没有安全备份方案。
- unverified：便携文件导出、跨设备接续、fork、cancel。单机恢复成功不能证明换机器后可继续。
- 本工单没有将 adapter 接入扩展 UI，也未实现持久保存/分享 transcript；后续打包前必须增加预览、逐项脱敏、用户确认和明确的本地/分享目的地。

## 官方参考

- [Entire CLI README](https://github.com/entireio/cli)
- [Security and Privacy](https://github.com/entireio/cli/blob/main/docs/security-and-privacy.md)
- [Sessions and Checkpoints architecture](https://github.com/entireio/cli/blob/main/docs/architecture/sessions-and-checkpoints.md)
- [Entire CLI v0.11.3 release](https://github.com/entireio/cli/releases/tag/v0.11.3)
