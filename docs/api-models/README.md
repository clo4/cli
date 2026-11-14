# Frozen API models

These JSON files preserve API signatures, doc comments and reference navigation for released major versions. Generated pages remain ignored by Git.

Run `pnpm --filter docs reference:freeze` to update the model for the root package's current major version. Freeze before changing that major version. Normal builds use source for the active major version and these models for older versions.

Read [the documentation workflow](../README.md#versioned-reference) before changing an archived model.
