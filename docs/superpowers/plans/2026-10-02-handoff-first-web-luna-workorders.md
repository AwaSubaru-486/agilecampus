# Luna 工单：把人–Agent 交接落实到网页主流程

状态：只交付工单，尚未施工。用户 2026-10-02 明确要求“列工单就行，让 Luna 干活”。本文件不是功能完成声明，也不要求当前编写者启动 Luna。

## 0. Luna 从这里开始

你的任务是让用户在网页上完成并理解：**选任务 → 看上次留下的工作 → 明确交接要求与资料 → 指定接手人 → 接手人核对并继续 → 留下成果 → 人工验收**。

当前网页仍是旧看板加独立聊天页。不要继续只完善看不见的规则层，也不要只改“AI 协作”的名字。第一批交付必须让用户打开现有项目 URL 就能看到新工作面。

本文件是本轮网页重构的执行入口。在网页布局、导航和交付批次上优先于 2026-09-30 网页计划；那份计划的领域语义、权限、真实能力限制继续有效。VS Code 的 E00–E10 是独立专项，不要从 E00 重新做一遍。

首次执行 **W00 → W01 → W02 → W03**，完成可见的只读工作面后停下来验收。不能做完 W00 数据盘点就声称第一批已完成。用户后续说“继续”时，从进度中第一个未完成工单执行；明确要求连续全部执行时，可按依赖顺序连做。

本轮允许 Luna 修改下文点名的网页布局、导航及组件，不受旧 Antigravity UI 文件分工阻挡；不得覆盖其他执行者未提交内容，不修改 VS Code。只改所需业务包装入口；共享后端状态机和数据库变更另外列单。

## 1. 已核对的现状，先分清做到了哪一步

核对仓库：`/Users/qwsdjivc/agilecampus-ai`，当时 HEAD `bc0b28d`。这是审计标记，不得 checkout 回该提交。启动时再次检查当前 HEAD。

| 对象 | 实际存在的代码 | 本轮判断 |
| --- | --- | --- |
| 任务、交接契约、认领版本、提交与验收 | `src/lib/task.ts`、`src/lib/handoff.ts` | 领域能力已有，网页主界面没有完整呈现 |
| 行动优先排序、运行状态、主动作规则 | `src/lib/collaboration-console-view.ts` | 已有，不重新发明 |
| 鉴权的任务/运行/事件只读投影 | `src/lib/collaboration-console.ts` | 本次看到的是未跟踪工作区文件，须检查并验收，不能当作已提交成果 |
| 只读投影权限测试 | `tests/collaboration-console.test.ts` | 同样是已有未跟踪工作，不归本轮自动接管 |
| 网页默认项目视图 | `src/lib/project-space.ts` 的 `DEFAULT_SPACE = live` | 仍进入旧概览 |
| 任务界面 | `_work/work-space.tsx` 挂载 `Board` | 仍围绕看板卡片，而非交接工作面 |
| AI 页面 | `_studio/studio-space.tsx` 挂载 `ChatPanel` | 仍是独立会话中心 |
| 网页上下文快照、会话 fork | `context-pack-builder.tsx`、`chat-panel.tsx` 与对应 API | 真实接口存在，但没有形成清晰交接路径 |
| 本地检查点、包导入导出、接续检查、并行 worktree | `vscode-extension/**` | 有实现及测试，宿主与真实执行验收须读该专项 progress；不能仅凭文件存在宣称可演示 |
| 网页读取队友本地检查点、同步本地尝试 | `docs/reviews/vscode-checkpoint/backend-contract.md` | E09 仍是待签收提案，不能假装已有 HTTP 接口 |

本轮开始前已经存在的未提交文件：

```text
src/lib/approval.ts
src/lib/collaboration-console.ts
tests/collaboration-console.test.ts
vscode-extension/src/views/project-view-provider.ts
vscode-extension/webview/src/App.tsx
```

执行时以实际 `git status` 为准。可以阅读、测试已有代码；不得重写、删除或把别人的改动混进自己的提交。确需修改重叠区域，先给出具体 diff 和原因并记录协调结果。

编写本工单时曾短暂新增 `src/lib/console-navigation.ts`、`_console/actions.ts`，并修改路由标签和 ActionBlock export；用户改为只要工单后，这些施工改动已精确撤回。**不要寻找它们作为已有实现。**

## 2. 当前混乱的明确原因

