# Versioning

The app shows its version and release date under the sign-in card
("Version 1.0.3 · Released Nov 14, 2026") and in Settings › About.

Both are computed when the frontend is built (`vite.config.ts`):

- `package.json` holds the base version, for example `1.0.0`.
- A git tag with the same name, `v1.0.0`, marks the commit that version
  starts from.
- Every commit after that tag adds one to the patch number: the tagged
  commit is 1.0.0, the next one 1.0.1, and so on. Nothing needs editing for
  ordinary updates.
- The release date is the date of the commit being built.

Starting a new minor or major version:

1. Set the new version in `package.json` (`npm version 1.1.0 --no-git-tag-version`).
2. Commit, then tag that commit: `git tag v1.1.0 && git push origin v1.1.0`.

Builds need the git history and tags (a full clone, or `git fetch --tags
--unshallow` in CI). Without them the build falls back to the base version
from `package.json` and the build date. Commit before building and deploying,
so the deployed version matches the code.
