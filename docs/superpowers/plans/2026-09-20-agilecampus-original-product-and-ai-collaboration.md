# AgileCampus 原创产品重构与 AI 协同 V2：可直接执行规格

> 面向下游 AI 的施工级规格。本文不是灵感清单；每一阶段都有输入、输出、文件、数据契约、测试和停止条件。

## 0. 任务定义

### 0.1 唯一目标

在保留当前分支已经验证的业务内核前提下，重建一套无法与老师原版形成页面一一对应关系的原创产品：

- 原创的信息架构，而不是换颜色；
- 原创的页面骨架，而不是移动几张卡；
- 原创的交互对象，而不是给旧看板加 AI 按钮；
- AI 是可接活、可交接、可审核的协作成员，不是右下角聊天助手；
- 人与 AI 共同工作的过程能够留下来源、决策和证据。

### 0.2 基线

- 仓库：`/Users/qwsdjivc/agilecampus-ai`
- 基线分支：`feat/risk-aware-closure`
- 最低基线提交：`5c9a3f9`
- 当前已有：任务承诺/拒绝/提交/验收、风险、求助、活动、复盘、人机成员、Agent run、共享会话、会话分支、项目档案。
- 老师原版 `upstream/master` 只用于做差异审计，不用于抄布局或组件。

截至 2026-09-20 的执行状态：

- Commit 1～3 已完成，当前最低执行基线为 `55684b9`。
- 下一步不得直接进入原 Commit 4；必须先完成第 7 节的 **M0 中期验收交互质感冲刺**。
- M0 的目标不是增加页面数量，而是让现有顶部工作带、项目四模式和核心操作首先达到可展示、可点击、可解释的完成度。

开始前执行：

```bash
cd /Users/qwsdjivc/agilecampus-ai
git status --short --branch
git merge-base --is-ancestor 5c9a3f9 HEAD
git diff --stat upstream/master...HEAD
```

若工作区不干净，停止并先识别已有修改。不得 reset、checkout 覆盖或自动 stash。

### 0.3 “不是换皮”的判定

重构完成后，以下六项中至少五项必须与原版不同；本计划要求六项全部不同：

1. **全局导航不同**：取消永久左侧栏，使用顶部工作带。
2. **项目入口不同**：不是项目卡片网格，而是“我的行动 + 项目脉搏”。
3. **项目主页不同**：不是摘要→里程碑→看板→聊天的纵向页面，而是四个互斥工作模式。
4. **任务操作不同**：卡片只用于扫描，完整动作在上下文抽屉完成。
5. **AI 模型不同**：不是单会话聊天框，而是上下文包→并行方案→决策→确认→证据。
6. **视觉语言不同**：新的色板、间距、形状、排版、图标和动效规则。

不得通过隐藏项目来源、删除许可证或“故意改名”冒充原创。原创来自重新设计产品结构；借鉴的非平凡代码仍须按许可证署名。

---

## 1. 产品概念：从项目管理器变成“协作现场”

### 1.1 五个核心对象

用户界面围绕五个对象组织，不再围绕传统“仪表盘/看板/聊天”组织：

| 对象 | 用户问题 | 现有数据 | V2 新能力 |
| --- | --- | --- | --- |
| 行动 Action | 现在该我做什么？ | task/review/blocker | 角色化行动队列 |
| 交接 Handoff | 这件事谁接住了？ | assignment/commitment/activity | 交接契约与回应时限 |
| 上下文 Context | AI/同伴需要知道什么？ | task/conversation/messages | 可见、可裁剪、可冻结的上下文包 |
| 决策 Decision | 为什么选这个方案？ | conversation/activity | 方案比较与决策记录 |
| 证据 Evidence | 做成了什么，如何验收？ | completionNote/entry/activity | 证据包与来源链 |

### 1.2 产品主张

> AgileCampus 不替学生做项目，而是让团队在人与 AI 之间交接工作时，不丢背景、不丢责任、不丢证据。

### 1.3 产品级成功指标

- 新成员进入项目 60 秒内能说出当前目标、最近里程碑、三个紧急行动和谁被卡住。
- 被指派者能在 30 秒内“接住”或“接不住”。
- 从任务发起 AI 协作时，无需重新手输项目背景。
- 任意 AI 建议都能追溯它读取了什么、由谁确认、最终写入了什么。
- 老师验收时不必翻聊天记录，能看到承诺、产出、证据、AI 参与范围和修改轨迹。
- 项目结束后可导出一份事实档案，不要求成员重新填写复盘表。

---

## 2. 全新信息架构

## 2.1 全局路由

保留后端兼容路由，但用户可见的一级导航重组为：

| 路由 | 导航名称 | 职责 |
| --- | --- | --- |
| `/today` | 今日 | 当前用户跨项目行动队列 |
| `/projects` | 项目 | 项目脉搏、最近访问、归档 |
| `/collaboration` | 协作 | 求助邀请、待确认 AI 动作、Agent 状态 |
| `/library` | 资料库 | 跨项目成果、文档、可复用上下文 |
| `/settings` | 设置 | 账户、连接、token、通知 |

兼容策略：

- `/health` 不再是一级导航；风险进入 `/today` 和项目“现场”。旧路由保留重定向一版。
- `/teams` 不再是一级导航；团队与 Agent 管理进入项目切换器中的“团队设置”。
- `/settings/tokens` 保留深链接，在 `/settings` 内做子页。
- 新路由未完成前不删除旧路由。

## 2.2 项目四模式

项目 URL 使用稳定查询参数：

```text
/projects/:projectId?space=live
/projects/:projectId?space=work
/projects/:projectId?space=studio
/projects/:projectId?space=record
```

| 参数 | 中文名 | 解决的问题 | 主对象 |
| --- | --- | --- | --- |
| `live` | 现场 | 谁在推进，哪里需要行动？ | Action + Handoff |
| `work` | 工作 | 任务如何拆分和流转？ | Task + Milestone |
| `studio` | 协同室 | 人与 AI 怎样探索、比较、确认？ | Context + Decision |
| `record` | 记录 | 形成了什么成果与证据？ | Evidence + Archive |

规则：

- 缺省 `space` 为 `live`。
- 四模式一次只渲染一个，不纵向堆叠。
- `task=<uuid>` 打开全局任务抽屉，可叠加在任意模式。
- `conversation=<uuid>` 只在 `studio` 生效；其他模式遇到它时跳转至 studio。
- `action=<uuid>` 用于定位待确认动作。
- 所有筛选写 URL，可复制、刷新和浏览器前进后退。

---

## 3. 原创界面系统

## 3.1 应用骨架

删除永久左侧导航。新骨架：

