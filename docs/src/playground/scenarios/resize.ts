import * as CLI from "@clo4/cli";

export const spec = CLI.spec({
  name: "resize",
  description: "Resize an image",
  args: {
    name: "image",
    description: "Image to resize",
  },
  options: [
    CLI.help,
    {
      name: "--size",
      description: "Width and height",
      isRequired: true,
      args: {
        name: "size",
        parse: CLI.seq(CLI.uint.as("width"), "x", CLI.uint.as("height")).asObject(),
        suggestions: [
          { name: "1920x1080", description: "FHD" },
          { name: "1280x720", description: "HD" },
          { name: "3840x2160", description: "4K" },
        ],
      },
    },
    {
      name: "--fit",
      description: "How the image fills the size",
      args: {
        name: "fit",
        default: "cover",
        parse: CLI.choice("cover", "contain", "fill"),
      },
    },
  ],
  subcommands: [CLI.completion],
  action({ args: [image], options }) {
    const { width, height } = options.get("--size");
    console.log(`Resizing ${image} to ${width}x${height} (${options.get("--fit")})`);
  },
});
