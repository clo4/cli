import { defineConfig, fontProviders } from "astro/config";
import fumadocs from "@fumadocs/astro";
import solid from "@solidjs/vite-plugin";
import { createCssVariablesTheme } from "shiki";
import { fileURLToPath } from "node:url";

const theme = createCssVariablesTheme({ name: "tokens", variablePrefix: "--shiki-" });

export default defineConfig({
  site: "https://clo4.net",
  base: "/cli",
  outDir: "./dist/cli",
  build: { format: "file" },
  prefetch: { prefetchAll: true },
  server: { allowedHosts: [".ts.net"] },
  vite: {
    // The playground's view is Solid, mounted in the browser. Once
    // @astrojs/solid-js supports Solid 2, it can be an island.
    plugins: [solid({ include: ["src/playground/**/*.tsx"] })],
    resolve: {
      alias: [
        {
          find: "@clo4/cli/analyze",
          replacement: fileURLToPath(new URL("../src/analyze.ts", import.meta.url)),
        },
        { find: "@clo4/cli", replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)) },
      ],
    },
  },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "Inter",
      cssVariable: "--font-sans",
      weights: ["400 600"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["system-ui", "sans-serif"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Roboto Mono",
      cssVariable: "--font-mono",
      weights: ["400 500"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["ui-monospace", "monospace"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Newsreader",
      cssVariable: "--font-display",
      weights: ["400 500"],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["Georgia", "serif"],
    },
  ],
  integrations: [
    fumadocs({
      includeProcessedMarkdown: true,
      rehypeCodeOptions: { themes: { light: theme, dark: theme }, defaultColor: "light" },
      collections: {
        docs: { dir: "content/docs" },
        blog: { dir: "content/blog" },
        changelog: { dir: "content/changelog" },
      },
    }),
  ],
});
