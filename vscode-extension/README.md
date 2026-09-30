# AgileCampus VS Code 扩展

## 当前施工入口

执行 [VS Code 工作台、检查点与人–Agent 接续专项工单](../docs/superpowers/plans/2026-09-30-vscode-checkpoint-handoff-luna-workorders.md)。首次只做 E00–E02，验收真实登录、项目绑定、任务读取后停止；检查点和 Agent 接续属于后续工单，目前不能视为已经实现。

下文描述现有骨架。F5 开发配置及测试脚本是否齐全，由 E00 实际核验并补齐，不凭文档认定已经可运行。

这是双端计划的 S4 骨架：侧栏显示项目现场，使用 typed message 调用扩展 host 的命令，再跳回网页端完成复杂操作。

## 本地开发

```bash
npm install
npm run compile
```

在 VS Code 中打开 `vscode-extension/`，按 `F5` 启动 Extension Development Host。当前快照 API 返回明确的“未关联项目”空态；下一步接入 AgileCampus Personal API Token、GitHub workspace remote 和项目映射。

扩展 host 承担身份和网络请求，Webview 只拿过滤后的项目快照；Webview 不保存 GitHub token，也不直接调用 GitHub API。
