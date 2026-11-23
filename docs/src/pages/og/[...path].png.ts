import type { APIRoute, GetStaticPaths, InferGetStaticPropsType } from "astro";
import { t } from "@/i18n";
import { formatDate, getPosts } from "@/lib/blog";
import { socialImage, type Card } from "@/lib/og";
import { categoryOf, routeOf, source } from "@/lib/source";

export const prerender = true;

export const getStaticPaths = (() => {
  const cards: { path: string; card: Card }[] = [
    { path: "index", card: { title: t("landing.title"), description: t("site.description") } },
    { path: "blog", card: { title: t("blog.title"), description: t("blog.description") } },
    { path: "changelog", card: { title: t("changelog.title"), description: t("changelog.description") } },
  ];
  for (const page of source.getPages()) {
    const category = categoryOf(page);
    cards.push({
      path: `docs/${routeOf(page) || "index"}`,
      card: {
        title: page.data.title,
        description: page.data.description,
        label: [t("nav.docs"), category].filter(Boolean).join(" · "),
      },
    });
  }
  for (const post of getPosts()) {
    cards.push({
      path: `blog/${post.slugs.join("/")}`,
      card: {
        title: post.data.title,
        description: post.data.description,
        label: `${t("blog.title")} · ${formatDate(post.data.date)}`,
      },
    });
  }
  return cards.map(({ path, card }) => ({ params: { path }, props: { card } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = async ({ props: { card } }) =>
  new Response(new Uint8Array(await socialImage(card)), { headers: { "Content-Type": "image/png" } });