```text
┌──────────────────────────────────────────────────────────────┐
│ AC  [项目切换器⌄]   今日  项目  协作  资料库        搜索 头像 │  56px 顶部工作带
├──────────────────────────────────────────────────────────────┤
│ 项目名称 / 最近里程碑         [现场][工作][协同室][记录] [＋] │  项目上下文带
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                       当前模式主画布                          │
│                                                              │
├──────────────────────────────────────────────┬───────────────┤
│ 状态/同步提示                                  │ 可选上下文抽屉 │
└──────────────────────────────────────────────┴───────────────┘
```

实现要求：

- 顶部工作带桌面 56px、移动端 52px；不做玻璃拟态。
- 项目上下文带只在项目内出现，桌面 sticky 48px。
- 任务/决策/证据共用右侧上下文抽屉；桌面 420px，移动端全屏 sheet。
- 全局求助入口不是悬浮圆按钮，移入顶部“协作”状态入口，避免遮挡内容。
- 项目切换器支持最近项目和搜索，Escape 关闭。

## 3.2 视觉 token

在 `src/app/globals.css` 重建 token，禁止组件散落硬编码色值：

```css
@theme {
  --color-ground: #f3f1eb;
  --color-panel: #fbfaf7;
  --color-raised: #ffffff;
  --color-ink: #1d2421;
  --color-ink-2: #4f5b56;
  --color-ink-3: #7e8983;
  --color-stroke: #dcded8;
  --color-stroke-strong: #c7cbc4;

  --color-signal: #3157d5;
  --color-signal-soft: #e9edff;
  --color-human: #13795b;
  --color-human-soft: #e4f4ed;
  --color-agent: #7557c9;
  --color-agent-soft: #eee9fb;
  --color-risk: #c4424f;
  --color-risk-soft: #fbe8ea;
  --color-warn: #a76513;
  --color-warn-soft: #f7edd8;
  --color-success: #25734f;

  --radius-control: 0.5rem;
  --radius-panel: 0.75rem;
  --radius-sheet: 1rem;
}
```

视觉约束：

- 页面背景暖灰，内容面接近纸张；不使用当前亮蓝大按钮 + 圆角卡片堆叠的组合。
- 主面板圆角 12px，抽屉 16px；不能所有元素都用 24px 大圆角。
- 阴影只用于浮层；普通面板用边框与留白分层。
- 任务状态不能只靠颜色，要有短文本。
- 人为绿色语义、Agent 为紫色语义；二者不是“真人正常/AI 警告”的关系。
- 字体用现有本地字体栈，正文 14px，辅助 12px，页面标题 24～30px。
- 禁用装饰性英文眉题，如 `WORKSPACE`、`EXECUTION`、`CONTEXT LAB`。

## 3.3 间距与密度

- 基础单位 4px。
- 控件高度：小 28、标准 36、主要 40。
- 页面最大宽度：现场 1280px、工作看板无限横向画布、协同室 1440px、记录 1120px。
- 卡片内部间距 12px；大面板 16/20px；页面区块 24/32px。
- 一屏最多一个高强调主动作。

## 3.4 动效

- hover/focus 120ms；按压必须在 `pointerdown` 后 100ms 内产生反馈；模式切换不做整页飞入。
- 动效优先使用可打断的 spring；CSS fallback 使用明确的 `linear()` spring 曲线，不给所有元素套同一个 `ease`。
- 拖拽抬升最多 `translateY(-2px)`，可以使用低回弹 spring，但不用果冻、3D 倾斜或磁吸按钮。
- 只动画 `transform` 与 `opacity`；不得通过动画 `width`、`height`、`top`、`left` 制造布局抖动。
- 保存成功用局部状态确认，不全屏 toast 狂轰。
- 动画必须可被用户操作打断，过渡期间不得锁住输入。
- `prefers-reduced-motion` 时大幅位移改为淡入淡出或立即完成。

## 3.5 中期验收交互基线（P0）

本节优先级高于继续扩展业务功能。设计目标是“克制、即时、连续”，不是复制 Apple 外观，更不是给所有卡片增加玻璃和弹跳。

设计与审计来源：

- `~/.codex/skills/apple-design-interaction/SKILL.md`：导航模型、状态设计、感知性能、键盘和指针输入。
- `~/.codex/skills/apple-design-motion/SKILL.md`：按压反馈、spring、可打断过渡、拖拽与 reduced motion。
- `~/.codex/skills/ui-ux-pro-max/SKILL.md`：触控尺寸、响应式、无障碍、视觉一致性检查。
- `~/.codex/skills/web-design-guidelines/SKILL.md`：实现完成后的逐文件 Web UI 审计。

执行时只借鉴规则，不复制仓库的组件、示例页面、品牌资产或营销风格。所有落地代码必须以 AgileCampus 的信息架构和 token 为准。

### 3.5.1 反馈时序

| 场景 | 反馈要求 | 完成时限 |
| --- | --- | --- |
| 按钮/可点击行按下 | 亮度或背景变化，可选 `scale(.985)`；禁用态说明原因 | `<100ms` |
| 普通切换 | 局部内容更新，保留滚动和筛选状态 | `120～180ms` |
| 抽屉打开/关闭 | 桌面从来源侧进入，移动端 sheet；焦点同步移动 | `180～240ms` |
| 拖拽开始 | 移动超过 6px 后才进入 drag，原位占位，目标列预高亮 | `<100ms` |
| 乐观写操作 | 先显示本地结果；失败回滚并在操作附近解释 | 立即 |
| 内容等待 | `<1s` 不闪 spinner；形状确定时用 skeleton；超过 1s 才显示持续状态 | 按阈值 |
| 成功 | 控件自身变成“已保存/已确认”，随后安静恢复 | `1.2～2s` |

### 3.5.2 核心控件状态契约

所有交互控件至少实现：`rest / hover / focus-visible / pressed / disabled / pending / success / error`。不得只实现默认态和 hover。

- **主要按钮**：最小可点击区域 44×44px；一屏最多一个高强调动作；pending 时宽度不得跳动。
- **任务卡片**：hover 只调整边框/底色；点击打开任务抽屉；只有 drag handle 或明确拖拽区域启动拖拽。
- **模式标签**：选中指示物在相邻标签间连续移动；URL、浏览器前进后退和刷新后状态一致。
- **任务抽屉**：支持 Escape、焦点陷阱、关闭后焦点返回来源卡；移动端改为全屏 sheet。
- **菜单/项目切换器**：点击外部和 Escape 关闭；重新打开时保留搜索输入只限当前会话。
- **表单**：错误出现在字段附近；提交失败不清空输入；disabled 必须能让用户知道为何不可操作。
- **AI 运行态**：只在当前任务/会话局部显示；用状态文本和轻微活动指示，不使用无限装饰动画。
- **AI 待确认动作**：确认前展示 before/after；确认后操作区立即进入 pending，成功后锁定已执行状态，禁止 toast 作为唯一反馈。

### 3.5.3 克制规则

