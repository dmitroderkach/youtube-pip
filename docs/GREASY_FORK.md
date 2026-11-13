# Greasy Fork: automatic update on release

The script on [Greasy Fork](https://greasyfork.org/en/scripts/564173-youtube-pip) updates itself when a release reaches the protected branch `release`, through Greasy Fork's GitHub webhook. No manual "Sync now".

Production is the file `youtube-pip.user.js` on the branch `release` (`https://raw.githubusercontent.com/dmitroderkach/youtube-pip/release/youtube-pip.user.js`): Greasy Fork syncs from it, and the `@updateURL` / `@downloadURL` of installed scripts point to it. Only the gate GitHub App (after the owner's ✅, `dev-ops release`, docs/DEV_WORKER.md) and the owner may update that branch (ruleset). GitHub releases stay the download page and the changelog; a release made by anyone else (e.g. on a pre-release tag, marked latest) reaches nobody.

## How it works

1. The tag `vX.Y.Z` is created (by the gate App on the owner's ✅: `dev-ops release`; or by the owner, `npm run release:tag`); `.github/workflows/release.yml` builds the userscript.
2. The release is created as a **draft** with the assets `youtube-pip.user.js` and `userscript.js`, then **published** in a separate step (`gh release edit --draft=false --latest`). Publishing only after the assets are attached matters: the `release` webhook fires on publish, and Greasy Fork downloads the asset right away (a release published before its assets are uploaded gives "No scripts found for this release").
3. github-gate waits for that release, checks it was made by GitHub Actions (the release and its `youtube-pip.user.js` asset) with the right `@version`, and commits the file to the branch `release`. A release tagged by the owner by hand is not copied: the owner updates `release` themselves (or uses `dev-ops release`).
4. GitHub sends the `push` event of `release` to Greasy Fork; Greasy Fork fetches the script from its sync URL and publishes the new version (the `@version` must be higher than the current one, which the bump flow guarantees).

Until every installed script has taken a release with the new `@updateURL` (published from 2026-11), the old URL `releases/latest/download/youtube-pip.user.js` still matters for them: release.yml keeps publishing the GitHub release as latest.

Pre-releases (`vX.Y.Z-rc.N`, [PRERELEASE.md](PRERELEASE.md)) never touch the branch `release`, so neither Greasy Fork nor installed scripts see them.

## One-time setup

On Greasy Fork:

1. Open the script → **Admin** → **Source Syncing**: "This script's code is set up to sync from" `https://raw.githubusercontent.com/dmitroderkach/youtube-pip/release/youtube-pip.user.js`, "The script will be synced" **Automatic** (a daily check, the fallback if a webhook delivery is lost). There is no separate webhook sync type: a webhook delivery syncs every script with a matching sync URL.
2. Follow the link **set up a webhook** in the same section (`https://greasyfork.org/users/webhook-info`): it shows the **Payload URL** and the **Secret** (generate one if there is none).

On GitHub (repository → **Settings** → **Webhooks** → **Add webhook**):

- Payload URL: from step 2
- Content type: `application/json`
- Secret: from step 2 (never commit it)
- Events: **Let me select individual events** → check **Pushes** (the `release` branch; pushes to other branches change nothing on Greasy Fork, whose sync URL is on `release`)
- Active: checked

## Check

After a release: GitHub → Settings → Webhooks → the Greasy Fork hook → **Recent Deliveries** shows the `push` delivery of `release` and Greasy Fork's response; the script's page on Greasy Fork shows the new version. A failed delivery can be re-sent there (**Redeliver**).
