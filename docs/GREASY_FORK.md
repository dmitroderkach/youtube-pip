# Greasy Fork: automatic update on release

The script on [Greasy Fork](https://greasyfork.org/en/scripts/564173-youtube-pip) updates itself when a GitHub release is published, through Greasy Fork's GitHub webhook. No manual "Sync now".

## How it works

1. `npm run release:tag` pushes the tag `vX.Y.Z`; `.github/workflows/release.yml` builds the userscript.
2. The release is created as a **draft** with the assets `youtube-pip.user.js` and `userscript.js`, then **published** in a separate step (`gh release edit --draft=false --latest`). Publishing only after the assets are attached matters: the `release` webhook fires on publish, and Greasy Fork downloads the asset right away (a release published before its assets are uploaded gives "No scripts found for this release").
3. GitHub sends the `release` event to Greasy Fork; Greasy Fork fetches the script from its sync URL and publishes the new version (the `@version` must be higher than the current one, which the bump flow guarantees).

## One-time setup

On Greasy Fork:

1. Open the script → **Admin** → **Sync**: sync URL `https://github.com/dmitroderkach/youtube-pip/releases/latest/download/youtube-pip.user.js`, sync type **Webhook**. Save.
2. Open your profile → **Webhook** (the link in the "Sync" section, or `https://greasyfork.org/users/webhook-info`): it shows the **Payload URL** and the **Secret** (generate one if there is none).

On GitHub (repository → **Settings** → **Webhooks** → **Add webhook**):

- Payload URL: from step 2
- Content type: `application/json`
- Secret: from step 2 (never commit it)
- Events: **Let me select individual events** → uncheck **Pushes**, check **Releases**
- Active: checked

## Check

After a release: GitHub → Settings → Webhooks → the Greasy Fork hook → **Recent Deliveries** shows the `release` delivery and Greasy Fork's response; the script's page on Greasy Fork shows the new version. A failed delivery can be re-sent there (**Redeliver**).
