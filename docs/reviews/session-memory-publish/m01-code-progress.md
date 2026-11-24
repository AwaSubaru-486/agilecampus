# M01 会话记忆契约代码进度

日期：2026-10-02。范围：共享契约、数据库基础表、项目分享授权、会话索引读取 API 与权限测试；真实会话、模型、GitHub 和页面 UI 尚未接入。

状态：`PARTIAL`（M01 共享契约与服务端持久化/只读访问基础通过；发布写入与外部材料验证未完成）。不得据此标为自动发布或端到端接续完成。

修改文件：

- `shared/session-memory/types.ts`：事件、记忆、manifest、包及脱敏 transcript archive 类型。对话事件映射到中性 `archiveRecordId` 和源/发布字节范围；git snapshot 和扩展合成 gap 不伪造 transcript 坐标。
- `shared/session-memory/schema.ts`：严格 v1 校验、证据/任务/父版本关系、连续序号与 gap 校验、事件到归档记录的唯一映射、逐片段/发布 bytes SHA 和范围/大小限制、partial/unavailable 与完整发布门槛、包组装与解析。原始未脱敏导出的 digest 不放入共享包；远端仅携带可校验的脱敏发布 bytes digest。
- `shared/session-memory/index.ts`：唯一共享导出入口。
- `vscode-extension/src/checkpoints/session-memory-package.ts`：Node SHA-256 适配器。
- `vscode-extension/tsconfig.json`：`rootDir` 放宽到仓库根，供 `tsc --noEmit` 检查被扩展导入的单一 shared 源文件；扩展仍由 esbuild 从 `src/extension.ts` 生成 `dist/extension.js`，没有改运行时 entry 或输出脚本。
- `tests/session-memory-contract.test.ts`：Codex/Claude Hook 合成输入目标映射、各类事件 schema、完整 archive round-trip、缺片/hash/路径/范围/未知 parser/截断/脱敏确认/partial 完整发布/缺失事件归档映射/父版本等拒绝，以及扩展入口 round-trip。
- `docs/reviews/session-memory-publish/contract.md`：共享事件、记忆、发布包、原文 archive 完整性/隐私门槛和 API 边界。

执行记录：

| 命令 | 工作目录 | 结果 |
| --- | --- | --- |
| `npm ci` | 仓库根 | 退出码 0；依根 `package-lock.json` 安装本地测试依赖。 |
| `npm ci` | `vscode-extension/` | 退出码 0；依扩展 `package-lock.json` 安装本地构建依赖。 |
| `npm test -- tests/session-memory-contract.test.ts` | 仓库根 | 退出码 0；1 个文件、5 项通过。 |
| `npm --prefix vscode-extension test -- tests/share-package.test.ts` | 仓库根 | 退出码 0；旧检查点包兼容回归 1 个文件、8 项通过（包含 v1 读取与当前 v2 导入/校验）。 |
| `npm --prefix vscode-extension run check` | 仓库根 | 退出码 0；TypeScript `--noEmit` 通过，esbuild 仍输出 `dist/extension.js`、`dist/webview.js` 与 CSS。共享 schema 随扩展入口 bundle 打包，没有新增运行时路径。 |
| `git diff --check -- shared/session-memory vscode-extension/tsconfig.json vscode-extension/src/checkpoints/session-memory-package.ts tests/session-memory-contract.test.ts docs/reviews/session-memory-publish/contract.md docs/reviews/session-memory-publish/m01-code-progress.md` | 仓库根 | 退出码 0；目标文件无空白错误。 |

Archive 修订后再次核验（2026-10-02）：

| 命令 | 工作目录 | 结果 |
| --- | --- | --- |
| `npm test -- tests/session-memory-contract.test.ts` | `/Users/qwsdjivc/agilecampus-ai` | 退出码 0；1 个文件、7 项通过。覆盖脱敏完整归档 round-trip、每个对话事件唯一映射到归档记录/range、缺片/哈希/相对路径/越界映射/未知 parser/截断/未经确认/partial 冒充 complete 均拒绝；partial 可显式表示，unavailable 不可标完整。 |
| `npm --prefix vscode-extension test -- tests/share-package.test.ts` | `/Users/qwsdjivc/agilecampus-ai` | 退出码 0；旧 checkpoint 分享包兼容回归 1 个文件、8 项通过，旧 v1/v2 行为未更改。 |
| `npm --prefix vscode-extension run check` | `/Users/qwsdjivc/agilecampus-ai` | 退出码 0；扩展 TypeScript `--noEmit` 与既有 esbuild 输出通过，未引入 shared 文件单独运行时输出路径。 |
| `git diff --check -- shared/session-memory tests/session-memory-contract.test.ts docs/reviews/session-memory-publish/contract.md docs/reviews/session-memory-publish/m01-code-progress.md vscode-extension/tsconfig.json vscode-extension/src/checkpoints/session-memory-package.ts` | `/Users/qwsdjivc/agilecampus-ai` | 退出码 0。 |

