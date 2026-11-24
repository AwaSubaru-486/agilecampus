import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexHookCommand, hasCodexCaptureHook, installCodexCaptureHook, removeCodexCaptureHook } from "../src/session-memory/codex-hook-config";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Codex hook configuration", () => {
  it("quotes paths for the target shell", () => {
    expect(codexHookCommand("/opt/Agent Tools/hook.cjs", "/Users/example/Library/Application Support/AgileCampus")).toBe(
      "node '/opt/Agent Tools/hook.cjs' '/Users/example/Library/Application Support/AgileCampus'",
    );
    expect(codexHookCommand("C:\\Program Files\\AgileCampus\\hook.cjs", "C:\\Users\\Test User\\Data", true)).toBe(
      'node "C:\\Program Files\\AgileCampus\\hook.cjs" "C:\\Users\\Test User\\Data"',
    );
  });

  it("merges all supported events while preserving existing user hooks and is idempotent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-codex-config-"));
    roots.push(root);
    await mkdir(root, { recursive: true });
    const file = path.join(root, "hooks.json");
    const original = { description: "user hooks", hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "user-hook" }] }] } };
    await writeFile(file, JSON.stringify(original));
    const input = { configDirectory: root, scriptPath: path.join(root, "agilecampus-codex-session-hook.cjs"), storageRoot: path.join(root, "local storage") };

    await installCodexCaptureHook(input);
    await installCodexCaptureHook(input);
    const saved = JSON.parse(await readFile(file, "utf8")) as { description: string; hooks: Record<string, Array<{ hooks: Array<{ command?: string }> }>> };
    expect(saved.description).toBe("user hooks");
    expect(saved.hooks.Stop).toHaveLength(2);
    expect(saved.hooks.Stop[0].hooks[0].command).toBe("user-hook");
    expect(saved.hooks.Stop.flatMap(({ hooks }) => hooks).filter((hook) => hook.command?.includes("agilecampus-codex-session-hook"))).toHaveLength(1);
    expect(await hasCodexCaptureHook(root)).toBe(true);
  });

  it("leaves malformed existing config untouched", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-codex-invalid-config-"));
    roots.push(root);
    const file = path.join(root, "hooks.json");
    await writeFile(file, "{not-json");
    await expect(installCodexCaptureHook({ configDirectory: root, scriptPath: "/tmp/agilecampus-codex-session-hook.cjs", storageRoot: "/tmp/storage" }))
      .rejects.toThrow("原文件未修改");
    expect(await readFile(file, "utf8")).toBe("{not-json");
  });

  it("removes only AgileCampus handlers and leaves other hooks unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-codex-disable-"));
    roots.push(root);
    const file = path.join(root, "hooks.json");
    const input = { configDirectory: root, scriptPath: path.join(root, "agilecampus-codex-session-hook.cjs"), storageRoot: path.join(root, "storage") };
    const originalHook = { type: "command", command: "keep this user hook" };
    await writeFile(file, JSON.stringify({ hooks: { Stop: [{ hooks: [originalHook] }] } }));
    await installCodexCaptureHook(input);
    expect(await hasCodexCaptureHook(root)).toBe(true);
    expect(await removeCodexCaptureHook(root)).toMatchObject({ removed: true });
    expect(await hasCodexCaptureHook(root)).toBe(false);
    const saved = JSON.parse(await readFile(file, "utf8")) as { hooks: Record<string, Array<{ hooks: unknown[] }>> };
    expect(saved.hooks.Stop).toEqual([{ hooks: [originalHook] }]);
    expect(Object.keys(saved.hooks)).toEqual(["Stop"]);
  });

  it("treats a config without hooks as a safe no-op when disabling", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agile-codex-no-hooks-"));
    roots.push(root);
    const file = path.join(root, "hooks.json");
    await writeFile(file, JSON.stringify({ description: "unrelated config" }));
    expect(await removeCodexCaptureHook(root)).toEqual({ file, removed: false });
    expect(await readFile(file, "utf8")).toBe(JSON.stringify({ description: "unrelated config" }));
  });
});
