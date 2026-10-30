import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import nextEnv from "@next/env";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputs = ["src", "shared", "public", "scripts", "package.json", "package-lock.json", "next.config.ts",
  "tsconfig.json", "postcss.config.mjs", ".env", ".env.local", ".env.production", ".env.production.local"];

// Hash source content, not timestamps; documentation and runtime logs do not
// invalidate a build. Environment files are hashed without exposing their values.
export async function buildFingerprint(root) {
  const hash = createHash("sha256").update(process.versions.node);
  async function visit(path) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (error) {
      if (error.code === "ENOENT") return;
      if (error.code !== "ENOTDIR") throw error;
      hash.update(relative(root, path)).update("\0").update(await readFile(path)).update("\0");
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error("Build inputs must not contain symbolic links.");
      await visit(join(path, entry.name));
    }
  }
  for (const input of inputs) await visit(join(root, input));
  return hash.digest("hex");
}

export async function buildStatus(root) {
  try {
    const stamp = JSON.parse(await readFile(join(root, ".next/local-build.json"), "utf8"));
    const buildId = (await readFile(join(root, ".next/BUILD_ID"), "utf8")).trim();
    await readFile(join(root, ".next/standalone/server.js"));
    return stamp.buildId === buildId && stamp.fingerprint === await buildFingerprint(root) ? "ready" : "stale";
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return "missing";
    throw error;
  }
}

export async function prepareAssets(root) {
  const standalone = join(root, ".next/standalone");
  await readFile(join(standalone, "server.js"));
  await mkdir(join(standalone, ".next"), { recursive: true });
  await cp(join(root, ".next/static"), join(standalone, ".next/static"), { recursive: true });
  try { await cp(join(root, "public"), join(standalone, "public"), { recursive: true }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

export function parseAddress(args, env = process.env) {
  let port = env.PORT ?? "3106";
  let hostname = "127.0.0.1";
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (["--port", "-p"].includes(option)) port = args[++index];
    else if (["--hostname", "-H"].includes(option)) hostname = args[++index];
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!/^\d+$/.test(port ?? "") || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid server port.");
  if (typeof hostname !== "string" || !hostname.trim()) throw new Error("Invalid hostname.");
  return { port: String(Number(port)), hostname };
}

function runNode(args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot, env, stdio: "inherit" });
    const stop = () => child.kill("SIGTERM");
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    child.once("error", reject);
    child.once("exit", (code) => {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
      if (code === 0) resolveRun();
      else reject(new Error(`Server command exited with code ${code ?? "signal"}.`));
    });
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "check") { console.log(await buildStatus(projectRoot)); return; }
  if (command === "build") {
    const fingerprint = await buildFingerprint(projectRoot);
    await runNode([join(projectRoot, "node_modules/next/dist/bin/next"), "build"]);
    if (fingerprint !== await buildFingerprint(projectRoot)) throw new Error("Source changed during compilation. Please build again.");
    await prepareAssets(projectRoot);
    const buildId = (await readFile(join(projectRoot, ".next/BUILD_ID"), "utf8")).trim();
    await writeFile(join(projectRoot, ".next/local-build.json"), JSON.stringify({ fingerprint, buildId }));
    return;
  }
  if (command === "start") {
    if (await buildStatus(projectRoot) !== "ready") throw new Error("Production build is missing or outdated. Run npm run build or npm run local.");
    const { port, hostname } = parseAddress(args);
    process.env.NODE_ENV = "production";
    nextEnv.loadEnvConfig(projectRoot, false);
    await runNode([join(projectRoot, ".next/standalone/server.js")], { ...process.env, NODE_ENV: "production", PORT: port, HOSTNAME: hostname });
    return;
  }
  throw new Error("Usage: production-runtime.mjs build | check | start [-p port] [--hostname address]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