- 项目管理、看板、表单、资料列表保持原生快速滚动；禁止 scroll-jacking、页面级 snap 和随滚动飘移的工具栏。
- 禁止给普通卡片做磁吸、鼠标追光、3D tilt、持续漂浮或逐卡 stagger 入场。
- 阴影仅用于正在拖拽的对象、菜单、抽屉等真实浮层。
- 玻璃材质只允许出现在确有覆盖关系的临时浮层，且 M0 默认不使用。
- 图标使用同一套 SVG 语言；禁止 emoji 充当功能图标。
- 颜色不是状态的唯一载体；风险、完成、Agent 等状态必须带文本或图标。

### 3.5.4 M0 可复用实现边界

优先建立少量底层原语，不引入大型 UI 框架：

```text
src/app/(app)/_ui/
├── pressable.tsx
├── async-action.tsx
├── focus-sheet.tsx
├── status-indicator.tsx
└── motion.css
```

- `Pressable` 统一 pointer/keyboard pressed 状态，不能吞掉业务组件的原生语义。
- `AsyncAction` 统一 idle/pending/success/error，不负责具体数据请求。
- `FocusSheet` 统一抽屉焦点、Escape、焦点返回和 reduced-motion 行为。
- `motion.css` 只保存语义 motion token 与 reduced-motion 覆盖，不存页面专用动画。
- 若现有组件已满足职责，扩展现有实现，不为了目录整齐重复造组件。

---

## 4. 页面施工规格

## 4.1 `/today`：跨项目行动页

线框：

```text
今天，周瑜                                     9 月 20 日
你有 2 件需要回应，1 件等待验收

[需要你现在决定]
┌ 待回应 · 前端问答界面 ─ 赤壁演习 ───────── [接住] [接不住] ┐
└ AI 动作待确认 · 拆成 3 项任务 ───────────── [查看差异]       ┘

[正在推进]                         [需要帮助]
任务/Agent run 的紧凑列表           blocker 邀请与可帮事项

[项目脉搏]
最近 4 个项目：下一里程碑、活跃成员、风险一句话
```

数据：

- 新建 `src/lib/today.ts` 中的 `buildMyActionQueue(userId, now)`。
- 返回统一判别联合：`assignment_response | review | blocker_invite | rejected_work | overdue | ai_approval`。
- 排序：需要确认 > 验收 > 求助邀请 > 被退回 > 逾期 > 三天内到期。
- 相同任务只出现一次，选择最高优先级原因。
- 默认最多 8 条，支持“显示全部”。

文件：

- `src/app/(app)/today/page.tsx`
- `src/app/(app)/today/action-row.tsx`
- `src/app/(app)/today/project-pulse.tsx`
- `src/lib/today.ts`
- `tests/today.test.ts`

验收：不同角色看到不同队列；空状态不显示虚假指标；每行一个主动作。

## 4.2 项目“现场”

线框：

```text
[下一步行动 1] [下一步行动 2] [下一步行动 3]

正在发生
人/AI        当前工作             状态        最近变化
周瑜          模型微调实验          需要帮助    2h
小码 · AI     数据接口              运行中      3m

交接轨迹                              最近里程碑
张昭 → 小文AI → 老师                  中期可演示  7/10
任务 + 动作 + 时间                    缺 3 项 / 1 阻塞

开放求助（只有存在时显示）
```

要求：

- “下一步行动”来自纯规则，不让模型排序。
- 正在发生是一张表/列表，不再用多张人物卡。
- 接力轨迹按任务聚合，不显示无意义的每次字段编辑。
- 里程碑只显示最近未完成一项，完整列表移到记录或抽屉。
- 健康问题嵌入对应行动，不再单独放巨大健康面板。

## 4.3 项目“工作”

顶部工具条：

```text
[看板 | 列表 | 时间线]  [我的] [待回应] [待验收] [有阻塞]  搜索  筛选  ＋任务
```

看板：

- 四列固定语义：待开始、进行中、待验收、已完成。
- 列头显示数量与 WIP 提示；不允许用户创建自定义状态。
- 卡片只显示标题、负责人、截止、最高优先流程信号、最多两个标签。
- 点击卡片打开任务抽屉；不在卡片内展开大型表单。
- 列底快速新增只收标题；创建后打开抽屉补充信息。
- 拖到不合法列时提前显示原因。

列表：按“需要行动”而非数据库字段默认排序。可切换负责人、里程碑、截止日分组。

时间线：保留现有能力，但使用同一任务抽屉，不另造编辑弹窗。

## 4.4 项目“协同室”

协同室不是聊天页。桌面三栏：

```text
┌──────────────┬──────────────────────────────────┬──────────────────┐
│ 探索树       │ 当前工作台                       │ 上下文与待确认   │
│              │                                  │                  │
│ 主方案       │ 对话/方案内容                    │ 上下文包 7 项    │
│ ├ 方案 A     │ 关键结论可固定为“候选决策”       │ 2 项已过期       │
│ └ 方案 B     │                                  │                  │
│              │ [比较两个分支] [形成决策]         │ 待确认动作 2     │
└──────────────┴──────────────────────────────────┴──────────────────┘
```

移动端使用顶部切换：探索树 / 工作台 / 上下文。

协同室必须实现：

- 会话树而非平铺列表；显示父子关系与分叉点。
- 关联任务、可见范围、作者、最后活动。
- 上下文包可展开查看来源、更新时间、是否包含。
- 从 AI 回复固定“候选决策”。
- 选择两个分支进入比较模式。
- AI 工具动作进入右栏待确认池，不混入普通消息。
- 人与 Agent 的发言都显示作者，但消息气泡不按左右对打布局。

## 4.5 项目“记录”

顺序：

1. 已验收成果和证据包；
2. 决策记录；
3. 里程碑与自动亮点；
4. 老师反馈/文档/成果链接；
5. 复盘事实与活动；
6. 导出。

当前 `ArchiveSection` 已实现的 entry 必须复用，不再新增重复 artifact 表。后续只补关联 decision/evidence 与导出。

---

## 5. AI 协同创新模型

## 5.1 创新一：上下文包 Context Pack

### 用户价值

当前“继承历史”仍可能把聊天当作上下文。上下文包把 AI 真正需要知道的项目事实变成可见资产：用户知道 AI 看见了什么，也能移除敏感或无关内容。

### 数据模型

新增：

```ts
contextPackStatusEnum = ["draft", "frozen", "superseded"]
contextSourceTypeEnum = [
  "project", "milestone", "task", "blocker", "entry",
  "decision", "conversation", "message", "activity_window", "manual"
]

contextPacks {
  id, projectId, conversationId?, taskId?, createdById,
  title, status, summary?, createdAt, frozenAt?
}

contextPackItems {
  id, packId, sourceType, sourceId?, label,
  snapshot, sourceUpdatedAt?, included, position, createdAt
}
```

关键规则：

