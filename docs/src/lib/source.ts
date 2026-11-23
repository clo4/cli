import { getCollection } from "astro:content";
import { llms, loader } from "fumadocs-core/source";
import type * as PageTree from "fumadocs-core/page-tree";
import { toFumadocsSource } from "@fumadocs/astro/source";
import { base } from "./shared";
import { latest, versionById, type Version } from "./versions";

export const source = loader({
  source: toFumadocsSource(await getCollection("docs"), await getCollection("meta")),
  baseUrl: `${base}/docs`,
  url: ([version, ...rest]) => [versionById(version)!.path, ...rest].join("/"),
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`,
});

export type Page = ReturnType<typeof source.getPages>[number];

export function versionOf(page: Page): Version {
  return versionById(page.slugs[0])!;
}

export function routeOf(page: Page): string {
  return page.url.slice(`${base}/docs`.length + 1);
}

export function pageAt(route: string | undefined): Page | undefined {
  const parts = (route ?? "").split("/").filter(Boolean);
  const [first, ...rest] = parts;
  const explicit = first !== latest.id && versionById(first) !== undefined;
  return explicit ? source.getPage([first, ...rest]) : source.getPage([latest.id, ...parts]);
}

/** The page about the same thing in `version`, if it has one. */
export function sameTopic(page: Page, version: Version): Page | undefined {
  return source.getPage([version.id, ...page.slugs.slice(1)]);
}

/** Where to go to read `page` in `version`: the same page, or else its first. */
export function counterpart(page: Page, version: Version): Page {
  return sameTopic(page, version) ?? source.getPage([version.id])!;
}

export interface Category {
  name: string;
  items: PageTree.Item[];
}

export function categories(version: Version): Category[] {
  const root = source.getPageTree();
  const folder = root.children.find(
    (node): node is PageTree.Folder => node.type === "folder" && node.$ref?.folder === version.id,
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

/** The name of the category `page` is in. */
export function categoryOf(page: Page): string | undefined {
  return categories(versionOf(page)).find((category) => category.items.some((item) => item.url === page.url))
    ?.name;
}

export function neighbours(page: Page): { previous?: PageTree.Item; next?: PageTree.Item } {
  const items = categories(versionOf(page)).flatMap((category) => category.items);
  const at = items.findIndex((item) => item.url === page.url);
  return { previous: items[at - 1], next: items[at + 1] };
}
