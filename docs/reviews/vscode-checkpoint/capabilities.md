# VS Code 接续能力核实表

本表记录当前仓库实现状态；代码有接口或测试不能自动算“真实 Agent 能力已验证”。

| 能力 | 状态 | 证据/限制 |
| --- | --- | --- |
| 扩展项目与任务读取 | implemented; live auth unverified | E00–E02；本机服务 API 目前返回 401，需用户 PAT 现场验收 |
| Webview host 权限隔离 | implemented; activation verified | Extension Host 日志确认扩展激活；PAT 留在 SecretStorage，按服务和工作区隔离；host 只向 Webview post task DTO；runtime message 白名单 |
| VS Code workspace/Git branch 读取 | implemented; API shape regression tested | 使用内置 Git API 的 `RepositoryState.remotes`；无 Git 时仍可查看任务；需用户打开项目视图后确认显示 |
| Entire CLI 可用版本和安装 | verified for Entire `0.11.3` + Codex CLI | E03 在无 remote 的一次性 Git 仓库验证；未在 AgileCampus 仓库启用；正常 hook trust 审批 UI 尚未验收 |
| Session capture/read | verified in isolated CLI 0.11.3 test; capture requires clean hook status | session/checkpoint transcript 可读取；hooks trust warning 时 capture 为 unverified |
| Exact checkpoint native resume plan | unsupported by adapter | Entire CLI 的 resume 已在临时仓库运行验证；但 CLI 默认保留本机已有 session 日志，`--force` 会覆盖日志。adapter 无法证明本机上下文与所选 checkpoint 一致，也没有安全备份/回滚流程，因此不生成接续命令 |
| Portable export | unverified | 本地读取 transcript 不等于已验证便携包导出；E04/E05 需做 context-only 包和跨机器验收 |
| Cross-machine resume/fork/cancel | unverified | 暂无真实跨设备、分叉或取消实验；不得在 UI 宣称可用 |
| 本地检查点、人工导入导出 | unimplemented | 后续 E04–E06；导出 transcript 前必须预览、脱敏并由用户确认 |
| 本地 Agent 启动与执行回执 | unimplemented | 后续 E07；共享分配授权先过 E09 |
| 独立 worktree 并行探索 | unimplemented | 后续 E08 |
| VSIX 安装/商店发布 | unverified | 本轮不打包/发布 |
