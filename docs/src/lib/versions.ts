/**
 * The versions of the docs: `next`, from the main branch, and the newest docs
 * of each major release, newest first. The newest major is the latest, and its
 * pages are at `/docs` with no version in the path.
 */

import { getCollection } from "astro:content";
import { t } from "@/i18n";
import { getReleases } from "./changelog";
import { base } from "./shared";

export interface Version {
  /** The folder its pages are in: `next`, or a major like `v7`. */
  id: string;
  /** `next` is the main branch, `latest` the newest major, and `old` the others. */
  status: "next" | "latest" | "old";
  /** The newest release of its major, like `7.0.0`. `next` has none. */
  release?: string;
  /** Where its pages are. */
  path: string;
}

const majors = [...new Set((await getCollection("docs")).map((entry) => entry.id.split("/")[0]))]
  .filter((dir) => /^v\d+$/.test(dir))
  .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
const releases = getReleases().map((release) => release.data.title);

export const versions: readonly Version[] = [
  { id: "next", status: "next", path: `${base}/docs/next` },
  ...majors.map((id, i): Version => ({
    id,
    status: i === 0 ? "latest" : "old",
    release: releases.find((release) => release.split(".")[0] === id.slice(1)),
    path: i === 0 ? `${base}/docs` : `${base}/docs/${id}`,
  })),
];

export const latest = versions.find((version) => version.status === "latest")!;

export function versionById(id: string): Version | undefined {
  return versions.find((version) => version.id === id);
}

/** What the version selector calls a version: a name, and a note after it. */
export function versionLabel(version: Version): { name: string; note?: string } {
  const release = version.release && t("docs.version.release", { release: version.release });
  switch (version.status) {
    case "next":
      return { name: t("docs.version.next"), note: t("docs.version.nextNote") };
    case "latest":
      return { name: t("docs.version.latest"), note: release };
    case "old":
      return { name: release ?? version.id };
  }
}
