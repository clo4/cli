# Documentation

Run `pnpm --filter docs dev` from the repository root to start the site. Run `pnpm --filter docs build` for a production build, or `pnpm --filter docs check` for type checking.

The sidebar separates Concepts, Guides, Reference and Background. Introduction stands outside those groups. Concepts explain the library through examples. Guides address concrete tasks. Reference describes fields and behavior. Background covers comparisons, measurements and compatibility. There is no separate tutorial section.

## Versions

The site has the working docs and one set of released docs for each major version:

- `content/docs/next` describes the `main` branch. It's served at `/cli/next`, and each page has a banner that links to the released page.
- `content/docs/v6` describes the latest 6.x release. `/cli` redirects to the newest released version.

Every push to `main` deploys both, so the site isn't tied to the release schedule. Write docs for unreleased work in `next`. Fix a mistake in released docs in the version's directory, and in `next` too if it's still there.

`pnpm version` releases the docs with the package. Run it from the repository root:

```sh
pnpm version minor
```

Before it changes the version, it runs `pnpm verify`. After, it runs `pnpm --filter docs release`, which replaces the pages of the current major with the pages in `next`, saves the API model for that release, and points `/cli` at the version. The major comes from the root `package.json`, so the first release of a new major creates its directory. The result goes into the release commit, which is named `Release 6.1.0` and tagged `v6.1.0`.

Pushing the branch deploys the docs, and pushing the tag publishes to npm.

The README in the repository links to the working docs. When the package is packed for npm, `scripts/readme-links.mjs` points those links at the released version, and puts them back afterwards.

## Blog

Posts are in `content/blog`, one `.mdx` file each, and each is served at `/cli/blog/<file name>`. A post's frontmatter needs a `title` and a `date`. Its `description` is optional, and the blog's index shows it under the title. The index lists posts newest first.

Write a post for a release worth explaining, or for anything else readers should know about. A post that covers only a release's highlights links to its GitHub release, which has the full list of changes.

`pnpm --filter docs release` leaves posts as they are, because they don't belong to a version. The site search and `llms.txt` don't include them.

## Generated API reference

Doc comments own the API reference. Edit comments beside public declarations, not files under a `reference` directory.

`pnpm --filter docs reference` renders the reference for every version. The working docs render from `src/index.ts` and `src/testing.ts`. A released version renders from its API model in `api-models`, which holds the signatures, comments, symbol links and reference navigation it was released with.

TypeDoc extracts signatures and comments. Its Markdown plugin renders MDX. `scripts/generate-reference.mjs` adds frontmatter and groups symbols by their role: definitions, execution, help and completion, testing, and utilities. The generated content uses the same search, Markdown endpoints and `llms-full.txt` pipeline as written pages. A new export has to be added to a group in that script to appear in the sidebar.

The generated directories are ignored by Git. The development, build and check commands generate them first. After changing comments during development, rerun the reference command to update the pages. Warnings and conversion errors fail generation.

TypeDoc currently requires TypeScript 6, so the docs workspace uses that version. The library retains its TypeScript 7 compiler. This dependency adds nothing to the published package.

To correct the reference of a released version, check out its tag, fix the comments, and save the model again with `pnpm --filter docs reference:freeze`. Do not replace a version's model with a later version's API. A missing or mismatched model fails the build before it replaces generated output.

To render every version from saved models, the working docs included:

```sh
pnpm --filter docs reference --frozen
```

Models record the TypeDoc version that created them. When upgrading the generation tools, run the isolation checks and inspect the resulting pages:

```sh
pnpm --filter docs reference:check
```

The checks use a temporary project with a released v6 and working docs for a later source. They verify that the two stay separate, that a missing model is an error, and that frozen rendering ignores later source changes. They do not alter this repository's source or API models.

## Writing

Assume readers know TypeScript and use CLIs. Introduce library concepts through concrete definitions and examples. Explain the rules that affect constructing a command. Keep exhaustive field and signature details in the generated reference.

Use behavioral reference tables for interactions that involve several fields. Give task guides a specific outcome. Link between the explanation, guide and reference where the reader needs another kind of information.

Use complete examples when readers need to run the code. Label smaller snippets as definitions or fields rather than asking readers to reconstruct a program from another page.

Benchmark tables are recorded measurements. Preserve their values, hardware and methodology when editing the surrounding prose.
