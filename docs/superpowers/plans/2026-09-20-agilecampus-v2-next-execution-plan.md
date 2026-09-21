# AgileCampus V2 下一阶段执行计划（仓库实况版）

> 这是一份交给下游 AI 直接施工的计划，不是产品畅想。它以当前仓库实际代码为准，明确哪些能力已经完成、哪些只缺界面、哪些需要新数据模型，以及每一步的文件边界、测试、验收和停止条件。

## 0. 执行摘要

### 0.1 当前基线

- 仓库：`/Users/qwsdjivc/agilecampus-ai`
- 分支：`feat/risk-aware-closure`
- 审计时 HEAD：`3254512 feat(ai): make decision drafts reviewable and traceable`
- 技术栈：Next.js App Router、React、TypeScript、PostgreSQL、Drizzle、Vitest
- 当前测试入口：`npm test`
- 当前质量入口：`npm run lint`、`npm run build`

`3254512` 只是本次审计锚点，不是要求下游 AI 回退到该提交。每次开始施工前都必须重新读取当前 HEAD 和工作区状态。

### 0.2 一句话判断

项目雏形已经成立，底层业务链路比界面呈现更完整。下一步不应继续横向增加普通项目管理功能，而应把已经存在的 Context Pack、会话分支、Decision、Evidence、Agent Run 串成一个能被看见、能被操作、能被演示的 AI 协同闭环。

### 0.3 下一阶段唯一主线

```text
选择任务/问题
  → 预览并冻结上下文包
  → 在协同室发起或分叉探索
  → AI 产出结构化草案
  → 草案进入持久化待确认队列
  → 人查看差异并确认/驳回
  → 写入任务或决策
  → 执行结果形成证据
  → 在任务抽屉和项目档案中验收追溯
```

中期验收最优先展示前四步和“人确认后才写入”。分支比较、选择性合并是随后拉开创新性的功能，不阻塞第一轮可演示版本。

### 0.4 本轮已落地的复用切片

本计划发布后已完成一批 S1 施工，并提前落地了 S2 的核心链路：

- 适配 Lody 的防御式会话树纯函数和测试；
- Studio 左栏由平铺会话替换为可折叠分支树；
- Context Pack 右栏支持来源勾选、预览、创建、冻结和选择；
- 消息流由左右气泡改为连续工作稿；
- 新增 `THIRD_PARTY_NOTICES.md` 记录 Apache-2.0 适配来源。
- AI 草案写入 `approval_requests`，并接入幂等登记、待处理汇总、拒绝和 CAS 执行；
- 刷新或重新打开会话时，从消息工具轨迹重新挂回审批卡。

因此，下游 AI 不得重复创建会话树、Context Pack Builder 或 Approval 基础表；后续应在这批实现上继续接入审批详情、Action Queue、stale 版本提示和来源导航。

---

## 1. 开始施工前的强制检查

下游 AI 每次开始一批工作前执行：

```bash
cd /Users/qwsdjivc/agilecampus-ai
git status --short --branch
git rev-parse --short HEAD
git log -8 --oneline
rg --files -g 'AGENTS.md' -g '!node_modules'
```

然后完整阅读：

1. 根目录 `AGENTS.md`；
2. 本计划；
3. 本批次将修改文件的现有实现；
4. 对应的 `src/lib/*` 服务与测试，确认能力是否已存在。

停止条件：

- 工作区存在无法归属的修改时，先报告文件和差异，不得 reset、checkout 或自动 stash；
- 发现另一位执行者正在修改同一文件时，先重新划分文件所有权；
- 发现计划描述与当前代码不一致时，以代码和测试为准，并先更新本计划状态；
- 不得为了“统一风格”批量格式化无关文件。

---

## 2. 仓库实况：禁止重复实现

### 2.1 已经完成，后续只允许修复或接入

