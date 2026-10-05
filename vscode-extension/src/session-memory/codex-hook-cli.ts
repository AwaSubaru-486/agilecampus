import { runCodexHookCli } from "./codex-hook-adapter";

const storageRoot = process.argv[2];
if (!storageRoot) {
  process.stderr.write("AgileCampus local session hook: storage path is missing\n");
  process.exitCode = 1;
} else {
  void runCodexHookCli(storageRoot, process.stdin).then((result) => {
    if (result.status === "unsupported") {
      process.stderr.write(`AgileCampus local session hook: ${result.reason ?? "unsupported event"}\n`);
      process.exitCode = 1;
    }
  }).catch((error: unknown) => {
    process.stderr.write(`AgileCampus local session hook: ${error instanceof Error ? error.message : "capture failed"}\n`);
    process.exitCode = 1;
  });
}