- `snapshot` 保存冻结时的精简 JSON，不在运行时偷偷读取更多数据。
- `sourceUpdatedAt` 用于判断“上下文已过期”。
- `frozen` 后项目不再修改；调整内容创建新版本并将旧包标记 superseded。
- 私有会话、token、密码、隐藏 prompt 永远不能成为 pack item。
- pack 上限：20 项、总序列化文本 24k 字符；超限必须显示裁剪结果。
- 模型调用保存 `contextPackId`，以后可复现它当时看到的材料。

### API

```text
POST /api/projects/:projectId/context-packs/preview
POST /api/projects/:projectId/context-packs
GET  /api/context-packs/:id
POST /api/context-packs/:id/freeze
```

preview 只计算候选，不落库；freeze 校验所有来源仍对用户可见。

### 测试

- 私有会话不可被他人加入。
- 来源更新后返回 stale=true。
- frozen 包不可原地修改。
- 超限按固定顺序裁剪并给出 omitted 计数。
- 非项目成员不可读取。

## 5.2 创新二：交接契约 Handoff Contract

### 用户价值

“把任务派给 AI”不等于 AI 理解了任务。每次人→人、人→AI、AI→人交接都应包含最小协议：目标、边界、完成定义、必须交付的证据。

首版不新增 handoff 表，复用：

- tasks：目标、assignee、commitment、状态；
- activity：交接轨迹；
- contextPacks：背景；
- evidenceItems：交付证据；
- agentRuns：执行实例。

在任务中新增字段：

```ts
handoffBrief: text
doneCriteria: jsonb // string[]，最多 8 条
requiredEvidence: jsonb // ("link"|"file"|"text"|"test"|"demo")[]
responseDueAt: timestamp
contextPackId: uuid | null
```

交接 UI 分三步：

1. “要达成什么”——一句话结果；
2. “什么算完成”——可勾选完成条件；
3. “需要带回什么”——证据类型与上下文包。

接收者看到后只能先“接住”或“接不住”；接住时写实现计划，接不住时写原因和建议转交对象。Agent 通过 inbox 获得同一结构化契约。

## 5.3 创新三：并行探索与方案合并

### 用户价值

现有会话分支能保留不同思路，但缺少“比较和收束”。V2 允许团队让人或多个 Agent 并行探索，再由人明确选择，不让分支永久散落。

数据模型：

```ts
branchComparisons {
  id, projectId, createdById,
  leftConversationId, rightConversationId,
  criteria, summary?, createdAt
}

branchComparisonVotes {
  id, comparisonId, voterId,
  preferred: "left" | "right" | "hybrid" | "neither",
  note?, createdAt
}
```

比较页固定维度：

- 共同结论；
- 冲突结论；
- 依据来源；
- 实施成本；
- 风险与未知；
- 可合并部分。

模型可以生成比较摘要，但必须引用两边 message ID；不能无来源输出“推荐方案”。最终选择由人创建 Decision。

合并不是复制全部聊天。用户勾选要保留的结论与来源，生成新会话和新 Context Pack，父关系记录两个来源会话。若当前 schema 只能单父，新增：

```ts
conversationParents {
  conversationId, parentConversationId, throughMessageId?, relation
}
```

迁移后保留旧 `parentConversationId` 兼容读取一版，新写入统一走关系表。

## 5.4 创新四：决策记录 Decision Ledger

### 用户价值

项目最容易丢失的不是消息，而是“最后为什么这么选”。决策记录把 AI 探索转成团队可审计的结论。

数据模型：

```ts
decisionStatusEnum = ["proposed", "accepted", "rejected", "superseded"]

decisions {
  id, projectId, taskId?, milestoneId?,
  title, question, status,
  selectedOption?, rationale?,
  proposedById, decidedById?,
  sourceConversationId?, sourceMessageId?,
  supersededById?, createdAt, decidedAt?
}

decisionOptions {
  id, decisionId, label, description,
  benefits, risks, evidenceRefs, position
}
```

规则：

- AI 只能创建 proposed；人才能 accepted/rejected。
- accepted 必须写选择与理由；理由可以很短但不能空。
- 被替代的决策保留，指向新决策。
- 每条 evidence ref 必须指向用户有权读取的消息、entry、task 或 context item。
- 任务抽屉显示相关决策；项目记录页显示全部已接受决策。

## 5.5 创新五：待确认动作 Approval Inbox

### 用户价值

不同 AI 会话产生的任务草案、字段修改和跟进建议集中到一个确认池，人不必翻聊天找按钮。

数据模型：

```ts
approvalStatusEnum = ["pending", "approved", "rejected", "expired", "executed", "failed"]
approvalActionEnum = [
  "create_task", "update_task", "create_milestone",
  "create_entry", "create_decision", "raise_blocker"
]

approvalRequests {
  id, projectId, conversationId?, messageId?, agentRunId?,
  requestedById, action, payload, beforeSnapshot?,
  status, expiresAt, decidedById?, decisionNote?,
  executedAt?, error?, createdAt
}
```

权限矩阵：

| 动作 | student 可确认 | teacher 可确认 | admin 可确认 |
| --- | --- | --- | --- |
| create_task | 是 | 否 | 是 |
| update_task | 本人有编辑权时 | 否 | 是 |
| create_milestone | 否 | 否 | 是 |
| create_entry | 文档/成果 | feedback | 全部 |
| create_decision | proposed | proposed | proposed |
| raise_blocker | 是 | 是 | 是 |

明确禁止：AI 验收任务、删项目、改成员角色、生成/撤销 token、读取私人会话。

执行采用 compare-and-swap：提交时检查 `beforeSnapshot` 中的关键 `updatedAt/status/assigneeId`。不一致则 expired，要求用户查看新差异，不能静默覆盖。

## 5.6 创新六：证据包 Evidence Pack

### 用户价值

“完成说明”不是验收证据。每次提交应把成果、测试、演示、文档和 AI 参与范围组织成证据包。

数据模型：

```ts
evidenceTypeEnum = ["link", "text", "test", "demo", "entry", "message", "run"]

evidenceItems {
  id, projectId, taskId, submittedById,
  type, label, value, sourceId?, createdAt
}
```

规则：

- 提交任务时，根据 `requiredEvidence` 校验类型是否齐全。
- 不要求上传大文件；V2 先保存 URL、文本、项目 entry、message/run 引用。
- 老师验收界面按“承诺→完成条件→证据→AI 参与→验收意见”排列。
- Agent run 自动成为一种 evidence，但不能单独证明业务结果完成。
- 证据删除必须保留 activity 记录；已验收任务的证据默认不可删除，只能追加更正。

## 5.7 创新七：静默观察者（P1，不阻塞首发）

AI 可订阅确定性事件，在不写库、不打扰成员的前提下形成建议草稿：

- 三天无活动但临近截止；
- 同一任务两次被退回；
- blocker 超过 24 小时无人回应；
- 两个任务依赖冲突；
- 里程碑范围变化。

