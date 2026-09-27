import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Pure lib/ modules run in plain Node; component tests opt into jsdom with
// a `// @vitest-environment jsdom` pragma at the top of the file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
