import { Builtins, Command, Option, runExit } from "clipanion";

class BuildCommand extends Command {
  static paths = [["build"], ["b"]];
  static usage = Command.Usage({ description: "Build inputs." });
  inputs = Option.Rest({ name: "inputs" });
  out = Option.String("--out", { required: true, description: "Output directory." });
  mode = Option.String("--mode", { description: "Build mode." });
  watch = Option.Boolean("--watch", false, { description: "Watch files." });
  verbose = Option.Counter("-v,--verbose", 0, { description: "Increase verbosity." });

  async execute() {
    console.log(
      `build:${this.inputs.join(",")}:${this.out}:${this.mode ?? "-"}:${this.watch}:${this.verbose}`,
    );
  }
}

class RemoteAddCommand extends Command {
  static paths = [["remote", "add"]];
  static usage = Command.Usage({ description: "Add a remote." });
  name = Option.String();
  url = Option.String();
  force = Option.Boolean("--force", false, { description: "Overwrite an existing remote." });
  tag = Option.String("-t,--tag", { description: "Attach a tag." });

  async execute() {
    console.log(`add:${this.name}:${this.url}:${this.force}:${this.tag ?? "-"}`);
  }
}

class RemoteRemoveCommand extends Command {
  static paths = [["remote", "remove"]];
  static usage = Command.Usage({ description: "Remove a remote." });
  name = Option.String();
  force = Option.Boolean("--force", false, { description: "Skip confirmation." });

  async execute() {
    console.log(`remove:${this.name}`);
  }
}

class RemoteListCommand extends Command {
  static paths = [["remote", "list"]];
  static usage = Command.Usage({ description: "List remotes." });

  async execute() {
    console.log("list");
  }
}

class ConfigSetCommand extends Command {
  static paths = [["config", "set"]];
  static usage = Command.Usage({ description: "Set a value." });
  key = Option.String();
  value = Option.String();

  async execute() {
    console.log(`set:${this.key}:${this.value}`);
  }
}

class ConfigGetCommand extends Command {
  static paths = [["config", "get"]];
  static usage = Command.Usage({ description: "Get a value." });
  key = Option.String();

  async execute() {
    console.log(`get:${this.key}`);
  }
}

await runExit(
  { binaryName: "forge", binaryLabel: "Build orchestrator." },
  [
    Builtins.HelpCommand,
    BuildCommand,
    RemoteAddCommand,
    RemoteRemoveCommand,
    RemoteListCommand,
    ConfigSetCommand,
    ConfigGetCommand,
  ],
  process.argv.slice(2),
);
