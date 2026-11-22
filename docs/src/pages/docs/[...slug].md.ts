import type { APIRoute, GetStaticPaths, InferGetStaticPropsType } from "astro";
import { docsLlms, routeOf, source } from "@/lib/source";

export const prerender = true;

export const getStaticPaths = (() => {
  return source.getPages().map((page) => ({
    params: { slug: routeOf(page) || "index" },
    props: { page },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = async ({ props: { page } }) => {
  return new Response(await docsLlms.page(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
