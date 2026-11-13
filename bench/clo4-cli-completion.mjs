import * as CLI from "../dist/index.js";
import { spec } from "./clo4-spec.mjs";

// Only @clo4/cli has runtime completion, so the completion scenario gets an
// adapter of its own. That keeps completion's code out of the bundles the
// other scenarios time.
CLI.run(
  CLI.spec({
    ...spec,
    subcommands: [...spec.subcommands, { ...CLI.completion, hidden: true }],
  }),
);
