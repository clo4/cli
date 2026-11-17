import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { metaLoader, pageLoader } from "@fumadocs/astro/loaders";
import { pageSchema } from "fumadocs-core/source/schema";

export const collections = {
  docs: defineCollection({ loader: pageLoader() }),
  meta: defineCollection({ loader: metaLoader() }),
  blog: defineCollection({
    loader: pageLoader("blog"),
    schema: pageSchema.extend({ date: z.coerce.date(), draft: z.boolean().optional() }),
  }),
};
