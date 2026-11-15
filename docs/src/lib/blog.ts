import { getCollection } from "astro:content";
import { loader } from "fumadocs-core/source";
import { toFumadocsSource } from "@fumadocs/astro/source";
import { base } from "./shared";

export const blog = loader({
  source: toFumadocsSource(await getCollection("blog"), []),
  baseUrl: `${base}/blog`,
});

/** The blog's posts, newest first. */
export function getPosts() {
  return blog.getPages().sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}
