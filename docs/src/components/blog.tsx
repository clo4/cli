import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Provider, type ProviderProps } from "@/components/provider";
import { baseOptions } from "@/lib/layout.shared";
import { base } from "@/lib/shared";

export function Blog({ children, ...props }: ProviderProps) {
  return (
    <Provider {...props}>
      <HomeLayout
        {...baseOptions()}
        links={[
          { text: "Documentation", url: `${base}/` },
          { text: "Blog", url: `${base}/blog`, active: "nested-url" },
        ]}
      >
        <main className="mx-auto w-full max-w-3xl px-4 py-12">{children}</main>
      </HomeLayout>
    </Provider>
  );
}
