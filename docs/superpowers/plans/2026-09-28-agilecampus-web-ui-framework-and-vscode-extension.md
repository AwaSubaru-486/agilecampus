# AgileCampus 网页端 UI 框架与 VS Code 双端计划

> 状态：已确认，作为网页端 UI 重构与 VS Code 扩展开发的唯一施工计划。
>
> 本文解决两个问题：第一，在保留 AgileCampus 业务功能的前提下，使用成熟开源 Web UI 组件改造网页端；第二，增加 VS Code 扩展入口，让开发者在编辑器里同时查看 GitHub、AI 协作和项目进度。
>
> 本计划不要求把项目迁移到 GitHub Projects，也不要求把网页端改造成 VS Code 页面。网页端和扩展端是两个入口，共用同一套 AgileCampus 服务端、任务数据、AI 会话和权限规则。

## 1. 已确认的技术组合

### 1.1 当前基线

以施工开始时的实际代码为准，不以旧计划中的提交号为准。当前基线为：

| 层 | 当前实现 | 计划中的处理 |
| --- | --- | --- |
| Web 框架 | Next.js 16 App Router | 保留 |
| UI 运行时 | React 19 | 保留 |
| 样式 | Tailwind CSS 4 + `src/app/globals.css` tokens | 保留 tokens，补充可复用组件 |
| 服务端 | Next Route Handlers、Server Components、Server Actions | 保留，不把业务搬到前端 |
| 数据 | PostgreSQL + Drizzle | 保留 |
| 权限 | Auth.js + 领域层权限校验 | 保留，扩展端不能绕过 |
| AI | Vercel AI SDK + OpenAI-compatible provider | 保留 `/api/chat` 和 Agent API |
| 测试 | Vitest、ESLint、Next build | 每阶段继续执行 |

### 1.2 开源复用组合

