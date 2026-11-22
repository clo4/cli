import { defineConfig, fontProviders } from "astro/config";
import fumadocs from "@fumadocs/astro";
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
    resolve: {
      alias: [
        {
          find: "@clo4/cli/unstable",
          replacement: fileURLToPath(new URL("../src/unstable.ts", import.meta.url)),
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
