import { navigate } from "astro:transitions/client";
import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/astro";
import SearchDialog from "@/components/search";

export interface ProviderProps {
  pathname: string;
  params: Record<string, string | undefined>;
  children?: ReactNode;
}

export function Provider({ pathname, params, children }: ProviderProps) {
  return (
    <RootProvider pathname={pathname} params={params} navigate={navigate} search={{ SearchDialog }}>
      {children}
    </RootProvider>
  );
}
