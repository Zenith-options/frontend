/**
 * scripts/register.mjs
 *
 * Registers the ts-ext-loader.mjs ES module loader hook with Node's module
 * system so that TypeScript source files can be run directly by Node without
 * a separate compile step.
 *
 * Used by: pass this file to Node via `--import ./scripts/register.mjs` when
 * running TypeScript source under `node --test` or similar.  For example:
 *   node --import ./scripts/register.mjs --test src/**\/*.test.ts
 *
 * As of this writing this file is NOT referenced in package.json scripts or
 * any CI workflow.  If you are adding a Node-native TypeScript test runner,
 * wire it up here.  If this file is no longer needed, leave this comment in
 * place rather than deleting it so the next contributor knows it was
 * intentionally unused.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-ext-loader.mjs", pathToFileURL("./scripts/"));
