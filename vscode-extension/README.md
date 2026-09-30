# AgileCampus VS Code 扩展

## 当前施工入口

执行 [VS Code 工作台、检查点与人–Agent 接续专项工单](../docs/superpowers/plans/2026-09-30-vscode-checkpoint-handoff-luna-workorders.md)。首次只做 E00–E02，验收真实登录、项目绑定、任务读取后停止；检查点和 Agent 接续属于后续工单，目前不能视为已经实现。

下文描述现有骨架。F5 开发配置及测试脚本是否齐全，由 E00 实际核验并补齐，不凭文档认定已经可运行。

这是双端计划的 S4 骨架：侧栏显示项目现场，使用 typed message 调用扩展 host 的命令，再跳回网页端完成复杂操作。

## 本地开发

```bash
npm ci
npm run check
npm test
```

在 VS Code 中单独打开 `vscode-extension/`，运行和调试面板选择 `AgileCampus Extension Development Host`，按 `F5` 启动 Extension Development Host。登录通过 AgileCampus 设置页创建的 Personal API Token 完成；GitHub 登录只用于 GitHub 接口，不用于 AgileCampus 登录。

扩展 host 通过 VS Code SecretStorage 保存令牌并负责网络请求。Webview 只接收经过筛选的项目/任务数据，不接收 token。当前可读取真实项目任务；Agent 工作入口会打开网页端。session 记录、检查点和 Agent 原生接续仍未实现。
