import { getCollection } from "astro:content";
import { loader } from "fumadocs-core/source";
import { toFumadocsSource } from "@fumadocs/astro/source";
import { base } from "./shared";

const posts = await getCollection("blog", ({ data }) => import.meta.env.DEV || !data.draft);

export const blog = loader({
  source: toFumadocsSource(posts, []),
  baseUrl: `${base}/blog`,
});

export function getPosts() {
  return blog.getPages().sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function formatDate(date: Date, style: "long" | "short" = "long") {
  return style === "long"
    ? date.toLocaleDateString("en-GB", { dateStyle: "long", timeZone: "UTC" })
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
