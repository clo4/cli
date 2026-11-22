import { appName, site } from "./shared";

export interface Item {
  title: string;
  url: string;
  date?: Date;
  description?: string;
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function rss(title: string, description: string, url: string, items: Item[]) {
  const entries = items
    .map(
      (item) => `    <item>
      <title>${escape(item.title)}</title>
      <link>${new URL(item.url, site).href}</link>
      <guid>${new URL(item.url, site).href}</guid>${item.date ? `\n      <pubDate>${item.date.toUTCString()}</pubDate>` : ""}${item.description ? `\n      <description>${escape(item.description.replaceAll("`", ""))}</description>` : ""}
    </item>`,
    )
    .join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escape(`${appName} · ${title}`)}</title>
    <link>${new URL(url, site).href}</link>
    <description>${escape(description)}</description>
${entries}
  </channel>
</rss>
`,
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } },
  );
}
