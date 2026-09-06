# Subscriptions

For connecting Feedbin, YouTube, and Overcast. Run commands from the repository root with the [environment configured](operations.md#environment-and-sending). [All documentation](../README.md#documentation).

## Feedbin

Before send runs, the workflow runs `npm run feedbin:sync` to create missing subscriptions for active Substack feeds, titles in the comma-separated `FEEDBIN_SYNC_EXTRA_TITLES` list (default `Joblo`), and feeds with `feedbinSync: true`. It uses `FEEDBIN_EMAIL` and `FEEDBIN_PASSWORD`. Set `FEEDBIN_SYNC_SUBSCRIPTIONS=false` to disable the workflow step.

To sync manually:

```bash
npm run feedbin:sync
```

This command can add subscriptions to the Feedbin account. Sync retries use `FEEDBIN_SYNC_ATTEMPTS` and `FEEDBIN_SYNC_TIMEOUT_MS`, falling back to `FEED_FETCH_ATTEMPTS` and `FEED_FETCH_TIMEOUT_MS` when the sync-specific values are absent. The workflow supplies dedicated sync values using the defaults documented in [`.env.example`](../.env.example).

## YouTube

YouTube subscription sync uses Google OAuth with the read-only `https://www.googleapis.com/auth/youtube.readonly` scope, without a YouTube username or password.

### Authorization

```bash
export YOUTUBE_CLIENT_ID=...
export YOUTUBE_CLIENT_SECRET=...
npm run youtube:authorize
```

If the OAuth app is in Testing mode, add your Google account as a test user in the Google Auth Platform audience settings. External apps in Testing receive refresh tokens that expire after seven days for scopes such as YouTube read access. For scheduled use, move the app to Production when appropriate; see [Google's refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

Open the printed URL and approve access. Add the printed refresh token as the `YOUTUBE_REFRESH_TOKEN` repository secret, along with `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. Enable the repository variable `YOUTUBE_SYNC_SUBSCRIPTIONS=true`.

To test locally after authorization:

```bash
export YOUTUBE_REFRESH_TOKEN=...
npm run youtube:sync
npm run digest -- --dry-run --no-ai --no-embeddings
```

### Settings and recovery

Sync writes the ignored `config/youtube-subscriptions.json`, which the digest loads automatically when present. `YOUTUBE_TOPIC` selects the topic (default `YouTube`), and `YOUTUBE_MAX_SUBSCRIPTIONS` caps synced channels (`0` means no cap). `YOUTUBE_SKIP_UNAVAILABLE` defaults to `true`, skipping channel RSS feeds that return 404/410.

YouTube sync is optional by default: a failed OAuth refresh produces a workflow warning and generation continues without refreshed channel feeds. If the log reports `YouTube token refresh failed: Token has been expired or revoked.`, rerun `npm run youtube:authorize` and replace the `YOUTUBE_REFRESH_TOKEN` secret.

**Current workflow limitation:** `YOUTUBE_SYNC_REQUIRED=true` makes the send preflight require OAuth credentials, but does not reliably stop the workflow after a sync failure. The [sync step](../.github/workflows/daily-digest.yml) captures `$?` after the `if` statement, which has already replaced the failing command's status with `0`. Correcting that status handling is needed before relying on required sync to block a send.

## Overcast

Overcast sync reads an OPML export without storing an Overcast username or password. A subscriptions-only export is enough; an all-data export can also preserve episode metadata.

### Export and local use

1. Sign in at [Overcast account](https://overcast.fm/account).
2. Export subscriptions as OPML, or use the all-data export for the encrypted workflow below.
3. Save the export outside the repository, or under `config/` where raw OPML files are ignored.

```bash
export OVERCAST_OPML_PATH=/path/to/overcast.opml
npm run overcast:sync
npm run digest -- --dry-run --no-ai --no-embeddings
```

The sync reads `OVERCAST_OPML_PATH`, then `OVERCAST_OPML_BASE64`, then raw `OVERCAST_OPML`, in that priority order. It writes the ignored `config/podcast-subscriptions.json`, which the digest loads automatically when present.

`OVERCAST_TOPIC` selects the topic (default `Podcasts`), and `OVERCAST_MAX_SUBSCRIPTIONS` caps synced podcasts (`0` means no cap). `OVERCAST_MAX_EPISODES_PER_FEED` caps stored episode links from all-data exports; its default `0` keeps all links. `OVERCAST_SKIP_UNAVAILABLE` defaults to `true`, skipping feed URLs that return 404/410.

### GitHub Actions setup

For a subscriptions export, encode it and save the result as a secret. This example uses macOS `base64` and the authenticated GitHub CLI:

```bash
base64 -i /path/to/overcast.opml -o /path/to/overcast.opml.b64
gh secret set OVERCAST_OPML_BASE64 < /path/to/overcast.opml.b64
gh variable set OVERCAST_SYNC_SUBSCRIPTIONS --body true
```

For large all-data exports, encrypt the file and commit only the ciphertext. This also requires GnuPG:

```bash
passphrase="$(openssl rand -base64 32)"

gpg --batch --yes --pinentry-mode loopback \
  --passphrase "${passphrase}" \
  --symmetric --cipher-algo AES256 \
  --output config/overcast-all-data.opml.gpg \
  /path/to/overcast-all-data.opml

gh secret set OVERCAST_OPML_GPG_PASSPHRASE --body "${passphrase}"
gh variable set OVERCAST_SYNC_SUBSCRIPTIONS --body true
git add config/overcast-all-data.opml.gpg
```

When the encrypted file exists and Overcast sync is enabled, the workflow requires `OVERCAST_OPML_GPG_PASSPHRASE`, decrypts into the runner's temporary directory, and sets `OVERCAST_OPML_PATH` before syncing. An existing encrypted file takes precedence over OPML secrets. Set `OVERCAST_OPML_ENCRYPTED_PATH` if the encrypted file lives elsewhere.

Do not commit raw `.opml` or `.opml.b64` files. The repository ignores these under `config/`; exports placed at the root are not covered by those patterns.

## App links

Podcast cards use the episode or article URL from the feed. The renderer does not use Overcast subscribe links or episode-level `overcastUrl` values as special app links.

YouTube cards retain normal web links. Setting `VIDEO_LITE_URL_TEMPLATE` adds an app link using `{url}`, `{encodedUrl}`, and `{videoId}` placeholders, for example `someapp://open?url={encodedUrl}`. That example is a placeholder: configure the template only after confirming a working scheme on the target app.
