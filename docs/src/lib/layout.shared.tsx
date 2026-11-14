import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, base, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName,
      url: `${base}/`,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
