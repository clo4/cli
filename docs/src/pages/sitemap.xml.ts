import type { APIRoute } from "astro";
import { getPosts } from "@/lib/blog";
import { href, site } from "@/lib/shared";
import { latest, source, versionOf } from "@/lib/source";

export const prerender = true;

export const GET: APIRoute = () => {
  const urls = [
    href(),
    href("blog"),
    href("changelog"),
    ...source
      .getPages()
      .filter((page) => versionOf(page) === latest)
      .map((page) => page.url),
    ...getPosts().map((post) => post.url),
  ];
  const body = urls.map((url) => `  <url><loc>${new URL(url, site).href}</loc></url>`).join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
