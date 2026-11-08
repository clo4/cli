import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { argument, command, constant, flag, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run";

// Optique parses into a value and leaves dispatch to the caller, so each
// command has a `command` constant and the switch below runs the action. The
// -v counter is a repeated flag, counted by the number of matches.
const parser = or(
  command(
    "build",
    object({
      command: constant("build"),
      inputs: multiple(argument(string({ metavar: "INPUT" })), { min: 1 }),
      out: option("--out", string({ metavar: "DIR" }), { description: message`Output directory.` }),
      mode: optional(option("--mode", string({ metavar: "MODE" }), { description: message`Build mode.` })),
      watch: withDefault(flag("--watch", { description: message`Watch files.` }), false),
      verbose: multiple(flag("-v", "--verbose", { description: message`Increase verbosity.` })),
    }),
    { aliases: ["b"], description: message`Build inputs.` },
  ),
  command(
    "remote",
    or(
      command(
        "add",
        object({
          command: constant("remote add"),
          name: argument(string({ metavar: "NAME" })),
          url: argument(string({ metavar: "URL" })),
          force: withDefault(flag("--force", { description: message`Overwrite an existing remote.` }), false),
          tag: optional(
            option("-t", "--tag", string({ metavar: "TAG" }), { description: message`Attach a tag.` }),
          ),
        }),
        { description: message`Add a remote.` },
      ),
      command(
        "remove",
        object({
          command: constant("remote remove"),
          name: argument(string({ metavar: "NAME" })),
          force: withDefault(flag("--force", { description: message`Skip confirmation.` }), false),
        }),
        { description: message`Remove a remote.` },
      ),
      command("list", object({ command: constant("remote list") }), { description: message`List remotes.` }),
    ),
    { description: message`Manage remotes.` },
  ),
  command(
    "config",
    or(
      command(
        "set",
        object({
          command: constant("config set"),
          key: argument(string({ metavar: "KEY" })),
          value: argument(string({ metavar: "VALUE" })),
        }),
        { description: message`Set a value.` },
      ),
      command("get", object({ command: constant("config get"), key: argument(string({ metavar: "KEY" })) }), {
        description: message`Get a value.`,
      }),
    ),
    { description: message`Manage configuration.` },
  ),
);

const result = run(parser, {
  programName: "forge",
  brief: message`Build orchestrator.`,
  help: "option",
});

switch (result.command) {
  case "build":
    console.log(
      `build:${result.inputs.join(",")}:${result.out}:${result.mode ?? "-"}:${result.watch}:${result.verbose.length}`,
    );
    break;
  case "remote add":
    console.log(`add:${result.name}:${result.url}:${result.force}:${result.tag ?? "-"}`);
    break;
  case "remote remove":
    console.log(`remove:${result.name}`);
    break;
  case "remote list":
    console.log("list");
    break;
  case "config set":
    console.log(`set:${result.key}:${result.value}`);
    break;
  case "config get":
    console.log(`get:${result.key}`);
    break;
}
