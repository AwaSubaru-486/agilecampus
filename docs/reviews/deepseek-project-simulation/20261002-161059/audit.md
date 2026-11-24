# 模拟测试报告复核

复核基线：HEAD c1b53cf7717ced0036af70c37c81680ea95b2722；保留 agent-run-rail.tsx 原有未提交修改。本次是源码与既有测试记录审核，没有重新执行全套测试或真实模型调用。

结论：阶段性报告可以保留，完整项目验收不通过。下一轮按 [修复与接线工单](../../../superpowers/plans/2026-10-02-handoff-integration-next-luna-plan.md) 执行。

## 已核实的问题

1. P1：requiredEvidence 的领域定义为 EvidenceType[]，网页 console-shell.tsx 却声明 string，execution-console.tsx 又断言为 string，handoff-editor.tsx 调用 split。应修复整个数据传递链，单加可选链不能修复数组调用 split 的异常。task-contract-panel.tsx 直接渲染该值，也需统一显示。
2. P1：扩展 API client 只有项目/任务 GET；保存检查点、导入导出和接续是本机能力，尚无共享交接 API 接线。不能据此断言本地导出导入不能用；正确结论是跨成员主路径尚未验收。
3. P2：测试清理清单确实漏三张表。不过 TRUNCATE 使用 CASCADE，因此“必然残留数据”并未被证明；确定的问题是清单守卫失败，应补清单并验证实际清空效果。
4. P2：根 Vitest 没有限定 include，扩展 worker 又使用 process.cwd() 定位源码，根目录运行失败的解释与源码一致。

## 新发现，施工前补复现

5. P1：preflight 与 handoff action 路由把 JSON 解析失败和 Zod 校验失败一起吞掉，按空对象继续处理。非法 expectedHandoffVersion 或 clientDirty 可失去预期校验。源码路径确定，须补路由回归和真实 HTTP 复现后记录具体状态码。
6. P1：resolveHandoff 先读取 offered，再按 id 更新，更新条件未包含 offered。accept/withdraw 并发可能都成功；这是源码确认的竞争窗口，当前报告没有并发实验，不能写成已复现。
7. P1：resolveHandoff 内没有当前团队成员权限复核；调用路由仅做 bearer 身份认证。已离队接收者是否仍能接受必须补测试。options.expectedHandoffVersion 被接收却没有使用。
8. 服务端预检只在客户端提供 HEAD/repo/dirty 时检查相关字段，且不验证本地材料实际存在；其 ready 不能单独代表“可启动 Agent”。接收交接单也不等于认领任务或验收任务。

## 报告证据限制

- 13 PASS 等数量是 cases.csv 的检查条目数，不能转成用户流程通过率，也不等于单元测试数量。
- 产物目录只有汇总 Markdown/CSV/JSON，未归档完整命令日志、截图或认证 HTTP 响应。既有执行记录可参考，但不足以独立重放验收；后续补脱敏证据与命令退出码。
- 缺少 DeepSeek Key 只阻断真实模型分支，不阻断 checkpoint/handoff/accept/attempt 的认证 HTTP 测试；旧轮次这部分是尚未完成，不能全部归因于 Key。
- 同浏览器依次换号验证了部分权限，但没有验证两个独立客户端的缓存隔离；Extension Host 激活不等于按钮流程成功。
- 未显式配置 DeepSeek 不等于 CLI 一定不支持它；目前只能说供应商未核实，网页环境变量不会自动证明本地 CLI 使用了同一模型。

下一轮交付重点：先拿出可复现的 A 保存、B 接收并核对材料的闭环，再补真实 Agent 与并行工作区证据。

## 首批实施复核

R00–R01 已按下一阶段计划施工并通过回归：任务详情数组崩溃、reset 清单遗漏、根/扩展测试 cwd 冲突均有修复。网页任务详情在隔离环境中完成保存、刷新、重新打开验证。

后续用户授权继续至 R02。handoff 后端成员核验、版本冲突、同键并发幂等、accept/withdraw 条件竞争和 JSON 错误处理已修复；12 项路由测试通过；真实隔离 HTTP 服务完成 A/B/Outsider 验证；配置单 worker 后普通根 `npm test` 全量通过。这只证明服务端 API，不代表 VS Code 插件已经接线或真实 Agent session 已接续。

I-04（扩展未调用共享 API）及真实模型/材料导入/Agent 接班/并行仍未完成。细节见 [施工进度](../../handoff-integration-next/progress.md) 与 [R02 HTTP 证据](../../handoff-integration-next/evidence/r02-http-smoke.md)。
