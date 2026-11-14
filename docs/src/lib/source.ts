import { getCollection } from "astro:content";
import { llms, loader } from "fumadocs-core/source";
import { toFumadocsSource } from "@fumadocs/astro/source";
import { base } from "./shared";

export const source = loader({
  source: toFumadocsSource(await getCollection("docs"), await getCollection("meta")),
  baseUrl: base,
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});
