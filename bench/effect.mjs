import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";

const build = Command.make(
  "build",
  {
    inputs: Argument.String("inputs").pipe(Argument.variadic()),
    out: Flag.String("out").pipe(Flag.withDescription("Output directory."), Flag.withMetavar("dir")),
    mode: Flag.String("mode").pipe(
      Flag.withDescription("Build mode."),
      Flag.withMetavar("mode"),
      Flag.optional,
    ),
    watch: Flag.Boolean("watch").pipe(Flag.withDescription("Watch files."), Flag.withDefault(false)),
    verbose: Flag.Boolean("verbose").pipe(
      Flag.withAlias("v"),
      Flag.withDescription("Increase verbosity."),
      Flag.atLeast(0),
    ),
  },
  ({ inputs, out, mode, watch, verbose }) =>
    Console.log(
      `build:${inputs.join(",")}:${out}:${Option.getOrElse(mode, () => "-")}:${watch}:${verbose.filter(Boolean).length}`,
    ),
).pipe(Command.withDescription("Build inputs."), Command.withAlias("b"));

const remote = Command.make("remote").pipe(
  Command.withDescription("Manage remotes."),
  Command.withSubcommands([
    Command.make(
      "add",
      {
        name: Argument.String("name"),
        url: Argument.String("url"),
        force: Flag.Boolean("force").pipe(
          Flag.withDescription("Overwrite an existing remote."),
          Flag.withDefault(false),
        ),
        tag: Flag.String("tag").pipe(
          Flag.withAlias("t"),
          Flag.withDescription("Attach a tag."),
          Flag.withMetavar("tag"),
          Flag.optional,
        ),
      },
      ({ name, url, force, tag }) =>
        Console.log(`add:${name}:${url}:${force}:${Option.getOrElse(tag, () => "-")}`),
    ).pipe(Command.withDescription("Add a remote.")),
    Command.make(
      "remove",
      {
        name: Argument.String("name"),
        force: Flag.Boolean("force").pipe(
          Flag.withDescription("Skip confirmation."),
          Flag.withDefault(false),
        ),
      },
      ({ name }) => Console.log(`remove:${name}`),
    ).pipe(Command.withDescription("Remove a remote.")),
    Command.make("list", {}, () => Console.log("list")).pipe(Command.withDescription("List remotes.")),
  ]),
);

const config = Command.make("config").pipe(
  Command.withDescription("Manage configuration."),
  Command.withSubcommands([
    Command.make("set", { key: Argument.String("key"), value: Argument.String("value") }, ({ key, value }) =>
      Console.log(`set:${key}:${value}`),
    ).pipe(Command.withDescription("Set a value.")),
    Command.make("get", { key: Argument.String("key") }, ({ key }) => Console.log(`get:${key}`)).pipe(
      Command.withDescription("Get a value."),
    ),
  ]),
);

const forge = Command.make("forge").pipe(
  Command.withDescription("Build orchestrator."),
  Command.withSubcommands([build, remote, config]),
);

Command.run(forge, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
