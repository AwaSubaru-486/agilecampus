# AgileCampus VS Code 扩展

这是双端计划的 S4 骨架：侧栏显示项目现场，使用 typed message 调用扩展 host 的命令，再跳回网页端完成复杂操作。

## 本地开发

```bash
npm install
npm run compile
```

在 VS Code 中打开 `vscode-extension/`，按 `F5` 启动 Extension Development Host。当前快照 API 返回明确的“未关联项目”空态；下一步接入 AgileCampus Personal API Token、GitHub workspace remote 和项目映射。

扩展 host 承担身份和网络请求，Webview 只拿过滤后的项目快照；Webview 不保存 GitHub token，也不直接调用 GitHub API。
