# 协同执行台数据与权限映射

范围：工单 00。这里只记录当前代码事实和工单 02 的读取约束，不代表页面已经接入。

## 读取

| 内容 | 现有来源 | 权限与投影约束 |
| --- | --- | --- |
| 项目、团队角色 | `project.ts:getProjectForUser(actorId, projectId)` | 无项目或非团队成员均返回 null；必须在批量读取前调用 |
| 任务列表 | `task.ts:listProjectTasks`；`tasks` 表 | 已检查项目成员；现有查询无分页。新投影需分页，不给每行加载完整详情 |
| 任务详情、交接契约 | `task.ts:getTaskDetail`、`getDrawerTask` | 已检查任务所属项目权限；还须检查 task.projectId 等于本次选中项目，不能仅因两个项目都有权限便混用 |
| 任务字段 | `tasks` 的 title/status/priority/sortOrder/dueDate/assigneeId | Task 状态独立于 Run 状态；负责人类型来自 users.kind，不靠姓名推断 |
| 契约字段 | handoffBrief/doneCriteria/requiredEvidence/responseDueAt/contextPackId/handoffVersion/committedHandoffVersion/committedAt | 认领版本必须与当前版本相同；上下文冻结状态不能仅通过非空 contextPackId 推断 |
| 运行记录 | `agent-run.ts:listTaskRuns(taskId)`；`agentRuns` | 函数本身没有用户权限参数，外层必须验证任务/项目归属；列表只给 id/status/时间/agentId/taskId，不批量返回 result/error |
| 运行状态 | queued/dispatched/running/completed/failed/cancelled | 前三项都是活动状态。现有部分 busy 查询漏 queued，不直接复用。completed 不等于任务已提交或验收 |
| 任务阻塞 | `blocker.ts:listProjectBlockers`；`blockers` | 按本项目、taskId、status=open 批量计数；项目级阻塞或 Agent 总状态不能污染每个任务 |
| 证据 | `evidence.ts:listTaskEvidence(actorId, taskId)` | 通过任务检查项目权限；仅选中任务加载。共享证据不授权展开它引用的私密会话 |
| 上下文包 | `context-pack.ts:getContextPackForUser`、`listContextPacks` | 详情复用会话权限检查；校验与当前项目/任务的关联；不能绕过详情入口读取私密快照。过期检查会逐项查源，只对选中任务做 |
| 会话/消息 | `agent/conversation.ts:getConversationForUser`、`listConversationMessages` | 项目权限加 private 创建者检查；只能读取选定、已验证任务关联的会话，不用 getOrCreate/resolveConversation 等可能写入的入口 |
| 审批 | `approval.ts:listApprovalRequests`、`getApprovalRequestForUser` | 复用工具级 canResolve；审批没有直接 taskId，须由可见 sourceConversation 的 taskId 确认关联。无来源不能猜成当前任务审批 |
| 活动 | `activity-feed.ts:listProjectActivity`；`activityEvents` | 项目权限和 taskId 过滤；现有接口仅 limit、无稳定游标。任务活动不是 Run 专属工具日志；不能通过相同 taskId 虚构 runId 关联 |

## 写入入口

项目任务 actions 文件为 `src/app/(app)/projects/[projectId]/actions.ts`。

| 操作 | 已有入口 | 不可绕过的规则 |
| --- | --- | --- |
| 新建/编辑/删除/分配任务 | createTaskAction/updateTaskAction/deleteTaskAction | 复用服务端角色和字段验证，不从客户端直写数据库 |
| 排序 | moveTaskAction | 不允许拖拽绕过验收修改 status |
| 认领/拒绝/提交 | claimTaskAction/declineTaskAction/submitTaskAction | 保留现有签名；执行权限由 requireTaskExecution 校验；提交要满足证据要求 |
| 验收通过/退回 | reviewTaskAction | requireTaskReview 限 admin/teacher；Agent 完成报告不是验收 |
| 上报/解决阻塞 | blocker.ts:raiseBlocker/resolveBlocker/cancelBlocker | 复用领域检查；不能由页面更新任务状态代替 |
| 新增证据 | evidence.ts:createEvidenceItem | 复用任务权限、证据类型和链接验证 |
| 创建/冻结上下文 | context-pack.ts:createContextPack/freezeContextPack | 冻结只允许创建者操作 draft；读取投影禁止调用这些函数 |
| 确认/拒绝审批 | approval.ts:resolveApprovalRequest | 按工具和角色检查、校验 pending，不能把任务审核权限套到全部审批 |
| 会话分支 | POST /api/conversations/[conversationId]/fork | throughMessageId 必填，复用源会话权限；返回新 conversation，不返回恢复的进程 |
| Agent 上报 | POST /api/agent/runs | Bearer 身份；不能作为浏览器启动接口，也不能泄露 token |
| 网页启动/停止/重跑/恢复进程 | 未验证到可用的浏览器入口 | 保持能力关闭。enqueueRun 有定义不等于已有授权启动服务；详见 gaps |

## 工单 02 必须验证

任务默认每页 50 条，选中任务运行/事件各 30 条，提供稳定游标和 hasMore。列表必须批量读摘要，不能逐任务调用详情。明确传入无权限或外项目的 task/run/conversation 时返回统一的不可访问结果，不自动换成第一条记录。游标须校验范围，禁止跨项目/任务误用。私密内容不得进入列表 DTO。

既有 `requireTaskExecution` 的注释称拒绝 teacher，但实现是 admin 或负责人本人；新读取层不能凭注释擅自改权限。是否强化此规则另列安全整改，不在本工单修改现有写接口。
