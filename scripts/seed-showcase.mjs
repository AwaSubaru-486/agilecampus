import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const snapshot = JSON.parse(await readFile(new URL("./demo/showcase.json", import.meta.url), "utf8"));
const database = new URL(process.env.DATABASE_URL ?? "");
const origin = new URL(process.env.AGILECAMPUS_URL ?? "");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/agilecampus_demo" ||
    database.username !== "agilecampus_demo" || origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1") {
  throw new Error("The showcase can only be seeded into its dedicated local demo database.");
}

const demoPassword = "AgileCampusDemo2026";
const tables = [
  "teams", "users", "team_members", "projects", "project_briefs", "milestones",
  "task_stages", "tasks", "task_dependencies", "task_deliveries", "stage_integrations",
  "blockers", "blocker_invites", "evidence_items", "project_entries", "project_iterations",
  "activity_events", "home_profiles",
];
const jsonColumns = new Set([
  "done_criteria", "required_evidence", "reasons", "task_snapshot", "features",
  "module_snapshot", "outcome_snapshot", "payload", "pet",
]);
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", dateStyle: "short" });
const parts = Object.fromEntries(dayFormat.formatToParts(new Date()).map(({ type, value }) => [type, value]));
const dayOffset = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - Date.UTC(2026, 10, 25);

function prepareValue(value) {
  if (Array.isArray(value)) return value.map(prepareValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, prepareValue(item)]));
  }
  if (typeof value !== "string") return value;
  const date = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/.exec(value);
  if (date) {
    const shifted = new Date(Date.parse(date[1]) + dayOffset).toISOString().slice(0, 10);
    return shifted + (date[2] ?? "");
  }
  return value.replaceAll("{{DEMO_ORIGIN}}", origin.origin);
}

const sql = postgres(database.href, { max: 1, onnotice: () => {} });
try {
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(98312761)`;
    const demoId = snapshot.teams[0].id;
    const [existing] = await tx`SELECT id FROM teams WHERE id = ${demoId}`;
    if (existing) return;

    const passwordHash = await bcrypt.hash(demoPassword, 10);
    for (const table of tables) {
      const rows = snapshot[table].map(source => {
        const row = prepareValue(source);
        if (table === "teams") row.invite_code = "DEMO-" + randomBytes(6).toString("hex").toUpperCase();
        if (table === "users") row.password_hash = passwordHash;
        if (table === "home_profiles") delete row.web_pet;
        for (const key of Object.keys(row)) {
          if (row[key] !== null && jsonColumns.has(key)) row[key] = tx.json(row[key]);
        }
        return row;
      });
      if (rows.length) await tx`INSERT INTO ${tx(table)} ${tx(rows)}`;
    }
  });

  // Match the four built-in web pets to the office profiles on the first launch.
  for (const { owner_id: ownerId, web_pet: preset } of snapshot.home_profiles) {
    const accountKey = createHash("sha256").update(ownerId).digest("hex");
    const directory = join(".runtime", "web-pets", accountKey);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(join(directory, "desk-pet-config.json"), JSON.stringify(preset), { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  console.log("AgileCampus demo is ready.");
  console.log("Sign in: leader@demo.invalid / " + demoPassword);
} finally {
  await sql.end();
}
