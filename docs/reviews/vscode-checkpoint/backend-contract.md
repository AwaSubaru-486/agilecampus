# VS Code 检查点与人工交接：后端契约提案（B01 已签收）

状态：已于 2026-10-02 完成 B01 联合签收。正式进入 B02 后端实现阶段。扩展与网页统一遵循本文规定的数据结构、ACL 规则与 /api/extension/v1 API 规范。

范围：让成员 A 将本地检查点登记为可审计的交接，明确指定任务和成员 B；B 取得经授权的材料后在精确代码基线上继续，必要时建立彼此隔离的 Attempt。网页继续负责成员/任务权限和人工验收；VS Code 扩展负责本地 Git、session 接入与执行。第一版不上传完整 Agent transcript，不自动恢复其他人的运行进程，不改变现有任务状态机。

## 1. 仓库现状（已实现事实）

| 现有能力 | 当前实现与约束 | 对扩展交接的影响 |
| --- | --- | --- |
| PAT 身份 | `Authorization: Bearer ac_…` 由 `authenticateBearer` 校验，返回 token 所属真人 `userId`。令牌库保存 SHA-256 和撤销时间；令牌没有 API scope。 | 不能靠本地 Git 邮箱识别成员。现有 PAT 权限较宽，E09 需要决定新增扩展专用 scope/token，不能把“扩展只调用 GET”误说成令牌只读。 |
| 项目/任务只读 | `/api/agent/projects`、`/api/agent/projects/:projectId`、`/api/agent/projects/:projectId/tasks`、`/api/agent/tasks/:taskId` 接受 Bearer；项目/任务 service 执行成员权限检查。任务列表没有 cursor 分页。 | 可继续供扩展刷新列表和详情使用；新增交接读接口仍须逐次校验成员资格。 |
| 任务契约 | Task 含 `handoffVersion`、`committedHandoffVersion`；修改交接要求会递增版本。`claimTask` 固定认领版本，`submitTask` 会核对提交契约版本，最终由人审核。 | 交接创建/接收必须带 expected task/handoff version；不能静默更新任务负责人或状态。 |
| Context Pack | `/api/projects/:projectId/context-packs` 及 preview/freeze/detail 当前通过网页登录 session `auth()`，不是 Bearer API；服务层已有项目访问、作者和冻结校验。 | 可以复用现有冻结、裁剪和权限领域逻辑，但扩展端当前不能直接调用这些网页登录接口。不得重新实现一套绕过权限的快照读取。 |
| 对话 fork | `/api/conversations/:conversationId/fork` 当前要求网页登录 session，并按 `throughMessageId` 创建私密/项目可见的对话分支。 | 可以作为网页中继续项目对话的既有能力；不能声称该 API 已供 VS Code PAT 调用，也不能把其 transcript 默认复制进 checkpoint。 |
| Agent Run | `/api/agent/runs` 的 Bearer 身份映射为已登记的 Agent 用户；Agent 只能报告自身运行。`completed` 会提交任务等待人工验收。 | 本机由真人启动的 Codex CLI 不是真正的注册 Agent，不能伪造 agentId、写 Agent Run 或将本地进程状态映射成共享任务状态。 |

身份与角色：真人身份必须来自认证 token 的 `userId`；项目/团队角色来自当前数据库成员关系（目前 `team_members.role` 是团队角色）。不得由请求体、显示名、Git 配置或客户端缓存决定。项目是否允许该角色执行交接动作由后端领域层确定，本文不预设现有角色可以做未授权的操作。

## 2. 第一版范围与不做事项

第一版需要支持：

1. 扩展确认当前真人身份、当前项目成员关系与可执行动作。
2. 服务器登记最小 checkpoint 索引（检查点摘要、SHA、任务/项目、创建者、材料摘要、父关系、来源工具）；原文和 artifact 默认仍由用户人工传递 JSON 包。
3. A 在当前任务契约版本上，明确指定 B，登记一次 handoff；B 可读取授权元数据、接收或拒绝。撤回只允许在状态和版本满足条件时执行。
4. 接收后的执行回执记录真人 actor、checkpoint、Attempt、工具来源和显式用户声明的结果；它不是 Agent Run，也不自动提交 Task。
5. 并行方案必须各有 Attempt ID、同一 checkpoint/base SHA 和不同分支/worktree；禁止把同一分支同时分配给多人。

