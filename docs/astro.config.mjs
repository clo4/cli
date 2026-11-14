import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import fumadocs from "@fumadocs/astro";

export default defineConfig({
  site: "https://clo4.github.io",
  base: "/cli",
  prefetch: { prefetchAll: true },
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
