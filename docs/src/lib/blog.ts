import { getCollection } from "astro:content";
import { loader } from "fumadocs-core/source";
import { toFumadocsSource } from "@fumadocs/astro/source";
import { base } from "./shared";

/**
 * A post with `draft: true` in its front matter is left out of a build, so
 * it has no page and the blog's index doesn't list it. `pnpm dev` shows it,
 * for reading it before it's published.
 */
const posts = await getCollection("blog", ({ data }) => import.meta.env.DEV || !data.draft);

export const blog = loader({
  source: toFumadocsSource(posts, []),
  baseUrl: `${base}/blog`,
});

/** The blog's posts, newest first. */
export function getPosts() {
  return blog.getPages().sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}
