# Documentation

Run `pnpm --filter docs dev` from the repository root to start the site. Run `pnpm --filter docs build` for a production build, or `pnpm --filter docs check` for type checking.

The sidebar separates Concepts, Guides, Reference and Background. Introduction stands outside those groups. Concepts explain the library through examples. Guides address concrete tasks. Reference describes fields and behavior. Background covers comparisons, measurements and compatibility. There is no separate tutorial section.

## Generated API reference

Doc comments own the API reference. Edit comments beside public declarations, not files under a version's `reference` directory.

`pnpm --filter docs reference` extracts the active API from `src/index.ts` and `src/testing.ts`. The active documentation version comes from the major version in the root `package.json`. Its documentation directory must already exist.

TypeDoc extracts signatures and comments. Its Markdown plugin renders MDX. `scripts/generate-reference.mjs` adds frontmatter and groups symbols by their role: definitions, execution, help and completion, testing, and utilities. The generated content uses the same search, Markdown endpoints and `llms-full.txt` pipeline as written pages.

The generated directories are ignored by Git. The development, build and check commands generate them first. After changing comments during development, rerun the reference command to update the pages. Warnings and conversion errors fail generation.

TypeDoc currently requires TypeScript 6, so the docs workspace uses that version. The library retains its TypeScript 7 compiler. This dependency adds nothing to the published package.

## Versioned reference

The active major version uses working source. Older documentation versions use checked-in API models under `api-models`. A model contains signatures, comments, symbol links and the reference navigation for that version. Builds render the model without extracting the older API from current source.

Before switching the package to a new major version, refresh the current model:

```sh
pnpm --filter docs reference:freeze
```

Commit the model with the source and comment changes it describes. The command replaces the model for the current major version. Refresh it when changing that version's API or reference comments, and freeze once more before starting the next major version.

When the root package becomes version 7, create the v7 documentation directory. Generation then renders v7 from source and v6 from `api-models/v6.json`. A missing or mismatched archived model fails the build before replacing generated output.

To render saved models for every documentation version, including the active version:

```sh
pnpm --filter docs reference --frozen
```

To correct an archived API reference, update the matching version's source comments and regenerate its model. Do not replace an old model with a newer major version's API.

Models record the TypeDoc version that created them. When upgrading the generation tools, run the archive-isolation checks and inspect the resulting pages:

```sh
pnpm --filter docs reference:check
```

The checks use a temporary v7 project beside the frozen v6 model. They verify source and archive separation, missing-model errors, and rendering after source changes. They do not alter this repository's source or API models.

## Writing

Assume readers know TypeScript and use CLIs. Introduce library concepts through concrete definitions and examples. Explain the rules that affect constructing a command. Keep exhaustive field and signature details in the generated reference.

Use behavioral reference tables for interactions that involve several fields. Give task guides a specific outcome. Link between the explanation, guide and reference where the reader needs another kind of information.

Use complete examples when readers need to run the code. Label smaller snippets as definitions or fields rather than asking readers to reconstruct a program from another page.

Benchmark tables are recorded measurements. Preserve their values, hardware and methodology when editing the surrounding prose.
