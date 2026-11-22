import { getCollection } from "astro:content";
import { llms, loader } from "fumadocs-core/source";
import type * as PageTree from "fumadocs-core/page-tree";
import { toFumadocsSource } from "@fumadocs/astro/source";
import { base } from "./shared";

const collected = await getCollection("docs");

export const versions = [...new Set(collected.map((entry) => entry.id.split("/")[0]))]
  .filter((dir) => /^v\d+$/.test(dir))
  .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));

export const latest = versions[0];

export function versionPath(version: string): string {
  return version === latest ? `${base}/docs` : `${base}/docs/${version}`;
}

export const source = loader({
  source: toFumadocsSource(collected, await getCollection("meta")),
  baseUrl: `${base}/docs`,
  url: ([version, ...rest]) => [versionPath(version), ...rest].join("/"),
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});

export type Page = ReturnType<typeof source.getPages>[number];

export function versionOf(page: Page): string {
  return page.slugs[0];
}

export function routeOf(page: Page): string {
  return page.url.slice(`${base}/docs`.length + 1);
}

export function pageAt(route: string | undefined): Page | undefined {
  const parts = (route ?? "").split("/").filter(Boolean);
  const [first, ...rest] = parts;
  const explicit = first === "next" || (first !== latest && versions.includes(first));
  return explicit ? source.getPage([first, ...rest]) : source.getPage([latest, ...parts]);
}

export function sameTopic(page: Page, version: string): Page | undefined {
  return source.getPage([version, ...page.slugs.slice(1)]);
}

export interface Category {
  name: string;
  items: PageTree.Item[];
}

export function categories(version: string): Category[] {
  const root = source.getPageTree();
  const folder = root.children.find(
    (node): node is PageTree.Folder => node.type === "folder" && node.$ref?.folder === version,
  );
  const result: Category[] = [];
  let current: Category | undefined;
  for (const node of folder?.children ?? []) {
    if (node.type === "separator") {
      current = { name: String(node.name ?? ""), items: [] };
      result.push(current);
      continue;
    }
    if (!current) {
      current = { name: "Introduction", items: [] };
      result.push(current);
    }
    const item = node.type === "folder" ? node.index : node;
    if (item) {
      current.items.push(item);
    }
  }
  if (folder?.index) {
    const intro = result.find((category) => category.name === "Introduction") ?? result[0];
    intro?.items.unshift(folder.index);
  }
  return result;
}

export function neighbours(page: Page): { previous?: PageTree.Item; next?: PageTree.Item } {
  const items = categories(versionOf(page)).flatMap((category) => category.items);
  const at = items.findIndex((item) => item.url === page.url);
  return { previous: items[at - 1], next: items[at + 1] };
}
