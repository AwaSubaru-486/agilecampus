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

在项目视图的标题菜单选择“保存本地检查点”，填写工作目标、已完成事项、卡点和下一步，并选择是否把本机 Agent transcript 作为附件保存。检查点保存在 VS Code 全局存储目录，不会上传。dirty 工作区需要明确确认，未提交/未跟踪改动会从代码基线中排除；Git LFS/submodule 会标注为当前不可恢复。

选择“查看本地检查点”可在本机查看交接内容和 Git SHA。原始 transcript 仅在用户单独确认后落盘，清单不包含对话正文，读取附件时会校验 SHA-256。保存的会话材料标为 `context-only`；它不是 Entire 原生会话恢复，也不等于把另一台电脑的工作目录备份过来。原生 checkpoint 恢复目前因 Entire CLI 的本地日志覆盖语义而关闭，工作区代码也不会自动恢复。

“导出检查点交接包”会生成一个版本化 JSON。交接内容默认包含；context 附件可选；transcript 默认不选，选中后会先打开原文预览，再要求单独确认。导出会拦截几类常见凭据文本模式；这只能发现部分明显格式，不保证识别所有秘密。导入会先校验包大小、schema、附件引用、base64、SHA-256 和路径；附件写入使用本机生成的文件名，不执行包内命令。导入只按本地数据查看，SHA-256 不证明作者身份，执行前必须重新在线核对任务、代码 SHA 和工作区状态。

VS Code 命令面板还提供“AgileCampus: 保存本地检查点”和“AgileCampus: 查看本地检查点”。卸载扩展前，检查点位于 VS Code 为此扩展分配的 globalStorage 目录；删除扩展存储会一并删除这些本地材料。
