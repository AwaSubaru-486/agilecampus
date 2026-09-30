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

Agent 工作入口目前只打开网页端。session 采集、检查点保存、Agent 原生恢复和 worktree 分支探索尚未实现；这些能力按专项工单后续阶段验收。
