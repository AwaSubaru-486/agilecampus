# VS Code 检查点接续施工进度

## E00–E02（第一轮）

状态：E00–E02 代码与扩展宿主激活检查完成，停在第一轮人工验收点。

施工起点：`bba2285`。施工时保留以下他人未提交改动，没有暂存或提交：`src/lib/approval.ts`、`src/lib/collaboration-console.ts`、`tests/collaboration-console.test.ts`。

环境：Node `v26.8.1`、npm `11.19.0`、VS Code `1.122.0`。扩展开发宿主已安装。

完成内容：

- E00：修正 Webview view 声明；增加 Extension Development Host F5 配置与编译任务；扩展目录有独立 `check`、`test`；刷新说明文档。Extension Development Host 的 Extension Host 日志确认 `agilecampus.agilecampus-vscode` 成功激活；当前侧栏项目入口收在 VS Code“其他视图”溢出菜单中。
- E01：用 AgileCampus PAT 读取项目；令牌按 server origin 哈希隔离并写入 VS Code SecretStorage；项目绑定放入 workspaceState；校验远程 HTTPS、禁用重定向、请求超时、401/403/服务端错误和绑定切换；读取本机 Git 插件的仓库名/分支，不要求 GitHub 登录。断开某工作区只在该服务没有其他工作区绑定后删除共享令牌。
- E02：真实列项目任务、负责人、状态、截止日和任务交接要求；详情点击后按需读取；未知消息、非 UUID 的任务引用不进入 host；固定生成带 projectId 的 work/studio 页面链接；失败状态保留上次数据及同步时间。

测试命令和结果：

```text
npm --prefix vscode-extension run check：通过（Extension Host TS + Webview bundle）
npm --prefix vscode-extension test：13 项通过
git diff --check：通过
```

真实端点探测：`GET http://localhost:3000/` 跳转到 `/login`；未提供凭据调用 `GET /api/agent/projects` 返回 401。真实 PAT 的成功路径尚未验证，未读取、保存或输出用户令牌。已通过 Extension Host 日志确认扩展激活；本机真实任务读取、点击详情和网页跳转仍需用户输入自己的 PAT 后验收。

能力边界：Webview 可以查看任务并打开网页任务/Agent 会话；插件尚未采集 session、保存检查点、传递跨设备材料或恢复/启动本地 Agent。暂无任务分页，因此大项目的数据规模是已知限制。`repository` 来自 VS Code Git 扩展；未启用/不存在 Git 扩展时显示未检测到仓库。

停止点：用户在开发宿主的“其他视图”中打开 AgileCampus，输入自己的 PAT，选择真实项目，确认列表/任务详情/网页跳转。验收通过后再开始 E03，先在一次性 Git 仓库验证 Entire。
