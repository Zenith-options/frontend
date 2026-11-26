// `npm run api:check` — validates checked-in backend fixtures against the Zod
// schemas and diffs their key sets, so backend drift (renamed/added/removed
// fields) is caught before it reaches the UI. Fixtures live in
// contracts/fixtures/<SchemaName>.json; regenerate them from the backend
// (curl each endpoint) whenever the backend contract changes. Once the
// backend publishes OpenAPI, replace the fixture source with that file.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import * as S from "../src/lib/api/schemas";

// ─── Help / usage ─────────────────────────────────────────────────────────────

const USAGE = `\
Usage: npx tsx scripts/api-check.ts [options]

Validates every JSON fixture in contracts/fixtures/ against its matching Zod
schema exported from src/lib/api/schemas.ts, and reports any fields that exist
in the fixture but are absent from the schema (backend drift).

Options:
  --help, -h   Print this message and exit.

Arguments:
  None. The script discovers fixtures automatically from contracts/fixtures/.

Environment variables:
  None required. The fixtures and schemas directories are resolved relative
  to this script's location (__dirname).

Exit codes:
  0  All fixtures pass schema validation and no drift was detected.
  1  One or more fixtures failed validation or drift was detected.

Examples:
  npx tsx scripts/api-check.ts
  npm run api:check
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const unknownArgs = args.filter((a) => !["--help", "-h"].includes(a));
if (unknownArgs.length > 0) {
  process.stderr.write(`Unknown argument(s): ${unknownArgs.join(", ")}\n\n${USAGE}`);
  process.exit(1);
}

// ─── Check logic (unchanged) ──────────────────────────────────────────────────

const dir = join(__dirname, "..", "contracts", "fixtures");
const schemas = S as unknown as Record<string, z.ZodTypeAny>;
let failed = false;

function shapeKeys(schema: z.ZodTypeAny): string[] | null {
  if (schema instanceof z.ZodObject) return Object.keys(schema.shape);
  if (schema instanceof z.ZodArray) return shapeKeys(schema.element);
  return null;
}
const firstItem = (v: unknown) => (Array.isArray(v) ? v[0] : v);

for (const file of readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const name = file.replace(/\.json$/, "");
  const schema = schemas[name];
  if (!schema) { console.error(`FAIL ${name}: no exported schema`); failed = true; continue; }
  const payload = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const res = schema.safeParse(payload);
  if (!res.success) {
    console.error(`FAIL ${name}:`, res.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
    failed = true;
    continue;
  }
  const expected = shapeKeys(schema);
  const item = firstItem(payload);
  if (expected && item && typeof item === "object") {
    const extra = Object.keys(item).filter(k => !expected.includes(k));
    if (extra.length) { console.error(`DRIFT ${name}: fixture has fields not in schema: ${extra.join(", ")}`); failed = true; continue; }
  }
  console.log(`ok   ${name}`);
}
process.exit(failed ? 1 : 0);
