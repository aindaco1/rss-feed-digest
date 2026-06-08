# RSS Feed Digest

Daily RSS digest generator for Alonso's feeds. It fetches Feedbin/Substack RSS feeds, dedupes and clusters overlapping articles, optionally uses OpenAI to merge clustered coverage, renders an HTML email, and sends it with Resend.

## Local Commands

```bash
npm install
npm run validate:feeds
npm test
npm run digest:test
```

`npm run digest:test` uses the requested test window: 7:00 AM America/Denver on 2026-05-30 through 7:00 AM America/Denver on 2026-06-01.

Generated files are written to `out/`:

- `digest-YYYY-MM-DD.html`
- `digest-YYYY-MM-DD.json`

## Sending

Set these secrets locally or in GitHub Actions:

```bash
OPENAI_API_KEY=...
RESEND_API_KEY=...
DIGEST_FROM_EMAIL="Alonso's Daily Digest <digest@example.com>"
DIGEST_TO_EMAIL="alonso@example.com"
```

Then run:

```bash
npm run check:env
npm run digest:send
```

Dry-run is the default unless `--send` is provided or `SEND_DIGEST=true` is set.

## Useful CLI Flags

```bash
node src/digest/runDigest.js --test-window --dry-run
node src/digest/runDigest.js --start 2026-05-30T07:00:00 --end 2026-06-01T07:00:00 --dry-run
node src/digest/runDigest.js --send
node src/digest/runDigest.js --dry-run --no-ai --no-embeddings
```

Datetimes without an offset are interpreted in `America/Denver`.

## GitHub Actions

`.github/workflows/daily-digest.yml` runs every day at 7:00 AM America/Denver and also supports manual dispatch for backfills and dry-runs.

GitHub Actions schedules are UTC-only, so the workflow has two cron triggers:

- `13:00 UTC` for 7:00 AM during daylight time
- `14:00 UTC` for 7:00 AM during standard time

The first workflow step checks the current `America/Denver` UTC offset and skips the non-matching run, so only one email is sent each morning.

Before enabling the scheduled send, add these under **Settings → Secrets and variables → Actions**.

Required repository secrets:

- `OPENAI_API_KEY`
- `RESEND_API_KEY`
- `DIGEST_FROM_EMAIL`
- `DIGEST_TO_EMAIL`
- `FEEDBIN_EMAIL`
- `FEEDBIN_PASSWORD`

Optional YouTube subscription sync secrets:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

Optional Overcast podcast sync secrets:

- `OVERCAST_OPML_BASE64`
- `OVERCAST_OPML`
- `OVERCAST_OPML_GPG_PASSPHRASE`

Optional repository variables:

- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `FEED_CONCURRENCY`
- `FEED_FETCH_ATTEMPTS`
- `FEEDBIN_PER_PAGE`
- `FEEDBIN_SYNC_SUBSCRIPTIONS`
- `FEEDBIN_SYNC_EXTRA_TITLES`
- `FEEDBIN_PREFER_FOR_BACKFILLS`
- `FEEDBIN_BACKFILL_AFTER_HOURS`
- `OVERCAST_SYNC_SUBSCRIPTIONS`
- `OVERCAST_TOPIC`
- `OVERCAST_MAX_SUBSCRIPTIONS`
- `OVERCAST_MAX_EPISODES_PER_FEED`
- `OVERCAST_OPML_ENCRYPTED_PATH`
- `OVERCAST_SKIP_UNAVAILABLE`
- `OVERCAST_CHECK_CONCURRENCY`
- `YOUTUBE_SYNC_SUBSCRIPTIONS`
- `YOUTUBE_TOPIC`
- `YOUTUBE_MAX_SUBSCRIPTIONS`
- `VIDEO_LITE_URL_TEMPLATE`
- `SUBSTACK_ARCHIVE_LIMIT`
- `ALLOW_PARTIAL_DIGEST_SEND`
- `USE_EMBEDDINGS`
- `FETCH_OG_IMAGES`
- `FETCH_SPONSORED_CHECKS`
- `SPONSORED_CHECK_CONCURRENCY`
- `CLUSTER_THRESHOLD`
- `EMBEDDING_CLUSTER_THRESHOLD`
- `CLUSTER_CROSS_SOURCE_STRONG_SEMANTIC_THRESHOLD`
- `CLUSTER_CROSS_SOURCE_SEMANTIC_THRESHOLD`
- `CLUSTER_CROSS_SOURCE_PHRASE_SEMANTIC_THRESHOLD`
- `CLUSTER_CROSS_SOURCE_SPARSE_SEMANTIC_THRESHOLD`
- `CLUSTER_SAME_SOURCE_STRONG_SEMANTIC_THRESHOLD`
- `CLUSTER_SAME_SOURCE_SEMANTIC_THRESHOLD`
- `CLUSTER_SAME_SOURCE_PHRASE_SEMANTIC_THRESHOLD`
- `CLUSTER_SAME_SOURCE_LEAD_PHRASE_SEMANTIC_THRESHOLD`
- `CLUSTER_MIN_SHARED_SIGNALS`
- `CLUSTER_MIN_SHARED_PHRASES`
- `CLUSTER_MIN_SHARED_STRONG_PHRASES`
- `NO_BROAD_CLUSTER_TOPICS`