1. 页面按“任务 / AI 聊天 / 概览”分开，用户必须自己拼出任务如何交给 Agent。
2. `task-card.tsx` 的 `deepLinked` 用 `?task=` 自动打开编辑框；`page.tsx` 同时挂载 `TaskDrawer`，一个任务链接可能打开两个层。详情选择和编辑操作必须分开。
3. `ChatPanel` 的上下文列使用 `hidden ... xl:block`，中小宽度无法操作上下文。
4. `selectConversationForWorkspace` 最后回落到项目第一条会话；指定任务没有会话时，可能打开另一任务的会话。新工作面必须严格限定关联。
5. `ChatPanel` 初始化 `creating = Boolean(initialTask)`，即便任务已有会话，也可能默认展开新建表单。
6. 运行、冻结上下文、交接契约、人工确认已有各自实现，但缺少同一任务下的关联展示。
7. 网页会话分叉、代码分支、可恢复检查点混用措辞。用户无法判断点击按钮究竟会产生什么。

## 3. 固定界面，照这个做

### 3.1 导航

全局一级：今日 / 项目 / 协作中心。

进入具体项目后，项目二级：项目列表 / **协同执行** / **Agent 协作** / **成果记录**。

- 协同执行是默认页。
- Agent 协作复用同一个执行台，左侧显示真实运行摘要或带运行的任务；选中后中央仍是同一任务的契约与成果，右侧为所选 Run。运行列表无数据时显示“暂无执行记录”，提供回任务列表的入口。
- 会话放在所选任务内的“会话与分支”，不再作为独立的默认 AI 首页。
- 无具体项目时仅展示项目列表；不得擅自使用 `projects[0]` 作为当前项目。
- 侧栏保留收起/展开；手机导航关闭必须在 query 变化时也生效，不能只监听 pathname。
- 未关联任务的历史会话移到显式的“项目会话”次要入口，保留可访问性，不删除历史。

### 3.2 桌面工作面

```text
固定侧栏     当前项目                                      新建任务  更多
             搜索任务  状态筛选  负责人筛选
             ┌任务列表────────┬交接工作面──────────────────┬执行记录─────────┐
             │需处理          │任务名       任务状态        │Agent / Run 状态 │
             │任务名/负责人   │负责人 / 截止                │真实时间与结果   │
             │任务与运行状态  │                             │错误/阻塞输入    │
             │               │任务目标                     │                 │
             │进行中          │交接要求 / 完成条件          │会话与分支       │
             │               │冻结资料 / 来源 / 变更提示   │按需展开消息     │
             │已完成（折叠）  │                             │                 │
             │               │交付证据 / 人工验收          │任务活动         │
             └───────────────┴─────────────────────────────┴─────────────────┘
```

重点不是把所有信息铺满：中央默认只展开交接要求、当前冻结资料和当前可执行动作。较长证据列表、历史任务活动、完整对话按需展开。用户输入的真实任务描述保留；标题下介绍性副标题全部删除。

中央主动作按真实条件出现：补充交接 / 确认认领 / 提交成果 / 验收。没有网页执行器接口，就不出现“启动 Agent”“恢复执行”“停止运行”可用按钮。

“最近记录”要标明来源：运行结果、任务活动、协作会话。普通事件没有代码基线，不能称为“可恢复断点”。

### 3.3 样式与响应式

- 保持黑灰中性主题与现有 system sans，不换暖灰，不添加装饰点、彩色竖线、虚线大框、渐变、标语、统计卡片墙。
- 复用 `src/components/ui/`，先读组件实际 props；仓库目前不是已装好完整 shadcn/Radix 的环境，禁止假设有依赖。
- 普通面板无阴影，分栏 0 圆角，控件沿用 6px；正文 14px，元数据 12px，任务标题 16px；哈希/路径用 mono。
- 按内容容器宽度而非浏览器总宽度响应：≥1120px 三栏（280 / 剩余 / 320）；760–1119px 任务+详情，执行轨通过“执行记录”按钮打开已有抽屉；<760px 列表与详情二选一，详情有“返回任务”。
- 小屏仍能看上下文、分支、证据和验收，不能通过 hidden 隐去能力。不要把三栏堆成一条超长页面。
- 任务行至少 44px；明确键盘焦点。抽屉 Escape 关闭、焦点回原按钮；同一时刻只有一个详情层。

## 4. 代码组织和数据来源

