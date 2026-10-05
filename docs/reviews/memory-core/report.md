# 会话记忆核心专项验收报告

日期：2026-10-05  
结论：C00–C05 本地核心实现与自动化回归通过；VS Code 扩展宿主启动及命令注册 smoke test 通过；不等于完整交互、真实模型调用或跨设备 Agent 续接已验收。

## 交付结果

本专项把主线串为：

```text
本机已采集会话
  → 固定事件前缀并生成快照
  → 脱敏、限额和预览实际外发内容
  → 经确认后生成带事件出处的 AI 候选
  → 人工审核/修订并接受为版本
  → 生成接班材料，接收端校验后由人复制给 Agent
```

- 快照不可变；后续新事件不会悄悄进入旧快照。
- 原始会话留在本机；出站内容使用版本化的预处理输入，用户可先看到请求内容。脱敏规则不是完整 DLP，确认仍不可省略。
- 候选必须引用实际发送的事件；程序校验引用和测试证据结构。AI 结论仍需人审核，结构校验不等于语义正确。
- 人工修改、删除和接受版本保留在本机草稿历史中；下一次会话快照会继承人工编辑、人工补充和删除记录，不静默覆盖。
- 接班包是手动导出的 JSON，不加密、不含原始 transcript；接收端核对来源、项目/任务权限、仓库标识、HEAD、工作区和阻塞项，并逐字段核对材料正文与已接受记忆。通过后只复制上下文，不自动启动 Agent。
- 发给提炼服务前会屏蔽事件正文、命令、路径字段和仓库阻塞说明中的常见本机绝对路径（POSIX、Windows、UNC 和 `file://`）；这不等于完整 DLP。
- captured 测试证据必须由同一 `toolCallId` 关联的命令和结果支持，不能拼接两次工具调用。

## 关键入口和文件

- VS Code 命令：`AgileCampus: 提炼本机会话记忆`、`AgileCampus: 审核或导出会话记忆`、`AgileCampus: 导入并核对接班记忆`。
- 扩展核心：`vscode-extension/src/memory/`；命令编排：`vscode-extension/src/commands/session-memory.ts` 与 `import-memory-handoff.ts`。
- 服务端提炼：`src/app/api/extension/v1/projects/[projectId]/session-memory/extract/route.ts`，复用现有鉴权、项目权限和服务器模型配置；不把模型密钥放进扩展。
- 对接边界：`docs/reviews/memory-core/integration-contract.md`；施工进度：`docs/reviews/memory-core/progress.md`；合成验收场景：`docs/reviews/memory-core/cases.md`。

## 自动化验证

| 命令 | 结果 |
| --- | --- |
| `cd vscode-extension && npm test` | 通过：29 个测试文件，165 项测试 |
| `cd vscode-extension && npm run check` | 通过：扩展 TypeScript、扩展 bundle、Codex Hook CLI 与 Webview bundle |
| `npm test`（仓库根目录） | 通过：60 个文件通过、1 个跳过；648 项通过、2 项跳过 |
| `npx tsc --noEmit`（仓库根目录） | 通过 |
| `git diff --check` | 通过 |
| VS Code Extension Development Host（1.122.0，隔离用户数据目录） | 启动并激活 AgileCampus；日志确认三条会话记忆命令均已注册。未执行需要项目绑定/用户交互的完整命令流程 |
| 本机提炼 API 未认证请求 | `POST /api/extension/v1/projects/{projectId}/session-memory/extract` 返回 HTTP 401；未提供 token，认证失败在解析请求正文与模型调用之前返回 |

补充回归覆盖：新快照继承人工编辑/补充/删除、材料内容即使重算摘要也不得与接受版本不一致、正文/命令/路径/仓库阻塞说明中的绝对本机路径外发前被脱敏、混合工具调用不能伪造成功测试。离线测试数据均为合成数据。测试证明实现的确定性行为和接口约束，不证明模型总结质量或用户真实运行环境。

## 尚未验收，不得宣称已完成

1. **真实来源覆盖**：只验证了 Extension Development Host 启动及命令注册；未走完依赖已连接项目和真实会话绑定的提炼、审核、导入交互，也未验证真实 Codex Hook 的会话覆盖、重启恢复与失败路径；Claude CLI/Code 的自动采集未由本专项实现或实测。
2. **真实模型请求**：没有使用 DeepSeek/其他模型或真实会话内容发请求；API 配置、网络、响应语义和实际 token 消耗尚未实测。
3. **跨设备传输**：没有私有平台上传/下载服务。接班 JSON 未加密，必须经可信渠道手动传递；不要放进公开仓库。
4. **真正的 Agent 续接**：接收端目前只在核验通过后生成/复制上下文，不读取发送端原始事件，不恢复 provider 隐藏状态、原生 session ID 或工具进程，也不自动启动 Agent。
5. **队友模块集成**：worktree 创建/隔离、Webview 前端展示、账号与跨设备成员授权不属于本专项；需要各负责人通过集成契约接入并另做端到端验收。

## 工作区说明

仓库开始时已有共享工作区改动。本专项未清理、还原、暂存、提交或推送工作区。测试生成的 `dist` 不作为源代码交付；应以 Git 状态中的源文件和文档为准。最终状态不是“整个 AgileCampus 产品已经交付”，而是“会话记忆核心本地能力已实现并通过自动化回归，外部联调项仍待负责人完成”。
