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
- `fallbackImageUrl`: supplies a default image when a feed item has none.
- `titleIncludes`: keeps only items whose title contains the configured text.
- YTS release titles are shortened for display by dropping source tags such as `[YTS.BZ]` and keeping useful release details.
- `excludeSponsored`: drops explicit sponsored or affiliate posts, including page-level disclosures when sponsored checks are enabled.
- `excludeSingleIssues`: drops GetComics-style single-issue posts with issue-number markers such as `#1`.
