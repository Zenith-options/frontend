// `npm run api:check` — validates checked-in backend fixtures against the Zod
// schemas and diffs their key sets, so backend drift (renamed/added/removed
// fields) is caught before it reaches the UI. Fixtures live in
// contracts/fixtures/<SchemaName>.json; regenerate them from the backend
// (curl each endpoint) whenever the backend contract changes. Once the
// backend publishes OpenAPI, replace the fixture source with that file.
//
// When `--url <base>` is passed the script also performs a live HTTP health
// check against each fixture's corresponding endpoint. Any status outside
// 200–299 (including 3xx redirects, which almost always indicate a
// misconfigured base URL) is treated as a failure and exits non-zero.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import * as S from "../src/lib/api/schemas";

const dir = join(__dirname, "..", "contracts", "fixtures");
const schemas = S as unknown as Record<string, z.ZodTypeAny>;
let failed = false;

// ── Optional live HTTP check ─────────────────────────────────────────────────

const urlFlagIndex = process.argv.indexOf("--url");
const baseUrl = urlFlagIndex !== -1 ? process.argv[urlFlagIndex + 1] : undefined;

async function checkEndpoint(url: string): Promise<void> {
  let res: Response;
  try {
    // redirect: "manual" ensures 3xx is not silently followed and treated as 2xx.
    res = await fetch(url, { redirect: "manual" });
  } catch (err) {
    console.error(`FAIL ${url}: network error — ${(err as Error).message}`);
    failed = true;
    return;
  }
  if (res.status < 200 || res.status > 299) {
    console.error(`FAIL ${url}: unexpected status ${res.status}`);
    failed = true;
    return;
  }
  console.log(`ok   ${url} (${res.status})`);
}

// ── Fixture schema validation ─────────────────────────────────────────────────

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

// ── Live health check (only when --url is supplied) ───────────────────────────

if (baseUrl) {
  const endpoints = readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      // Derive a conventional endpoint path from the fixture name, e.g.
      // "AccountSchema" → "/api/v1/account".
      const name = f.replace(/Schema\.json$/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
      return `${baseUrl.replace(/\/$/, "")}/api/v1/${name}`;
    });

  (async () => {
    for (const url of endpoints) await checkEndpoint(url);
    process.exit(failed ? 1 : 0);
  })();
} else {
  process.exit(failed ? 1 : 0);
}
