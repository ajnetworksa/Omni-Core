---
description: Cut a release (version bump, changelog, full verify, tag) — the GitHub workflow publishes it
---

1. `git status` must be clean except the release changes; `git pull` first.
2. Pick the version (semver): bug fixes → patch, new features → minor.
3. Update `version` in the root `package.json`.
4. Add a `## [X.Y.Z] — YYYY-MM-DD · title` section at the top of `CHANGELOG.md`: a short
   "In short" paragraph, then Highlights / Fixed / Upgrading notes. The release workflow posts
   exactly this section as the GitHub Release notes.
5. Run `npm run verify:full` (or `npm run verify -- --docker` if Playwright isn't installed).
   Everything must PASS. Paste the table.
6. Show the user the commands to run (don't push without their OK):
   `git add -A && git commit -m "OmniCore X.Y.Z: …" && git tag vX.Y.Z && git push && git push --tags`
7. After they push: the Actions tab runs CI and creates the release.