The workflow defaults `FEED_CONCURRENCY` to `2` and `FEED_FETCH_ATTEMPTS` to `4` to reduce 403s from feeds that throttle GitHub-hosted runners.
If Substack blocks `/feed` on GitHub runners, the fetcher falls back to the publication's public `/api/v1/archive` endpoint, then to Feedbin's cached entries for the matching subscription. `SUBSTACK_ARCHIVE_LIMIT` defaults to `30`; `FEEDBIN_PER_PAGE` defaults to `100`.
Before send runs, the workflow runs `npm run feedbin:sync` so Feedbin has subscriptions for Substack feeds and JoBlo. Set `FEEDBIN_SYNC_SUBSCRIPTIONS=false` to disable that. `FEEDBIN_SYNC_EXTRA_TITLES` defaults to `Joblo` and can be a comma-separated list.
If `OVERCAST_SYNC_SUBSCRIPTIONS=true`, the workflow runs `npm run overcast:sync` before building the digest. This reads an Overcast OPML export from `OVERCAST_OPML_BASE64`, `OVERCAST_OPML`, `OVERCAST_OPML_PATH`, or an encrypted OPML file, writes an ignored `config/podcast-subscriptions.json`, and the digest loads those generated podcast feeds under the `Podcasts` topic by default. Set `OVERCAST_TOPIC` to route them to another topic, `OVERCAST_MAX_SUBSCRIPTIONS` to cap the number of synced podcasts, or `OVERCAST_MAX_EPISODES_PER_FEED` to a positive number to cap stored episode links from an Overcast all-data export. `OVERCAST_MAX_EPISODES_PER_FEED` defaults to `0`, which keeps all episode links. `OVERCAST_SKIP_UNAVAILABLE` defaults to `true` and drops OPML entries whose feed URL returns 404 or 410.
If `YOUTUBE_SYNC_SUBSCRIPTIONS=true`, the workflow runs `npm run youtube:sync` before building the digest. This fetches the authenticated account's YouTube subscriptions, writes an ignored `config/youtube-subscriptions.json`, and the digest loads those generated channel feeds under the `YouTube` topic by default. Set `YOUTUBE_TOPIC` to route them to another topic, or `YOUTUBE_MAX_SUBSCRIPTIONS` to cap the number of synced channels. YouTube Shorts are filtered out of the digest.
The email renderer always moves the `YouTube`, `Podcasts`, and `Downloads` sections to the bottom of the email.
Manual backfills and older dry-runs prefer Feedbin cached entries for feeds with `source: "feedbin"` when Feedbin credentials are configured. This avoids losing items from short rolling public feeds such as GetComics. `FEEDBIN_BACKFILL_AFTER_HOURS` defaults to `6`; set `FEEDBIN_PREFER_FOR_BACKFILLS=false` to force direct RSS fetches for historical windows.
Scheduled sends fail before Resend if any feeds fail. Set `ALLOW_PARTIAL_DIGEST_SEND=true` only if you want to send incomplete digests.

Clustering first combines exact canonical URL matches, then optionally uses embeddings for high-similarity cross-source articles. The fallback scorer builds a corpus-weighted content profile for each article in the digest run from the title, summary, article text, and nearby phrase pairs. Terms and phrases that are rarer in that day's candidate set carry more weight, while low-signal template words are suppressed. Articles merge only when the weighted semantic score is supported by shared signal terms or phrases. After the first pass, clusters are compared again so later bridge articles can still merge earlier related items; larger clusters require compatibility across the cluster so roundup posts do not bridge unrelated stories. `NO_BROAD_CLUSTER_TOPICS` defaults to `Downloads,Sports,Local` to avoid merging release-list feeds and recurring local/sports updates that often share generic titles, teams, places, years, or issue numbers without covering the same story.

