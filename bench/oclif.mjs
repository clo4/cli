import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Args, Command, Flags, execute } from "@oclif/core";

class Build extends Command {
  static description = "Build inputs.";
  static aliases = ["b"];
  static args = { inputs: Args.string({ multiple: true }) };
  static flags = {
    out: Flags.string({ description: "Output directory.", helpValue: "<dir>", required: true }),
    mode: Flags.string({ description: "Build mode.", helpValue: "<mode>" }),
    watch: Flags.boolean({ description: "Watch files." }),
    // oclif has no counter flag, so run() counts the -v tokens it parsed.
    verbose: Flags.boolean({ char: "v", description: "Increase verbosity." }),
  };

  async run() {
    const { args, flags, raw } = await this.parse(Build);
    const verbose = raw.filter((token) => token.type === "flag" && token.flag === "verbose").length;
    this.log(
      `build:${(args.inputs ?? []).join(",")}:${flags.out}:${flags.mode ?? "-"}:${Boolean(flags.watch)}:${verbose}`,
    );
  }
}

class RemoteAdd extends Command {
  static description = "Add a remote.";
  static args = {
    name: Args.string({ required: true }),
    url: Args.string({ required: true }),
  };
  static flags = {
    force: Flags.boolean({ description: "Overwrite an existing remote." }),
    tag: Flags.string({ char: "t", description: "Attach a tag.", helpValue: "<tag>" }),
  };

  async run() {
    const { args, flags } = await this.parse(RemoteAdd);
    this.log(`add:${args.name}:${args.url}:${Boolean(flags.force)}:${flags.tag ?? "-"}`);
  }
}

class RemoteRemove extends Command {
  static description = "Remove a remote.";
  static args = { name: Args.string({ required: true }) };
  static flags = { force: Flags.boolean({ description: "Skip confirmation." }) };

  async run() {
    const { args } = await this.parse(RemoteRemove);
    this.log(`remove:${args.name}`);
  }
}

class RemoteList extends Command {
  static description = "List remotes.";

  async run() {
    this.log("list");
  }
}

class ConfigSet extends Command {
  static description = "Set a value.";
  static args = {
    key: Args.string({ required: true }),
    value: Args.string({ required: true }),
  };

  async run() {
    const { args } = await this.parse(ConfigSet);
    this.log(`set:${args.key}:${args.value}`);
  }
}

class ConfigGet extends Command {
  static description = "Get a value.";
  static args = { key: Args.string({ required: true }) };

  async run() {
    const { args } = await this.parse(ConfigGet);
    this.log(`get:${args.key}`);
  }
}

export const COMMANDS = {
  build: Build,
  "remote:add": RemoteAdd,
  "remote:remove": RemoteRemove,
  "remote:list": RemoteList,
  "config:set": ConfigSet,
  "config:get": ConfigGet,
};

// oclif finds its commands through package.json. The "explicit" strategy loads
// them from a module export, so the inline package.json points oclif back at
// this bundle's COMMANDS export. oclif imports this module again to read it,
// and that import only resolves once this module has finished evaluating, so
// execute() isn't awaited here. It handles its own errors.
const file = fileURLToPath(import.meta.url);
execute({
  dir: import.meta.url,
  loadOptions: {
    root: dirname(file),
    pjson: {
      name: "forge",
      version: "0.0.0",
      description: "Build orchestrator.",
      type: "module",
      oclif: {
        bin: "forge",
        topicSeparator: " ",
        commands: { strategy: "explicit", target: `./${basename(file)}`, identifier: "COMMANDS" },
        topics: {
          remote: { description: "Manage remotes." },
          config: { description: "Manage configuration." },
        },
      },
    },
  },
});