| 能力 | 已有实现证据 | 后续动作 |
| --- | --- | --- |
| 新信息架构 | `/today`、`/projects`、`/collaboration`、`/library`、`/settings` | 保持，不退回旧侧栏结构 |
| 项目四空间 | `live/work/studio/record`，由 URL `space` 驱动 | 保持深链与刷新恢复 |
| URL 任务抽屉 | `_shared/task-drawer.tsx`，使用 `?task=` | 扩充证据和决策，不另造弹窗 |
| 状态列禁拖 | 看板不允许靠跨列拖动改变业务状态，服务端也校验 | 不恢复自由跨列拖拽 |
| 行动队列 | `/today` 与顶部角标共用行动源 | 将持久化审批并入同一来源 |
| 会话与分叉 | `conversations.parentConversationId`、fork API/服务 | 补树形 UI，不另造会话系统 |
| Context Pack 后端 | preview/create/get/freeze API、权限、隐私隔离、过期检测、冻结快照 | 只补构建器和检查器 UI |
| Handoff Contract | 版本、再确认、必需证据校验 | 只补完整可视化与编辑入口 |
| Evidence | `evidence_items`、API、提交验收拦截 | 只补抽屉里的时间线/检查清单 |
| Agent Run | 执行生命周期、完成自动生成 `run` 证据 | 只补来源展示，不重复自动证据逻辑 |
| Decision Ledger | AI 只能提议，人确认/拒绝/替代；来源和证据引用 | 补任务关联视图和协同室工作流 |
| 项目导出 | Markdown/JSON，包含任务、证据、决策、AI 运行 | 只做演示和回归测试 |
| 基础视觉系统 | token、焦点态、键盘传感器、减弱动效基础 | 做一致性收敛，不重新换肤 |

### 2.2 当前真实缺口

| 优先级 | 缺口 | 当前表现 | 影响 |
| --- | --- | --- | --- |
| P0 | Context Pack 没有产品界面 | 后端完整，但用户只能从已有冻结包下拉选择 | AI“继承上下文”的核心卖点不可见 |
| P0 | Studio 仍是旧 ChatPanel | 会话平铺、气泡流、右栏只选包 | 看起来仍像普通 AI 聊天页 |
| P0 | AI 草案不持久 | `DraftCards` 依附单次响应，刷新后消失 | 无法形成可信审批队列 |
| P1 | 分支不能比较合并 | 有 fork，无二选对比、投票、选择性合并 | Lody 式协同创新只完成一半 |
| P1 | 任务抽屉追溯不完整 | 看得到承诺和动作，看不到证据清单与关联决策 | 老师验收闭环断在界面层 |
| P1 | Live 仍组合旧组件 | `WorkspaceView`、`BlockerStrip`、`HealthPanel` 仍在主路径 | 原创结构仍有历史痕迹 |
| P2 | 开发历史残留 | “Commit 6/7”等注释、旧 alias 和过期评审文档 | 增加维护噪音，易误导下游 AI |
| P0 | 缺少中期演示脚本 | 没有固定种子数据和 3–5 分钟路径 | 功能存在但验收展示不稳定 |

### 2.3 暂不做

- 不做完整 Jira/PingCode 替代品；
- 不做任意工作流字段配置器；
- 不做真实多 Agent 自动辩论与自动投票；
- 不让 AI 绕过人工确认直接改任务、里程碑或决策；
- 不把用户私聊、私有上下文或未授权资料注入项目包；
- 不做自由跨状态列拖动；
- 不为了“苹果感”加入玻璃拟态、巨大圆角、蓝紫渐变和无意义弹簧动画；
- 不删除来源项目许可证或掩盖依赖来源。

---

## 3. 施工顺序总览

| 阶段 | 目标 | 优先级 | 依赖 | 建议提交数 |
| --- | --- | --- | --- | --- |
| S1 | Context Pack Builder + Studio V2 外壳 | P0 | 现有 Context Pack API | 3–4 |
| S2 | 持久化 Approval Inbox | P0 | S1 可独立，数据迁移需谨慎 | 4–5 |
| S3 | 分支比较与选择性合并 | P1 | S1；最好复用 S2 审批 | 4–5 |
| S4 | 任务级证据与决策追溯 | P1 | 现有 Evidence/Decision | 2–3 |
| S5 | Live 空间去旧组件化 | P1 | 无后端依赖 | 2–3 |
| S6 | 中期演示、视觉验收与文档收口 | P0 | 至少完成 S1，推荐完成 S2/S4 | 2–3 |

