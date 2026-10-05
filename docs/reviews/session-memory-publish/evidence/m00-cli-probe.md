# M00 CLI probe

日期：2026-10-02。工作目录：`/Users/qwsdjivc/agilecampus-ai`。

| 命令 | 结果 | 退出码 |
| --- | --- | --- |
| `codex --version` | `codex-cli 0.153.4` | 0 |
| `codex exec --help` | 支持 `--json`（stdout JSONL event stream）；说明只针对由该命令启动的会话 | 0 |
| `claude --version` | `2.1.185 (Claude Code)` | 0 |
| `claude --help` | 显示 `--resume`、stream-json、插件和 hooks 相关参数 | 0 |
| `entire --version` | `Entire CLI 0.11.3` | 0 |
| `entire status --json` | `{"enabled":false,"agents":null,"active_sessions":null,"error":"not set up"}` | 0 |

安全边界：未运行 `entire session list`，未读取 `$CODEX_HOME`、`~/.codex`、`~/.claude` 内任何 transcript/数据库，也未写入 Agent 全局配置或访问模型/GitHub 凭据。

官方 Hook 字段/信任行为另见 [capabilities.md](../capabilities.md) 的官方来源链接。`transcript_path` 只作为本地来源位置；Codex 官方说明 transcript 文件格式并非稳定接口。