第一版不做：完整 session 云备份、隐式自动分享、后台自动接手、自动 merge/push、自动更新 Task status、把 GitHub 公共仓库作为 artifact storage、把本机绝对路径同步给队友、模型代替老师/负责人验收。无文件传输服务时，服务端只记录材料 hash/大小/类型；B 通过人工选择的文件取得实际材料，服务端不能把“有 hash”冒充“B 已拿到文件”。

## 3. 建议资源与状态

以下是待签收的逻辑模型，不要求照搬表名；后端负责人可映射到现有领域模块。

### CheckpointIndex

```ts
type CheckpointIndex = {
  id: string;                    // 服务端 UUID
  projectId: string;
  taskId: string;
  creatorId: string;             // 只能由认证身份填入
  visibility: "assignee" | "project";
  parentCheckpointId: string | null;
  taskHandoffVersion: number;
  taskUpdatedAt: string;
  repositoryKeyHash: string;     // 不存带凭据 remote 或本机路径
  headSha: string;
  source: { provider: string; providerVersion: string; captureMode: "native" | "context-only" };
  handoffSummary: { goal: string; completed: string[]; remaining: string[]; blocker: string | null; nextAction: string };
  materials: Array<{ id: string; kind: "context" | "transcript" | "patch" | "other"; sha256: string; byteLength: number; transferred: boolean }>;
  createdAt: string;
};
```

服务端只保存经用户确认的摘要和索引，不保存原始 transcript、prompt、工具输入输出、工作区路径、环境变量或凭据。数组/字符串/单项/总大小设后端硬限制；超过即 413，不能截断后继续返回成功。`repositoryKeyHash` 只用于比较稳定的非秘密仓库身份；必须定义 remote 规范化/本地仓库规则并审查碰撞与隐私，不接受客户端传入凭据 URL。

### Handoff 与 Attempt

```ts
type HandoffState = "offered" | "accepted" | "declined" | "withdrawn" | "superseded";
type Handoff = {
  id: string; projectId: string; taskId: string;
  checkpointId: string; fromUserId: string; toUserId: string;
  expectedTaskUpdatedAt: string; expectedHandoffVersion: number;
  state: HandoffState; createdAt: string; resolvedAt: string | null;
  idempotencyKey: string;
};

type Attempt = {
  id: string; handoffId: string; checkpointId: string; taskId: string;
  actorId: string; baseSha: string; branchName: string | null;
  kind: "continuation" | "parallel";
  provider: string; providerVersion: string;
  state: "started" | "finished" | "failed" | "unknown";
  receipt: { sessionId: string | null; headSha: string | null; changedPaths: string[]; tests: Array<{ commandLabel: string; exitCode: number | null; source: "captured" | "user-reported" }> };
  createdAt: string; updatedAt: string;
};
```

`actorId` 永远由服务端认证确定。`sessionId` 只作为来源工具给出的不透明标识，除非用户显式确认其可分享，否则不可反向查询其他人的 transcript。回执是客户端可提供的证据，不是服务器独立验证了本地文件；UI 必须显示证据出处。任何 Attempt 都不自动变成 `agent_runs`。

## 4. API 契约（提案与实现状态）

本节下方保留最初提案。扩展后端已有实际路由；已实现并经 R02 回归确认的行为以本段和当前路由为准，不应再按“尚未实现”理解：Bearer 身份由服务端确定；接收/处理交接时重查团队成员资格；accept/decline/withdraw 的 JSON body 必须提供正整数 `expectedHandoffVersion`，且必须等于交接单记录的版本；非法 JSON 与类型错误返回 400；任务交接契约版本过期、交接状态竞争返回 409。创建 handoff 的同一幂等键仅在完整规范化载荷（项目、任务、检查点、接收人、任务时间、契约版本）一致时复用记录，否则 409。实际代码仍未实现本节其他标注的建议能力（例如 Attempt 写入幂等、checkpoint 请求幂等、服务端材料传输）。

路径建议放在 `/api/extension/v1`，让扩展身份、幂等和版本规则与既有 Agent API 区分开。所有请求需要 HTTPS、`Authorization: Bearer`；成功响应 JSON；除另有说明，ID 均 UUID。响应中的项目/任务标题及个人信息按现有成员权限最小化返回。

### 身份和能力

`GET /api/extension/v1/me`

建议返回：