观察者只创建 `approvalRequests(pending)` 或摘要草案；默认每日合并一次，不逐事件轰炸。任何自动建议都展示触发规则和证据。

## 5.8 创新八：风险排演（P2）

允许用户问“如果这个任务晚三天会怎样”。依赖传播、日期冲突、里程碑影响由确定性函数计算；模型只用自然语言解释。结果不自动改日期，可一键生成待确认调整方案。

---

## 6. 文件与组件目标结构

完成后，项目界面不得继续把全部组件堆在 `[projectId]` 根目录：

```text
src/app/(app)/
├── _shell/
│   ├── top-workbar.tsx
│   ├── project-switcher.tsx
│   ├── account-menu.tsx
│   └── mobile-workbar.tsx
├── today/
│   ├── page.tsx
│   ├── action-row.tsx
│   └── project-pulse.tsx
├── collaboration/
│   ├── page.tsx
│   ├── approval-list.tsx
│   └── agent-presence.tsx
├── library/page.tsx
└── projects/[projectId]/
    ├── page.tsx
    ├── _shared/
    │   ├── project-band.tsx
    │   ├── space-tabs.tsx
    │   ├── task-drawer.tsx
    │   └── context-drawer.tsx
    ├── _live/
    │   ├── live-space.tsx
    │   ├── next-actions.tsx
    │   ├── presence-table.tsx
    │   └── relay-trace.tsx
    ├── _work/
    │   ├── work-space.tsx
    │   ├── board-view.tsx
    │   ├── list-view.tsx
    │   └── work-toolbar.tsx
    ├── _studio/
    │   ├── studio-space.tsx
    │   ├── exploration-tree.tsx
    │   ├── conversation-workbench.tsx
    │   ├── context-pack-panel.tsx
    │   ├── branch-comparison.tsx
    │   └── approval-stack.tsx
    └── _record/
        ├── record-space.tsx
        ├── evidence-ledger.tsx
        ├── decision-ledger.tsx
        └── archive-list.tsx
```

领域层：

```text
src/lib/
├── actions/queue.ts
├── context-pack.ts
├── decision.ts
├── approval.ts
├── evidence.ts
├── branch-comparison.ts
├── project-space.ts
└── task-transition.ts
```

迁移规则：

- 新组件先读取现有领域函数；不要复制业务查询。
- 旧组件在新模式达到功能等价后删除。
- `actions.ts` 只做解析、鉴权、调用领域函数和映射错误，不堆业务逻辑。
- 客户端 props 只传序列化 DTO，不直接传数据库行。

---

## 7. 逐提交施工计划

## Commit 1：冻结原创边界与视觉基线

文件：

- 新建 `docs/design/originality-audit.md`
- 新建 `docs/design/product-language.md`
- 修改 `README.md`

步骤：

- [ ] 截取并记录原版以下页面结构：登录、项目列表、项目页、看板、聊天、团队；只记录结构，不复制资产。
- [ ] 为每页填写“原版指纹 / V2 对应设计 / 为什么不同”。
- [ ] 固定本文第 2～4 节的路由、术语和骨架。
- [ ] README 明确当前产品主张，不再用“另一个项目管理系统”描述。
- [ ] 不改业务代码。

验收：`originality-audit.md` 六类指纹均有明确差异；不存在“之后再设计”。

提交：`docs: 冻结原创产品边界与交互语言`

## Commit 2：新 token 与顶部工作带

文件：

- 修改 `src/app/globals.css`
- 修改 `src/app/(app)/layout.tsx`
- 删除/迁移 `src/app/(app)/app-navigation.tsx`
- 新建 `src/app/(app)/_shell/*`

步骤：

- [ ] 先读 Next.js 16 layout 与 Link 本地文档。
- [ ] 按 3.2 建 token；提供旧 token 临时 alias，避免一次破坏所有旧组件。
- [ ] 实现顶部工作带和移动端工作带。
- [ ] 项目切换器使用 `listMyProjects`，不在客户端泄漏无权项目。
- [ ] 全局求助入口移入协作菜单，但保留原 `StuckButton` 功能直到新入口验收。
- [ ] 检查 320px、768px、1440px。
- [ ] 新 shell 稳定后删除旧左栏，不同时保留两套主导航。

验收：所有现有路由可进入；无左侧永久栏；键盘可操作；无横向溢出。

提交：`refactor: 建立顶部工作带与原创视觉基线`

## Commit 3：项目四模式与按需加载

文件：

- 新建 `src/lib/project-space.ts`
- 新建 `_shared/project-band.tsx`、`space-tabs.tsx`
- 新建四个 space 壳
- 修改项目 `page.tsx`
- 新建 `tests/project-space.test.ts`

函数：

```ts
export const PROJECT_SPACES = ["live", "work", "studio", "record"] as const;
export function parseProjectSpace(value: unknown): ProjectSpace;
export function buildSpaceHref(input: { projectId: string; space: ProjectSpace; taskId?: string }): string;
```

步骤：

- [ ] 测试合法/非法/数组/空值。
- [ ] page 先鉴权，再按 space 调用对应 loader。
- [ ] 四个 loader 独立；禁止所有 space 查询所有数据。
- [ ] 旧页面内容分配进四个壳，但暂不改变业务。
- [ ] 旧 activity/retrospective/timeline 深链接仍工作。

验收：默认 live；刷新保持模式；Network/日志证明 live 不查完整 conversation history。

提交：`refactor: 将项目重组为现场工作协同记录四模式`

## M0：中期验收交互质感冲刺（立即执行，阻塞 Commit 4）

目标：用已有顶部工作带和项目四模式完成一条 3～5 分钟可稳定演示的交互路径，让评审先感受到“这是一套重新设计的协作产品”，同时不伪造尚未完成的 AI 后端能力。

### M0.1 先审计，不盲目加动画

文件：

- 新建 `docs/design/midterm-interaction-audit.md`
- 修改 `docs/design/product-language.md`
- 检查 `src/app/(app)/_shell/*`、项目四模式壳、当前任务卡与对话入口

步骤：

- [ ] 完整阅读本计划 3.1～3.5 和四个已安装技能的 `SKILL.md`；按需读取其 references。
- [ ] 用 `ui-ux-pro-max` 分别检索 `productivity collaboration dashboard`、`keyboard focus drawer`、`dragging movements`，并使用 `--stack nextjs` 查询实现约束；只记录与当前产品匹配的结果。
- [ ] 盘点中期路径中每个可操作元素的 8 态：rest/hover/focus/pressed/disabled/pending/success/error。
- [ ] 标记点击无反应、布局跳动、只能 hover 才发现、焦点丢失、反馈只靠 toast 的位置。
- [ ] 给每项问题标 P0/P1/P2；M0 只修阻断演示或明显破坏质感的 P0。
- [ ] 截取 1440×900、768×1024、390×844 三种基线截图，写入审计文档；不要把截图二进制直接塞入 git，按仓库既有截图策略存放。

