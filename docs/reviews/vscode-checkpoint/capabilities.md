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
| Local checkpoint capture and read | implemented; awaiting Extension Host acceptance | 本机保存任务交接、Git SHA/branch/dirty 状态；存储在 VS Code globalStorage；附件单独同意并校验 SHA-256。保存和查看命令已有；尚未在 Extension Development Host 手工验收 |
| Manual checkpoint export/import | implemented; awaiting two-workspace acceptance | JSON 包有 15 MiB 上限；context 可选、transcript 默认不选且预览/二次确认；导入先本机验证 schema、路径、大小和 SHA。作者身份、共享授权和跨机器原生恢复均未验证 |
| Checkpoint handoff preflight | implemented; awaiting Extension Host acceptance | 在线校验任务/契约，核对 repo key、精确 SHA、dirty 和附件完整性；变更须确认；只输出 context-only 计划，不启动进程 |
| Cross-machine resume/fork/cancel | unverified | JSON 包可人工传递但尚未做双设备实测；native resume/fork/cancel 未验证 |
| 本地 Agent 启动与执行回执 | implemented; awaiting Extension Host acceptance | 仅支持核验过的 Codex CLI `0.153.4`；shell=false、`workspace-write`、人工二次确认；JSONL `thread.started` / `turn.completed` 确认回执；不保存 prompt/transcript，不改任务状态；真实 CLI 在一次性仓库验证通过 |
| 并行 checkpoint Attempts | implemented; awaiting Extension Host acceptance | 精确 SHA worktrees、唯一 branch、共用基线；不跑 setup、不合并；Git 真实 diff summary；尚未实测双 Agent 同时执行 |
| 共享身份/checkpoint/handoff HTTP API | proposed only; backend sign-off required | `backend-contract.md` 定义提案；现有 PAT 无 scope，Context Pack/fork 是网页登录态，Agent Run 不能代表本机 Codex；扩展未调用任何提案接口 |
| 本地任务自动刷新 | implemented; automated acceptance passed | 视图可见每 15 秒 GET、隐藏/断开暂停、单请求串行、15/30/60 秒抖动退避、401 停止、成功复位；Extension Host 手动切换可见性仍待用户验收 |
| 共享实时事件/文件传输 | not implemented; blocked on backend contract | 无签收契约和存储能力，不宣传实时同步、不假装服务端有 checkpoint 原文 |
| 本地 VSIX 打包 | verified; not installed | `vsce package --no-dependencies` 本机打包成功；未经 Extension Host 安装验收；打包提示仓库 LICENSE 文件缺失 |
| VSIX 商店发布 | not performed | 用户未要求发布；本轮明确不发布 |
