import { Renderer } from "@takumi-rs/core";

const fonts = [
  ["newsreader", 400],
  ["inter", 400],
  ["roboto-mono", 500],
] as const;

let renderer: Promise<Renderer> | undefined;

function load() {
  return (renderer ??= (async () => {
    const instance = new Renderer();
    for (const [family, weight] of fonts) {
      const response = await fetch(
        `https://cdn.jsdelivr.net/fontsource/fonts/${family}@latest/latin-${weight}-normal.woff2`,
      );
      if (!response.ok) {
        throw new Error(`Couldn't load the ${family} font for social images: ${response.status}`);
      }
      await instance.registerFont(new Uint8Array(await response.arrayBuffer()));
    }
    return instance;
  })());
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface Card {
  title: string;
  description?: string;
  label?: string;
}

export async function socialImage({ title, description, label }: Card) {
  const size = title.length > 40 ? 64 : 84;
  const html = `<div style="display:flex;flex-direction:column;justify-content:space-between;width:100%;height:100%;padding:72px 80px;background:#141312;color:#e9e6e1;font-family:Inter">
    <div style="font-family:'Roboto Mono';font-size:30px"><span style="color:#605b55">@clo4/</span>cli</div>
    <div style="display:flex;flex-direction:column;gap:20px">
      <div style="font-family:Newsreader;font-size:${size}px;line-height:1.05;letter-spacing:-0.02em">${escape(title)}</div>
      ${description ? `<div style="font-size:32px;color:#9a958e;line-height:1.4">${escape(description.replaceAll("`", ""))}</div>` : ""}
    </div>
    <div style="font-size:26px;color:#9a958e">${escape(label ?? "")}</div>
  </div>`;
  return (await load()).render(html, { width: 1200, height: 630 });
}
