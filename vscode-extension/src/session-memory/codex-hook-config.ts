import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const EVENT_NAMES = ["UserPromptSubmit", "PostToolUse", "Stop", "SubagentStop"] as const;
const HANDLER_ID = "agilecampus-codex-session-hook";

export function codexConfigDirectory(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return path.resolve(configured || path.join(homedir(), ".codex"));
}

export function codexHookCommand(scriptPath: string, storageRoot: string, windows = process.platform === "win32"): string {
  if (windows) return `node ${quoteWindows(scriptPath)} ${quoteWindows(storageRoot)}`;
  return `node ${quotePosix(scriptPath)} ${quotePosix(storageRoot)}`;
}

export async function hasCodexCaptureHook(
  configDirectory = codexConfigDirectory(),
  expected?: { scriptPath: string; storageRoot: string },
): Promise<boolean> {
  let config: unknown;
  try { config = JSON.parse(await readFile(path.join(configDirectory, "hooks.json"), "utf8")); }
  catch { return false; }
  if (!isRecord(config) || !isRecord(config.hooks)) return false;
  const hooks = config.hooks;
  const expectedCommand = expected ? codexHookCommand(expected.scriptPath, expected.storageRoot) : undefined;
  return EVENT_NAMES.every((eventName) => {
    const rows = hooks[eventName];
    return Array.isArray(rows) && rows.some((row) => isRecord(row) && Array.isArray(row.hooks) &&
      row.hooks.some((handler) => isRecord(handler) && handler.type === "command" &&
        typeof handler.command === "string" && handler.command.includes(HANDLER_ID) &&
        (!expectedCommand || handler.command === expectedCommand)));
  });
}

/** Merge our one user-level hook into Codex hooks.json without replacing other hooks. */
export async function installCodexCaptureHook(input: {
  configDirectory?: string;
  scriptPath: string;
  storageRoot: string;
}): Promise<string> {
  const configDirectory = path.resolve(input.configDirectory ?? codexConfigDirectory());
  const file = path.join(configDirectory, "hooks.json");
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  let original: Buffer | null = null;
  let mode = 0o600;
  try {
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Codex hooks.json 是符号链接或非普通文件；为避免修改其他目标，未写入");
    mode = metadata.mode & 0o777;
    original = await readFile(file);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  let config: Record<string, unknown> = {};
  if (original) {
    try {
      const parsed: unknown = JSON.parse(original.toString("utf8"));
      if (!isRecord(parsed)) throw new Error("根节点不是 JSON 对象");
      config = parsed;
    } catch (error) { throw new Error(`无法解析现有 Codex hooks.json；原文件未修改（${error instanceof Error ? error.message : "JSON 错误"}）`); }
  }
  if (config.hooks !== undefined && !isRecord(config.hooks)) throw new Error("现有 Codex hooks.json 的 hooks 字段格式无效；原文件未修改");
  const hooks = { ...(config.hooks as Record<string, unknown> | undefined) };
  const command = codexHookCommand(input.scriptPath, input.storageRoot);
  for (const eventName of EVENT_NAMES) {
    const handlers = hooks[eventName] === undefined ? [] : hooks[eventName];
    if (!Array.isArray(handlers)) throw new Error(`现有 Codex ${eventName} hook 格式无效；原文件未修改`);
    const managed = (handler: unknown): handler is Record<string, unknown> => isRecord(handler) && handler.type === "command" &&
      typeof handler.command === "string" && handler.command.includes(HANDLER_ID);
    const replacement = (previous?: Record<string, unknown>): Record<string, unknown> => {
      const { commandWindows: _oldWindowsCommand, ...rest } = previous ?? {};
      return {
        ...rest,
        type: "command",
        command,
        ...(process.platform === "win32" ? { commandWindows: codexHookCommand(input.scriptPath, input.storageRoot, true) } : {}),
        timeout: 10,
      };
    };
    let found = false;
    const merged = handlers.flatMap((row) => {
      if (!isRecord(row) || !Array.isArray(row.hooks)) return [row];
      let retainedManagedHandler = false;
      let changed = false;
      const nextHandlers = row.hooks.flatMap((handler) => {
        if (!managed(handler)) return [handler];
        found = true;
        changed = true;
        if (retainedManagedHandler) return [];
        retainedManagedHandler = true;
        return [replacement(handler)];
      });
      return changed ? (nextHandlers.length ? [{ ...row, hooks: nextHandlers }] : []) : [row];
    });
    hooks[eventName] = found ? merged : [...merged, { hooks: [replacement()] }];
  }
  const next = { ...config, hooks };
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new Error(`写入 Codex hooks.json 失败；原有配置保留（${error instanceof Error ? error.message : "文件错误"}）`);
  }
  return file;
}

export async function removeCodexCaptureHook(configDirectory = codexConfigDirectory()): Promise<{ file: string; removed: boolean }> {
  const file = path.join(path.resolve(configDirectory), "hooks.json");
  let metadata;
  try { metadata = await lstat(file); }
  catch (error) { if (isMissing(error)) return { file, removed: false }; throw error; }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Codex hooks.json 是符号链接或非普通文件；为避免修改其他目标，未写入");
  const original = await readFile(file);
  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(original.toString("utf8"));
    if (!isRecord(parsed)) throw new Error("根节点不是 JSON 对象");
    config = parsed;
  } catch (error) { throw new Error(`无法解析 Codex hooks.json；原文件未修改（${error instanceof Error ? error.message : "JSON 错误"}）`); }
  if (config.hooks === undefined) return { file, removed: false };
  if (!isRecord(config.hooks)) throw new Error("Codex hooks.json 的 hooks 字段格式无效；原文件未修改");
  const hooks = { ...config.hooks };
  let removed = false;
  for (const [eventName, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) continue;
    const rows = value.flatMap((row) => {
      if (!isRecord(row) || !Array.isArray(row.hooks)) return [row];
      const handlers = row.hooks.filter((handler) => {
        const isManaged = isRecord(handler) && handler.type === "command" && typeof handler.command === "string" &&
          handler.command.includes(HANDLER_ID);
        if (isManaged) removed = true;
        return !isManaged;
      });
      return handlers.length ? [{ ...row, hooks: handlers }] : [];
    });
    if (rows.length) hooks[eventName] = rows;
    else delete hooks[eventName];
  }
  if (!removed) return { file, removed: false };
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify({ ...config, hooks }, null, 2)}\n`, { flag: "wx", mode: metadata.mode & 0o777 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new Error(`移除 AgileCampus Codex Hook 失败；原有配置保留（${error instanceof Error ? error.message : "文件错误"}）`);
  }
  return { file, removed: true };
}

export function managedCodexHookScriptName(): string { return `${HANDLER_ID}.cjs`; }

function quotePosix(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function quoteWindows(value: string): string { return `"${value.replace(/"/g, '\\"')}"`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isMissing(error: unknown): boolean { return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT"; }