| 方案 | 用途 | 许可证/状态 | 决策 |
| --- | --- | --- | --- |
| [TailGrids](https://github.com/TailGrids/tailgrids) | Tailwind 原生的 Button、Tabs、Drawer、Command、Table、Progress、Toast、Timeline 等组件和布局片段 | MIT；支持 React、Next.js、Tailwind | **网页端主要复用对象；以本地组件为主，不把示例站当运行时依赖** |
| [Primer React](https://github.com/primer/react) | GitHub Issue、PR、Label、评论、状态和时间线的交互参考；只有在 peer dependency 与 React 19 兼容且确有必要时才引入单个组件 | MIT；GitHub 官方 React 设计系统 | **默认只参考，不在 S1 安装** |
| [Thinboard](https://github.com/claretnnamocha/thinboard) | Next.js 后台壳、侧栏、页面标题、表格和 Drawer 的结构参考 | MIT；示例模板，不含业务后端 | **只参考结构，不整体覆盖** |
| [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview) | 扩展侧栏和编辑器面板 | VS Code 官方 API | **扩展端实现基础** |
| [GitHub Actions VS Code](https://github.com/github/vscode-github-actions) | GitHub 登录、工作区仓库、Workflow/Run/日志在编辑器内呈现的实现参考 | MIT；GitHub 官方扩展 | **只参考扩展架构，不复制无关代码** |

### 1.3 组合没有冲突的原因

1. TailGrids 的主要交付物是可审计的 Tailwind 组件代码和布局片段，可以逐个吸收，不需要更换 Next.js、路由或数据层；每个复制片段都记录来源提交和许可证。
2. Primer React 只承担 GitHub 语义组件，不作为全站皮肤；默认用本地实现复刻所需交互，只有依赖兼容性和体积都通过审计时才引入包，避免网页端变成 GitHub 克隆。
3. Thinboard 的功能是页面壳参考。AgileCampus 已有项目四空间、任务抽屉和 AI 协作室，因此只吸收它的布局节奏和组件组织方式。
4. VS Code 扩展通过 API 与网页端共享数据，不复制一套任务状态机。扩展只负责展示、调用命令和把编辑器事件传回服务端。
5. 许可证只允许在真正复制代码时加入第三方声明。仅参考交互或组件 API 不写成“已集成”。如果复制非平凡代码，必须把仓库 URL、许可证、提交号和文件映射补进 `THIRD_PARTY_NOTICES.md`。

## 2. 不可改变的产品边界

下面这些行为属于现有产品契约，UI 重构和扩展开发都不能破坏：

- 任务状态仍由领域层控制，状态分组看板不能通过跨列拖动直接修改状态；
- 任务只能经过“接住 → 提交待验收 → 人工验收”进入完成；
- AI 可以提出任务、决策、风险和文档草案，但写入项目必须经过人工确认；
- 项目私有会话、私有 Context Pack 和未授权资料不能出现在共享会话、网页端或扩展端；
- URL 中的 `space`、`task`、`conversation` 和筛选条件必须能复制、刷新和前进后退恢复；
- 现有 `/today`、`/projects`、`/collaboration`、`/library`、`/settings` 和项目四空间继续有效；
- 现有 Agent API 的 Personal API Token 只允许访问该 Agent 有权限的项目；
- 扩展端不保存大模型密钥，不在 Webview 中直接放置 GitHub Personal Access Token；
- 原有 API 的请求和返回字段不能为了视觉重构而悄悄改变。需要新增字段时，先扩展类型和测试，再接 UI。

## 3. 目标信息架构

网页端继续承担完整项目管理工作。扩展端承担开发现场的快捷入口。

```text
                    ┌──────────────────────────┐
                    │      AgileCampus API     │
                    │  任务 / AI / 权限 / 证据  │
                    └────────────┬─────────────┘
             ┌───────────────────┴───────────────────┐
             │                                       │
   ┌─────────▼─────────┐                 ┌──────────▼──────────┐
   │     Web 网页端     │                 │    VS Code 扩展端    │
   │ 完整项目工作台     │                 │ 开发现场快捷面板     │
   │ 四空间、档案、审批 │                 │ GitHub、AI、进度     │
   └─────────┬─────────┘                 └──────────┬──────────┘
             │                                       │
             └────────────── GitHub 连接层 ──────────┘
                   Issues / PR / Actions / 评论 / 提交
```

### 3.1 网页端导航

保留四个项目空间，但统一页面壳和视觉层级：

- 现场：谁在推进、谁卡住、下一步需要谁搭手；
- 工作：任务、交接契约、负责人、筛选和验收；
- Agent：共享会话、会话分支、Context Pack、AI 草案和人工确认；
- 记录：决策、证据、成果和可导出的项目档案。

网页端的首页区域优先呈现一个明确的“下一步”，让用户进入页面后知道要处理什么。页面不再堆叠同等权重的白色圆角卡片。

### 3.2 VS Code 扩展导航

扩展第一版只做一个侧栏视图和一个可展开的详情面板：

- 当前仓库和 GitHub 分支；
- 当前项目进度和待处理任务；
- 我的任务、卡住的任务和待验收任务；
- 当前任务的 AI 工作现场；
- GitHub Issue、PR 和最近一次 Actions 运行；
- “打开网页端”“打开任务”“继续 AI 工作”“报告卡住”四个命令。

扩展不复制网页端的全部设置、资料库、团队管理和项目导出功能。复杂编辑动作跳回网页端，并保留任务和会话的深链接。

## 4. 阶段 A：网页端组件框架接入

### 4.1 目标

使用 TailGrids 的 Tailwind 组件模式建立 `src/components/ui/`，让网页端有稳定的 Button、Tabs、Drawer、Command、Badge、Table、Timeline、Toast、EmptyState 和 Skeleton。S1 不安装 TailGrids、Primer 或 Thinboard 的运行时包；所有组件都要套入现有 AgileCampus tokens，不直接使用 TailGrids 默认配色。

### 4.2 实施边界

不得执行以下操作：

- 不把 TailGrids 的完整示例站复制进项目；
- 不整体替换当前顶部工作带和项目四空间；
- 不安装一套与现有 tokens 冲突的主题系统；
- 不同时引入 TailGrids、Thinboard、shadcn 全套组件；
- 不在业务组件中直接写新的硬编码颜色和圆角值；
- 不改任务状态、权限、Server Action 或 API 语义。

组件实现优先采用 Tailwind 类名和现有 `globals.css` tokens。若从 TailGrids 复制非平凡实现，先在 `THIRD_PARTY_NOTICES.md` 记录仓库、提交号、许可证和对应文件，再提交代码。

### 4.3 文件边界

新增或整理：

```text
src/components/ui/button.tsx
src/components/ui/badge.tsx
src/components/ui/tabs.tsx
src/components/ui/drawer.tsx
src/components/ui/command.tsx
src/components/ui/table.tsx
src/components/ui/timeline.tsx
src/components/ui/toast.tsx
src/components/ui/empty-state.tsx
src/components/ui/skeleton.tsx
src/components/ui/index.ts
```

优先迁移：

```text
src/app/(app)/_shell/top-workbar.tsx
src/app/(app)/projects/[projectId]/_shared/space-tabs.tsx
src/app/(app)/projects/[projectId]/_shared/task-drawer.tsx
src/app/(app)/projects/[projectId]/workspace-view.tsx
src/app/(app)/projects/[projectId]/chat-panel.tsx
src/app/(app)/projects/[projectId]/conversation-tree.tsx
src/app/(app)/projects/[projectId]/task-card.tsx
```

### 4.4 视觉决策

- 方向：工程协作控制台 + 学术项目档案；
- 底色：保留暖灰纸面和深墨色，避免默认蓝紫 AI 配色；
- 强调色：蓝色只表达可执行操作，红色只表达真实阻塞，绿色表达已验证成果，Agent 使用独立语义色；
- 半径：控件 8px，普通面板 8px，抽屉 12px；不对每个元素使用胶囊和大圆角；
- 阴影：只用于抽屉、菜单和浮层；普通区域用边界线和留白分层；
- 动效：点击反馈、抽屉进出、状态变化使用 120–220ms；尊重 `prefers-reduced-motion`；
- 字体：中文使用系统字体；日志、时间、ID 和 Git 分支使用等宽字体；
- 图标：使用已有 SVG 图标或 Octicons，不使用 Emoji 作为 UI 图标。

### 4.5 网页端验收

- 每个页面都有一个明显的主动作；
- 任务详情可以在不丢失 URL 状态的情况下打开和关闭；
- 键盘可以到达所有按钮、Tabs、Drawer 和表单；
- 空态、加载态、错误态和提交成功态都有可读反馈；
- 375px、768px、1024px、1440px 宽度不出现横向滚动；
- 现有业务测试保持全绿，新增组件不引入业务状态副作用；
- 截图审查确认页面仍然属于 AgileCampus，而不是 TailGrids、GitHub 或通用 shadcn 模板。

## 5. 阶段 B：任务与 AI 工作现场绑定

### 5.1 目标

让“任务交接”真正落到一个可点击的 AI 工作现场。负责人把任务分配给 B 后，B 可以从任务卡直接打开对应的共享会话，看到原成员的历史、卡点和 Context Pack，然后继续工作。

### 5.2 数据决策

第一步先复用现有 `conversations.taskId` 和项目共享可见性，不立即新增表。若同一任务存在多个共享会话，新增一个最小字段：

```text
tasks.activeConversationId -> conversations.id (nullable, on delete set null)
```

该字段表示任务当前用于接力的会话，不删除历史分支。所有更新必须经过领域层权限校验和测试。

### 5.3 UI 行为

- 任务抽屉显示“继续 AI 工作”；
- 没有关联会话时显示“为这项任务创建共享会话”；
- 有关联会话时跳转到 `?space=studio&task=<taskId>&conversation=<conversationId>`；
- 任务被改派后，原会话仍然保留；B 只要有项目访问权即可继续；
- AI 回复保留“从这里创建方案分支”；
- Context Pack 冻结状态、来源数量和最后更新时间在协同室顶部显示；
- 提交 AI 草案前显示来源会话、任务和 Context Pack；
- 写入任务、决策和里程碑仍需人确认。

### 5.4 验收场景

```text
孙权创建任务并指派给 Agent 小码
  → 小码在共享会话中完成需求分析
  → 小码报告“缺少接口返回结构”
  → 孙权把任务改派给鲁肃
  → 鲁肃点击“继续 AI 工作”
  → 页面打开原会话、卡点和冻结上下文
  → 鲁肃继续询问 Agent
  → AI 产出方案草案
  → 鲁肃确认或驳回
  → 任务记录和活动流留下来源
```

## 6. 阶段 C：GitHub 连接层

### 6.1 目标

把 GitHub 作为工程事实来源接入项目，不让 GitHub 取代 AgileCampus 的任务、AI 和验收模型。

### 6.2 最小数据模型

优先新增以下表或等价结构：

```text
github_repositories
  id, projectId, owner, repo, defaultBranch,
  installationId, syncMode, lastSyncedAt, createdAt, updatedAt

github_links
  id, projectId, taskId, issueNumber, pullRequestNumber,
  url, linkType, createdAt

github_sync_events
  id, projectId, eventId, eventType, payloadHash,
  receivedAt, processedAt, processingError
```

字段命名和 UUID 规则必须先对照现有 schema，再写迁移。

### 6.3 同步规则

第一版只做：

- AgileCampus 任务可以关联一个 GitHub Issue；
- Issue、PR、Actions Run 以链接和证据形式回到任务；
- GitHub PR 合并不直接把 AgileCampus 任务改成完成，只产生“可验收”证据；
- Issue 评论不自动写入 AI 会话；需要人选择“加入 Context Pack”后才可被 AI 使用；
- GitHub Webhook 必须校验签名、事件 ID 和重复投递；
- 同步失败保留错误记录，可以重试，不静默丢弃。

第二版再考虑双向状态同步。所有状态映射必须先写表格和冲突规则，再写代码。

### 6.4 认证边界

- Web 端使用 GitHub App 或 OAuth 授权，token 保存在服务端安全存储；
- VS Code 扩展使用 VS Code 的 GitHub authentication provider；
- Webview 只拿经过服务端过滤的数据，不直接接收长期 token；
- 扩展 host 负责读取本地仓库路径、当前分支和 GitHub 会话，再向 Webview 发送最小字段；
- GitHub 权限不足时显示明确的重新授权入口，不把原始 API 错误直接展示给用户。

## 7. 阶段 D：VS Code 扩展

### 7.1 目录和职责

新增独立扩展目录，不把扩展代码塞进 Next.js 的 `src/app`：

```text
vscode-extension/
  package.json
  tsconfig.json
  src/
    extension.ts
    auth/github-session.ts
    github/github-client.ts
    agilecampus/api-client.ts
    views/project-view-provider.ts
    views/task-detail-provider.ts
    commands/open-web.ts
    commands/continue-ai.ts
    commands/report-blocker.ts
  webview/
    index.html
    src/
      App.tsx
      components/
      tokens.css
```

### 7.2 第一版扩展功能

- `AgileCampus: Open Project`：打开当前仓库关联项目；
- `AgileCampus: Refresh`：重新拉取 GitHub 和 AgileCampus 状态；
- `AgileCampus: Continue AI Work`：打开当前任务关联的共享会话；
- `AgileCampus: Report Blocker`：把卡点写入既有 blocker API；
- 侧栏显示我的任务、阻塞、待验收、当前分支和最近 PR；
- 详情面板显示任务交接说明、Context Pack 摘要、AI 最近一轮输出和 GitHub 证据；
- 点击复杂编辑动作跳回网页端的深链接。

### 7.3 Webview 实现规则

- Webview 使用 React，但不依赖 Next.js 的 server component、`next/link` 或 `next/navigation`；
- 可复用的纯展示组件和 tokens 从 `src/components/ui` 提取到共享包；共享包建立前，扩展端不得直接 import Next.js 页面组件，第一版允许在 `vscode-extension/webview` 使用等价的轻量展示组件；
- 网页端的服务端加载器、Server Action 和数据库代码不进入扩展；
- Webview 使用严格 CSP、nonce 和 `asWebviewUri`，禁止加载任意远程脚本；
- 扩展与 Webview 只通过明确的 typed message 传递数据；
- 颜色优先读取 VS Code theme variables，同时保留 AgileCampus 的人/Agent/风险语义；
- 资源紧张时避免自动刷新和过重的 Webview；刷新由用户操作、GitHub 事件或明确的轮询间隔触发。

## 8. 阶段顺序和停止条件

### 执行记录（2026-09-29）

- S0 已完成：确认当前基线为 `af6686c`，Next.js 16.2.10、React 19.2.4、Tailwind 4；S1 不安装 TailGrids、Primer 或 Thinboard 运行时包，组件以本地 Tailwind 实现为主。
- S1 第一切片已完成：建立 `src/components/ui/` 原语目录，落地 Button、Badge、Tabs、Drawer、Command、Table、Timeline、Toast、EmptyState、Skeleton，并将项目模式切换、任务抽屉、Agent 协同室和现场高光接入 `TabsLink`、`TabsList`、`Badge`、`Button`。
- 本切片验证：`npx tsc --noEmit`、`npm run lint`、`npm test`、`npm run build` 均通过。Lint 仅保留 `.codex-ppt-build` 下的 3 条既有未使用变量警告。
- S1 未完成部分：项目壳、现场页、协同室迁移，以及 375 / 768 / 1024 / 1440 宽度截图审查，留给下一切片；在完成前不勾选 S1 总体验收。

### S0：基线与依赖审计

- [x] 记录当前 HEAD、工作区状态、Node/npm 版本和数据库状态；
- [x] 检查 TailGrids、Primer React、Thinboard、VS Code 参考仓库的许可证；
- [x] 决定哪些代码是复制、哪些只是参考；复制前记录提交号和文件映射；
- [x] 检查 `THIRD_PARTY_NOTICES.md` 是否需要新增条目；
- [x] 不在 S0 安装三套 UI 库。

停止条件：许可证不清楚、依赖和 Tailwind 4 冲突、或者需要改业务 API 才能渲染基础组件时，先停在 S0 解决。

### S1：网页端 UI 原语

- [x] 建立 `src/components/ui`；
- [x] 只引入 Button、Badge、Tabs、Drawer、Command、Table、Timeline、Toast、EmptyState、Skeleton；
- [x] 用现有 tokens 覆盖默认颜色、半径、阴影和焦点态；
- [ ] 迁移项目壳、现场页、任务抽屉和协同室；
- [ ] 生成桌面和窄屏截图，检查主路径和错误态。

验收：`npm run lint`、`npm run build`、`npm test` 全部通过；四个项目空间 URL 行为不变。

### S2：AI 工作现场绑定

- [ ] 任务抽屉显示并正确跳转“继续 AI 工作”；
- [ ] 需要时新增 `tasks.activeConversationId`，补 schema、服务层和测试；
- [ ] 共享会话继续读取项目权限、消息来源和 Context Pack；
- [ ] 编写一条“卡住 → 改派 → 继续会话”的集成测试；
- [ ] 编写人工确认不能被扩展端绕过的权限测试。

验收：两个不同项目成员使用各自会话，可以完成同一任务的接力续作，私有会话不会泄露。

### S3：GitHub 只读连接

- [ ] 新增仓库关联设置和服务端 GitHub client；
- [ ] 支持读取当前仓库的 Issue、PR、Actions Run；
- [ ] 任务详情显示 GitHub 证据链接；
- [ ] 处理权限不足、限流、网络失败和空仓库状态；
- [ ] Webhook 先只写入同步事件日志，再接入项目活动流。

验收：一个 GitHub Issue、一个 PR 和一个 Actions Run 能在任务详情中被定位，并且重复 Webhook 不产生重复活动。

### S4：VS Code 扩展骨架

- [ ] 新增扩展目录和构建脚本；
- [ ] 注册 Sidebar WebviewViewProvider；
- [ ] 完成 GitHub 登录、当前 workspace 仓库识别和 AgileCampus API 会话；
- [ ] 显示任务、AI 工作现场和 GitHub 证据；
- [ ] 深链接到网页端任务、会话和验收页面；
- [ ] 处理没有工作区、没有 GitHub 仓库、未登录、无项目映射四种空态。

验收：在 VS Code 本地打开当前仓库后，用户可以从侧栏进入一个任务、继续 AI 会话并打开对应 GitHub Issue。

### S5：扩展交互和双向事件

- [ ] `Continue AI Work` 调用既有共享会话，不创建隐形私聊；
- [ ] `Report Blocker` 走既有 blocker API；
- [ ] PR 合并和 Actions 结果回到 AgileCampus 活动流；
- [ ] GitHub 评论只有在用户明确加入 Context Pack 后才进入 AI 上下文；
- [ ] 处理 Webview 销毁、网络失败、并发刷新和权限过期。

验收：扩展端和网页端查看同一任务时，任务状态、AI 会话来源、GitHub 证据和人工审批状态一致。

## 9. 质量门槛

每个阶段都必须执行与改动范围匹配的检查：

```bash
npm run lint
npm run build
npm test
```

网页端 UI 额外检查：

- 375 / 768 / 1024 / 1440 宽度截图；
- 键盘 Tab 顺序和焦点可见；
- `prefers-reduced-motion`；
- 空态、加载态、错误态、成功反馈；
- 任务状态列不可跨列拖动；
- 私有会话和 Context Pack 权限；
- 页面刷新后 `space`、`task`、`conversation` 状态恢复。

扩展端额外检查：

- Webview CSP；
- GitHub token 不进入页面 DOM、localStorage 或日志；
- 没有工作区、没有 GitHub 登录、没有项目映射时的提示；
- Webview 关闭后重新打开不丢失当前项目和任务；
- GitHub API 限流和网络错误可恢复。

## 10. 明确不做的事情

- 不把整个 AgileCampus 改造成 GitHub Projects 的皮肤；
- 不直接 fork 一个完整后台模板并覆盖当前业务页面；
- 不同时混用 TailGrids、Thinboard、Primer、shadcn 的整套视觉系统；
- 不把所有 GitHub 评论自动喂给大模型；
- 不把 API key 或 GitHub 长期 token 放进浏览器或 Webview；
- 不让扩展端另造一套任务状态机、验收流程或权限规则；
- 不为了“看起来像成熟产品”增加没有对应用户动作的数据卡片和图表。

## 11. 下游 AI 的执行协议

每次开始任务时必须：

1. 读取 `AGENTS.md`、本文件和当前 `git status`；
2. 只认本文件规定的组合与阶段，不自行引入其他 UI 框架；
3. 先读要修改的现有组件和对应 `src/lib/*`，确认是否已有功能；
4. 一次只完成一个阶段或一个可回滚切片；
5. 代码、测试、截图和文档一起提交；
6. 任何跨越业务边界的修改先记录原因、影响和回滚方式；
7. 完成阶段后更新本文件的复选框、验证结果和实际提交号；
8. 发现本文与代码不一致时先修本文，再继续施工，不得默默绕过。

当前启动任务：**S0 基线与依赖审计**。S0 完成并记录后，才能进入 S1 网页端 UI 原语。
