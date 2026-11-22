import { getCollection } from "astro:content";
import { loader } from "fumadocs-core/source";
import { toFumadocsSource } from "@fumadocs/astro/source";
import { base } from "./shared";

export const changelog = loader({
  source: toFumadocsSource(await getCollection("changelog"), []),
  baseUrl: `${base}/changelog`,
});

const parts = (version: string) => version.split(".").map(Number);

export function getReleases() {
  return changelog
    .getPages()
    .filter((page) => page.slugs[0] !== "unreleased")
    .sort((a, b) => {
      const [x, y] = [parts(a.data.title), parts(b.data.title)];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
}

export function getUnreleased() {
  return changelog.getPage(["unreleased"]);
}
