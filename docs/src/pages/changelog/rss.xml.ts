import type { APIRoute } from "astro";
import { t } from "@/i18n";
import { getReleases } from "@/lib/changelog";
import { rss } from "@/lib/rss";
import { href } from "@/lib/shared";

export const prerender = true;

export const GET: APIRoute = () =>
  rss(
    t("changelog.title"),
    t("changelog.description"),
    href("changelog"),
    getReleases().map((release) => ({
      title: release.data.title,
      url: `${href("changelog")}#v${release.data.title}`,
      date: release.data.date,
    })),
  );