新组件统一放在 `src/app/(app)/projects/[projectId]/_console/`，避免在已有大型组件中再堆一整套工作台。

| 文件 | 职责 |
| --- | --- |
| `execution-console.tsx` | 服务端编排，读取当前项目、任务及选中详情，定义唯一工作面 |
| `console-shell.tsx` | 客户端容器、响应式、窄屏列表/详情、执行记录抽屉 |
| `task-list.tsx` | 任务行、状态筛选、完成组收起、分页 |
| `task-contract-panel.tsx` | 任务目标、交接契约、版本确认、冻结资料、真实动作 |
| `handoff-editor.tsx` | 交接表单，复用既有写入规则 |
| `agent-run-rail.tsx` | 当前/历史 Run、结果/错误、任务活动、人工输入 |
| `task-conversations.tsx` | 只读会话来源及会话操作容器，复用聊天与 fork，不另造聊天协议 |
| `evidence-list.tsx` | 所选任务交付物、来源与验收入口 |
| `src/lib/console-navigation.ts` | 纯 URL 归一化、选择与清除旧关联规则 |

实际函数先看本地返回类型，不允许 `any` 或 `as unknown as` 掩盖数据不一致。

| 信息/动作 | 复用入口 | 必须保留的条件 |
| --- | --- | --- |
| 项目权限 | `getProjectForUser` | 在查询详情前鉴权 |
| 任务摘要 | `listConsoleTasks` | 每页 50、批量 Run/阻塞摘要；这是当前页，不冒充整个项目总数 |
| 行动排序 | `sortTaskRows` / `toTaskRowModel` | 复用已有优先级、Task/Run 独立语义 |
| 所选任务 | `getConsoleTask` | task 必须属于选定项目；上下文不可读时不能泄露正文 |
| Run/活动翻页 | `listConsoleRuns` / `listConsoleEvents` | 默认各 30，真实 cursor/hasMore；不能仅 slice 隐藏更多 |
| 所选 Run 结果 | `getConsoleRun` | 同时校验 project、task、run，正文按需读取 |
| 会话 | `listProjectConversations`、`getConsoleConversation` | private 权限 + 当前任务关联；显式不存在的 ID 不静默换其他会话 |
| 人工审批 | `getApprovalRequestForUser` / `listApprovalRequests`、`ApprovalDetail` | 按可见来源会话关联任务；使用 canResolve，非所有管理员都能处理任意工具审批 |
| 阻塞 | `listProjectBlockers`、`resolveBlockerAction` | 过滤当前 taskId，复用权限，项目级阻塞不能附会到单个 Run |
| 创建/冻结快照 | `ContextPackBuilder`、现有 context-packs / preview / freeze API | 创建者权限、来源权限、冻结状态；冻结成功不等于已绑定交接契约 |
| 修改交接、改派 | `updateTask` | 角色、成员归属、版本递增、改派重置认领；禁止客户端直接写 DB |
| 认领/拒绝/提交/验收 | 项目 `actions.ts` 与 `TaskDrawer` 的动作表单 | 提取共用内容，复用服务端校验；不能复制一套状态机 |
| 交付证据 | `/api/tasks/[taskId]/evidence`、`listTaskEvidence` | 权限、类型、真实来源；链接不代表服务器已验证内容 |
| 会话分支 | `/api/conversations/[conversationId]/fork` | `throughMessageId` 必填，HTTP 201 返回 conversation；不代表 worktree 创建 |

## 5. 逐单执行

### W00 — 接管现状与验证读取层

输入：本文件、`AGENTS.md`、旧网页 runbook、`docs/reviews/vscode-checkpoint/progress.md`。

操作：

1. 运行 `git status --short --branch`、`git rev-parse HEAD`、`git diff --stat`，把未提交文件清单写入本轮 progress。
2. 核对第 1、2 节事实有没有改变；已经实现的保留，不重做。
3. 阅读并运行已有 `collaboration-console-view`、`collaboration-console` 测试。执行依赖 `.env.test` 的测试前，只核实测试库身份与开发库不同，不打印凭据；无法确认则禁止运行 resetDb。
4. 记录读取层是否可用、是否存在接口缺口。真实不可用不得用样例数据替代。
5. 创建 `docs/reviews/2026-10-02-handoff-web-progress.md`，按第 8 节格式维护。

验收：能指出任务、Run、交接、上下文、会话、证据的真实入口；已有未提交代码未被覆盖。完成本单后继续 W01。

