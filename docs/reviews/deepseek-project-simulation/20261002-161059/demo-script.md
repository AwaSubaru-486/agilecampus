# 当前可复现演示

状态：完成隔离平台基础流程、离线代码基线和缺失 Key 的错误提示验证；暂不把它表述为 AI 接班演示。

1. 在 http://localhost:3100/register 创建 Reviewer、A、B、Outsider 合成账号；A/B 已通过团队邀请码加入同一测试组。
2. Reviewer 创建了“团队任务排期器”项目，项目 ID 91029e16-98fb-47a9-883a-0ca406f7a7cc。
3. Outsider 直接访问该项目 URL 得到 404。
4. 模拟 GitHub 仓库保存 TypeScript 排期器需求、smoke 测试和完整 contract tests；基线 smoke 为 2/2，通过，完整 contract 测试当前 1/6 通过，符合尚未完成实现的初始状态。
5. 项目会话入口可创建会话；未配置 Key 时发送显示“DeepSeek 未配置”，没有虚构的 Agent 输出。

还不能演示：DeepSeek 草案、扩展 Agent 启动、A/B 检查点接手、并行 Agent、PR 审核与平台人工验收。需先接通测试 API Key 和可操作的隔离 VS Code Extension Host，并解决扩展的共享交接入口缺失。
