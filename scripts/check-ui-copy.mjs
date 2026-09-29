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
