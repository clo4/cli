import type { APIRoute } from "astro";
import { t } from "@/i18n";
import { getPosts } from "@/lib/blog";
import { rss } from "@/lib/rss";
import { href } from "@/lib/shared";

export const prerender = true;

export const GET: APIRoute = () =>
  rss(
    t("blog.title"),
    t("blog.description"),
    href("blog"),
    getPosts().map((post) => ({
      title: post.data.title,
      url: post.url,
      date: post.data.date,
      description: post.data.description,
    })),
  );
