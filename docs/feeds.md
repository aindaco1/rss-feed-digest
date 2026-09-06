# Feeds

For maintaining sources and understanding how articles reach the email. Run commands from the repository root. [All documentation](../README.md#documentation).

## Configuration

[`config/feeds.json`](../config/feeds.json) defines digest settings, topic order, and static feeds. Each feed needs `title`, `feedUrl`, `siteUrl`, `topic`, and `source`; its topic must appear in the configured topic list.

Optional maintenance fields:

| Field | Behavior |
| --- | --- |
| `disabled` | Skips the feed during digest generation, Feedbin subscription sync, and audits. |
| `disabledReason` | Records why a feed is disabled. |
| `feedbinSync` | Opts the feed into [Feedbin subscription sync](subscriptions.md#feedbin). |
| `fallbackImageUrl` | Supplies a default image when an item has none. |
| `preferFeedbinBackfill` | Set to `false` to keep a `source: "feedbin"` feed on direct RSS for backfills. |
| `titleIncludes` | Keeps only items whose title contains the configured text. |
| `excludeCouponPosts` | Drops recurring coupon-code and promo-code commerce posts. |
| `excludeSponsored` | Drops posts with explicit sponsored or affiliate disclosures. |
| `excludeSingleIssues` | Drops GetComics-style single-issue posts with markers such as `#1`. |

## Validation and audits

```bash
npm run validate:feeds
npm run audit:feeds
```

Validation checks static configuration locally. The audit makes network requests to active feeds and reports errors or HTML responses where RSS/Atom was expected. Disabled feeds are skipped. Generated YouTube and podcast feeds returning 404/410 are also skipped under their default availability policy; failures from static feeds remain fatal. See [subscription settings](subscriptions.md) for availability overrides.

## Fetching and backfills

The scheduled workflow uses `FEED_CONCURRENCY=2`, `FEED_FETCH_ATTEMPTS=4`, and `FEED_FETCH_TIMEOUT_MS=30000` to accommodate large feeds and transient throttling. All scheduled defaults are maintained in [`.env.example`](../.env.example).

If Substack blocks `/feed`, the fetcher tries the publication's public `/api/v1/archive` endpoint, then Feedbin's cached entries for the matching subscription when credentials are available. `SUBSTACK_ARCHIVE_LIMIT` controls the archive page size; `FEEDBIN_PER_PAGE` controls Feedbin page size.

For windows ending at least `FEEDBIN_BACKFILL_AFTER_HOURS` ago (default `6`), feeds with `source: "feedbin"` prefer cached entries when Feedbin credentials are configured. This helps recover items missing from short rolling feeds such as GetComics. Set `FEEDBIN_PREFER_FOR_BACKFILLS=false` to use direct RSS for historical windows, or set `preferFeedbinBackfill: false` on an individual feed.

## Filtering and presentation

Feeds with `excludeSponsored: true` drop articles with explicit disclosures in the RSS body. Unless `FETCH_SPONSORED_CHECKS=false`, the digest also checks opted-in article pages for disclosures omitted from RSS summaries.

YouTube Shorts are filtered out. YTS release titles are shortened by removing source tags such as `[YTS.BZ]` while keeping useful release details. The email renderer places the `YouTube`, `Podcasts`, and `Downloads` sections at the bottom. Provider-specific link behavior is documented under [app links](subscriptions.md#app-links).

## Clustering

Clustering first combines exact canonical URL matches, then optionally uses embeddings for high-similarity articles. Its fallback scorer builds a corpus-weighted profile from each article's title, summary, text, and nearby phrase pairs. Terms and phrases that are rarer in the current candidate set carry more weight; low-signal template words are suppressed. Articles merge only when the semantic score is supported by shared signal terms or phrases.

A second comparison pass lets later bridge articles merge earlier related clusters. Larger clusters require compatibility across the cluster so roundup posts do not connect unrelated stories.

`NO_BROAD_CLUSTER_TOPICS` defaults to `Downloads,Sports,Local` to avoid merging release lists and recurring local or sports updates that share generic names or numbers without covering the same story. Clustering thresholds are listed in [`.env.example`](../.env.example); the implementation is in [`clusterArticles.js`](../src/cluster/clusterArticles.js).
