# AgileCampus VS Code 扩展

扩展在 VS Code 侧栏显示所选 AgileCampus 项目的任务、负责人、状态、截止日期和交接要求。AgileCampus PAT 保存在 VS Code SecretStorage，并按服务地址与本地工作区分别隔离；请求由扩展 Host 发出，Webview 不接触令牌。

## 本地开发

```bash
npm ci
npm run check
npm test
```

在 VS Code 中打开 `vscode-extension/`，从“运行和调试”选择 `AgileCampus Extension Development Host`，按 `F5` 启动。首次连接时，从 AgileCampus 设置页创建 Personal API Token，在 VS Code 的密码输入框中填写，再选择项目和本地工作区。

项目视图可以刷新任务、查看任务交接目标/完成条件/证据要求，并跳转到网页端对应任务。Git 仓库和当前分支通过 VS Code 内置 Git 扩展读取。未登录、无权限和网络失败会分别显示错误状态。

项目视图处于前台可见时，每 15 秒自动重新读取项目与任务；切到其他视图后暂停，重新显示时恢复。刷新请求串行，不会因上次请求未完成而并发堆积。网络或服务失败按 15/30/60 秒退避（带有限抖动），成功后回到 15 秒；401 会停止自动请求并清除无效登录凭据，需重新连接。403 保留权限错误提示并按退避重试。标题菜单“刷新”仍可立即读取；自动刷新只发 GET，不会写回任务或检查点。

当前扩展还没有共享 checkpoint/handoff API。E09 契约仅是待评审提案；Context Pack/对话分支写 API 需要网页登录，Agent Run 则代表服务端登记的 Agent 身份，不能用来冒充本机 Codex。导出的 JSON 交接包仍须由用户自行传递，不能把本地记录称为已同步。

在项目视图的标题菜单选择“保存本地检查点”，填写工作目标、已完成事项、卡点和下一步，并选择是否把本机 Agent transcript 作为附件保存。检查点保存在 VS Code 全局存储目录，不会上传。dirty 工作区需要明确确认，未提交/未跟踪改动会从代码基线中排除；Git LFS/submodule 会标注为当前不可恢复。

选择“查看本地检查点”可在本机查看交接内容和 Git SHA。原始 transcript 仅在用户单独确认后落盘，清单不包含对话正文，读取附件时会校验 SHA-256。保存的会话材料标为 `context-only`；它不是 Entire 原生会话恢复，也不等于把另一台电脑的工作目录备份过来。原生 checkpoint 恢复目前因 Entire CLI 的本地日志覆盖语义而关闭，工作区代码也不会自动恢复。

“导出检查点交接包”会生成一个版本化 JSON。交接内容默认包含；context 附件可选；transcript 默认不选，选中后会先打开原文预览，再要求单独确认。导出会拦截几类常见凭据文本模式；这只能发现部分明显格式，不保证识别所有秘密。导入会先校验包大小、schema、附件引用、base64、SHA-256 和路径；附件写入使用本机生成的文件名，不执行包内命令。导入只按本地数据查看，SHA-256 不证明作者身份，执行前必须重新在线核对任务、代码 SHA 和工作区状态。

“检查接续条件”会重新读取服务端任务和本地 Git 状态，比较任务契约、检查点 SHA、仓库身份和附件完整性，然后生成只读的 context-only 计划。此命令不会启动 Agent、改分支或写任务状态；Entire 原生 session 恢复当前关闭。“从检查点启动 Agent”会再做检查、让用户选择附件并预览，再要求确认后调用本机已核验的 Codex CLI 0.153.4；它是新会话，prompt 与附件会发送到用户已配置的 Codex 服务，Agent 在当前干净工作区获得 `workspace-write`。不会启用危险绕过、执行附件命令、提交、推送或更改平台任务。未找到真实 session / turn 回执时记录为待核对，不显示为成功。Agent 尝试元数据保存在 VS Code globalStorage，不保存 prompt 或 transcript 正文。

VS Code 命令面板还提供“AgileCampus: 保存本地检查点”“AgileCampus: 查看本地检查点”“AgileCampus: 检查接续条件”“AgileCampus: 从检查点启动 Agent”和“AgileCampus: 查看本地 Agent 尝试”。扩展重启后无法证明旧进程仍运行时会把尝试标为 `unknown`，并阻止重复启动。卸载扩展前，检查点与尝试元数据位于 VS Code 为此扩展分配的 globalStorage 目录；删除扩展存储会一并删除这些本地材料。

“创建并行尝试 worktree”会在用户挑选的源仓库之外目录创建唯一分支和 Git worktree，基线强制使用检查点 SHA；每个尝试互不共享可写工作目录。操作只创建目录/分支，不跑 `npm install` 或项目脚本、不自动启动 Agent、不 cherry-pick/merge，也不清理已有尝试。之后在“从检查点启动 Agent”里选择对应 worktree。“比较并行尝试”只展示两条尝试的真实 HEAD、提交数、文件状态和 Git diff 统计，不自动判优。worktree 只隔离 Git 工作树，不是操作系统安全沙箱。
