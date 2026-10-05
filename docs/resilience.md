# Delivery resilience

The Node job collects and enriches the digest. One small Cloudflare Worker with SQLite Durable Objects stores editions and private subscription caches, sends frozen emails, checks provider receipts, and monitors the daily deadline. There is no second generator, queue service, database server, or new Platform package. It reuses the pinned Worker Core response readers, email headers, Resend error classification and outbox retry helpers.

## Failure policy

| Failure | Result |
| --- | --- |
| One or a few ordinary feeds fail | Send useful coverage with a notice naming missing sources. At least half of active feeds must load, and a partial edition must contain articles. |
| Fewer than half load, or a partial edition is empty | Save a diagnostic preview, hold delivery and let the monitor report/retry the edition. |
| All feeds load but publish nothing | Send an explicit no-new-articles edition. |
| Optional subscriptions cannot refresh | Use the last validated private cache, up to seven days old, and show its age. Without a valid cache, omit that source with an explicit notice. |
| Feedbin maintenance fails | Continue with direct RSS and any existing Feedbin subscriptions. |
| AI is missing, slow, or unavailable | Keep headlines and original source links. Three systemic provider errors open a circuit; authentication errors stop new calls immediately. |
| Runner dies after collection | A saved headline/link edition is sent when its 12-minute generation lease expires. |
| Provider response is lost or temporary failure occurs | Retry the same frozen payload and idempotency key from durable storage. |
| Already accepted, permanent error, six failed attempts, or uncertainty older than 23 hours | Never automatically resend. Accepted editions retain a permanent receipt; uncertain editions require reconciliation. |

`ALLOW_PARTIAL_DIGEST_SEND=false` restores strict handling of ordinary feed failures. The explicit `--allow-feed-failures` flag enables partial coverage, but never bypasses the minimum-coverage/empty-partial guard. `YOUTUBE_SYNC_REQUIRED=true` intentionally blocks when enabled YouTube refresh fails, including when cached data exists.

## Deadlines and checkpoints

Generation has a nine-minute budget after the process begins: subscription refreshes are bounded child processes (45 seconds per source; Overcast decryption at most 10 seconds), Feedbin maintenance at most 30 seconds, collection at most three minutes, image hydration 20 seconds, embeddings 30 seconds and summaries four minutes. Enrichment deadlines are capped by the remaining overall budget. SDK retries are disabled; summary retries are explicitly bounded. Body reads stay inside request timeouts and size caps.

After collection, heuristic grouping produces a usable headline/link edition saved both locally and remotely. Optional enrichment may replace it only before any send attempt. The final edition is marked ready and delivered immediately. If the generator stalls, a Durable Object alarm promotes the saved draft after its lease expires. If the runner never collected anything, recovery must still wait for a GitHub runner; a schedule cannot manufacture a missing edition during a full GitHub outage.

A production workflow step has a 12-minute limit and a separate concurrency group with a preserved pending queue. Previews/comparisons cannot evict pending production runs. Local dates define adjacent 7 AM cutoffs, giving 23- or 25-hour windows at DST transitions without gaps or overlaps.

## Frozen editions and recovery

A standard daily edition uses `daily-digest/YYYY-MM-DD`; explicitly supplied standard windows use the same key. Nonstandard windows add a hash of both endpoints. A transaction claims the edition before generation. Before contacting Resend, another transaction records the attempt and retains the complete envelope, its SHA-256 hash, window, first attempt time and a short sending lease. The entire envelope, including recipients, subject, HTML, text, reply-to and headers, is immutable after the first attempt.

A provider ID means accepted, not delivered. An alarm checks Resend after five minutes and then every 30 minutes until a terminal delivery result or seven days. Accepted payloads are removed after seven days; small receipt records remain to prevent duplicates beyond Resend's [24-hour idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys). Unresolved payloads remain for reconciliation. Payloads are private, capped at 1.5 MB (below the [SQLite Durable Object value limit](https://developers.cloudflare.com/durable-objects/platform/limits/)); a larger edition is held rather than truncated.

With `DIGEST_STATE_URL` and `DIGEST_STATE_TOKEN` exported, inspect a daily edition:

```bash
node scripts/delivery-status.js --date 2026-10-05
node scripts/delivery-status.js --date 2026-10-05 --refresh
```

Retry the normal send command with the same window. It either resumes the saved email, reports that another owner is working, or returns the existing acceptance receipt. It does not regenerate an attempted edition. A 409 changed-payload conflict is permanent; a concurrent-request conflict can be retried. Retry-After is respected within the retry window.

