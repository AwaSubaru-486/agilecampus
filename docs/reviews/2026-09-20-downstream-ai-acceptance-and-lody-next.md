# 下游 AI 阶段验收与 Lody 式协同下一步方案

验收日期：2026-09-20  
验收分支：`feat/risk-aware-closure`  
验收 HEAD：`55684b9`  
对照基线：`5c9a3f9`  
对照计划：`2026-09-20-agilecampus-original-product-and-ai-collaboration.md`

## 1. 验收结论

**阶段性通过，不允许按 V2 完工验收。**

下游 AI 正确完成了施工计划前 3 个提交：

1. 原创边界和产品语言；
2. 顶部工作带与新视觉 token；
3. 项目“现场 / 工作 / 协同室 / 记录”四模式。

代码质量与回归情况良好，但任务操作和 AI 协同仍是旧实现的搬迁版。当前更准确的状态是：

> 新产品骨架完成，业务房间仍有一半是旧房间；AI 协同 V2 尚未开工。

### 综合评分

| 维度 | 结果 | 说明 |
| --- | --- | --- |
| 工程稳定性 | 通过 | 483 tests passed，2 skipped；build 通过 |
| 静态检查 | 有条件通过 | lint 0 error，1 条旧测试未使用 import warning |
| 计划进度 | 3/13 commits | Commit 1～3 完成，Commit 4～13 未完成 |
| 原创产品骨架 | 通过 | 顶部工作带、今日入口、四模式明显不同 |
| 原创任务体验 | 未通过 | 仍是旧卡片/表单，任务抽屉缺失 |
| AI 协同创新 | 未通过 | 仍是旧 ChatPanel；上下文包等均未实现 |
| 核心流程可用性 | 部分通过 | 四模式可切换，但今日行动深链是断的 |
| 移动端 | 未验收 | 顶栏存在小屏拥挤风险，需要 320px 实测与修复 |

## 2. 已验证结果

执行命令：

```bash
npm test
npm run lint
npm run build
```

结果：

- Test Files：44 passed，1 skipped；
- Tests：483 passed，2 skipped；
- Next.js production build：通过；
- TypeScript：通过；
- ESLint：0 error，1 warning；
- 新路由已被构建识别：`/today`、`/collaboration`、`/library`。

浏览器实测：

- 演示账号可登录；
- 顶部工作带、项目切换器、五项一级导航可见；
- `/today` 能显示待验收任务；
- 项目四模式可切换；
- “现场”数据真实，能显示人/AI、接力、里程碑、求助和健康风险；
- “协同室”能显示旧会话界面；
- 视觉已经从亮蓝侧栏方案切换为暖灰纸感方案。

## 3. 必须修复的问题

### P1-1：登录后的默认入口仍然是 `/teams`

证据：`src/app/page.tsx:6`。

当前：

```ts
redirect(session?.user ? "/teams" : "/login");
```

计划要求登录后进入 `/today`。现在用户第一次看到的仍是旧团队卡片页，直接削弱新产品结构。

修复：改为 `/today`，并增加路由测试。

### P1-2：`/today` 的任务链接不能完成动作

证据：

- `src/app/(app)/today/page.tsx:79-81` 生成 `?task=<id>`；
- `src/app/(app)/projects/[projectId]/page.tsx:52` 只解析 taskId；
- `page.tsx:84` 仅把 taskId 继续传给 tab 链接；
- 页面没有渲染 TaskDrawer。

实际结果：从“等你验收”点任务后进入项目现场，但看不到目标任务，也没有验收控件。

这不是小细节，而是当前主入口的核心操作断链。

修复顺序：

1. 先做最小任务抽屉，至少支持查看、接住/接不住、提交、验收；
2. 抽屉支持 `task=` 深链；
3. 关闭时移除参数并把焦点还给来源行；
4. 再扩展成计划中的八段结构。

### P1-3：顶部协作数字与今日页面口径不一致

证据：`src/lib/shell.ts:75-92`。

`listMyActionItems()` 返回待回应和待验收，但 `countMyPendingActions()` 只数待回应。管理员在今日页有两件待验收，顶部可能显示 0。

