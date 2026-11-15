import { type SerializedPageTree, useFumadocsLoader } from "fumadocs-core/source/client";
import type { TOCItemType } from "fumadocs-core/toc";
import { Callout } from "fumadocs-ui/components/callout";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { Provider, type ProviderProps } from "@/components/provider";
import { baseOptions } from "@/lib/layout.shared";

export interface DocsProps extends ProviderProps {
  tree: SerializedPageTree;
  title: string;
  description?: string;
  toc: TOCItemType[];
  markdownUrl: string;
  githubUrl: string;
  /** Set on a page of the working docs: the newest released version and its page for the same topic. */
  unreleased?: { version: string; url: string };
}

export function Docs({
  tree,
  title,
  description,
  toc,
  markdownUrl,
  githubUrl,
  unreleased,
  children,
  ...props
}: DocsProps) {
  const data = useFumadocsLoader({ tree });

  return (
    <Provider {...props}>
      <DocsLayout {...baseOptions()} tree={data.tree}>
        <DocsPage toc={toc}>
          {unreleased && (
            <Callout type="warn" title="Unreleased">
              This page describes the <code>main</code> branch, which can differ from the package on npm.{" "}
              <a href={unreleased.url}>Read the {unreleased.version} docs</a> for the latest release.
            </Callout>
          )}
          <DocsTitle>{title}</DocsTitle>
          <DocsDescription>{description}</DocsDescription>
          <div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
            <MarkdownCopyButton markdownUrl={markdownUrl} />
            <ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={githubUrl} />
          </div>
          {children}
        </DocsPage>
      </DocsLayout>
    </Provider>
  );
}
