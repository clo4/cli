import { createGetUrl } from "fumadocs-core/source";

export const appName = "@clo4/cli";
export const base = "/cli";

export const gitConfig = {
  user: "clo4",
  repo: "cli",
  branch: "main",
};

const getDocsUrl = createGetUrl(base);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs];
  if (segments.length === 0) {
    segments.push("index.md");
  } else {
    segments[segments.length - 1] += ".md";
  }

  return { segments, url: getDocsUrl(segments, page.locale) };
}
