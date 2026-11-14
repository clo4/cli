import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import fumadocs from "@fumadocs/astro";

export default defineConfig({
  site: "https://clo4.net",
  base: "/cli",
  outDir: "./dist/cli",
  build: { format: "file" },
  prefetch: { prefetchAll: true },
  redirects: { "/": "/cli/v6" },
  integrations: [
    fumadocs({
      components: "./src/components/mdx.tsx",
      includeProcessedMarkdown: true,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