### W01 — 统一选择和路由，修掉叠层

修改：新增 `console-navigation.ts` 与对应纯函数测试；改 `page.tsx`、`project-space.ts`、`top-workbar.tsx`、`task-card.tsx` 的选择职责。布局切换与 W02/W03 配套，不能交付半挂载页。

精确规则：

| 输入 | 规范化结果 |
| --- | --- |
| 缺省/非法 space | `space=work` |
| `space=live` | `space=work`，保留合法筛选与关联参数 |
| `space=work` | 协同执行 |
| `space=studio` | 同一执行台的 Agent 视图 |
| `space=record` | 成果记录 |
| 非空 conversation/approval | `space=studio`，服务端验证对象及关联任务后展示来源 |

- 数组参数取第一项，重复归一化结果不变，不产生重定向循环。
- 点击任务使用 push，保留筛选；清除旧 `run/conversation/approval` 及其游标。
- 默认选当前页排序最前的待处理任务，用 replace 补入 URL；窄屏默认仍显示列表，使用 `panel=list` 区分。显式 task 链接直接显示详情。
- 指定 task 无权限/不存在，显示统一错误；指定 conversation/run/approval 与 task 不匹配，不自动换绑或回落。
- 没有显式 task、但给出合法 conversation/approval，可从已授权来源解析 task；旧无任务会话使用“项目会话”入口，不绑定到第一项任务。
- `?task=` 只用于查看详情；编辑由明确“编辑”按钮或 `edit=` 控制。移除 task-card 中由 task 参数自动打开编辑框的逻辑。
- 新执行台自己承载详情时，`page.tsx` 不再额外挂一个 TaskDrawer。

验收：刷新/返回恢复同一任务，A→B 不残留 A 的会话与运行；旧 URL 不坏；一个任务链接只有一个详情工作面。

### W02 — 挂载任务列表和交接主面板

修改：`_console/execution-console.tsx`、`console-shell.tsx`、`task-list.tsx`、`task-contract-panel.tsx`，以及 `_work/work-space.tsx` 的挂载。

步骤：

1. 先鉴权，调用只读投影；客户端只接可序列化摘要，不能 import 数据库模块。
2. 主界面使用第 3 节布局；任务行只放标题、负责人、Task 状态、Run 状态、截止。已完成默认收起；选中已完成深链时自动展开该组。
3. 选择任务后，在中央显示其 description / handoffBrief / doneCriteria / requiredEvidence / responseDueAt、负责人、版本和已认领版本。没有内容显示“未填写”，不能生成漂亮但虚假的交接摘要。
4. 当前绑定上下文显示标题、状态、冻结时间、来源名称和 stale 提示；不可读显示“无权查看此资料”，不能显示其私密摘要。
5. 显示当前真实 blocker 的原因与所需输入；保留已有解决入口，在 W05 补齐统一动作。
6. 把新建任务复用到顶部；原看板放在明确的 `view=board` 次要入口，“返回协同执行”可返回；原时间线等能力放“更多”，不能静默删除。
7. 分页必须有下一页/加载更多和已加载数；只对当前页排序时标注“当前页”，不得冒充全项目优先级排序。跨页任务详情可以合法打开。
8. 原 assignee/priority/label/milestone/overdue 参数不能悄悄失效。新投影缺少 label/milestone 字段时，在只读层补摘要或先保留明确的看板筛选入口；不得把筛选控件显示为生效但读未筛选数据。

验收：用户在既有 `/projects/:id?space=work` 看到的是任务列表加交接面板，能读出“谁负责、任务要什么、交接资料在哪”。不是旧卡片换文案。

### W03 — 接上真实执行记录，形成第一批可见交付

修改：`agent-run-rail.tsx`、必要读取编排、`_studio/studio-space.tsx` 和侧栏标签。复用 W02，不新建另一套执行台。

步骤：