```json
{
  "actor": { "id": "<userId>", "displayName": "成员名称" },
  "memberships": [{ "projectId": "<uuid>", "teamId": "<uuid>", "role": "<现有角色值>" }],
  "capabilities": { "checkpointRead": true, "checkpointCreate": true, "handoffOffer": true, "handoffReceive": false }
}
```

只有 `actor.id` 和服务端实际允许的成员关系是权限事实；客户端不得缓存 capability 作为永久授权。若采用扩展专用 token scope，scope 还须在服务端逐请求执行；`capabilities` 只用于 UI 提示，不替代授权判断。

当前已实现的接收人目录：

```http
GET /api/extension/v1/projects/{projectId}/members
Authorization: Bearer ac_…
```

响应形状为 `{ "projectId": "<uuid>", "items": [{ "userId": "<uuid>", "displayName": "成员名称", "role": "student" }] }`。服务端每次请求重新检查调用者当前仍属于该项目团队；只返回当前人类成员，不返回邮箱，也不列出不能以个人 VS Code PAT 接收交接的系统 Agent。无凭据为 401，非成员/撤权为 403，非法项目 UUID 为 400；响应设置 `Cache-Control: private, no-store`。这是接收人选择目录，不替代创建 handoff 时对双方成员关系的事务内复核。

### Checkpoint 索引

- `POST /api/extension/v1/projects/{projectId}/tasks/{taskId}/checkpoints`：创建索引。请求不得含 `creatorId`、绝对路径、raw transcript、token、工具输出；需含 `expectedTaskUpdatedAt`、`expectedHandoffVersion`、仓库 key hash、SHA、可见范围、摘要、materials hash/size/type 和 `Idempotency-Key`。服务端原子校验项目成员、任务归属、版本及字段上限，再由认证身份填 creator。
- `GET /api/extension/v1/projects/{projectId}/checkpoints?taskId=…&cursor=…`：成员可见索引分页读取；返回 `items`、opaque `nextCursor`、`serverTime`。默认每页最多 50 条，cursor 绑定查询条件/身份并设置过期。
- `GET /api/extension/v1/checkpoints/{checkpointId}`：逐请求重新检查可见范围和项目成员；对无权和不存在的资源按统一策略响应，避免泄露资源是否存在。
- `DELETE /api/extension/v1/checkpoints/{checkpointId}`：建议仅创建者可请求删除自己的索引；如果已有有效 handoff/Attempt，先按保留规则拒绝或软删除并保留最小审计墓碑，不级联删除对方合法取得的本地材料。具体删除权限、保留期需签收。

V1 人工 JSON 包仍是实际内容传输方式。B 导入后扩展对包执行 schema、hash、大小和路径校验，并将实际传输完成作为本地事实；不能仅凭服务端 `materials` 摘要声称“附件已下载”。后续如提供自动传输，另立存储评审：受控 bucket、短时授权 URL、病毒/内容限制、撤权和删除语义，不将附件原文放入普通 JSON API 日志。

### 建立、查询和处理 handoff

- `POST /api/extension/v1/projects/{projectId}/tasks/{taskId}/handoffs`：请求 `{checkpointId,toUserId,expectedTaskUpdatedAt,expectedHandoffVersion,idempotencyKey}`。后端检查 A 与 B 都是该项目有效成员、A 对动作有权限、任务可交接、checkpoint 属于同一 project/task 且 creator 为 A 或 A 有明确分享权、checkpoint SHA/契约版本符合策略。服务端从 Bearer 取 `fromUserId`。若任务已变化返回 409，不能最后写入覆盖。
- `GET /api/extension/v1/handoffs?projectId=…&state=…&cursor=…`：仅列出当前用户被授权看见的 handoff；收件箱默认仅 `toUserId = actorId`，发件箱仅 `fromUserId = actorId`，项目列表受角色和 visibility 限制。
- `GET /api/extension/v1/handoffs/{handoffId}`：返回最小任务/检查点/成员信息、当前状态和服务器版本，不包含原始 artifact。
- `POST /api/extension/v1/handoffs/{handoffId}/accept`、`/decline`、`/withdraw`：当前已实现 body `{expectedHandoffVersion,reason?}`。版本号必填且必须匹配记录；accept/decline 仅接收者，withdraw 仅发起者，当前用户还必须仍是项目成员；仅允许从 `offered` 转换。数据库事务锁定交接记录并以 `state=offered` + 版本作条件更新，因此并发时最多一个转换成功，输家返回 409。任务契约变化会阻止 accept，但不阻止接收者拒绝或发起者撤回过期交接。状态动作幂等键尚未实现；客户端收到不确定的 POST 结果不得盲目创建另一交接。

