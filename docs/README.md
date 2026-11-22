# Site

## Releasing

`pnpm version` releases the docs with the package. Run it from the repository root:

```sh
pnpm version minor
```

Before it changes the version, it runs `pnpm verify`. After, `pnpm --filter docs release`:

- replaces `content/docs/v<major>` with the pages in `next`,
- renames `content/changelog/unreleased.mdx` to the new version with today's date, and starts an empty one,
- writes `_redirects` for the majors there are.

Write the notes for the next release in `unreleased.mdx` as changes land. The changelog shows them while there are any.

Pushing the branch deploys the site, and pushing the tag publishes to npm.

The README in the repository links to the working docs. When the package is packed for npm, `scripts/readme-links.mjs` points those links at the released version, and puts them back afterwards.
