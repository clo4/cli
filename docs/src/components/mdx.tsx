import defaultMdxComponents from "fumadocs-ui/mdx";
import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { base } from "@/lib/shared";

const Link = defaultMdxComponents.a;

function resolvePageLink(href?: string) {
  const match = href?.match(/^\.\/([\w-]+)\.mdx(#.*)?$/);
  if (!match) {
    return href;
  }
  const [, slug, hash = ""] = match;
  return `${base}/${slug === "index" ? "" : slug}${hash}`;
}

export default {
  ...defaultMdxComponents,
  a: (props: ComponentProps<"a">) => <Link {...props} href={resolvePageLink(props.href)} />,
  wrapper: DocsBody,
} satisfies MDXComponents;