**关键产品决策仍待签收：** 接受 handoff 不应自动把任务指派给 B 或改变 Task status；它只表明 B 接受尝试。建议 `assigneeId` 与原 owner 保持不变，直到项目负责人明确改派；允许 B 以显式 Attempt 身份接续并留下记录。若要变更 assignee，必须调用现有任务领域状态机、应用角色规则并产生正常任务事件，不能在 handoff route 旁写一份平行逻辑。A 的旧 Attempt 是否可继续、同一 checkpoint 是否允许多位 receiver、拒绝后能否重新邀请，也需由产品/后端签收。

### Attempt 回执

- `POST /api/extension/v1/handoffs/{handoffId}/attempts`：以当前真人创建 continuation 或 parallel Attempt；必须检查 handoff 已 accepted、actor 为接收人、task/checkpoint 版本仍有效。parallel 请求还要指定既有/新 attempt 分组规则；每个 attempt 的 `baseSha` 必须等于 checkpoint SHA。分支名由扩展生成但必须校验，不能传任意工作目录。
- `PATCH /api/extension/v1/attempts/{attemptId}`：只允许创建者递交有限状态和回执字段；必须带 `expectedVersion` + `Idempotency-Key`。字段上限、变更文件路径字符过滤、测试条数/长度上限由后端实现。`finished` 不等于任务验收、不等于工作树/提交已由服务器验证。不要允许客户端写 `reviewedBy`、review outcome、Agent Run ID 或 Task 完成状态。
- `GET /api/extension/v1/handoffs/{handoffId}/attempts?cursor=…`：授权参与者读取真实 attempt/runs 摘要，按 cursor 分页；不得返回其他成员私有 session 原文。

对于能推送到远端的代码证据，可存 commit SHA 和仓库标识；单机目录、dirty 文件和本地 session ID 都是客户端声明。不能凭远端 commit 猜测它属于哪次 attempt，需用户确认关联或后续 GitHub App 授权的独立设计。

## 5. ACL 和条件写规则

| 操作 | 最低建议校验 | 不允许 |
| --- | --- | --- |
| 创建索引 | Bearer 真人仍有效；属于 project team；task.projectId 与路径一致；作者由 token 取；项目当前策略允许创建 | 信任 body 的 creatorId/role；仅凭可猜 UUID 写入 |
| 查看 checkpoint | 有效项目成员且 checkpoint visibility 允许；task 仍属于项目或有清晰归档策略 | 仅凭知道 checkpointId 越权读取 |
| 发起 handoff | 有效成员、操作者具备交接权限；指定收件人是同项目有效成员；checkpoint 和 task/project 对齐；期望版本未变化 | 自动把客户端声明的接手人写成 owner；跨项目分享 |
| 接收/拒绝 | `actorId === toUserId`，状态仍 offered，版本匹配 | 发起人替对方接受；重放旧请求覆盖新状态 |
| 撤回 | `actorId === fromUserId`，状态仍 offered，尚未发生不可逆操作 | 删除他人已取得材料或已产生的本地代码 |
| 写 Attempt | handoff accepted 且本人是 toUser/获准参与者；base SHA 精确等于 checkpoint；幂等键唯一 | 伪造 agent 身份、替他人写回执、自动完成 Task |
| 审核成果 | 继续调用现有人类审核链和权限规则 | 扩展回执/Agent 自己将 Task 置 done |

数据库写需要在一个事务里校验 expected task/handoff version 和状态，然后条件更新；如果项目现有实现没有统一 version，可为交接资源自身新增单调 `version`，不能仅用客户端时间戳当并发控制。所有写 route 重新读取认证身份和成员/角色，不依赖 `GET /me` 先前结果。

## 6. 错误、幂等、同步和撤权

