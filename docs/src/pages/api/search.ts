import type { APIRoute } from "astro";
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

const server = createFromSource(source, {
  language: "english",
  // Each page is tagged with the version it belongs to, `next` or `v6`, so
  // the search dialog can show results from the version being read only.
  async buildIndex(page) {
    const { structuredData } = await page.data.load();
    return {
      id: page.url,
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      structuredData,
      tag: page.slugs[0],
    };
  },
});

export const GET: APIRoute = () => server.staticGET();
