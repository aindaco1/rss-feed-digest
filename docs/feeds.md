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

Validation checks static configuration locally. The audit makes network requests to active feeds and reports errors or HTML responses where RSS/Atom was expected. Disabled feeds are skipped. Generated YouTube and podcast feeds returning 404/410 are also skipped under their default availability policy; failures from static feeds are included in the partial-coverage gate and missing-source notice. See [subscription settings](subscriptions.md) for availability overrides.

## Fetching and backfills

The scheduled workflow uses `FEED_CONCURRENCY=2`, `FEED_FETCH_ATTEMPTS=4`, and `FEED_FETCH_TIMEOUT_MS=30000` to accommodate large feeds and transient throttling. Temporary 5xx responses, including Cloudflare 521/522/524, use bounded retries before the existing fallbacks. Collection has an overall three-minute budget. All scheduled defaults are maintained in [`.env.example`](../.env.example).

If Substack blocks `/feed`, the fetcher tries the publication's public `/api/v1/archive` endpoint, then Feedbin's cached entries for the matching subscription when credentials are available. `SUBSTACK_ARCHIVE_LIMIT` controls the archive page size; `FEEDBIN_PER_PAGE` controls Feedbin page size.

For windows ending at least `FEEDBIN_BACKFILL_AFTER_HOURS` ago (default `6`), feeds with `source: "feedbin"` prefer cached entries when Feedbin credentials are configured. This helps recover items missing from short rolling feeds such as GetComics. Set `FEEDBIN_PREFER_FOR_BACKFILLS=false` to use direct RSS for historical windows, or set `preferFeedbinBackfill: false` on an individual feed.

## Filtering and presentation

Feeds with `excludeSponsored: true` drop articles with explicit disclosures in the RSS body. Unless `FETCH_SPONSORED_CHECKS=false`, the digest also checks opted-in article pages for disclosures omitted from RSS summaries.

YouTube Shorts are filtered out. YTS release titles are shortened by removing source tags such as `[YTS.BZ]` while keeping useful release details. The email renderer places the `YouTube`, `Podcasts`, and `Downloads` sections at the bottom. Provider-specific link behavior is documented under [app links](subscriptions.md#app-links).

## Clustering

Clustering first combines exact canonical URL matches, then optionally uses embeddings for high-similarity articles. Its fallback scorer builds a corpus-weighted profile from each article's title, summary, text, and nearby phrase pairs. Terms and phrases that are rarer in the current candidate set carry more weight; low-signal template words are suppressed. Articles merge only when the semantic score is supported by shared signal terms or phrases.

Shared-term counts include distinct terms only; a derived phrase does not count as another independent term. Low-signal words use the same normalization as article tokens. Sparse cross-source matches also require a shared phrase involving a title and the other article's lead. This preserves closely related roundups while rejecting generic overlaps such as “old school” and announcement templates.

A second comparison pass lets later bridge articles merge earlier related clusters. Larger clusters require compatibility across the cluster so roundup posts do not connect unrelated stories.

Embedding matches obey the same excluded-topic, standalone-video, and commerce/news boundaries. A vector match must meet the similarity threshold for every member of the candidate cluster; one highly similar roundup cannot connect unrelated stories. Embedding requests skip articles excluded from broad clustering and map responses by their explicit input index. Missing, invalid, or inconsistent vectors trigger the existing heuristic fallback.

`NO_BROAD_CLUSTER_TOPICS` defaults to `Downloads,Sports,Local` to avoid merging release lists and recurring local or sports updates that share generic names or numbers without covering the same story. Clustering thresholds are listed in [`.env.example`](../.env.example); the implementation is in [`clusterArticles.js`](../src/cluster/clusterArticles.js).

## Summary coverage

AI summaries receive each normalized source's summary and body (normalization retains up to 6,000 body characters). Publisher-supplied summaries take precedence over body snippets. Atom XHTML is converted to equivalent escaped HTML before parsing so linked words remain in sentence order.

Single articles and combined cards both use AI by default. `AI_MAX_CLUSTERS=0` covers the whole edition; a positive integer deliberately limits how many cards get attempts. `AI_SUMMARIZE_SINGLE_ARTICLES=false` remains an explicit opt-out. These settings are aligned in the workflow and environment example.

Single-article cards preserve the source title after feed normalization, including the existing YTS title cleanup. AI generates their body summary but cannot replace or shorten their headline. Only cards combining multiple articles use an AI-generated headline.

The summarizer requests 2–4 concise sentences in one paragraph of at most 100 words. A standalone feed teaser with at most 60 supplied words gets one short sentence and a stricter 35-word limit, to avoid padding sparse material. Jokes and figurative comparisons must not become literal claims. It prioritizes the main development and essential qualifications, costs, exclusions, attributed disagreements and uncertainty. Paragraph and word limits are validated before rendering. Invalid output or a failed request gets one retry, with a 45-second timeout per attempt and no additional SDK retries. Generated text is never clipped to satisfy the limit.

After both attempts fail, the card retains its headline and every source link, with no summary or copied excerpt. Disabled AI, explicit limits and oversized inputs (over 64,000 UTF-8 payload bytes) also produce headline-only cards. Each card records `summaryKind` and `summaryReason`; aggregate `summaryCounts` distinguishes generated summaries, errors, disabled AI, disabled singles and capacity limits. `aiCalls` counts actual requests, `aiRetries` counts second attempts, and `aiFailures` counts cards that could not be summarized, including oversized inputs.

This contract summarizes available feed content, not necessarily the complete web article. It cannot recover missing feed details or guarantee semantic accuracy. See [quality checks](testing.md).
