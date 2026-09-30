# VS Code 接续能力核实表

本表记录当前仓库实现状态；代码有接口或测试不能自动算“真实 Agent 能力已验证”。

| 能力 | 状态 | 证据/限制 |
| --- | --- | --- |
| 扩展项目与任务读取 | implemented; live auth unverified | E00–E02；本机服务 API 目前返回 401，需用户 PAT 现场验收 |
| Webview host 权限隔离 | implemented; activation verified | Extension Host 日志确认扩展激活；PAT 留在 SecretStorage；host 只向 Webview post task DTO；runtime message 白名单 |
| VS Code workspace/Git branch 读取 | implemented; activation verified | 依赖内置 `vscode.git` API；无 Git 时仍可查看任务；需用户打开项目视图后确认显示 |
| Entire CLI 可用版本和安装 | unverified | E03 尚未执行；禁止对真实仓库 enable |
| Session capture/read/native resume/cross-device resume | unverified | 没有接入任何 session adapter |
| 本地检查点、人工导入导出 | unimplemented | 后续 E04–E06 |
| 本地 Agent 启动与执行回执 | unimplemented | 后续 E07；共享分配授权先过 E09 |
| 独立 worktree 并行探索 | unimplemented | 后续 E08 |
| VSIX 安装/商店发布 | unverified | 本轮不打包/发布 |