推荐先完成 S1 → S6 的最小演示内容，再进入 S2。不要同时打开 S1、S2、S3 的 schema 和大 UI 重构。

依赖图：

```text
现有 Context Pack 后端 ──→ S1 Studio V2 ──→ S3 分支比较
                                      └────→ S6 演示
现有 DraftCards ─────────→ S2 持久审批 ────→ S3 合并审批
现有 Evidence/Decision ──→ S4 任务追溯 ────→ S6 演示
现有 Live loaders ───────→ S5 去旧组件化 ─→ S6 视觉回归
```

---

## 4. S1 — Context Pack Builder 与 Studio V2

### 4.1 目标

把“AI 为什么知道这些”变成用户可见、可裁剪、可冻结的工作对象；把协同室从普通聊天页改成“探索树 + 连续工作稿 + 上下文检查器”。

### 4.2 不改数据模型

本阶段不得新增 Context Pack 表。优先复用现有能力：

- `src/lib/context-pack.ts`
- `GET/POST /api/projects/[projectId]/context-packs`
- `POST /api/projects/[projectId]/context-packs/preview`
- `GET /api/context-packs/[packId]`
- `POST /api/context-packs/[packId]/freeze`

若现有 API 返回字段不够，先证明界面需要的字段无法从现有返回值取得，再做最小扩充并加测试。

### 4.3 文件计划

新增：

```text
src/app/(app)/projects/[projectId]/_studio/conversation-tree.tsx
src/app/(app)/projects/[projectId]/_studio/context-pack-builder.tsx
src/app/(app)/projects/[projectId]/_studio/context-inspector.tsx
src/app/(app)/projects/[projectId]/_studio/studio-workbench.tsx
```

修改：

```text
src/app/(app)/projects/[projectId]/_studio/studio-space.tsx
src/app/(app)/projects/[projectId]/chat-panel.tsx
src/app/(app)/projects/[projectId]/page.tsx       # 仅必要的查询参数接线
src/app/globals.css                              # 仅新增通用 token/状态，不写页面专属泥团
```

重构方式：先让 `ChatPanel` 退化为消息编排/输入能力，再由 `StudioWorkbench` 组织三块区域。不要一次复制整个 ChatPanel 形成第二套聊天实现。

### 4.4 左侧：探索树

输入为现有会话的 `id`、`title`、`parentConversationId`、`updatedAt`。

要求：

- 用父子关系构建树，根会话按最近更新时间排序；
- 子分支在父会话下缩进，不能只做平铺列表加图标；
- 当前会话使用左侧实线或文本权重标识，不铺大面积蓝底；
- 每个节点显示标题、最后更新时间、是否存在未处理草案；
- 键盘可聚焦，Enter 打开，左右方向键折叠/展开；
- “创建探索”与“从此处分叉”语义分开；
- 通过 URL `conversation=` 恢复当前节点，刷新不丢位置；
- 为空时说明“先围绕一个任务或问题发起探索”，并提供唯一主动作。

### 4.5 中间：连续工作稿

- 消息以连续文档流呈现，不使用左右交错彩色气泡；
- 用户输入以作者行、时间和较轻底色区分；
- AI 输出使用正文排版，结构化草案嵌在对应来源后；
- 工具执行、引用来源、错误和重试分别使用稳定的窄状态行；
- 输入区固定在工作稿底部，只保留一个高强调发送按钮；
- 当选择了任务，输入区上方显示任务上下文条；
- 当选择了冻结包，显示包名、冻结时间和过期状态；
- 发送时必须明确携带选中的 `contextPackId`，不得靠 UI 文案假装已继承。

### 4.6 右侧：Context Pack Builder / Inspector

状态分为四种：

1. 未创建：展示“预览上下文”；
2. 预览中：显示候选项、来源类型、可见性、是否包含；
3. 草稿包：允许勾选/移除候选项并修改标题；
4. 已冻结：只读展示快照、冻结人/时间、fresh/stale；需要变化时“基于此包新建”，不能原地改写。

候选项至少覆盖现有后端支持的任务、里程碑、决策、档案/消息等类型。每项显示：

