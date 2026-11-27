/**
 * scripts/ts-ext-loader.mjs
 *
 * Node.js ES module loader hook that resolves extensionless relative imports
 * to their `.ts` counterpart. This lets test files written as plain TypeScript
 * import each other without spelling out the `.ts` extension, which mirrors
 * the TypeScript compiler's own resolution behaviour.
 *
 * Used by: scripts/register.mjs, which is passed to Node via
 *   --import ./scripts/register.mjs
 * when running TypeScript source files directly under `node --test` (or any
 * other Node runner that accepts the `--import` / `--loader` flags).
 *
 * If this file appears unreferenced in your search, check for `--import` or
 * `--loader` flags passed to Node in package.json scripts, Makefiles, or CI
 * workflow steps.
 */
/** Resolve extensionless relative imports to .ts for node --test. */
export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.(ts|tsx|js|mjs|cjs|json)$/.test(specifier)
  ) {
    try {
      return await nextResolve(specifier + ".ts", context);
    } catch {
      // fall through
    }
  }
  return nextResolve(specifier, context);
}
