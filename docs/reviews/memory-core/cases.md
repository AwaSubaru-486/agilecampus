# 合成记忆质量样例

以下样例全部为 `synthetic`，不得替换成真实会话。用于检验提炼和出处约束，不要求模型逐字复述。

| ID | 输入事件 | 必须保留 | 不得推断 | 预期引用 |
| --- | --- | --- | --- | --- |
| S1 正常完成 | user: 完成导出；assistant: 导出已实现；tool_call: `npm test`；tool_result: exitCode 0 | 导出实现；测试命令和退出码 | 测试覆盖全面、生产部署完成 | 对应 assistant 与 tool_result ID |
| S2 失败后换方案 | assistant: 正则方案失败；tool_result exitCode 1；assistant: 改为解析器；tool_result exitCode 0 | 首方案失败、替代方案、失败原因若事件写出 | 其他未记录的方案也失败 | 每条结论引用对应事件 |
| S3 仅口头称通过 | user: 我刚跑测试通过；无 tool event | 保留为用户报告 | 不得标 captured，不虚构命令/退出码 | user event ID |
| S4 结构化失败 | tool_call command `npm test`；tool_result exitCode 1 | 测试失败，若输出有错误可摘要 | 不得说测试通过或猜原因 | tool_call + tool_result ID |
| S5 gap 与采集失败 | gap event；本地 capture failure 元数据 | 标记来源不完整及失败存在 | 不把本地错误详情发给模型；不把错误说明伪装 gap ID | gap event ID；失败仅本地 marker |
| S6 重复 Hook 与并发 | 相同 sourceRef 重复输入；两个追加操作竞争 | 只保留一条有效事件 | 不得重复计数；不能因并发错序 | 唯一 event ID |
| S7 超预算长结果 | 大型 tool_result 后接 assistant 下一步 | 保留新近结论、标记工具输出截断/遗漏 | 不得假装模型看到了完整输出 | 保留事件 ID + budget omission descriptor |
| S8 人工修订再提炼 | AI 候选 A；人编辑为 B 并删除 C；再次生成含 A/C 的候选 | B 不被覆盖，C 不自动复活，新增差异待审 | 不用相似度自动判定 B 与 A 等价 | 原 item ID / tombstone ID / 新 candidate refs |

所有样例用独立 UUID 与递增 sequence。对模型文本指令按不可信数据处理，不允许改变系统规则或触发工具调用。