验收：审计覆盖顶部工作带、项目切换、四模式切换、任务卡、任务抽屉或其当前替代入口、AI 协同入口；每个 P0 都有文件和可复现动作。

### M0.2 建立交互原语与 motion token

文件：

- 修改 `src/app/globals.css`
- 按 3.5.4 新建或扩展 `_ui/*`
- 新建相应组件测试；若项目已有同类测试目录则跟随现有结构

步骤：

- [ ] 定义 `--motion-instant`、`--motion-fast`、`--motion-panel` 和低回弹 spring curve；禁止组件自行发明 duration。
- [ ] 实现 `Pressable`，保证 button/link 原生语义、Space/Enter、pointer cancel 和 focus-visible。
- [ ] 实现 `AsyncAction` 状态机；pending 时禁止重复提交，失败可重试，文本宽度变化不造成明显 CLS。
- [ ] 实现或加固 `FocusSheet`；支持 Escape、外部关闭策略、焦点陷阱、关闭后返回来源、移动端全屏。
- [ ] 在 `prefers-reduced-motion: reduce` 下禁用缩放和大位移，只保留必要的 opacity/即时状态。
- [ ] 不新增 Framer Motion/GSAP 等依赖；现阶段 CSS + React 状态足够。确有无法完成的手势需求时另开决策记录。

验收：键盘、鼠标、触屏路径都可用；组件卸载后无遗留定时器；动画中途反向操作不会卡死；无新增 hydration warning。

提交：`feat: 建立中期演示交互反馈原语`

### M0.3 打磨五个中期可见触点

按顺序执行，前一项未验收不得继续堆后续装饰：

1. **顶部工作带与项目切换器**
   - [ ] 点击、键盘、Escape、外部关闭和焦点返回完整。
   - [ ] 项目切换不丢当前用户能理解的上下文；等待时保持旧内容，不整页白屏。
2. **项目四模式切换**
   - [ ] active indicator 连续移动；内容只做轻微淡入，不整页飞入。
   - [ ] 快速连续点击可打断，不排队播放动画；URL 与选中态始终一致。
3. **任务扫描与抽屉入口**
   - [ ] hover、focus、pressed 清楚但克制；点击和拖拽意图不冲突。
   - [ ] 抽屉从来源方向出现并保持背景语境；关闭后返回原任务。
4. **看板拖拽**
   - [ ] 6px 激活阈值、原位占位、拖拽抬升、目标列高亮、非法投放预提示。
   - [ ] drop 先乐观显示，失败回滚；学生拖入 done 之前就看到不可操作原因。
   - [ ] 提供键盘移动或等价菜单，不允许手势成为唯一入口。
5. **AI 协同入口与待确认示意**
   - [ ] 从任务进入 AI 时保留任务标题、目标和上下文来源可见性。
   - [ ] 尚未实现的能力标注“原型/即将接入”，不得用假进度冒充真实运行。
   - [ ] 至少做出 context preview → AI 局部运行态 → 建议 diff → 人工确认的前端演示闭环；数据可以使用明确标注的 demo fixture，但不得写进生产数据库。

验收：五个触点在 60fps 目标下无明显卡顿；按钮按压即时；无悬浮乱跳；快速切换、取消拖拽和失败回滚都能恢复正确状态。

提交：`feat: 打磨项目模式拖拽抽屉与 AI 确认体验`

### M0.4 中期演示与质量闸门

- [ ] 新建 `docs/demo/midterm-script.md`，严格控制在 3～5 分钟。
- [ ] 演示顺序：项目切换 → 四模式定位 → 任务拖拽 → 抽屉查看上下文 → 发起 AI 协同 → 查看建议差异 → 人工确认。
- [ ] 为每一步写“讲什么 / 点哪里 / 预期反馈 / 失败备用动作”，避免现场临时找功能。
- [ ] 运行相关测试、`npm run lint`、`npm run build`。
- [ ] 用 Chrome Performance 或等价工具检查一次抽屉和拖拽；不得出现持续 long task 或明显布局抖动。
- [ ] 使用 `web-design-guidelines` 对本阶段改动的 UI 文件做最终审计；所有 P0/P1 问题修复或在审计文档说明理由。
- [ ] 逐页检查 200% 缩放、390px 宽度、键盘路径与 reduced motion。
- [ ] 保存中期验收最终截图，并与老师原版并排验证“不是换皮”。

M0 完成定义：

- [ ] 一条 3～5 分钟演示路径可以连续完成，不刷新、不进入死路。
- [ ] 点击、切换、打开、拖动、确认五类动作均有即时且一致的局部反馈。
- [ ] AI 演示清楚表现“读了什么、建议什么、由谁确认”，而非聊天框生成文字。
- [ ] 页面没有滥用玻璃、弹跳、悬浮、磁吸或长动画。
- [ ] 三种 viewport、键盘、reduced motion、lint、build 全部通过。
- [ ] 中期截图与原版不构成换色即可互换的同构页面。

M0 未通过时停止，不进入 Commit 4。中期验收通过后，原 Commit 4～13 顺序保持不变。

## Commit 4：今日行动与现场页

文件按 4.1、4.2 新建；复用 `health.ts`、`blocker.ts`、`workspace.ts`。

步骤：

- [ ] 先写 `tests/today.test.ts`，覆盖六类 action 与去重。
- [ ] 实现 `buildMyActionQueue`，纯规则排序。
- [ ] 新增 `/today`，登录默认入口改为 `/today`。
- [ ] 现场页替换当前 `WorkspaceView + HealthPanel + BlockerStrip` 三段堆叠。
- [ ] 风险成为行动行，不显示综合健康分。
- [ ] 人/Agent 统一 presence table。

验收：学生、教师、admin 各自有正确行动；空数据自然；一次点击到执行控件。

提交：`feat: 以行动队列重建今日与项目现场`

## Commit 5：任务抽屉与工作模式

文件按 4.3 与第 6 节结构调整。

步骤：

- [ ] 把状态转换规则提取到 `task-transition.ts`，先写矩阵测试。
- [ ] 卡片去除完整编辑/验收表单。
- [ ] 实现 URL 驱动任务抽屉。
- [ ] 抽屉段落：目标、交接、执行、证据、验收、关系、历史、AI。
- [ ] 添加 KeyboardSensor 与非法 drop 预判。
- [ ] 列内新增只收标题。
- [ ] 保持教师“能验收、不能普通编辑”的边界。

验收：四条任务链全通；Escape/focus return；学生无法拖入 done。

提交：`feat: 用任务抽屉和低噪工作模式承载执行闭环`

## Commit 6：上下文包数据地基

文件：

- 修改 `src/db/schema.ts`、`tests/helpers.ts`
- 新建 `src/lib/context-pack.ts`
- 新建 context pack API
- 新建 `tests/context-pack.test.ts`