- 人能读懂的标题；
- 来源类型；
- 最近更新时间；
- included / excluded；
- fresh / stale；
- 私有项被过滤时给出数量提示，但绝不能泄露标题或内容。

过期规则：包冻结后的来源发生变化，显示“上下文已变化”，提供“查看变化”和“创建新版”；仍允许查看旧冻结快照以保证可追溯。

### 4.7 响应式与交互

- `>= 1280px`：三栏；左 248–288px，中间自适应，右 300–360px；
- `768–1279px`：左树保持窄栏，右检查器改为可切换侧板；
- `< 768px`：工作稿为主，探索树和上下文分别用全高 sheet；
- 所有 sheet 有焦点陷阱、Escape 关闭、关闭后焦点归还；
- 状态变化使用 120–200ms，不使用等待动画冒充真实延迟；
- 支持 `prefers-reduced-motion`；
- 触控目标至少 40px，正文和状态不能只靠颜色区分。

### 4.8 测试

至少新增/扩充：

- 会话数组转树的纯函数测试：根、两级分支、孤儿节点、循环防御；
- 预览 → 创建 → 冻结 → 读取的 API/服务集成测试；
- 无权限项目、私有内容隔离测试；
- 冻结后来源更新，stale 标记测试；
- 发送消息时 contextPackId 真正进入 orchestrator 的测试；
- URL 指定 conversation/task 后服务端选择正确上下文的测试。

### 4.9 验收脚本

1. 从一个任务抽屉点击“在协同室继续”；
2. Studio 自动选中该任务；
3. 预览上下文，删除一项无关资料；
4. 创建并冻结“登录流程排障上下文”；
5. 发问后指出 AI 使用了哪些冻结来源；
6. 从当前会话分叉两个方向；
7. 刷新页面，树、当前会话、冻结包仍然存在。

完成定义：观察者不看讲解也能回答“AI 读了什么、这是哪条探索分支、刷新后是否还在”。

### 4.10 建议提交

```text
feat(studio): add conversation tree navigation
feat(context): add context pack builder and inspector
refactor(studio): present conversations as a continuous workbench
test(studio): cover context selection and branch restoration
```

---

## 5. S2 — 持久化 Approval Inbox

### 5.1 目标

把当前只存在于单次响应中的 `DraftCards` 变成真正的“AI 提议—人审阅—系统执行”对象。刷新、换页面、换设备后仍可继续处理，并完整记录来源和处理人。

### 5.2 当前状态

S2 核心链路已落地：schema、幂等创建、项目权限校验、跨项目协作汇总、消息历史恢复、审批详情/编辑、拒绝、CAS 抢占、统一 `commitDraft` 执行、失败留痕、`/today` Action Queue 接入、私有来源过滤、字段级 stale 预览和角色级确认范围均已实现。执行中断提供人工核对后恢复为 failed 的保守路径，避免自动重放造成重复写入。后续可继续把高风险动作拆成更细的团队策略配置。

### 5.3 已实现数据契约

当前 `approval_requests` 已在测试库和 schema 中生效，字段为：

```text
id uuid pk
project_id uuid not null
tool enum not null
status pending | executing | executed | rejected | failed
title text not null
payload jsonb not null
result jsonb nullable
error text nullable
source_conversation_id uuid nullable
source_message_id uuid nullable
requested_by_id uuid nullable
resolved_by_id uuid nullable
resolution_note text nullable
idempotency_key text unique not null
ordinal integer not null
created_at / updated_at / resolved_at / executed_at
```

约束：

- `tool` 第一版支持 `create_project`、`create_decision`、`decompose_tasks`、`update_tasks`、`plan_sprint`、`create_milestone`；
- `payload` 存结构化意图，不存可执行代码；
- 同一审批只能成功执行一次；重复请求返回既有结果；
- `executing` 与 `executed` 分开，执行失败不能伪装成已完成；
- 拒绝必须能填写原因；替代旧提议时保留链路，不物理删除；
- 项目权限和可见性必须在 list/detail/resolve/execute 四处都校验。

### 5.4 文件计划

预计新增：

