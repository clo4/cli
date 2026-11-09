import { completion, run } from "../dist/index.js";
import { spec } from "./clo4-spec.mjs";

// Only @clo4/cli has runtime completion, so the completion scenario gets an
// adapter of its own. That keeps completion's code out of the bundles the
// other scenarios time.
process.exitCode = await run({
  ...spec,
  subcommands: [...spec.subcommands, { ...completion, hidden: true }],
});