步骤：

- [ ] 增加第 5.1 节两表与索引。
- [ ] `buildContextPackPreview` 只收允许的 source descriptor，不接受任意表名。
- [ ] `freezeContextPack` 在事务内验证来源、限制和可见性。
- [ ] `getContextPackForUser` 统一权限边界。
- [ ] orchestrator 改为读取 frozen snapshot；保留旧 snapshot 作为无 pack 会话的兼容路径。
- [ ] message/tool audit 保存 pack ID。

验收：权限、过期、冻结、裁剪、私密隔离测试全部通过。

提交：`feat: 引入可见可冻结的 AI 上下文包`

## Commit 7：协同室第一版

文件：`_studio/*`、chat APIs、conversation DTO。

步骤：

- [ ] 平铺会话列表改为树；禁止用 CSS 假层级，父子关系来自数据。
- [ ] 右栏显示 pack items、fresh/stale、included 状态。
- [ ] 创建会话先 preview，再确认 pack，再发送首条消息。
- [ ] 旧会话可继续，显示“旧会话无冻结上下文记录”。
- [ ] 消息使用连续文档流，不用左右气泡。
- [ ] 工具草案移出消息正文，进入 approval stack 占位。

验收：关联任务打开 studio 时自动预选候选上下文；用户能看到模型将读取什么。

提交：`feat: 将聊天面板重建为上下文可见的协同室`

## Commit 8：并行方案比较与合并

文件：schema、`branch-comparison.ts`、API、`branch-comparison.tsx`、测试。

步骤：

- [ ] 新增 comparison/vote 表。
- [ ] 迁移多父关系表；先双写，旧字段继续读。
- [ ] 选择两个有共同祖先或同一任务的会话比较。
- [ ] 生成摘要时每条结论必须带 message ID refs。
- [ ] 实现人工偏好投票与备注。
- [ ] 合并时勾选结论，创建新 conversation + new pack，不复制无关消息。

验收：不能比较无权限私有会话；合并后来源可追溯；父后续消息不泄漏。

提交：`feat: 支持 AI 方案并行比较与有来源合并`

## Commit 9：决策记录

文件：schema、`decision.ts`、API、studio/record/task drawer、测试。

步骤：

- [ ] 新增 decision 两表。
- [ ] 从消息固定候选决策时预填 source IDs。
- [ ] AI 只能 proposed；server 端强制人确认。
- [ ] accepted/rejected 写 activity。
- [ ] supersede 保留旧链路。
- [ ] record 页与 task drawer 展示相关决策。

验收：每个接受决策有操作者、时间、选择、理由和来源。

提交：`feat: 将 AI 探索沉淀为可追溯决策记录`

## Commit 10：待确认动作池

文件：schema、`approval.ts`、API、`/collaboration`、studio stack、测试。

步骤：

- [ ] 新增 approval 表与枚举。
- [ ] 把现有 `DraftCards` 生成结果适配为 approval request；兼容旧 API 一版。
- [ ] 领域函数内实现权限矩阵，不写在按钮判断里。
- [ ] 批准前展示 before/after diff。
- [ ] compare-and-swap 防过期覆盖。
- [ ] reject 保存可选原因；相同 request 不可重复执行。
- [ ] `/collaboration` 集中显示跨项目 pending。

验收：过期、越权、重复请求、部分失败都有测试；AI 无法验收或删数据。

提交：`feat: 建立跨会话 AI 动作待确认池`

## Commit 11：交接契约与证据包

文件：schema、task lib/actions/drawer、Agent inbox/run、`evidence.ts`、测试。

步骤：

- [ ] tasks 增加交接字段；evidence 表。
- [ ] 创建/分配任务时可填写契约，旧任务字段可空。
- [ ] claim 同时确认契约版本；契约变化后要求重新回应。
- [ ] Agent inbox 返回结构化 done criteria、required evidence、pack。
- [ ] submit 校验证据类型并进入 review。
- [ ] 验收布局按承诺→条件→证据→AI 参与→意见。
- [ ] agent run 自动引用为 evidence，但仍需业务证据。

验收：人和 Agent 使用同一协议；证据缺失时给具体提示；Agent complete 仍不等于 done。

提交：`feat: 用交接契约和证据包统一人机任务闭环`

## Commit 12：记录页与档案导出

文件：record space、project export、archive adapters、测试。

步骤：

- [ ] 复用 project_entries，不建重复成果表。
- [ ] 聚合 evidence、decision、milestone highlights、activity、contribution。
- [ ] 导出 Markdown/JSON。
- [ ] 共享会话只导出索引与已固定决策，不默认导出完整聊天。
- [ ] 私人会话永不导出。
- [ ] 明确 AI 参与范围，不把 AI 输出写成学生本人原创证据。

验收：导出不含 token/私聊/隐藏 prompt；数据稳定可比较。

提交：`feat: 将协作来源决策与证据汇入项目记录`

## Commit 13：删除旧 UI 与原创性回归

步骤：

- [ ] 删除已被替换的 `AppNavigation`、旧 `WorkspaceView`、`HealthPanel`、`BlockerStrip`、旧 `ChatPanel` 等；若仍被兼容路由引用则先适配。
- [ ] 搜索旧英文眉题和旧 token：

```bash
rg 'WORKSPACE|EXECUTION|CONTEXT LAB|ac-card|ac-btn|primary-soft' src/app
```

- [ ] 能删除的全部删除，暂留 alias 写明移除日期。
- [ ] 对照 `originality-audit.md` 逐页截图检查。
- [ ] 对比 `upstream/master`，确保用户主路径不存在同构页面序列。
- [ ] 检查许可证与 `THIRD_PARTY_NOTICES.md`。

验收：六项原创判定全部通过；不是同页换色；旧业务测试仍全绿。

提交：`refactor: 移除旧界面并完成原创产品收口`

---

## 8. API 与权限统一规则

所有新 route/action：

1. 用 Zod 解析输入；
2. 从 session/token 得 actor，不接受 body 传 userId；
3. 调用 `getProjectForUser` 或领域层统一权限；
4. 在事务内做状态检查与写入；
5. 写 activity；
6. 返回最小 DTO；
7. 错误映射为 400/401/403/404/409，未知错误 500；
8. 不把数据库错误、prompt、token 打回客户端。

并发规则：

- 决策、approval、task submit/review 使用状态条件更新或事务锁。
- 重复 POST 要么使用 idempotency key，要么检测已执行状态返回同一结果。
- 客户端乐观更新失败必须回滚并刷新服务器真相。

隐私规则：

- project 会话项目成员可读；private 仅创建者。
- 老师不会因为角色自动获得学生 private 会话。
- context pack 创建者只能加入自己有权读取的来源。
- Agent 只读取明确分派任务的 frozen pack，不读取整个项目私聊。
- 活动事件只记录动作摘要，不记录完整私人消息。

---