```text
src/lib/approval.ts
src/app/api/projects/[projectId]/approvals/route.ts
src/app/api/approvals/[approvalId]/route.ts
src/app/api/approvals/[approvalId]/resolve/route.ts
src/app/api/approvals/[approvalId]/recover/route.ts
src/app/(app)/projects/[projectId]/approval-detail.tsx
tests/approval.test.ts
```

修改：

```text
src/db/schema.ts
src/lib/agent/orchestrator.ts 或实际产出 tool draft 的位置
src/app/(app)/projects/[projectId]/draft-cards.tsx
src/app/(app)/collaboration/page.tsx
src/lib/action-queue.ts
tests/helpers.ts
```

### 5.5 兼容迁移

- 第一阶段：AI 响应创建持久审批，同时 `DraftCards` 仍能读取旧内联草案；
- 第二阶段：`DraftCards` 改为审批对象的紧凑视图，并从协作/今日入口直接打开详情；
- 一个发布周期内保留旧响应草案渲染，避免历史对话损坏；
- 不把已有 Decision Ledger 迁移成 approval；Decision 是已形成的业务记录，Approval 是待处理动作。

### 5.6 审批界面

每张审批卡必须回答：

1. AI 想做什么；
2. 为什么；
3. 会改哪些对象；
4. 当前值与建议值有什么差异；
5. 来源于哪条会话/消息和哪个上下文包；
6. 谁可以确认；
7. 执行后发生了什么。

允许动作：查看来源、编辑允许字段、确认执行、驳回并写原因。危险或批量动作必须显示影响数量，不能只有“确定/取消”。

### 5.7 Action Queue 接入

- 待自己处理的 approval 进入 `/today`；
- 项目内所有待确认项进入 `/collaboration`；
- 顶部角标继续复用单一行动源，不能在客户端另算一套；
- 已处理项从行动队列消失，但在协同室与审计记录中保留。

### 5.8 测试

- 创建、权限过滤、批准、拒绝、替代、重复执行幂等；
- `update_tasks` 既有 updatedAt compare-and-swap 冲突继续返回可读结果，审批详情在执行前展示每条任务的一致/冲突状态；
- 非管理员不能确认高权限动作，详情页必须解释原因；
- 来源会话不可见时不泄露内容；
- Action Queue 与 Collaboration 数量一致；
- 老的内联 DraftCards 仍可渲染；
- 执行失败保留 approval 和错误，不产生半完成业务状态。

### 5.9 建议提交

```text
feat(approval): add persistent approval request model
feat(approval): persist agent action drafts with provenance
feat(collaboration): add approval inbox and action queue entries
refactor(studio): render draft cards from persistent approvals
test(approval): cover permissions conflicts and idempotency
```

---

## 6. S3 — 分支比较与选择性合并

### 6.1 目标

不是让两个 AI 自动争论，而是让团队把两条已存在的探索分支放在一起，按主张、依据、风险和可执行动作比较，然后由人选择并合并有价值的部分。

### 6.2 数据模型

建议使用两个概念：

1. `comparison_sessions`：谁在比较哪两条或多条会话；
2. `comparison_selections`：人选择了哪些消息/主张，以及理由。

最小字段：

```text
comparison_sessions:
  id, project_id, title, created_by_id, status(open|resolved), created_at, resolved_at

comparison_branches:
  comparison_id, conversation_id, position

comparison_selections:
  id, comparison_id, conversation_id, message_id nullable,
  verdict(prefer|reject|merge), note, created_by_id, created_at
```

若只需两分支，可在首版 API 限制数量为 2，但表结构不要把左右写死在列名里。

### 6.3 交互

- 在探索树中多选两条同项目分支，点击“比较”；
- 顶部显示共同祖先和分叉点；
- 两栏按消息或结构化主张对齐，不做纯文本 diff 墙；
- 每侧显示：核心主张、证据引用、风险、建议动作；
- 人可选择整侧，也可勾选若干消息/主张进入合并；
- 必须填写或允许填写选择理由；
- “生成合并稿”创建一条新会话，父级关系记录共同祖先或通过 comparison 关系追溯；
- 合并稿使用新冻结 Context Pack，包含被选择来源，不修改两条原分支；
- 若合并结果要写业务数据，进入 S2 Approval，不直接落库。

