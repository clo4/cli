import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@clo4/cli/unstable", replacement: at("../src/unstable.ts") },
      { find: "@clo4/cli", replacement: at("../src/index.ts") },
      { find: /^@\//, replacement: at("./src/") },
    ],
  },
});