修复：统一从一个 `buildMyActionQueue()` 结果计算列表和数字，禁止两个查询各算各的。

### P1-4：原创性只完成了骨架，没有完成房间

当前“现场”仍直接复用：

- `WorkspaceView`
- `BlockerStrip`
- `HealthPanel`

当前“协同室”仍直接复用：

- `ChatPanel`
- `DraftCards`

实测仍出现 `CONTEXT LAB`、`HEALTH`、旧会话布局和旧健康卡片。因此六项原创判据只完成导航、项目模式、基础视觉三项。

这符合 Commit 3 的过渡状态，但不符合最终交付。

### P1-5：AI 协同核心尚未开始

以下均只有计划，没有 schema/API/UI：

- 上下文包；
- 会话/运行统一 Session；
- 多 Agent 子会话；
- 分支比较与合并；
- 决策记录；
- 待确认动作池；
- 证据包。

不要把“已有共享聊天与分支”描述为 AI 协同 V2 完成。

## 4. 次要问题

### P2-1：conversation 参数没有规范化 URL

`spaceForConversationParams()` 会在服务端渲染 studio，但 URL 仍可能是 `?space=live&conversation=...`。界面与地址不一致。

修复：发现 conversation 且 space 不是 studio 时使用 redirect 生成 canonical URL。

### P2-2：现场仍是一条很长的页面

拆成四模式解决了全项目长页面，但现场内部仍按“正在发生→接力→里程碑→求助→健康”纵向堆叠。应该按计划改成：

- 顶部 1～3 条行动；
- presence table；
- 接力与下一里程碑双栏；
- 仅在存在时显示求助；
- 健康问题融入行动，不再单独整块。

### P2-3：原始枚举泄漏到界面

实测出现：

- `卡住了：dependency`
- `卡在：unclear`

必须经 `blocker-labels.ts` 映射成人话，不能暴露数据库枚举。

### P2-4：README API 说明滞后

README 仍写“POST `/api/agent/tasks/complete` 将任务标记为 done”，实际路由已变为 `review`。`docs/agent-api.md` 是正确的。

修复：README 改为“提交待验收”，并补 review endpoint。

### P2-5：移动顶栏存在拥挤风险

320px 内同时保留 logo、项目切换器、五个文字导航、头像，且 nav 不可横向滚动。需要真实小屏验收；预计应改为：

- 桌面显示五项文字导航；
- 小屏仅保留今日/项目/协作三项图标或底部导航；
- 资料库与设置收入账户菜单；
- 项目切换器限制宽度。

### P2-6：开发阶段注释进入产品代码

新代码多处写着“Commit 2 先……Commit 4 再……”。开发历史应留在计划和提交信息，最终产品代码只解释当前约束。

## 5. 下一轮施工顺序

不能直接跳到复杂多 Agent。先恢复主路径，再建立 Lody 内核。

### Sprint A：修复当前断链（必须先做）

一个提交完成：

1. `/` 登录后转 `/today`；
2. `buildMyActionQueue()` 统一行动列表与徽章；
3. 排除归档项目；
4. 最小 TaskDrawer 接住 `task=`；
5. conversation URL 规范化；
6. raw enum 翻译；
7. README complete/review 契约修正；
8. 清 lint warning。

验收：从今日任一行动点击后，能在一次跳转内完成该动作。

### Sprint B：完成原创“现场”和“工作”

1. 新 `LiveSpace` 不再拼旧三个组件；
2. 行动优先，风险归入行动；
3. presence table + relay trace + next milestone；
4. 任务卡降噪；
5. TaskDrawer 完成八段结构；
6. 删除旧内嵌编辑表单；
7. 手机与键盘验收。

验收：旧 `WorkspaceView/HealthPanel/BlockerStrip` 不再被项目主路径引用。

### Sprint C：Lody 式协同最小内核

不要一次实现原计划所有 AI 表。先建立“Session 是一等对象”。详见下一节。

### Sprint D：上下文、确认与证据

