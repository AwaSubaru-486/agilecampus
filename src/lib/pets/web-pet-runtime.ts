import { createHash } from "node:crypto";
import path from "node:path";

/** Account-scoped storage usable by providers without importing browser auth. */
export function webPetRuntime(userId: string) {
  const cwd = process.cwd();
  const root = cwd.includes(`${path.sep}.next`) ? cwd.split(`${path.sep}.next`)[0] : cwd;
  return path.join(root, ".runtime", "web-pets", createHash("sha256").update(userId).digest("hex"));
}