### 6.4 文件计划

```text
src/lib/comparison.ts
src/app/api/projects/[projectId]/comparisons/route.ts
src/app/api/comparisons/[comparisonId]/route.ts
src/app/api/comparisons/[comparisonId]/resolve/route.ts
src/app/(app)/projects/[projectId]/_studio/branch-comparison.tsx
src/app/(app)/projects/[projectId]/_studio/merge-composer.tsx
tests/comparison.test.ts
```

并修改 schema、Studio 探索树、Context Pack 服务和 action/approval 接线。

### 6.5 测试与验收

- 不同项目会话不能比较；
- 无权查看的分支不能被引用；
- 共同祖先识别正确；
- 选择项和理由可追溯到用户；
- 合并生成新会话，不污染原分支；
- 新冻结包只包含有权访问且被选择的来源；
- 重复 resolve 幂等；
- 业务写入仍需人工审批。

演示场景：围绕“登录方案”分出“邮箱验证码”和“校园统一认证”两支，对比维护成本与接入风险，选择统一认证的身份链路和邮箱方案的降级策略，生成第三条合并稿。

---

## 7. S4 — 任务级证据与决策追溯

### 7.1 目标

老师打开一个任务，不翻聊天记录就能按顺序看到：承诺 → 验收条件 → 提交证据 → AI 参与 → 决策依据 → 验收意见。

### 7.2 后端原则

现有 Evidence、Agent Run 自动证据和 Decision 服务已经完成。本阶段默认不新增表。先扩充任务详情 loader，把有权限的数据投影给抽屉。

### 7.3 TaskDrawer 数据扩充

在 `DrawerTask` 或单独 detail 类型中加入：

- `requiredEvidence`；
- evidence items：type、label、value、sourceId、submittedBy、createdAt；
- agent runs：agent、status、startedAt、finishedAt、result/error；
- related decisions：title、status、selected option、source conversation/message；
- handoff version / reconfirmation state（若现有类型已有则直接接入）。

不要在客户端按标题猜关联。优先使用 taskId、sourceId 和已有证据引用。

### 7.4 抽屉结构

固定顺序：

```text
目标
交接与承诺
验收条件
提交证据
AI 参与记录
关联决策
验收与退回意见
当前可执行动作
```

证据以紧凑时间线呈现；链接可直接打开；测试/运行结果默认摘要，展开看原文；缺少的必需证据用明确清单说明，不能只在提交时报错。

### 7.5 验收

- Agent run 可见但明确标注“执行记录不等于验收通过”；
- 缺 link/test 时提交按钮附近提前显示缺口；
- Decision 能跳回来源会话；
- 私有会话内容不会因任务关联泄露；
- 键盘焦点和 URL 深链继续工作；
- 抽屉在 390px 宽度可完成所有动作。

---

## 8. S5 — Live 空间去旧组件化

### 8.1 目标

保留已经验证的 loader 和业务函数，替换主路径中对 `WorkspaceView`、`BlockerStrip`、`HealthPanel` 的直接组合，让 Live 真正围绕“正在发生的事”而不是旧仪表盘组件展开。

### 8.2 新结构

```text
Live pulse header
  当前里程碑 / 今日推进 / 待回应交接

Activity lanes
  正在推进 | 等待回应 | 卡住求助

Relay timeline
  最近交接链与责任变化

Risk notes
  只呈现需要动作的风险，链接到任务抽屉
```

不做：KPI 大数字墙、每项都装进圆角卡片、彩色渐变风险榜、装饰性折线图。

### 8.3 实现原则

- 复用 `buildLiveBoard`、`listProjectActivity`、`listMilestoneProgress`、`getProjectHealth`、`listProjectBlockers`；
- 先新建 Live 专属小组件，再逐个替换；
- 旧组件确认无其他路由使用后才删除；
- 用户动作仍打开同一个 URL TaskDrawer；
- 无数据时给具体下一步，不显示假图表或虚构百分比。

### 8.4 视觉验收