## 9. 测试与验收清单

每个 commit 至少运行相关测试；每三个 commit 跑一次全套：

```bash
npm run db:push
npm run db:push:test
npm test
npm run lint
npm run build
```

必须新增或更新的测试：

- `tests/project-space.test.ts`
- `tests/today.test.ts`
- `tests/task-transition.test.ts`
- `tests/context-pack.test.ts`
- `tests/branch-comparison.test.ts`
- `tests/decision.test.ts`
- `tests/approval.test.ts`
- `tests/evidence.test.ts`
- `tests/project-export.test.ts`
- Agent API、conversation、commitment、health 的回归测试。

浏览器验收矩阵：

| 身份 | 桌面 | 手机 | 必走路径 |
| --- | --- | --- | --- |
| student | 是 | 是 | 回应任务、求助、AI 分支、提交证据 |
| teacher | 是 | 是 | 待验收、查看 AI 参与、通过/退回、反馈 |
| admin | 是 | 是 | 建项目、分配、里程碑、确认 AI 动作、导出 |
| agent token | API | 不适用 | inbox、claim、run、blocked、complete |

可访问性：

- Tab 顺序、焦点可见；
- 抽屉焦点陷阱和返回；
- icon button 有名称；
- live region 不重复朗读；
- 颜色不是唯一信号；
- 200% 缩放与 reduced motion。

交互质感回归：

- 按钮和可点击行在 pointerdown 后立即反馈，键盘激活得到等价反馈；
- 任务卡的点击、拖拽和卡片内操作互不误触；
- 抽屉开合期间可以反向操作，关闭后焦点回到来源；
- 快速切换项目模式时 URL、active indicator、内容三者最终一致；
- pending 不重复提交，失败能回滚，成功反馈不只依赖 toast；
- 动画不触发布局跳动，reduced motion 下没有大幅移动；
- 触控目标至少 44×44px，390px 宽度无非预期横向滚动。

原创性验收：

- 将原版与 V2 的登录后首页、项目主页、任务操作、AI 协作、档案五组截图并排。
- 若任一页面可通过“换 logo/颜色”互相转换，判定失败，必须重做结构。
- 若操作序列仍是“项目卡→同构项目页→同构看板→底部聊天”，判定失败。

---

## 10. 演示故事

演示不是功能巡游，固定讲一个协作断点如何被接住：

1. 学生从“今日”看到一个待回应交接，而不是打开看板找任务。
2. 他查看目标、完成条件和上下文包，判断部分工作可交给 Agent。
3. Agent 接住并运行；遇到数据格式问题，上报 blocker 和所需帮助。
4. 同伴从协作页响应，补充一条项目文档到上下文包。
5. 团队在协同室让两个分支分别探索方案，比较共同点、冲突、证据和成本。
6. 人工形成 Decision，选择混合方案并说明理由。
7. AI 生成任务调整草案，进入待确认池；管理员查看差异后批准。
8. Agent 提交证据包，学生补演示链接，老师按完成条件验收。
9. 记录页自动出现决策、证据、人机接力、里程碑亮点和成果。

这段演示的创新结论：AI 不只是“帮你生成内容”，而是在一套可追溯的交接协议里成为团队成员。

中期验收使用 M0.4 的 3～5 分钟精简脚本，只承诺已经实现或明确标成 demo fixture 的能力；完整九步故事留给终期验收。中期展示重点依次为：原创骨架、操作手感、任务上下文、AI 建议可见性、人工确认边界。

---

## 11. 下游 AI 启动提示词

```text
你将在 /Users/qwsdjivc/agilecampus-ai 执行：
docs/superpowers/plans/2026-09-20-agilecampus-original-product-and-ai-collaboration.md

这是施工规格，不是建议列表。先完整阅读 AGENTS.md、本文件、现有
2026-09-17 总计划、docs/ai-collaboration.md 和当前 schema。确认 HEAD 包含 55684b9，
识别工作区已有修改并保留它们，然后从 M0 中期验收交互质感冲刺开始；Commit 1～3 已完成，
不得重做或回退。

M0 开始前还必须阅读：
- ~/.codex/skills/apple-design-interaction/SKILL.md
- ~/.codex/skills/apple-design-motion/SKILL.md
- ~/.codex/skills/ui-ux-pro-max/SKILL.md
- ~/.codex/skills/web-design-guidelines/SKILL.md

这些技能是交互与审计依据，不是外部页面模板。只把适合生产力工具的即时反馈、状态完整性、
空间连续性、键盘/触控、reduced motion 和审计规则落地；禁止复制品牌视觉，禁止把项目做成
Apple 官网，禁止用玻璃、弹跳和滚动特效掩盖尚未完成的功能。

目标是原创重构，不是换皮：取消旧左侧栏和长项目页，建立顶部工作带、今日行动、
项目四模式、任务上下文抽屉和协同室。保留并复用已验证的领域逻辑，不重写权限、任务
四态、求助、风险、活动、Agent run 和 project_entries。

一次只执行一个 M0 子阶段或 Commit。每个阶段必须：
1. 检查现有实现和调用者；
2. 阅读相关 Next.js 16 本地文档；
3. 先写或更新失败测试；
4. 做最小完整实现；
5. 跑局部测试、lint/build（按计划频率）；
6. 用浏览器按身份验收；
7. 检查 diff 和敏感信息；
8. 以计划给定语义提交。

不要提前实现后续 Commit，不要把所有 schema 一次性塞入一个巨型提交，不要复制外部
项目整套 UI，不要让 AI 绕过人工确认，不要泄漏 private 会话或 token，不要用总分评价学生。

每完成一项，汇报：已完成 checkbox、修改文件、数据库变化、测试输出、浏览器验收、
与原版的结构差异、剩余风险。遇到计划与真实代码冲突时停止该小项，给出证据和最小修订建议。
```

---

## 12. 完成定义

- [ ] 原版与 V2 无法通过换色、换 logo、调间距互相转换。
- [ ] 用户主路径不再复用原版页面顺序。
- [ ] AI 协作具有上下文包、并行比较、决策、待确认、证据五个闭环。
- [ ] 人与 Agent 使用同一交接协议，但权限与身份清楚。
- [ ] 每个 AI 写操作可追溯来源并需合法人类确认。
- [ ] 每项验收可见完成条件和证据，不靠聊天截图。
- [ ] 项目记录自动沉淀决策、证据、成果、里程碑和贡献事实。
- [ ] 旧 UI 已删除或只有明确期限的兼容层。
- [ ] M0 中期交互闸门通过：按压、模式切换、任务抽屉、拖拽、AI 确认均有一致反馈与异常恢复。
- [ ] 生产力页面保持克制；无 scroll-jacking、无手势唯一入口、无以装饰动效替代状态说明。
- [ ] 全量测试、lint、build 通过。
- [ ] 三类人类角色与 Agent API 的演示剧本完整跑通。
