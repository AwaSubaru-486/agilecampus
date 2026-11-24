# 状态判定点清单（图九·P0 产出，P2 消费）

> **执行状态：已于 P2 全部落定。** 13 处判定点按本表的「P2 应改」列逐条改毕，
> 3 处配色已补 `review` 一色，`#13` 的两个 agent 端点已改为提交语义。
> 回归：全量测试 274 passed / 2 skipped，`tsc` 与 `eslint` 均通过，生产构建通过。
> 本表保留作日后加档（如 `cancelled`）时的施工模板——加一档要动哪些地方，此处已列全。

引入 `review`（待验收）档之前，全仓有 13 处把 `status === "done"` 当作「已完成」用的判定点，
以及 3 处状态配色映射。它们今天与「已终结」同义，加档后**不再同义**。

P0 刻意一处未动——因为 P0 之后 `isTerminal() === isCompleted() === (s === "done")` 是恒等变换，
替换看起来安全；但 P2 引入 `review` 的那一刻，这 13 处的语义会**同时**改变，
且藏在一个「加状态」的提交里。危险的不是改错，是**没人知道改了 13 个地方**。

故 P0 只把清单列出来、逐点标注应有的语义，P2 再按表施工。

---

## 一、必看的陷阱：`"done"` 不是只属于任务

盲目全局替换 `"done"` 会**误伤里程碑**：

| 位置 | 说明 |
|---|---|
| `src/db/schema.ts:58` | `milestoneStatusEnum = pgEnum("milestone_status", ["open", "done"])` —— **另一个枚举，取值恰好也叫 done**。里程碑的「已完成」与任务的「已完成」无关，勿合并。 |

另有若干 `bg-done` / `bg-doing` 是**纯装饰色**，与任务状态无关，一律不要动：

- `src/app/(app)/projects/page.tsx:43` 项目状态圆点
- `src/app/(app)/layout.tsx:65` 页脚装饰点
- `src/app/(app)/settings/tokens/token-manager.tsx:66` 令牌「生效中」徽标
- `src/app/(app)/teams/[teamId]/resources/page.tsx:86` 资源「占用中」徽标
- `src/app/(app)/projects/[projectId]/draft-cards.tsx:32,35,57` 草案卡片的 UI 局部状态机（`"idle"|"pending"|"done"`）

---

## 二、13 处终态判定点

「P2 应改」列给出**建议**的谓词，但每条都需在 P2 逐点确认——尤其带 ⚠️ 的四条，它们是产品语义决策而非机械替换。

| # | 位置 | 现义 | P2 应改 | 理由 |
|---|---|---|---|---|
| 1 | `src/lib/task.ts:151` | 状态转为 done 时发完成通知 | `isCompleted(patch.status) && !isCompleted(task.status)` | 「任务完成」通知应在**真正通过验收**时发；提交验收时不该惊动创建者 |
| 2 | `src/lib/agent/commit.ts:105` | 同上（AI 批量落库路径） | 同上 | 与 #1 必须同口径，否则网页发、AI 不发 |
| 3 | `src/lib/project.ts:183` | `doneCount` | `isCompleted` | 保持原义：进度分子**不含**待验收，否则进度虚高 |
| 4 | `src/app/(app)/projects/[projectId]/project-summary.tsx:39` | `done` 计数 | `isCompleted` | 同 #3 |
| 5 | `project-summary.tsx:41` | 「我负责」 | `isInFlight` | ⚠️ 任务交出去待验收，就不该再算在「我负责」里（同 `isInFlight` 的既有注释） |
| 6 | `project-summary.tsx:43` | 7 天内到期 | `isActive` | 待验收的仍有交付压力，该出现 |
| 7 | `project-summary.tsx:46` | 已逾期 | `isActive` | 同 #6 |
| 8 | `project-summary.tsx:48` | 待认领（无负责人） | `isInFlight && !assigneeId` | 同 #5 |
| 9 | `src/lib/board-filters.ts:81` | 「仅看逾期」筛选 | `isActive` | 同 #6 |
| 10 | `src/app/(app)/projects/[projectId]/timeline/page.tsx:156` | 甘特逾期判定 | `isActive` | 同 #6 |
| 11 | `src/lib/notify.ts:94` | 临期/逾期扫描 SQL | **不改谓词**，改**收件人** | ⚠️ 见下 |
| 12 | `src/app/(app)/projects/[projectId]/task-card.tsx:137` | 显示完成说明 | `!isInFlight` | ⚠️ 成员**提交验收时**正是要填完成说明，此刻必须显示，不能等到 done |
| 13 | `src/app/api/agent/tasks/complete/route.ts:23` | 硬编码 `status: "done"` | 改提交语义（→ `review`） | ⚠️ 见下 |