- 信息密度偏工程工具，文本对齐清楚；
- 主色只用于主动作和当前状态；
- 圆角有层级，面板、控件、徽标不使用同一巨大半径；
- 没有大段营销文案或“AI 赋能”式口号；
- 动效解释状态变化，不为静态卡片普遍加悬浮位移。

---

## 9. S6 — 中期演示、视觉验收与文档收口

### 9.1 固定演示数据

准备一个课程团队项目，至少包含：

- 1 个临近截止里程碑；
- 5–8 个任务，覆盖待接、进行中、待验收、已完成、已阻塞；
- 1 个人类成员和 1 个 Agent 成员；
- 1 个带 link/test 要求的任务；
- 1 条 Agent run 证据；
- 1 个已确认决策和 1 个待确认 AI 提议；
- 1 个冻结后变 stale 的 Context Pack；
- 1 棵含两条分支的会话树。

使用现有 seed 机制扩充，不在页面组件里硬编码演示数据。

### 9.2 3–5 分钟演示脚本

新增：

```text
docs/demo/midterm-script.md
```

脚本固定为：

1. `/today`：展示“现在轮到我做什么”；
2. 打开任务抽屉：展示承诺、验收条件和证据缺口；
3. 进入 Studio：上下文自动带入，预览并冻结 Context Pack；
4. AI 给出结构化方案，但没有直接改业务数据；
5. 在 Approval 中查看差异并由人确认；
6. 回到任务/Record：展示决策与证据来源；
7. 若 S3 已完成，再加 40 秒分支比较与合并。

每一步注明：操作、讲解句、预期画面、失败时备用路径。

### 9.3 自动化质量门

每个阶段合并前执行：

```bash
npm run lint
npm test
npm run build
```

若环境依赖数据库，先执行仓库既有测试数据库流程。不得把“本机数据库没开”写成测试通过。

### 9.4 手工矩阵

| 类别 | 必测项 |
| --- | --- |
| 尺寸 | 390px、768px、1440px |
| 输入 | 鼠标、键盘 Tab/Shift+Tab/Enter/Escape |
| 动效 | 正常、`prefers-reduced-motion` |
| 状态 | loading、empty、error、permission denied、stale、conflict |
| 导航 | 刷新、前进后退、深链、关闭抽屉焦点归还 |
| 数据 | 私有隔离、跨项目越权、重复提交、并发版本冲突 |

### 9.5 视觉反 AI 味检查

每个页面截图后逐项问：

- 是否一眼能看出主任务，而不是满屏同权卡片？
- 是否滥用蓝底、渐变、发光、超大圆角和胶囊？
- 是否所有文本都像 AI 写的宣传句，而不是实际工作语言？
- 是否每个区域都用标题 + 副标题 + 三张卡的模板？
- 是否存在没有功能意义的图标、动效或状态？
- 是否真实使用数据，还是为了好看伪造图表？
- 是否保留工程严谨性：来源、时间、负责人、状态、错误都可见？

未通过时优先减法：减少容器、减少颜色、缩短文案、强化对齐和层级；不要再叠一层装饰。

### 9.6 文档清理

- README 更新当前架构和启动路径；
- `docs/ai-collaboration.md` 更新为实际闭环；
- 历史 acceptance review 顶部加“历史快照”提示，不篡改当时结论；
- 删除代码中的“Commit 6/7 将实现”等过期施工注释；
- 清点无引用旧组件和 CSS alias，确认无使用后分批删除；
- 记录第三方依赖、借鉴来源和许可证。

---

## 10. 并行协作与文件所有权

遵守根目录 `AGENTS.md`。默认分工：

### Codex

- schema、数据库迁移、服务层、API、权限、幂等、并发控制；
- Context Pack / Approval / Comparison / Evidence / Decision 的核心契约；
- 测试、构建、数据种子和技术文档；
- 涉及共享类型时先定义契约，再通知 UI 执行者。

### Antigravity

- `Studio`、`TaskDrawer`、`Live` 的可见 UI 和交互细节；
- 响应式、键盘、焦点、空/错/加载状态；
- 视觉回归、文案收敛和演示截图；
- 不自行修改 schema 或绕过服务层直写数据。

### 共享文件规则

以下文件一次只允许一个负责人修改：