1. 右侧显示选中任务的真实 Run 摘要；`getConsoleRun` 只读取明确选定运行的结果/错误。无 Run 写“暂无执行记录”。
2. Agent 视图左栏默认显示当前已加载任务的活动/最近运行，标清列表范围。历史运行通过该任务的 `listConsoleRuns` 翻页获取，不能把每任务一条摘要说成全部历史。
3. 分开显示 Task 与 Run 状态；completed Run + doing Task 仍显示任务进行中。
4. 任务活动单独命名“任务活动”；没有 runId 的事件不可划进某个 Run。
5. 出现 pending approval 时按工具权限展示确认入口。未有 Run 的 Agent 任务也不能伪造“运行中”。
6. 未发现网页可调用的真实执行控制接口，取消“继续 AI 工作”这类歧义按钮；进入对话准确称“查看任务会话”，恢复代码执行不冒充聊天。
7. 小屏通过执行记录抽屉访问同样数据；上下文资料仍在中央可见。
8. 若有活动运行，页面前台每 10 秒 router.refresh；后台/卸载清理，不覆盖未提交表单，不用 POST 上报轮询。无活动运行不持续刷新。

第一批验收场景：打开项目 → 选一条 Agent 任务 → 同屏找到交接要求、资料和真实 Run → 换另一任务确认没有旧数据 → 窄屏同样能访问。提供桌面与窄屏截图和实际 URL，然后停下来给用户验收。

### W04 — 交接资料真正可保存、可绑定、可确认

前提：第一批通过。修改 `handoff-editor.tsx`、`context-pack-builder.tsx`；允许新增网页 server action 包装既有 updateTask，先核对 actions 是否已经支持这些字段。

表单字段固定：接手人（人/Agent 名称）、handoffBrief、doneCriteria（每行一条）、requiredEvidence、responseDueAt、已冻结 contextPackId。显示当前 handoffVersion 和已确认版本，不给用户直接编辑版本号。

步骤与边界：

1. 任务页直接“编辑交接”，不要求先创建聊天。保存只调用已有 updateTask 权限和契约逻辑；改变负责人后旧认领不得继续生效。
2. 快照流程：选择来源 → 预览 → 创建并冻结 → 明确选择为交接资料 → 保存交接契约。每步真实结果分别显示，不把“快照冻结成功”误报为“交接完成”。
3. ContextPackBuilder 不再限制在 xl 屏幕；复用到中央的明确展开区。仅列当前任务允许使用的包，服务端再次验证项目、任务、来源权限和 frozen 状态。
4. 已绑定私密会话的包不得因挂到任务就泄露；接手人不可读必须提示，不能绕过源权限。
5. 注意 `updateTask` 当前使用 `patch.x ?? task.x` 合并部分字段：null 未必真能清空。UI 不得允许清空后假报成功；本单优先仅提供替换冻结包。若必须修复清空或并发版本语义，另写最小领域修改与测试后交核心负责人处理。
6. 表单保存失败保留输入；成功显示新版本并刷新。编辑中发现版本变化时提示重新读取，不自动覆盖。没有原子版本比较接口时，在进度里注明并发写限制，不能把“保存前读一次”宣传为并发安全。
7. review/done 任务不直接改派或覆盖验收基线，使用现有退回流程。按真实权限显示表单，服务端拒绝仍须正确呈现。

验收：保存后刷新仍是同一交接要求和快照；改派重置认领；旧契约的提交仍被服务端拒绝；私密快照跨账号不可读。

### W05 — 认领、阻塞、交付、人工验收收进同一面板

修改：提取 `TaskDrawer` 现有动作内容为共享组件，在抽屉和中央使用同一套组件。接 `evidence-list.tsx` 与既有 evidence API。

- 保留 claim/decline/submit/review 原动作签名和权限；依据真实状态决定主动作。不要复制一套用客户端 setStatus 的捷径。
- 未认领或交接版本已变化，提示确认当前要求；能否确认由原 action 判断。
- blocker 显示原因和所需输入，解决使用 `resolveBlockerAction`；不能通过改 Task 状态掩盖阻塞。
- 证据显示类型、名称、提交人/时间、来源；有真实代码链接才展示提交/PR。没有 diff 不画 diff，没有测试结果不打绿勾。
- 提交证据失败不进入 review，review 只允许权限角色，退回必填说明；不允许跨栏拖动变 done。
- 教师/admin 的验收行为仍复用现有领域规则，不自行发明审核政策。

验收：在隔离测试数据中，成员提交真实证据 → 有权限者通过/退回 → 页面刷新状态一致；不足证据、无权限、重复提交有可见错误。不要为演示擅自把用户现有任务验收完成。

### W06 — 会话继承与分叉嵌入任务，修正误绑定

修改：`task-conversations.tsx`、`ChatPanel`、`ConversationTree`、`StudioSpace` 读取逻辑及选择规则测试。