| HTTP | 建议语义 | 扩展动作 |
| --- | --- | --- |
| 400 | 输入格式/字段限制不符 | 展示字段级错误；不自动重试 |
| 401 | token 缺失、无效、撤销 | 清本地认证态、暂停轮询、提示重新连接；不删除本地 checkpoint |
| 403 | 成员关系/动作权限失效 | 停止对应写操作；保留本地材料并显示权限变化 |
| 404 | 资源不存在或按防枚举策略隐藏 | 刷新目录，不显示其他成员数据 |
| 409 | task/handoff/version/state 冲突或幂等键与不同 payload 重用 | 获取当前服务端状态，让用户处理；禁止 last-write-wins |
| 413 | 摘要/材料元数据超出限制 | 要求用户缩减并重新确认；不静默截断 |
| 422 | 状态转换不允许、task 与 checkpoint 不匹配 | 显示领域原因；不重试 |
| 429 | 限流 | 遵守 `Retry-After`，有限退避；GET 可重试，写请求必须复用同一幂等键 |
| 5xx/网络断开 | 服务不可用或结果不确定 | GET 有限重试；写请求先用幂等键查询/重放同一请求，不生成第二次交接 |

幂等键按用户、HTTP 操作和资源范围唯一；服务端存 request hash 与结果，过期窗口需要定值并覆盖客户端离线周期。相同键、相同 payload 返回相同资源；相同键不同 payload 返回 409。Websocket/SSE 不是 E09 必需项；V1 采用 cursor 分页 + E10 15 秒可见视图轮询。若将来推事件，需带单调事件 ID、鉴权、断线 cursor 补拉和撤权处理。

撤销 token 后所有查询/写请求立即失效。成员移出项目后，后续请求必须拒绝，即使对方先前拿到 checkpoint UUID。服务端留最小安全审计：actor、对象 ID、动作、结果、时间、request/idempotency ID；禁止记录 Bearer、session 原文、完整 prompt 或 artifact body。产品/隐私政策需批准索引、审计和软删除保留期，支持合规删除。

## 7. 迁移与实施拆分建议

1. **契约签收**：后端负责人确认成员角色来源、checkpoint visibility、交接是否改派任务、A/B continuation 语义、删除/保留、artifact 传递方式及 PAT scope。
2. **认证改造**：先增加 extension identity/capability API 和可撤销的最小 scope，或书面接受扩展使用通用 PAT 的风险；不要因端点命名为 extension 就自动获得权限。
3. **只读索引/收件箱**：定义 schema、ACL 查询、cursor 和错误模型，按现有 task/context pack 领域服务复用权限，不复制业务规则。
4. **条件写**：索引、handoff、accept/decline/withdraw 与 Attempt 分独立迁移；版本检查、幂等和审计先覆盖 API/domain tests。
5. **扩展适配**：读取真实 OpenAPI/Zod contract；缺 route 或字段时 fail closed；处理 401/403/409/offline，不乐观显示对方已接受。
6. **跨人验收**：两个真实成员、两个隔离设备/配置；验证材料真实到达、成员撤权、token revoke、重复请求、并发修改、同基线不同 worktree、接收方拒绝及人工验收。任何一段只 mock 时不得标端到端通过。

数据库迁移应使用新增表/索引，不重写 task/agent-run 历史。建议为 checkpoint、handoff、attempt 建独立领域模块，先评估是否能复用现有 `context-pack.ts` / `conversation.ts` 的访问校验工具；Context Pack 仍保留“冻结项目资料”，Checkpoint 是本机代码/session 基线，两者不互相冒名。

## 8. E09 签收清单（B01 签收完成）

- [x] 认证：复用通用 PAT，由 `authenticateBearer` 解析 `userId` 并逐请求校验当前项目角色；撤销立即生效。
- [x] actor/role：真实身份由认证 token 提供，成员资格和角色由 `team_members` 表实时查验。
- [x] Task：接受 handoff **不自动改派** `assigneeId`，不改变任务状态；作为独立 Attempt 推进，由负责人显式改派。
- [x] 并行：允许同 checkpoint 多 attempt；Attempt 必须指定唯一 `baseSha`（等于 checkpoint headSha），不同 attempt 隔离分支与 worktree。
- [x] 材料：V1 采用用户导出/导入 JSON 包（SharePackage），服务端仅存储摘要和材料 SHA-256 索引；不把工作区文件和 transcript 传到数据库。
- [x] 隐私：限制摘要与材料数组长度，不存凭据与绝对路径；撤回仅限 offered 状态，删除保留最小审计。
- [x] API：路由前缀为 `/api/extension/v1`，使用 `Idempotency-Key` 控制幂等，支持 cursor 分页与 409 冲突响应。
- [x] 测试：单测与集成测试覆盖跨项目越权、非收件人操作、并发状态冲突与撤权拦截。

签署状态：B01 签收完成，进入 B02 代码与 API 实施。