### ⚠️ #11 的特别说明

`ne(tasks.status, "done")` 这个谓词**不用改**——`review ≠ done`，所以待验收的任务天然仍被扫到，行为正确。

错的是**收件人**：现在扫到谁就催谁（`assigneeId`），但待验收的任务该催的是**验收人**（admin/teacher），不是已经交出活的成员。
催错人比不催更伤——被催的人会觉得系统不懂他干了什么。

故 #11 是 P2 中唯一「谓词不动、逻辑重写」的一条。

### ⚠️ #13 的特别说明

这是全仓唯一会**硬跳 done** 的生产代码。加状态机后，它对 student 会直接抛错——
**Claude Code 的「完成任务」能力会静默失效**（端到端用的人不会立刻发现，因为报错在 API 层）。
故 P2 必须同步：
- 该端点改提交语义（`status: "review"` + 写 `submittedAt`）
- 新增 `POST /api/agent/tasks/review`（`{taskId, decision: "accept"|"reject", note?}`）供组长/教师用
- 更新 `docs/agent-api.md` 与 `.claude/skills/agilecampus/SKILL.md`

---

## 三、3 处状态配色映射

加 `review` 档后需补第四色（`--color-review`，**避开 `--color-medium` 的琥珀**，否则「待验收」与「中优先级」同色）：

| 位置 | 内容 |
|---|---|
| `timeline/page.tsx:148-151` | `STATUS_BAR` 映射，补 `review: "bg-review"` |
| `timeline/page.tsx:210` | `STATUS_BAR[b.status] ?? "bg-todo"` —— ⚠️ 兜底会**静默错色**（未知状态一律画成待办灰），漏补映射时不会报错 |
| `timeline/page.tsx:227-229` | 图例三条，补第四条 |

---

## 四、三处曾会静默出错、P0 已修

供 P2 复核用。这三处的共同失败模式：**加档后不报错，数字悄悄错掉**。

| 位置 | 原写法 | 症状 |
|---|---|---|
| `src/lib/project.ts:93` | `const byStatus = { todo: 0, doing: 0, done: 0 }` | **无类型标注，编译器抓不到**。第四档任务写进 `byStatus["review"]` 后，`taskTotal` 仍只加字面量那三项 → 总数少算、进度虚高 |
| `src/lib/agent/tools.ts:14` | 同上（有 `Record<TaskStatus, number>` 标注） | 加档时是编译错误，属良性；但 `byStatus[t.status]++` 对未知键得 `undefined++` = **NaN** |
| `src/lib/agent/snapshot.ts:24,36` | 同上，且 :36 硬编码中文串 | 统计串写死「待办/进行中/已完成」三项，模型看到的数字与现实不符 |

P0 已全部改为 `emptyByStatus()` + 由枚举派生文案。P2 加档时这三处**无需再动**。

---

## 五、P2 施工顺序（依赖关系）

```
1. lib/task-status.ts 加 "review" + TRANSITIONS + canTransition
2. db/schema.ts taskStatusEnum 自动跟上（已由 TASK_STATUSES 派生）
   → 此时 tsc 会报出 STATUS_LABEL / STATUS_TONE / emptyByStatus 的补全点
3. globals.css 加 --color-review（先做，否则第 4 步的 class 无样式）
4. 按本表逐点改 13 处谓词 + 3 处配色
5. 接线：updateTask 内 assertTransition（顺序：权限 → 归属 → 状态机）
6. 改 #13 的两个 agent 端点 + 文档
7. 跑测试，按 P2 清单同步既有断言
```

**第 2 步是安全网**：`STATUS_LABEL`、`STATUS_TONE`、`emptyByStatus` 都是 `Record<TaskStatus, ...>`，
加档后 TS 会主动报出所有待补之处。这正是 P0 把它们做成穷尽 Record 的目的。

---

## 六、回归检查（P0 已建立的机械手段）

```bash
# 纯重构证明：diff 中不应出现终态谓词的增删
git diff | grep -c '=== "done"'        # 应为 0

# 加档后：下列文件应全部处理完毕，不留字面量
grep -rn '"done"' src/ --include='*.ts' --include='*.tsx'
```

P0 完成时 `git diff | grep -c '=== "done"'` = **0**，全量测试 226 passed / 2 skipped，与基线一致。
