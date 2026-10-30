import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFingerprint, buildStatus, parseAddress, prepareAssets } from "../scripts/production-runtime.mjs";

const temporaryRoots = [];
afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agilecampus-runtime-"));
  temporaryRoots.push(root);
  for (const dir of ["src", "public", ".next/standalone", ".next/static"]) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, "src/page.tsx"), "export default function Page() {}");
  await writeFile(join(root, ".next/standalone/server.js"), "// standalone fixture");
  await writeFile(join(root, ".next/BUILD_ID"), "build-1");
  return root;
}
async function stamp(root) {
  await writeFile(join(root, ".next/local-build.json"), JSON.stringify({ fingerprint: await buildFingerprint(root), buildId: "build-1" }));
}

test("source edits and new files invalidate a build; docs and logs do not", async () => {
  const root = await fixture();
  await stamp(root);
  assert.equal(await buildStatus(root), "ready");
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs/review.md"), "review");
  await writeFile(join(root, ".next/server.log"), "log");
  assert.equal(await buildStatus(root), "ready");
  await writeFile(join(root, "src/page.tsx"), "export default function Page() { return null; }");
  assert.equal(await buildStatus(root), "stale");
  await stamp(root);
  await writeFile(join(root, "src/new.ts"), "export const value = 1;");
  assert.equal(await buildStatus(root), "stale");
});
test("production environment changes invalidate a build", async () => {
  const root = await fixture();
  await stamp(root);
  await writeFile(join(root, ".env.production.local"), "EXAMPLE=different");
  assert.equal(await buildStatus(root), "stale");
});
test("shared memory contracts invalidate a cached production build", async () => {
  const root = await fixture();
  await stamp(root);
  await mkdir(join(root, "shared/task-memory"), { recursive: true });
  await writeFile(join(root, "shared/task-memory/reception.ts"), "export const instructions = 'changed';");
  assert.equal(await buildStatus(root), "stale");
});
test("missing or replaced build artifacts are never treated as current", async () => {
  const root = await fixture();
  assert.equal(await buildStatus(root), "missing");
  await stamp(root);
  await writeFile(join(root, ".next/BUILD_ID"), "other-build");
  assert.equal(await buildStatus(root), "stale");
  await rm(join(root, ".next/standalone/server.js"));
  assert.equal(await buildStatus(root), "missing");
});
test("standalone packaging includes both CSS/JS and public files", async () => {
  const root = await fixture();
  await writeFile(join(root, ".next/static/site.css"), "body {}");
  await writeFile(join(root, "public/logo.svg"), "<svg />");
  await prepareAssets(root);
  assert.equal(await readFile(join(root, ".next/standalone/.next/static/site.css"), "utf8"), "body {}");
  assert.equal(await readFile(join(root, ".next/standalone/public/logo.svg"), "utf8"), "<svg />");
});
test("server address defaults to local access and validates CLI options", () => {
  assert.deepEqual(parseAddress([], {}), { port: "3106", hostname: "127.0.0.1" });
  assert.deepEqual(parseAddress(["-p", "3107", "--hostname", "127.0.0.1"], {}), { port: "3107", hostname: "127.0.0.1" });
  for (const args of [["--port"], ["--port", "0"], ["--port", "65536"], ["--hostname"], ["--unknown"]]) assert.throws(() => parseAddress(args, {}));
});
