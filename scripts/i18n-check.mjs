#!/usr/bin/env node
// CI check for message catalogs (#116). Every locale in messages/ must have
// exactly the keys in messages/en.json, with no empty strings and the same
// ICU placeholders and rich-text tags. Exits 1 on any problem.
//
//   npm run i18n:check
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { compareCatalogs, isClean } = require("../src/lib/i18n/keys.cjs");

const dir = "messages";
const src = "src";
const SOURCE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/;
const TEST_FILE = /__tests__|\.(test|spec)\./;
const NAMESPACE_CALL = /\b(?:useTranslations|getTranslations)\(\s*(?:\{[^}]*?namespace:\s*)?["'`]([^"'`]*)["'`]/g;
const STRING_LITERAL = /["'`]([^"'`\n]+)["'`]/g;
const source = JSON.parse(readFileSync(join(dir, "en.json"), "utf8"));
let failed = false;
let sourceIndex = null;

/** Maps each quoted string in src/ to the lines that contain it, with the namespaces its file opens. */
function indexSource() {
  const index = new Map();
  for (const rel of readdirSync(src, { recursive: true })) {
    const file = join(src, rel);
    if (!SOURCE_FILE.test(file) || TEST_FILE.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const namespaces = new Set([...text.matchAll(NAMESPACE_CALL)].map((m) => m[1]));
    text.split("\n").forEach((line, i) => {
      for (const [, value] of line.matchAll(STRING_LITERAL)) {
        if (!index.has(value)) index.set(value, []);
        index.get(value).push({ loc: `${file}:${i + 1}`, namespaces });
      }
    });
  }
  return index;
}

/** Call sites of a dotted key: the full key literal, or a suffix read under its namespace. */
function locate(index, key) {
  const found = new Set((index.get(key) ?? []).map((e) => e.loc));
  for (let i = key.indexOf("."); i !== -1; i = key.indexOf(".", i + 1)) {
    const namespace = key.slice(0, i);
    for (const e of index.get(key.slice(i + 1)) ?? []) if (e.namespaces.has(namespace)) found.add(e.loc);
  }
  return [...found];
}

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json").sort()) {
  const locale = file.replace(/\.json$/, "");
  const report = compareCatalogs(source, JSON.parse(readFileSync(join(dir, file), "utf8")), locale);
  if (isClean(report)) {
    console.log(`✓ ${locale}`);
    continue;
  }
  failed = true;
  console.error(`✗ ${locale}`);
  for (const k of report.missing) {
    sourceIndex ??= indexSource();
    console.error(`    missing      ${k}  (${locate(sourceIndex, k).join(", ") || "no reference in src"})`);
  }
  for (const k of report.extra) console.error(`    extra        ${k}`);
  for (const k of report.empty) console.error(`    empty        ${k}`);
  for (const m of report.placeholderMismatch) console.error(`    placeholders ${m.key}: expected [${m.expected}] got [${m.actual}]`);
}

process.exit(failed ? 1 : 0);