Feeds with `excludeSponsored: true` drop articles with explicit sponsored/affiliate disclosures in the RSS body. When `FETCH_SPONSORED_CHECKS` is not `false`, the digest also checks each opted-in article page so disclosures omitted from RSS summaries can still be filtered.

To test the automation without sending, run the workflow manually and keep `dry_run` checked. The generated HTML and JSON are uploaded as the `digest-output` workflow artifact.

## Feed Maintenance

```bash
npm run audit:feeds
```

This performs a network check of each active feed and reports sources that are returning errors or HTML instead of RSS/Atom.

Feed entries in `config/feeds.json` support these optional maintenance fields:

- `disabled`: keeps a feed documented while skipping digest generation, subscription sync, and feed audits.
- `disabledReason`: records why a disabled feed is being skipped.
- `feedbinSync`: opts a feed into the Feedbin subscription sync job.
- `fallbackImageUrl`: supplies a default image when a feed item has none.
- `preferFeedbinBackfill`: set to `false` to keep a `source: "feedbin"` feed on direct RSS fetches for manual backfills.
- `titleIncludes`: keeps only items whose title contains the configured text.
- YTS release titles are shortened for display by dropping source tags such as `[YTS.BZ]` and keeping useful release details.
- `excludeSponsored`: drops explicit sponsored or affiliate posts, including page-level disclosures when sponsored checks are enabled.
- `excludeSingleIssues`: drops GetComics-style single-issue posts with issue-number markers such as `#1`.

## YouTube Subscriptions

Do not use a YouTube username or password. YouTube subscriptions are synced through Google OAuth with the read-only `https://www.googleapis.com/auth/youtube.readonly` scope.

One-time local setup:

```bash
export YOUTUBE_CLIENT_ID=...
export YOUTUBE_CLIENT_SECRET=...
npm run youtube:authorize
```

If the OAuth app is in Testing mode, add your Google account under Google Cloud Console → Google Auth Platform → Audience → Test users before opening the authorization URL.

Open the printed URL, approve access, then add the printed value as the `YOUTUBE_REFRESH_TOKEN` repository secret. Add `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` as repository secrets too, then set the repository variable `YOUTUBE_SYNC_SUBSCRIPTIONS=true`.

To test locally after authorization:

```bash
export YOUTUBE_REFRESH_TOKEN=...
npm run youtube:sync
npm run digest -- --dry-run --no-ai --no-embeddings
```

The generated file is `config/youtube-subscriptions.json`; it is ignored by git.

Podcast cards use the normal episode or article link from the feed. The digest does not render Overcast subscribe links or Overcast web links because Overcast only documents a subscribe-prompt URL scheme, not a reliable episode-open scheme. YouTube cards keep their normal web links unless `VIDEO_LITE_URL_TEMPLATE` is set. The template supports `{url}`, `{encodedUrl}`, and `{videoId}` placeholders, for example `someapp://open?url={encodedUrl}`. Video Lite does not publish a URL scheme in its public docs, so do not set this until you have a confirmed working scheme.

## Overcast Podcasts

Overcast podcast subscriptions are synced from an OPML export. The workflow does not store an Overcast username or password. A subscriptions-only OPML export is enough for feed syncing; all-data exports can still be used, but episode-level `overcastUrl` values are not rendered as special links unless a reliable episode-open app scheme becomes available.

Export OPML from Overcast:

1. Sign in at `https://overcast.fm/account`.
2. Use the OPML subscriptions export for feed syncing, or the all-data export if you want to keep using the encrypted export workflow.
3. Save the export as `overcast.opml`.

Local test:

```bash
export OVERCAST_OPML_PATH=/path/to/overcast.opml
npm run overcast:sync
npm run digest -- --dry-run --no-ai --no-embeddings
```

GitHub Actions setup:

```bash
base64 -i overcast.opml -o overcast.opml.b64
gh secret set OVERCAST_OPML_BASE64 < overcast.opml.b64
gh variable set OVERCAST_SYNC_SUBSCRIPTIONS --body true
```

All-data OPML exports are often too large for GitHub's normal secret size limit. For large exports, encrypt the file and commit only the encrypted ciphertext:

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

Do not commit the raw `.opml` or `.opml.b64` file. The workflow decrypts `config/overcast-all-data.opml.gpg` into the runner temp directory and sets `OVERCAST_OPML_PATH` before `npm run overcast:sync`. Set `OVERCAST_OPML_ENCRYPTED_PATH` only if you commit the encrypted file somewhere else.

The generated file is `config/podcast-subscriptions.json`; it is ignored by git.
