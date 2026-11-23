import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The docs site has tests of its own, run in its package.
    exclude: [...configDefaults.exclude, ".*/**", "docs/**", "temp/**"],
  },
});