1. 默认折叠完整会话正文，入口叫“会话与分支”；列表只包含当前 taskId 下当前用户可读的会话。项目级无任务会话保留在明确的项目会话入口。
2. 显式 task 没有会话时显示“该任务暂无会话”；禁止回落其他任务最近会话。显式 conversation 不可读/不匹配时，显示错误而不是静默切换。
3. 已有会话时默认查看，不自动展开新建。新建从当前任务带入 taskId；成功后更新 URL 与列表，刷新后保持选择。
4. 复用 fork API：指定实际存在的 throughMessageId，成功后才切换；显示父会话和来源消息。按钮用“从此消息创建会话分支”。
5. 分支保留先前授权消息；fork 不意味着已创建 Git 分支、worktree 或启动执行器。来源不可读时不越权补全文。
6. 明确保留 forkedFromMessageId/sourceMessageId；会话改名不丢父来源。
7. 切换任务或会话时取消/忽略旧请求响应；A 的慢响应不能覆盖 B。发送失败保留用户文本，不把失败消息当作已保存。
8. 聊天发送前必须使用当前可验证会话/任务；不能通过缺省 conversationId 让服务端随便复用项目其他会话。

验收：A 任务会话中从一条消息分叉，B 分支能看见继承来源；刷新和返回保持选择。切换另一任务后不混入消息。mock API 测试与真实浏览器 fork 结果分别记录。

### W07 — 明确网页与 VS Code 检查点边界

本单完成显示与交付说明，不实现未签收共享接口，不修改扩展。

- 在交接资料的展开区展示“本地检查点”接入状态：当前未接入共享读取，网页不能枚举队友本地 session。不要永久占据首页大横幅。
- 提供与当前扩展 README 一致的操作说明：保存本地检查点 → 选择材料导出 JSON → 队友导入 → 检查接续条件 → context-only 新会话继续或建立并行 worktree。
- 准确区分“带材料启动新会话”与“原生恢复同一 session”；当前 native resume unsupported。
- 不添加点击后没效果的“上传 session”“查看本地断点”“恢复 Agent”按钮，不伪造 VS Code deep link 命令。
- 记录会话、上下文包、Checkpoint、Attempt、AgentRun 的区别，提供后续 B01 对接字段清单。

验收：用户能知道网页现在记录什么、扩展本机记录什么、队友怎样取得材料；没有任何文案暗示同步已完成。

### W08 — 全流程回归与交付

执行第 7 节验收。修复本轮引入问题；完成实测后更新 README 功能状态，而不是写“全链路完成”。

移除已无引用的旧挂载点前先 rg 查引用；原看板、时间线、项目资料不能无入口。不要借本单重做今日/资料库所有页面。

## 6. 后续核心功能，单独启动 B 系列

这部分直接服务用户负责的 session 记忆与接续，但**不在 W00–W08 网页施工中冒充完成**。

| 工单 | 产出与边界 | 最小验收 |
| --- | --- | --- |
| B01 共享契约签收 | 复核既有 E09 backend-contract：身份、Checkpoint 摘要、选中材料、人工分配/接收、Attempt 回执、权限/幂等/版本冲突；明确存放位置和保留范围 | 网页、后端、扩展对同一份契约签收，不重复造一份冲突 API |
| B02 小体积检查点共享 | 按 B01 实现任务绑定摘要、repo identity/base SHA、已完成/阻塞/下一步、材料索引；先同步摘要和用户选择的材料，不备份整个工作区，不默认上传全部 transcript | 两个成员身份跨环境，A 分享后 B 读到同一版本；未分享不可见、撤权立即生效、重试不重复 |
| B03 接班核对 | 任务契约版本、Git 基线、dirty 状态、材料完整性、权限；输出通过/不匹配及具体原因 | 改了代码基线或契约后旧接续计划失效，不能带错背景继续 |
| B04 同源并行方案 | 复用朋友负责的 worktree：共同 checkpoint/base SHA、不同 attempt/目录，网页只聚合有来源的结果与验证证据 | 两种方案从同起点独立运行；人选择方案，不自动合并、不自动判优 |
| B05 有效项目记忆 | 每条记忆记录来源、适用任务/代码版本、作者/确认者、有效/待复核/已替代；新结论不能悄悄覆盖旧证据 | 需求/代码变化可标记需复核；接手材料优先使用有效版本，能追溯为何更新 |

