import { Application, normalizePath } from "typedoc";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => arg !== "--freeze" && arg !== "--frozen") || args.size > 1) {
  throw new Error("Use --freeze to save the current model, or --frozen to render saved models");
}
const { version } = JSON.parse(await readFile("../package.json", "utf8"));
const major = version.split(".")[0];
if (!/^\d+$/.test(major)) {
  throw new Error(`Cannot determine the documentation version from ${version}`);
}
const current = `v${major}`;
await readFile(`content/docs/${current}/meta.json`, "utf8");

const groups = [
  ["", "API reference", ["index", "definitions", "execution", "completion", "testing", "utilities"]],
  [
    "definitions",
    "Definitions",
    [
      "../cli/functions/spec",
      "../cli/functions/command",
      "../cli/interfaces/Spec",
      "../cli/interfaces/Subcommand",
      "../cli/interfaces/Option",
      "../cli/interfaces/Arg",
    ],
  ],
  [
    "execution",
    "Execution",
    [
      "../cli/functions/run",
      "../cli/functions/printError",
      "../cli/interfaces/Action",
      "../cli/interfaces/ActionInit",
      "../cli/interfaces/OptionArgs",
      "../cli/interfaces/RunOptions",
    ],
  ],
  [
    "completion",
    "Help and completion",
    [
      "../cli/variables/help",
      "../cli/variables/helpCommand",
      "../cli/variables/completion",
      "../cli/interfaces/Generator",
      "../cli/interfaces/Suggestion",
      "../cli/type-aliases/Template",
      "../cli/type-aliases/Shell",
    ],
  ],
  [
    "testing",
    "Testing",
    [
      "variables/testSpec",
      "functions/test",
      "interfaces/TestOptions",
      "interfaces/TestContextLike",
      "type-aliases/TestNamingStyle",
    ],
  ],
  [
    "utilities",
    "Utility types and exports",
    [
      "../cli/type-aliases/CommandPath",
      "../cli/type-aliases/NonEmptyArray",
      "../cli/type-aliases/SingleOrArray",
      "../cli/type-aliases/SingleOrArrayOrEmpty",
      "../cli/variables/default",
    ],
  ],
];

async function application(output) {
  const app = await Application.bootstrapWithPlugins({ options: "typedoc.json" });
  app.options.setValue("out", output);
  return app;
}

function assertClean(app) {
  if (app.logger.hasWarnings() || app.logger.hasErrors()) {
    throw new Error("Fix TypeDoc warnings and errors before generating reference pages");
  }
}

async function sourceProject(app) {
  const project = await app.convert();
  if (!project) {
    throw new Error("TypeDoc could not convert the public API");
  }
  assertClean(app);
  return project;
}

if (args.has("--freeze")) {
  const app = await application(`content/docs/${current}/reference`);
  const project = await sourceProject(app);
  const snapshot = {
    format: 1,
    docsVersion: current,
    packageVersion: version,
    typedocVersion: Application.VERSION,
    navigation: groups,
    project: app.serializer.projectToObject(project, normalizePath(path.resolve(".."))),
  };
  await mkdir("api-models", { recursive: true });
  await writeFile(`api-models/${current}.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Saved api-models/${current}.json for ${version}`);
} else {
  const versions = (await readdir("content/docs", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  // Check archives before replacing any generated output.
  const snapshots = new Map();
  for (const docsVersion of versions) {
    if (docsVersion === current && !args.has("--frozen")) {
      continue;
    }
    const file = `api-models/${docsVersion}.json`;
    let snapshot;
    try {
      snapshot = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`Cannot load ${file}. Freeze each version before changing the package major.`, {
        cause: error,
      });
    }
    if (
      snapshot.format !== 1 ||
      snapshot.docsVersion !== docsVersion ||
      `v${snapshot.packageVersion?.split(".")[0]}` !== docsVersion ||
      !Array.isArray(snapshot.navigation) ||
      !snapshot.project
    ) {
      throw new Error(`Invalid API model: ${file}`);
    }
    snapshots.set(docsVersion, snapshot);
  }
  for (const docsVersion of versions) {
    const output = `content/docs/${docsVersion}/reference`;
    const app = await application(output);
    const snapshot = snapshots.get(docsVersion);
    const project = snapshot
      ? app.deserializer.reviveProject(snapshot.project.name, snapshot.project, {
          projectRoot: normalizePath(path.resolve("..")),
          registry: app.files,
        })
      : await sourceProject(app);
    if (snapshot) {
      app.trigger(Application.EVENT_PROJECT_REVIVE, project);
    }
    assertClean(app);
    await app.generateOutputs(project);
    assertClean(app);
    await addFrontmatter(output);
    await writeNavigation(output, snapshot?.navigation ?? groups);
    console.log(
      `Generated ${docsVersion} reference from ${snapshot ? snapshot.packageVersion + " API model" : "source"}`,
    );
  }
}

async function addFrontmatter(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await addFrontmatter(file);
    } else if (entry.name.endsWith(".mdx")) {
      const markdown = (await readFile(file, "utf8")).replace(
        /\]\((?![./#]|[a-z]+:)([^)]+\.mdx(?:#[^)]*)?)\)/g,
        "](./$1)",
      );
      const heading = /^# (.+)\n/.exec(markdown);
      if (!heading) {
        throw new Error(`Missing title in ${file}`);
      }
      const title = heading[1]
        .replace(/^(Function|Interface|Type Alias|Variable): /, "")
        .replace(/\\+([<>])/g, "$1");
      await writeFile(
        file,
        `---\ntitle: ${JSON.stringify(title)}\n---\n\n${markdown.slice(heading[0].length).trimStart()}`,
      );
    }
  }
}

async function writeNavigation(output, groups) {
  for (const [directory, title, pages] of groups) {
    await mkdir(path.join(output, directory), { recursive: true });
    await writeFile(
      path.join(output, directory, "meta.json"),
      `${JSON.stringify({ title, pages }, null, 2)}\n`,
    );
  }

  const overview = groups.slice(1).map(([directory, title, pages]) => {
    const links = pages.map((page) => {
      const name = path.posix.basename(page) + (page.includes("functions/") ? "()" : "");
      const target = path.posix.normalize(path.posix.join(directory, page));
      return `- [${name}](./${target}.mdx)`;
    });
    return `## ${title}\n\n${links.join("\n")}`;
  });
  await writeFile(
    path.join(output, "index.mdx"),
    `---\ntitle: API reference\n---\n\n${overview.join("\n\n")}\n`,
  );
}