1. Context Pack；
2. Approval Inbox；
3. Evidence Pack；
4. Decision Ledger。

### Sprint E：多 Agent 与方案合并

1. 子 Session；
2. 协调者 Session；
3. 并行结果比较；
4. 选择性合并；
5. 风险排演。

## 6. 重新理解 Lody

Lody 真正厉害的不是“团队能看别人的 AI 聊天”。它的完整模型是：

1. **Session 是团队资产**：会话、运行状态、文件和结果绑定在一起；
2. **机器和 Agent 可连接**：不同成员电脑或服务器上的 Agent 都能进入同一 workspace；
3. **可派发工作**：从桌面、Web、手机或 CLI 把工作送到指定 Agent；
4. **团队可接管**：别人能看完整历史、补指令、处理权限请求；
5. **Agent 可协调 Agent**：主 Session 能创建子 Session、读取状态、追加指令、取消并收回结果；
6. **并行工作彼此隔离**：开发场景用 worktree 隔离；
7. **执行证据与对话同处**：Diff、文件、预览、CI 与产生它们的 Session 在一起；
8. **关系不丢失**：fork、child session、引用和来源均可追溯。

AgileCampus 不需要照搬 daemon、ACP、Git worktree 和代码 Diff。它应翻译为高校项目语言：

| Lody | AgileCampus |
| --- | --- |
| Workspace | 项目现场 |
| Coding Session | 协作 Session |
| Machine | 学生电脑 / 实验室服务器 / 云 Agent |
| Agent Config | AI 成员角色与能力 |
| Worktree | 独立方案分支 / 独立交付空间 |
| Code Diff | 任务字段差异 / 文档版本 / 证据包 |
| Permission Request | 待确认动作 |
| PR Review | 老师/组长验收 |
| Session Fork | 方案分支 |
| Child Session | 子任务协作 |

## 7. 建议的新核心：Collaboration Session

目前 `conversations` 负责说了什么，`agentRuns` 负责 Agent 跑了什么，`tasks` 负责要做什么；三者互相靠 ID 和界面临时拼接。Lody 式协同需要一个上层 Session 把它们组织起来。

### 7.1 数据模型

```ts
collaborationSessionKind = ["explore", "execute", "review", "coordinate"]
collaborationSessionStatus = [
  "draft", "queued", "running", "needs_input",
  "blocked", "awaiting_review", "completed", "cancelled", "failed"
]

collaborationSessions {
  id
  projectId
  taskId?
  conversationId?
  createdById
  assignedToId?       // 人或 AI
  kind
  status
  title
  goal
  doneCriteria        // json string[]
  contextPackId?
  resultSummary?
  createdAt
  updatedAt
  completedAt?
}

collaborationSessionLinks {
  parentSessionId
  childSessionId
  relation             // delegated | forked | merged | referenced
  createdById
  createdAt
}
```

修改 `agentRuns`：增加 `sessionId`。一个 Session 可以有多次 run（失败重试、换模型重跑），但同时只能有一个 active run。

### 7.2 Session 页面

协同室三栏：

```text
左：Session 树               中：当前 Session                 右：控制与证据
主研究                      目标、完成条件                    负责人/AI
├ 数据调查                  对话与运行事件                    Context Pack
├ 方案 A                    产物预览                          权限请求
└ 方案 B                    人类追加指令                      证据与结果
```

与普通聊天的关键区别：

- 顶部先显示目标与完成条件，消息在其后；
- 运行状态与消息同屏；
- Agent 请求权限时 Session 进入 `needs_input`；
- 团队成员可以补充指令或拒绝动作；
- 结果必须进入 evidence/result，而不是停在最后一条聊天消息。

### 7.3 Session 控制能力

首版支持：

- 创建并关联任务；
- 指派给人或 AI；
- 开始/暂停/取消 run；
- 追加指令；
- 上报阻塞；
- 创建子 Session；
- 查看子 Session 状态；
- 将子 Session 结果带回父 Session；
- 提交待验收。

不支持：远程 shell、任意文件系统、自动读成员私人对话。

## 8. 更适合高校场景的创意

### 8.1 AI 接力单