顺序 B01 → B02 → B03；B04 在 B02 与 worktree 约定稳定后做；B05 先少量高价值约束和已验证结论，不做全项目无限总结。web 表格列出已有记录即可，不要求 AI 算法自动判断所有记忆正确性。

## 7. 可重复验收，不靠描述打勾

### 自动检查

按本单风险执行相关测试；最终 W08 运行完整检查。使用仓库现有脚本，不另装测试框架：

```bash
npm run check:ui-copy
npm run lint
npx tsc --noEmit
npm test -- tests/collaboration-console-view.test.ts tests/collaboration-console.test.ts tests/project-space.test.ts tests/conversation-selection.test.ts tests/console-navigation.test.ts
npm test
npm run build
git diff --check
```

`console-navigation.test.ts` 是 W01 要新增的文件，其余先查实际路径。集成测试有清库逻辑，必须确认独立测试库；环境不可用就记录未测，禁止对开发库执行 resetDb、db:push 或重灌数据。

必须覆盖的行为：默认/旧路由归一化幂等；任务切换清关联；非法关联 ID；private 隔离；分页不重不漏；无 Run；completed Run 与 doing Task 不混淆；交接版本变化与未认领；证据不足；审核权限；fork 失败；异步切换旧响应。

### 浏览器验收

起始 URL 使用用户现有 `http://localhost:3000/projects/d0000000-0000-4000-8000-000000000201?space=work`。先检查 3000 已有进程，不重复起服务，不擅自杀其他人的进程。

| 操作 | 可见结果 |
| --- | --- |
| 打开项目旧 work/live/无 space 链接 | 默认新执行台，侧栏二级一致，无旧长概览首页 |
| 选任务 A，再选 B，再浏览器返回 | 回到 A；无 B 的 Run、会话、审批残留 |
| 打开 Agent 任务 | 负责人和真实运行分别呈现；没有 Run 就明确暂无 |
| 展开交接资料 | 看得到来源、冻结版本、需复核信息；手机也能操作 |
| 点击任务 | 仅中央详情或一层窄屏详情，没有编辑框与抽屉叠加 |
| 看板/时间线/项目会话入口 | 能访问，能返回同一项目，不丢历史资料 |
| 交接保存、改派、认领、提交、退回/通过 | 在专用测试项目操作；每步刷新读回数据库真实状态 |
| 会话 fork | 来源和新会话可追溯，不显示代码已恢复 |
| 宽度 1440/1024/615/390；侧栏收起和展开 | 无全页横向溢出；任务/资料/执行记录均有入口；关闭弹层可键盘操作 |

演示数据可用于说明操作入口，不得作为真实 Agent 成功执行的证据。用户当前项目只做非破坏性查看；需要写入验收时使用隔离测试场景。

截图必须实际生成并查看，记录路径、视口和对应步骤。未打开浏览器不可写“视觉通过”。不要用“AI 味分数”代替用户可理解的操作验收。

## 8. 进度和交付格式

每单完成追加到 `docs/reviews/2026-10-02-handoff-web-progress.md`：

```text
工单：Wxx
状态：未开始 / 进行中 / 代码完成待实测 / 验收通过 / 阻塞
起点 HEAD：
本单修改文件：
保留的他人未提交文件：
用户现在可点击的入口和变化：
实际复用函数/API：
验证命令、退出码、浏览器操作结果：
尚未实现 / 未验证：
下一单：
```

每单独立提交时只 stage 本单明确文件，绝不 `git add .`；包含别人未提交模块的依赖时先说明，不能提交一个缺少必要依赖、克隆后跑不起来的结果。不要自行 push、发布扩展、部署服务。

给用户的交付文字先说“打开哪里 → 点击什么 → 与原来有何变化”，再报检查和限制；不得用文件数量、测试数量冒充产品完成度。

## 9. 可直接交给 Luna 的启动指令

> 读取 AGENTS.md 和 docs/superpowers/plans/2026-10-02-handoff-first-web-luna-workorders.md，按 W00→W03 完成第一批可见网页重构。任务是把交接契约、冻结资料与真实 Agent 运行接到同一项目执行台，不能只改规则文件或重命名聊天页。保留工作区原有未提交改动，不改 VS Code、不伪造同步或原生 session 恢复。保留旧链接和历史会话，修复 task 参数打开两层弹窗的问题。桌面与窄屏实际验证后更新 progress，给出可点击入口与截图，停下来让我验收。
