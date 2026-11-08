import { buildApplication, buildCommand, buildRouteMap, run } from "@stricli/core";

const build = buildCommand({
  docs: { brief: "Build inputs." },
  parameters: {
    flags: {
      out: { kind: "parsed", parse: String, brief: "Output directory.", placeholder: "dir" },
      mode: { kind: "parsed", parse: String, brief: "Build mode.", placeholder: "mode", optional: true },
      watch: { kind: "boolean", brief: "Watch files.", optional: true },
      verbose: { kind: "counter", brief: "Increase verbosity.", optional: true },
    },
    aliases: { v: "verbose" },
    positional: {
      kind: "array",
      parameter: { brief: "Inputs.", parse: String, placeholder: "inputs" },
    },
  },
  func(flags, ...inputs) {
    console.log(
      `build:${inputs.join(",")}:${flags.out}:${flags.mode ?? "-"}:${Boolean(flags.watch)}:${flags.verbose ?? 0}`,
    );
  },
});

const remote = buildRouteMap({
  docs: { brief: "Manage remotes." },
  routes: {
    add: buildCommand({
      docs: { brief: "Add a remote." },
      parameters: {
        flags: {
          force: { kind: "boolean", brief: "Overwrite an existing remote.", optional: true },
          tag: { kind: "parsed", parse: String, brief: "Attach a tag.", placeholder: "tag", optional: true },
        },
        aliases: { t: "tag" },
        positional: {
          kind: "tuple",
          parameters: [
            { brief: "Remote name.", parse: String, placeholder: "name" },
            { brief: "Remote URL.", parse: String, placeholder: "url" },
          ],
        },
      },
      func(flags, name, url) {
        console.log(`add:${name}:${url}:${Boolean(flags.force)}:${flags.tag ?? "-"}`);
      },
    }),
    remove: buildCommand({
      docs: { brief: "Remove a remote." },
      parameters: {
        flags: { force: { kind: "boolean", brief: "Skip confirmation.", optional: true } },
        positional: {
          kind: "tuple",
          parameters: [{ brief: "Remote name.", parse: String, placeholder: "name" }],
        },
      },
      func(_flags, name) {
        console.log(`remove:${name}`);
      },
    }),
    list: buildCommand({
      docs: { brief: "List remotes." },
      parameters: {},
      func() {
        console.log("list");
      },
    }),
  },
});

const config = buildRouteMap({
  docs: { brief: "Manage configuration." },
  routes: {
    set: buildCommand({
      docs: { brief: "Set a value." },
      parameters: {
        positional: {
          kind: "tuple",
          parameters: [
            { brief: "Key.", parse: String, placeholder: "key" },
            { brief: "Value.", parse: String, placeholder: "value" },
          ],
        },
      },
      func(_flags, key, value) {
        console.log(`set:${key}:${value}`);
      },
    }),
    get: buildCommand({
      docs: { brief: "Get a value." },
      parameters: {
        positional: {
          kind: "tuple",
          parameters: [{ brief: "Key.", parse: String, placeholder: "key" }],
        },
      },
      func(_flags, key) {
        console.log(`get:${key}`);
      },
    }),
  },
});

const app = buildApplication(
  buildRouteMap({
    docs: { brief: "Build orchestrator." },
    routes: { build, remote, config },
    aliases: { b: "build" },
  }),
  { name: "forge" },
);

await run(app, process.argv.slice(2), { process });
