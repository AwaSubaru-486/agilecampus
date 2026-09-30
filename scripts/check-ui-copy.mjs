import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["src/app/(app)", "src/components"];
const extensions = new Set([".tsx", ".ts"]);
const banned = [
  "不该只剩",
  "眼下都还稳",
  "有人在等搭手",
  "像人一样",
  "自己接活",
  "会举手",
  "AI TEAMMATES",
  "就地搭手",
  "现场 / 实时状态",
  "人、Agent",
  "团队正在按计划",
  "按责任人和状态",
  "AI 工作现场",
  "AI 可以比较",
  "按状态和负责人查看任务",
  "共享上下文，人工确认后写入项目",
  "按项目、类型和创建时间查看文档与成果",
  "反馈、文档和成果。",
  "AI 输出方案草案；项目成员确认后写入决策记录",
  "每条风险都附带原因、动作和负责人",
  "按风险级别列出项目和建议动作",
  "数据由任务验收、项目成果和活动记录自动生成",
  "接手后可以沿用原会话与上下文，不需要从头解释",
  "没有任何一格需要成员填写",
  "这份活你接得住吗",
  "接不住也是正当答复",
];

async function collect(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if (extensions.has(path.slice(path.lastIndexOf(".")))) files.push(path);
  }
  return files;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const findings = [];
for (const root of roots) {
  for (const file of await collect(root)) {
    const source = stripComments(await readFile(file, "utf8"));
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      for (const phrase of banned) {
        if (line.includes(phrase)) {
          findings.push(`${relative(process.cwd(), file)}:${index + 1} 禁用文案：${phrase}`);
        }
      }
      if (/>[^<\n]*·[^<\n]*</.test(line)) {
        findings.push(`${relative(process.cwd(), file)}:${index + 1} 可见文本使用点号串联字段`);
      }
    });
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("UI copy check passed");
}
