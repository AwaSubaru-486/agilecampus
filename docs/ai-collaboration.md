# AI 协作空间设计

## 目标

AgileCampus 将 AI 会话作为项目过程的一部分，而不是个人使用的临时聊天框。项目成员可以在权限范围内查看同伴的 AI 协作过程、继续已有会话，或者从某条 AI 回复创建新的方案分支。AI 生成的任务草案仍需人工确认后才能写入项目。

## 第一版能力

- 一个项目可以有多个 AI 会话，不再默认全项目共用一条聊天记录。
- 会话可以关联一个项目任务。
- 会话可设置为项目成员可见或仅创建者可见。
- 每条用户消息记录实际作者，团队成员可以判断上下文来自谁。
- 用户可以从任意已完成的 AI 回复创建分支。
- 分支复制该回复及此前的消息，并保存父会话、分支边界和逐条消息来源。
- 普通续聊和分支续聊都会把已保存的人机历史发送给模型。
- 工具调用记录继续作为审计信息保存，但不会不加处理地重新发送给模型。

## 数据关系

```text
项目
└── AI 会话
    ├── 可选关联任务
    ├── 可见范围
    ├── 父会话
    ├── 分支起点消息
    └── 消息
        ├── 作者
        └── 来源消息
```

## 开源实现参考

本功能保留 AgileCampus 原有技术栈，并参考以下公开项目的设计和实现方式。没有直接移植其完整应用或托管服务。

| 项目 | 许可证 | 借鉴内容 |
| --- | --- | --- |
| [LodyAI/Lody](https://github.com/LodyAI/Lody) | Apache 2.0 | Session 作为一等对象、从明确 Turn 边界分叉、保留来源关系、会话与执行证据共同展示 |
| [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | MIT | 消息级分支入口、分支导航的交互原则、运行中禁止切换或重复触发 |
| [vercel/ai-chatbot](https://github.com/vercel/ai-chatbot) | Apache 2.0 | Next.js 与 Drizzle 下的会话持久化、消息查询和可见范围设计 |
| [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) | MIT | 使用父消息关系表达会话树、复制历史时重建来源映射、分享快照与源会话隔离 |

Open WebUI 当前版本带额外品牌限制，本项目未合并其代码。

## 与 Lody 的差异

Lody 面向代码开发 Agent，包含本机 Daemon、ACP、Git Worktree、代码 Diff 和跨机器运行。AgileCampus 面向高校项目团队，第一版只实现 Web 端共享会话和上下文继承，不远程控制成员电脑，也不自动执行代码。这里复用的是协作模型，不是开发环境架构。

## 当前已落地的复用

当前分支已经把 Lody 中适合 AgileCampus 的一小块纯逻辑适配进仓库：

- `src/lib/conversation-tree.ts`：适配会话关系树的稳定排序、孤儿提升、循环防护和折叠展示；
- `src/app/(app)/projects/[projectId]/conversation-tree.tsx`：把项目会话从平铺列表改为可折叠分支树；
- `src/app/(app)/projects/[projectId]/context-pack-builder.tsx`：把现有 Context Pack API 接成可预览、创建、冻结、选择的工作流；
- `src/app/(app)/projects/[projectId]/chat-panel.tsx`：改为连续工作稿，保留分支来源和人工确认边界。
- `src/db/schema.ts` + `src/lib/approval.ts`：把 AI 写草案持久化为审批请求，使用幂等键和 CAS 抢占，统一委托既有 `commitDraft` 执行；
- `src/app/api/approvals/[approvalId]/resolve/route.ts` 与 `src/app/(app)/collaboration/page.tsx`：提供审批执行入口和跨项目待处理汇总；
- `src/app/(app)/projects/[projectId]/approval-detail.tsx`：提供结构化 payload 编辑、来源跳转、驳回原因、失败重试和执行超时人工恢复；
- `src/lib/approval.ts` + `/api/approvals/[approvalId]/preview`：在确认前按任务字段展示 stale 版本冲突，并根据团队角色显示可确认范围；
- `tests/approval.test.ts`：覆盖幂等登记、拒绝不写入、确认执行和重复确认不重复写入。

这不是把 Lody 的桌面端、Daemon 或 ACP runtime 搬进来；适配代码和来源说明见仓库根目录 `THIRD_PARTY_NOTICES.md`。assistant-ui、Vercel AI Chatbot、LibreChat、Plane 等目前仍作为交互和数据模型参考，后续只有在契约、许可证和现有权限模型都匹配时才会逐块引入。

## 后续计划

1. 将 AI 回复转为项目决策、风险、文档和交付物。
2. 为老师提供过程摘要，同时保留查看来源会话的入口。
3. 支持选择继承项目目标、任务、文档和已确认决策，而不是无差别发送全部历史。
4. 增加会话归档、搜索和项目档案导出。
