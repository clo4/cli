import { run } from "../dist/index.js";
import { spec } from "./clo4-spec.mjs";

process.exitCode = await run(spec);
