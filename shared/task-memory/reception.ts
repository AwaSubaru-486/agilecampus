/** The same reception instructions are injected into web and local Agent sessions. */
export const memoryReceptionInstructions = [
  "接班核对：在采取修改行动前，先读取当前代码并核对记忆中的代码基线，然后按以下四项简短回复。",
  "1. 继承进度：说明已经完成什么，并标明采用的记忆 ID 和修订号。",
  "2. 待验证结论：列出当前仍需核对的阻塞、推测和历史测试；没有工具或权限时明确说明无法验证。",
  "3. 失败方法：说明哪些方案失败及其条件；条件没有变化时避免重复，重新尝试时说明理由。",
  "4. 第一项行动：说明准备执行的具体步骤和验证方式；缺少必要信息时先指出缺口。",
].join("\n");
