# Operations

For running, sending, and troubleshooting the digest. Run commands from the repository root. [All documentation](../README.md#documentation).

## Environment and sending

Use [`.env.example`](../.env.example) for supported settings and defaults. Scripts read the process environment; they do not automatically load a `.env` file.

Export the following values locally, or add them as repository secrets under **Settings → Secrets and variables → Actions** for scheduled sends:

```bash
export OPENAI_API_KEY=...
export RESEND_API_KEY=...
export DIGEST_FROM_EMAIL="Alonso's Daily Digest <digest@example.com>"
export DIGEST_TO_EMAIL="alonso@example.com"
export FEEDBIN_EMAIL=...
export FEEDBIN_PASSWORD=...
```

Check the send environment, then send:

```bash
npm run check:env
npm run digest:send
```

`check:env` checks whether required values are present; it does not verify provider credentials. It uses the [shared environment contract](../src/config/environment.js). Optional provider credentials are covered in [subscriptions](subscriptions.md).

Dry-run is the default unless `--send` is provided or `SEND_DIGEST=true` is set. An explicit `--dry-run` takes precedence. Dry-runs still fetch feeds and can call OpenAI when a key is available; add `--no-ai --no-embeddings` to disable those calls.

## Windows and CLI options

```bash
npm run digest -- --dry-run --no-ai --no-embeddings
npm run digest:test
node src/digest/runDigest.js --start 2026-05-30T07:00:00 --end 2026-06-01T07:00:00 --dry-run
```

`npm run digest:test` is a live-feed dry-run for the fixed historical window from May 30, 2026 at 7:00 AM through June 1, 2026 at 7:00 AM America/Denver. It is separate from the offline test suite (`npm test`); old items may no longer be available from rolling feeds.

Provide both `--start` and `--end`, or neither. Datetimes without an offset use the timezone in [`config/feeds.json`](../config/feeds.json), currently `America/Denver`. Without explicit dates, the digest uses the 24 hours ending at the most recent configured cutoff, currently 7:00 AM. Historical windows can use [Feedbin backfills](feeds.md#fetching-and-backfills).

## Outputs and failed feeds

Generated files are written to the ignored `out/` directory:

- `digest-YYYY-MM-DD.html`: rendered email.
- `digest-YYYY-MM-DD.json`: window, topics, article and cluster counts, AI-call and AI-failure counts, ordinary feed failures, and separately recorded disabled or unavailable generated feeds. AI failures retain source excerpts rather than removing the story.

The filename date comes from the window's end date. Running another window ending on that date overwrites the same local output files.

Send runs stop before contacting Resend when ordinary feed failures are present. Inspect the JSON artifact and use the [feed audit](feeds.md#validation-and-audits) to investigate. To deliberately send an incomplete digest, set `ALLOW_PARTIAL_DIGEST_SEND=true` or pass `--allow-feed-failures` with `--send`.

## GitHub Actions

[Daily Digest](../.github/workflows/daily-digest.yml) is configured for 7:17 AM America/Denver each day, after the 7:00 AM digest cutoff. Its explicit timezone follows daylight-saving changes. Minute 17 avoids the start-of-hour peak, but scheduled runs can still be delayed or dropped under high load. See [GitHub's scheduling documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Optional repository variables and their defaults live under **Optional scheduled-workflow variables** in [`.env.example`](../.env.example). The [contract tests](../test/environmentContract.test.js) verify that the workflow forwards every supported scheduled variable and uses the documented defaults.

The workflow installs dependencies, runs [offline quality checks](testing.md), prepares enabled subscription sources, and builds the digest. Feedbin sync runs only before sends; enabled Overcast and YouTube sync also run for workflow dry-runs. See [subscriptions](subscriptions.md) for setup and the current YouTube required-sync limitation.

For a manual preview or backfill, open **Actions → Daily Digest → Run workflow** and keep `dry_run` checked. Supply both dates for a custom window, or select `test_window` for the fixed historical window. Unchecking `dry_run` requests a send. Generated HTML and JSON are uploaded as `digest-output` and retained for seven days when available, including after a send is blocked by feed failures.

## Deployment and local upkeep

Production runs from `main` through Daily Digest. Merge a reviewed change with its
immutable Platform gitlink and lockfile, then verify the Test workflow on the
merged revision. Test runs `npm run check` without credentials or inference.
Dispatch Daily Digest on `main` with `dry_run=true` to verify hosted subscription
reads, live feed ingestion, configured AI generation, and output artifacts.
Record the exact commit and workflow result. A successful preview establishes
generation, not Resend acceptance or delivered-email appearance. The next normal
scheduled run uses the published revision; deployment itself does not send mail.

Keep source, docs, synthetic fixtures, lockfiles, installed `node_modules`, the
pinned Platform submodule, and local operator/subscription configuration for
development. Keep representative successful and failed Jev evidence under
ignored `out/jev/`, including provenance and reports needed to explain a failure.
Superseded offline previews and temporary build output are reproducible and can
be moved to local Trash after verification. Keep a compact cleanup/deployment
receipt in ignored `out/release/`; do not commit credentials, real digest bodies,
private subscription exports, or operational logs.

Prune remote-tracking refs, then remove a task branch only after confirming its
tip was merged and it is unused by any worktree. Check remote tips immediately
before deletion so concurrent work is preserved. Retain `main` and any branch
with unmerged work.

## Recovery and duplicate sends

Before retrying a delayed or failed run, inspect its logs and output artifact. Local artifacts show what was generated; confirm the send result separately.

The [email sender](../src/email/sendDigestEmail.js) uses `daily-digest/YYYY-MM-DD` as its Resend idempotency key, based on the window's end date. Different windows ending on the same date therefore share a key. Resend retains keys for 24 hours: an identical retry returns the earlier result, while a changed payload with the same key is rejected. After that retention period, a retry can send again. See [Resend's idempotency rules](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Email delivery defaults

The sender uses Worker Core 0.15.0 at immutable Platform commit `60d439b887f1244f82ff232c849d74152b28c776`. Initialize submodules before `npm ci`; CI does the same. The shared helper adds `Auto-Submitted: auto-generated`. Optional `DIGEST_REPLY_TO_EMAIL` is forwarded from a GitHub repository variable; the authored sender and recipient secrets are unchanged. [Testing](testing.md#platform-adoption) owns the current dependency adoption and rollback record.

A plain-text alternative is derived from the same HTML using the existing HTML utility, preserving text and link destinations. The sender forwards the rendered HTML and subject unchanged. Delivery settings, schedule and idempotency keys are independent of summary evaluation. Deploying source does not trigger a send. Do not retry an already attempted window with changed content under the same key, or manually resend beyond the provider's 24-hour deduplication period without checking history.

Rollback the complete adoption commit and its submodule/lockfile together before the next scheduled run. See the [shared delivery guide](https://github.com/aindaco1/dust-wave-platform/blob/main/docs/email-deliverability.md). Tests use a mocked provider and do not send a live digest.