For `review`, inspect Resend's email history. If the provider accepted the frozen email, record the verified receipt:

```bash
node scripts/delivery-status.js --date 2026-10-05 --reconcile VERIFIED_PROVIDER_ID
```

Reconciliation fetches that provider email and checks sender, recipients, subject and HTML against the saved envelope. A mismatch or provider lookup failure leaves the hold intact. This command never sends. If no matching acceptance can be established, keep the edition held; a deliberate replacement is an operator decision, not an automatic retry. Never delete the receipt or change the idempotency key to force recovery.

## Independent scheduling and monitoring

The Worker checks every 15 minutes between 7 AM and 10:59 AM Denver time. At 7 AM it dispatches the GitHub generator if needed, while the original GitHub schedule remains a fallback. It checks today and the preceding two days, never before `START_DATE`, with at most three dispatch attempts per edition per day. Existing drafts, active claims, accepted editions and review holds prevent unnecessary dispatches. Durable alarms send ready/checkpointed emails independently of GitHub.

From 7:15 AM, a missing/unaccepted edition produces a deduplicated daily attention email and an error in Worker logs. Bounces, complaints, failures, suppressed mail, missing delivery confirmation and unavailable provider lookups are also reported. Alerts use the same durable sender and are sent only once per day. During a Resend outage, the alert email may also be delayed; Worker error logs remain available. Enable Cloudflare error notifications for this Worker when provisioning it. A single-provider design cannot promise delivery during every provider outage.

7 AM is the generation target, followed by bounded collection/enrichment. It is not a guaranteed exact inbox-arrival time. The independent trigger avoids relying only on GitHub's cron dispatcher, while the checkpoint permits recovery once collection has completed.

## Provisioning and cutover

This change requires the delivery Worker before enabling the updated production workflow. Local tests and `worker:build` do not deploy or send.

1. Run `npm ci && npm run check` on Node 22. Tests run real local workerd/SQLite with intercepted outbound traffic, plus deterministic failure tests.
2. Provision a staging Worker using the same bindings and a separate namespace. Configure `DIGEST_STATE_TOKEN` (a fresh high-entropy secret), `RESEND_API_KEY` (send and email-read access), `DIGEST_FROM_EMAIL`, `DIGEST_TO_EMAIL`, and a fine-grained `GITHUB_DISPATCH_TOKEN` limited to this repository's Actions write permission. Keep these in Worker secrets, not `wrangler.jsonc`. Set `GITHUB_REF` to the branch under review and choose an explicit `START_DATE` for any authorized smoke test. Use a designated test recipient for a live delivery check.
3. The production Worker is `rss-digest-delivery` in `wrangler.jsonc`. Set `START_DATE` to the first edition that this service will own, after checking legacy sends for that date. An empty start date intentionally prevents monitor activation. Set the alert sender/recipient to the existing digest addresses. Deploy only after review and approval.
4. Add `DIGEST_STATE_URL` and the matching `DIGEST_STATE_TOKEN` to GitHub repository secrets. The generator retains `DIGEST_FROM_EMAIL`, `DIGEST_TO_EMAIL` and optional feed/AI credentials; the provider send secret now belongs to the Worker. Existing GitHub `RESEND_API_KEY` is no longer used by this workflow.
5. Merge the reviewed generator/workflow changes, validate Test, then run a hosted `dry_run=true` preview. Verify its coverage and artifacts. A preview does not exercise remote checkpointing or provider acceptance. Run an authorized production send, confirm the saved ID and `deliveryStatus: delivered`, then verify the next independent scheduled check and the 7 AM run.

For rollback, disable the Worker's cron trigger and GitHub's scheduled workflow first. Inspect every in-flight edition and its alarms; disabling cron alone does not cancel alarms. Preserve the Durable Object namespace and receipts. Avoid restoring the old raw sender while a frozen edition is pending. Roll back generator code only after reconciling pending sends, then re-enable one delivery path.

## Verification

`npm run check` builds the Worker without deploying, runs Node tests (including the actual local Worker runtime), validates the feed manifest and runs offline Jev. Failure coverage includes partial/all-feed outages, hanging and oversized bodies, systemic AI failures, expired budgets, DST boundaries, strict YouTube failures, cached subscriptions, concurrent claims/sends, lost responses, immutable retries, retry limits, provider rejection, malformed success, receipt checks, reconciliation, and persisted receipts across runtime restart. No test sends email or calls an inference provider.