归档语义边界：现有 EntireAdapter 导出的 transcript 与 WorkCheckpoint transcript artifact 的字节长度/hash 只能证明“保存的字节与描述一致”，不能单独证明 provider 对话没有缺失。M01 不新增采集/parser；`opaque-text-v1` 仅声明可验证的 UTF-8 原文文本。发布端还必须按 provider/adapter/version allowlist 核对完整性能力，M02/M04 需复用现有 EntireAdapter/CheckpointStore 捕获与本地 artifact 语义，不能用 Hook 数量或客户端 `formatRecognized` 布尔值替代覆盖证据。原始源 digest 只可留本地，分享包只包含脱敏后的发布 digest/bytes。

契约运行时 fail closed：含 parentPackageId 的包必须带已解析父上下文，匹配项目/任务/记忆且父 revision 更旧；调用方应传已遍历祖先链以检测多节点循环。共享层已验证单包、自引用、父版和调用方 ancestry，不替代后端对持久化图谱的最终权限检查。

## M01 服务端施工增量（本轮）

新增 `src/db/schema-session-memory.ts`：会话、持久提炼作业、不可变草稿修订、publication 索引、项目分享授权五张表。索引覆盖项目/任务/会话/发布时间；幂等键与会话修订有唯一约束；token count、正版本、private 仓库 ID、project-only 分享范围和 complete/archive 状态有数据库 check。项目授权记录保存 repository numeric ID、披露版本、授权人/时间、授权版本及撤销时间，不存 GitHub credential。publication 记录其授权版本；撤销或换版本后旧 publication API 隐藏。

新增 `src/lib/session-memory/access.ts` 与两个扩展 PAT 只读接口：

- `GET /api/extension/v1/projects/{projectId}/sessions`：当前成员、当前有效授权下的会话分页索引；验证任务属于项目，且列表通过 session/task/checkpoint 关联条件过滤。
- `GET /api/extension/v1/session-publications/{publicationId}`：读取指定版本结构化记忆；复核项目成员资格、授权版本、session/task/project 对齐和项目共享 checkpoint 可见性；禁止缓存。
- 发布写入前置 helper 检查会话绑定者、项目/任务/checkpoint 范围和当前分享授权；目前没有 publication POST，也没有远端 manifest 服务端校验。

实现取舍：尝试加入数据库复合 FK 时，现有 `drizzle-kit push` 对已有表会先加 FK、之后才加它依赖的复合 UNIQUE，隔离库升级因此报 `there is no unique constraint matching given keys for referenced table tasks`。为保持仓库现行 `db:push` 流程可升级，撤掉本批跨表复合 FK；跨表组合由领域写入 gate 和读取 fail-closed join 校验。单列 FK、幂等唯一键和检查约束保留。后续若引入版本化 SQL migration，可再将组合关系下沉到数据库；当前服务层校验不能描述成数据库级复合 FK。

本轮最终验证：

| 命令 | 结果 |
| --- | --- |
| `npm run db:push:test` | 退出码 0；仅应用到 `.env.test` 隔离数据库。Drizzle 曾因测试生成的旧 publication 缺新增授权版本而要求确认数据损失；删除该测试行后 push 通过，未触碰开发库。 |
| `npx tsc --noEmit --pretty false` | 退出码 0。 |
| `npm test -- tests/session-memory-access.test.ts tests/reset-db.test.ts tests/session-memory-contract.test.ts` | 3 个文件、22 项通过；覆盖成员撤权、分享授权撤销、私有 checkpoint 拒绝、跨任务脏索引 fail-closed 和清表守卫。 |
| `git diff --check` | 待最终运行。 |

仍未完成：publication 登记/远端 manifest 回读校验、提炼与 job 状态 API、事件/transcript API、私有 GitHub 传输、Hook 自动采集、网页详情/人工修订 UI，以及真实 Extension Host A→B 接续。
