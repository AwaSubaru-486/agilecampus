# R02 共享后端 HTTP 冒烟证据

日期：2026-10-02（Asia/Shanghai）
隔离产品副本：`/tmp/agilecampus-sim-20261002-iWsfTm/repo`
隔离 HTTP 服务：`http://localhost:3111`（临时服务已停止）
数据库：本地隔离模拟库 `ac_sim_20261002161059`；测试后删除本次创建的合成用户和团队（级联删除合成项目及交接数据）。

## 执行

在真实 Next.js HTTP 服务前，脚本用领域方法创建合成 Alice、Bob、Outsider、项目、任务及三份 API token；token 仅在当前进程内使用，未打印或写入文件。随后通过 `fetch` 调用 `/api/extension/v1`。命令退出码为 0。

```text
GET /me                                      200
Outsider POST checkpoint                   403
Alice POST checkpoint                      201
Alice POST handoff to Bob                  201
same idempotency payload retry             200 (same id)
same idempotency key, changed payload      409
Outsider GET handoff detail                 403
sender attempts to accept                   403
malformed action JSON                       400
wrong action version type                   400
Bob inbox                                   200 (one item)
malformed preflight JSON                    400
empty optional preflight body               200
Bob creates Attempt before accept           409
Bob accepts current handoff                 200
Bob creates Attempt                         201
Bob updates execution receipt               200
task contract changes after offer           409 on accept
accept vs withdraw concurrent requests      [409, 200]
removed Bob attempts to accept a new offer   403
```

## 结论与限制

- 本次证明 API 路由在实际 HTTP 服务、数据库和 Bearer token 下执行；不是只直接调用 Next route handler。
- 交接单只改变交接状态；没有隐式改派任务，也没有自动验收任务。
- accept 与 withdraw 的竞争实际只产生一个胜方；胜方对应的终态与 HTTP 200 一致。
- 本轮没有真实 DeepSeek 调用、真实 VS Code Extension Host 操作、文件材料传输或真实 Agent session 恢复；这些仍属于后续 R03–R06。
- 没有将完整原始请求/响应、token、密码或用户本地会话内容归档。
