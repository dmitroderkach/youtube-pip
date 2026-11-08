# Pre-release: test the userscript before the release

A pre-release is a test build of a release branch published on GitHub, so the owner can install it in their own browser and check it before the release, also when the release is prepared by the dev worker ([DEV_WORKER.md](DEV_WORKER.md)) and there is no local build.

## How it works

1. The release branch `release/X.Y.Z` is ready (bump version flow, PR open, checks green).
2. `gh workflow run prerelease.yml --ref release/X.Y.Z` runs `.github/workflows/prerelease.yml` (GitHub-hosted runner, build only, no e2e):
   - takes `X.Y.Z` from `package.json` (fails if `vX.Y.Z` is already released: bump first);
   - picks `N` = the next free number among the tags `vX.Y.Z-rc.*`;
   - builds the userscript with `@version X.Y.Z-rc.N` (the version only changes inside the job);
   - publishes the GitHub **pre-release** `vX.Y.Z-rc.N` on the branch's commit with `youtube-pip.user.js` and `userscript.js`, the CHANGELOG section of `X.Y.Z` and the link to the PR.
3. The owner opens `https://github.com/dmitroderkach/youtube-pip/releases/download/vX.Y.Z-rc.N/youtube-pip.user.js` with Tampermonkey and confirms the update. Any new commit on the branch → run the workflow again → `rc.N+1`.
4. After the owner's "так": merge, `npm run release:tag`; `release.yml` publishes `vX.Y.Z` and deletes the pre-releases `vX.Y.Z-rc.*` with their tags.

## Why it does not reach users

- A pre-release is never the **latest** release. Greasy Fork syncs from `releases/latest/download/youtube-pip.user.js` and the `@updateURL` / `@downloadURL` of installed scripts point there too, so both keep getting the last stable release.
- Publishing a pre-release still sends the `release` webhook to Greasy Fork ([GREASY_FORK.md](GREASY_FORK.md)); Greasy Fork fetches the latest release, finds the same version and changes nothing.
- `release.yml` ignores tags with a hyphen (`!v*-*`), so a pre-release tag never starts a release. Tags created by the workflow token do not trigger workflows anyway.

## Versions in Tampermonkey

`X.Y.Z-rc.N` is lower than `X.Y.Z` and higher than the previous release (Mozilla toolkit version format: a part with a string suffix, `Z-rc`, is lower than the plain number `Z`). An installed pre-release keeps the same `@name` / `@namespace`, so it replaces the installed script instead of running next to it, and the stable `X.Y.Z` updates it back through `@updateURL`. If the update check does not pick it up, install the stable release from its release page.