一个 Agent 做完不直接“完成”，而是生成接力单：

- 我完成了什么；
- 我用了哪些上下文；
- 哪些是假设；
- 哪些没解决；
- 下一位应该做什么；
- 我带回了哪些证据。

下一位人或 Agent 必须接住/接不住。这样上下文继承不是复制聊天，而是有结构的交接。

### 8.2 双轨产出：人类判断与 AI 产物分开

每项成果展示：

- AI 生成部分；
- 人类修改部分；
- 人类最终决定；
- 来源资料；
- 验收人。

这既解决可信度，也能回应课程中的学术诚信问题。

### 8.3 反方 Session

提交重要方案前，可一键创建“反方 Session”：

- 不负责重写方案；
- 专门找证据不足、逻辑跳跃、遗漏用户、实施风险；
- 输出质疑清单；
- 原 Session 逐条回应后才能提交验收。

它比“AI 帮我润色”更有协作价值，也适合开题、答辩和实验设计。

### 8.4 上下文覆盖图

Context Pack 旁显示：

- 已读项目目标；
- 已读用户调研；
- 已读任务依赖；
- 未读老师反馈；
- 过期数据；
- 相互冲突的文档。

目的不是显示 token 数，而是告诉团队“AI 的结论覆盖了哪些材料、漏了哪些材料”。

### 8.5 决策回放

在记录页选择一条决策，可以回放：

```text
问题提出 → 两个方案 Session → 关键证据 → 人类选择 → AI 动作批准 → 任务结果
```

这比完整聊天记录更适合老师查看，也更适合复盘。

### 8.6 协调者 Session

一个 coordinate Session 可以把大目标拆给多个 Agent：

- 调研 Agent：整理访谈问题；
- 数据 Agent：分析问卷；
- 设计 Agent：提出交互方案；
- 反方 Agent：审查风险。

协调者只能创建“草案子 Session”，由人确认分派和权限；不能自行无限扩张任务。

### 8.7 上下文保鲜

上下文包冻结后，若任务、老师反馈或文档更新，显示：

> 此 Session 使用的上下文已落后 2 项：老师反馈已更新、任务截止日已变化。

用户选择：继续旧上下文、生成新版本、查看差异。这样“上下文继承”不会继承错误。

### 8.8 AI 贡献边界

自动生成一张“AI 参与说明”：

- 哪些任务由 AI 执行；
- 哪些决策由人确认；
- 哪些成果经人工修改；
- 哪些内容未经验证；
- 使用了哪些模型/Agent。

导出时可附在课程报告后，避免项目把 AI 使用藏起来。

## 9. Lody 主线的最小可演示版本

不要一开始实现所有创意。最小演示只做六步：

1. 从任务创建 execute Session；
2. 选择一个 AI 成员和冻结 Context Pack；
3. Agent 从 inbox 领取 Session，页面显示 running；
4. Agent 创建一个 child Session 调查子问题；
5. 子 Session 返回结构化接力单和证据；
6. 父 Session 汇总后提交，人类查看证据并验收。

如果这六步顺畅，已经能清晰证明：

> AgileCampus 不是“看别人和 AI 聊了什么”，而是“团队能看见 AI 工作怎样被派发、分叉、交接、收回和验收”。

## 10. 建议的下游 AI 工作单

下一位下游 AI 只执行 Sprint A，不允许直接做数据库大迁移：

```text
请在 feat/risk-aware-closure 当前 HEAD 上执行
docs/reviews/2026-09-20-downstream-ai-acceptance-and-lody-next.md 的 Sprint A。

先复现五个 P1 问题，重点是：登录仍进 /teams、today task 深链无抽屉、
协作徽章口径不一致。先写失败测试，再做最小修复。不要开始 Context Pack、
Session 或多 Agent schema；Sprint A 的目标是让当前新骨架每个入口都能完成动作。

完成后运行 npm test、npm run lint、npm run build，并分别用 admin、teacher、student
验证 /today → task drawer → 接住/提交/验收。输出修改文件、测试结果、浏览器证据和剩余风险。
```