- `src/db/schema.ts`
- `src/app/globals.css`
- `src/app/(app)/projects/[projectId]/page.tsx`
- `src/app/(app)/projects/[projectId]/chat-panel.tsx`
- `src/lib/action-queue.ts`
- `tests/helpers.ts`

交接说明必须包含：

```text
修改了什么
新增/变化的 props 或 API
仍未完成什么
运行了哪些测试
哪些文件下一位可以接手
```

---

## 11. 风险清单与回退策略

| 风险 | 预防 | 回退 |
| --- | --- | --- |
| Studio 大改破坏历史会话 | 先抽纯展示组件，保留现有 API | feature flag 或保留旧渲染入口一个阶段 |
| Approval 迁移导致草案丢失 | 双读旧内联草案与新表 | 关闭持久审批写入，旧卡仍可显示 |
| Context Pack 泄露私有内容 | 服务端权限过滤，不依赖 UI 隐藏 | 拒绝生成包并记录安全测试 |
| 重复点击造成多次写入 | idempotency + 唯一约束 + CAS | 返回既有执行结果 |
| 分支合并污染原会话 | 合并永远创建新会话和新冻结包 | 删除未提交的新合并会话，不碰原分支 |
| 视觉优化损伤工程信息 | 来源/状态/时间/责任人列为不可删字段 | 回退展示层，不回退业务模型 |
| 多执行者覆盖修改 | 文件所有权与小提交 | 停止并人工合并，不 reset |

---

## 12. 全项目完成定义

以下全部满足，才算下一阶段完成：

- [ ] 用户可在 UI 中预览、裁剪、创建、冻结和检查 Context Pack；
- [ ] Studio 使用树形探索与连续工作稿，不再只是平铺聊天列表；
- [ ] 选中的 Context Pack 确实进入 AI 执行链，且可追溯；
- [ ] AI 结构化动作刷新后仍在，必须由有权用户确认或驳回；
- [ ] 执行有幂等、冲突检测和失败状态；
- [ ] 两条探索分支可比较，人能选择并生成不污染原分支的合并稿；
- [ ] 任务抽屉能完整呈现承诺、条件、证据、AI 参与、决策和验收；
- [ ] Live 主路径不再直接依赖旧仪表盘式大组件；
- [ ] 390/768/1440 三档可用，键盘和 reduced motion 通过；
- [ ] `npm run lint`、`npm test`、`npm run build` 全部通过；
- [ ] 中期演示脚本可由非开发成员照着完成；
- [ ] README、AI 协作文档、历史计划状态与当前实现一致；
- [ ] 所有非平凡借鉴保留许可证和来源说明。

---

## 13. 下游 AI 的第一条执行指令

复制下面内容即可开始，不得一次执行后续所有阶段：

```text
你正在 /Users/qwsdjivc/agilecampus-ai 的 feat/risk-aware-closure 分支工作。

先完整阅读根 AGENTS.md 和 docs/superpowers/plans/2026-09-20-agilecampus-v2-next-execution-plan.md。检查 git status、当前 HEAD 和最近提交；不得覆盖任何未归属修改。

本轮从已落地的 S1/S2 基础继续执行，不要重复创建会话树、Context Pack Builder 或 approval_requests 表。优先补齐 S2：审批详情/编辑视图、/today Action Queue 接入、stale 版本预览和 executing 超时恢复；然后运行 npm run lint、npm test、npm run build，并提交变更摘要、测试结果、剩余风险和下一位可接手文件。

按小提交完成：
1. 审批详情与可编辑字段视图，显示来源消息、影响对象、状态和失败原因；
2. 将待处理审批并入 `/today` 的单一行动队列，避免重复计数；
3. 为 `update_tasks` / `plan_sprint` 增加 stale 版本预览与冲突回显；
4. 增加 executing 超时恢复/人工重试策略，并补齐测试与响应式无障碍验收。

视觉要求：工程化、简洁、信息层级明确；不用蓝色大底、渐变、发光、巨型圆角和气泡聊天。必须呈现来源、状态、时间和错误。完成后运行 npm run lint、npm test、npm run build，并提交变更摘要、测试结果、剩余风险和下一位可接手文件。
```
