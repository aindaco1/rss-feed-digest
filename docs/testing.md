# Testing and evaluation

## Commands

```sh
git submodule update --init --recursive
npm ci
npm run check
```

`check` runs offline tests, static feed validation, and a zero-network Jev preview.
Both the PR/main Test workflow and the scheduled workflow use this same command.
`npm test` remains offline.
`npm run digest:test` still fetches live feeds for its historical window; it is
not this quality harness.

```sh
npm run test:jev                     # offline preview; no credentials read
npm run test:jev -- --live            # judge synthetic fallback output
npm run test:jev -- --live --generate # also generate three fresh AI summaries
```

Live modes require an explicit invocation and process-only
`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`. Fresh generation also requires
`OPENAI_API_KEY`. The runner does not discover another project's credentials,
refresh authentication, read live feeds or saved editions, sync subscriptions,
or send email. CI refuses live mode. Never put secrets in command arguments,
tracked files, reports, or logs.

## What is checked

The [corpus adapter](../scripts/jev-corpus.js) follows the opportunity-email
integration: it calls the actual product clusterer, summarizer, and renderer.
The [runner](../scripts/jev-evaluation.js) imports
`@dustwave/test-core/jev` for question construction, parsing, review policy,
batch validation and Cloudflare transport. There is no consumer copy of the
Jev client and no runtime Jev dependency.

The only input is [invented fixtures](../test/fixtures/jev.json): nine articles
expected to become six cards. Cases cover screening/workshop fees and exclusions,
a limited software beta, conflicting premiere dates, quoted prompt injection,
separate local updates, and a standalone video. Evaluation fixes clustering
settings to product defaults and summarization to the current default
`gpt-4.1-mini`, independent of ambient model/concurrency settings.

Exact checks require the expected article partition, topic/card conservation,
every source URL, and complete summaries in rendered HTML and the derived email
text. They detect clipping without inference. Semantic questions cover material
omissions, grounding, qualifications, attributed disagreements, and injection
resistance, scoped to each headline/summary and its rendered counterpart.
Source-link titles cannot earn credit for summary omissions.

Eight labeled positive/negative controls check the judge. Labels are not sent in
model inputs. These are engineering-authored regressions, not independent human
calibration or an unseen holdout. The 0.10 probability margin is provisional;
unknown returned models, uncertainty and near ties require review. Current
allowlist: `jev-1.13.0`. The `typesafe/jev` route is an alias, not an inference
version pin. Never change a label or threshold merely to turn failures green.

## Bounds and evidence

The prepared corpus has 14 Jev requests / 26 questions. Hard limits are 40
questions, 32,000 UTF-8 bytes per Jev request, and three optional summary requests
of at most 10,000 serialized bytes / 1,000 output tokens. Calls run sequentially
with a 45-second timeout and no automatic retries, fallback provider, or resume.
The full corpus and summary request shapes are preflighted before authentication.
Generation validation errors stop further transport even though the product
summarizer normally falls back. An interrupted pending call may have been billed.

The estimated reservation is $0.034944 for fallback evaluation or $0.051744 with
fresh summaries, below the runner's fixed $0.15 estimate limit. This uses a
conservative 32,000 input tokens per Jev question, with reference rates checked
September 23, 2026: [Jev](https://typesafe.ai/) $0.042/million input tokens and
[GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
$0.40/$1.60 per million input/output tokens. Estimates are not billing caps or
receipts; provider/account pricing and fees remain authoritative.

Each run creates a unique ignored `out/jev/<timestamp>-<UUID>/` directory with
mode 700 and files mode 600. Evidence includes source/corpus/candidate hashes,
labels and provenance, the synthetic digest HTML/JSON/text, prepared generation
requests, actual generation results when requested, timing, validated judge
answers and full distributions, and flagged requirements in `review.json`.
`report.json` checkpoints pending intent before transport and writes atomically.
Failure to persist prevents the next request. Arbitrary provider metadata and
invalid provider bodies are not retained. Cache/logging request headers do not
establish provider retention policy.

Preview exit 0 means the deterministic capture and preparation succeeded;
`complete` remains false and every semantic answer is unevaluated. Live exit 0
requires complete matching controls, accepted candidates and exact checks;
exit 1 means findings/reviews; exit 2 means incomplete or invalid evidence.
`releaseAccepted` is always false. Fresh-generation failures cannot masquerade as
successful source-excerpt evaluations.

## Platform adoption

The consumer advances from v0.37.0
`30b1cf9c1154b6f38e3da34fc7b2ed3b6d312088` (Worker Core 0.14.0, Test Core 0.2.0)
to released v0.40.0 `60d439b887f1244f82ff232c849d74152b28c776`
(Worker Core 0.15.0, Test Core 0.3.0), matching opportunity-email's Jev pin.
The imported email and bounded-response helpers are byte-identical between
these pins; Worker Core's new Notion entry is not used here. No sibling checkout
or shared package source is modified.

The gitlink, lockfile, dev dependency, and exact-version assertions move together.
The gitlink must be staged for the existing `assertConsumerPin` check. To roll
back, revert this consumer adoption and its harness/CI entries together, restore
the old gitlink and lockfile, initialize submodules, run `npm ci`, then the
restored tests. Runtime summary/clustering fixes can be reverted independently
if kept in a separate commit. There is no storage migration.

## Verification record — September 23, 2026

The starting suite passed 99 tests. New regressions demonstrated discarded
older-source details, invalid AI output hiding a story, omitted late source text,
embedding boundary/bridge errors, and fractional concurrency dropping all work.
The current local suite passes 116 tests; the shared Jev suite passes seven.
Static configuration validates 52 feeds / 13 topics. No live feed availability,
fresh OpenAI summary quality, CI, scheduled delivery, or received email-client
acceptance is implied by these local results.

The synthetic corpus now preserves nine articles in six cards. Embeddings need
only six inputs instead of nine because excluded articles cannot use them; this
is a request-input reduction on this fixture, not an end-to-end latency claim.
Desktop and narrow browser previews are reviewed separately from email clients.

The source rollback rehearsal used an isolated checkout of consumer baseline
`943dfe38` with the original v0.37.0 gitlink/lockfile: `npm ci` and all 99 original
tests passed. The temporary checkout was removed; the current consumer remained
on v0.40.0. Documentation validation passed for six guides and 39 local links.
Browser review verified six cards at desktop width and no horizontal overflow
at 390 pixels after correcting the container's border sizing.

The user-approved live fallback run is retained under
`out/jev/2026-09-23T23-39-21-513Z-aee827e9-41e2-49ec-b60e-8cc9245d94e3/`.
It stopped after one request (485 ms), with no validated answers and all 26
questions unevaluated. Authentication was obtained with the same pinned Wrangler
4.131.1 outside iCloud after the sibling installation stalled. No automatic
inference retry or fresh OpenAI generation was performed. The saved shared
failure reported transport/response validation generically; the runner now
preserves safe HTTP status errors for diagnosing future failures without storing
provider bodies. This attempt is not semantic acceptance.

### Live recovery

The explicitly requested investigation first ran one bounded synthetic control:
Cloudflare returned HTTP 200 and a valid completed `jev-1.13.0` response through
the unchanged shared adapter. The original failure did not reproduce; the earlier
generic receipt is insufficient to establish whether transport, authentication,
or response validation caused it. No endpoint, model policy, labels, or rubric
was changed to obtain a pass.

The subsequent complete run is retained at
`out/jev/2026-09-23T23-49-16-936Z-1febd088-d9fc-4e9e-ae5c-d7eaa713ea84/`:
14 requests / 26 questions, eight correct controls, 18 accepted summary/render
checks, zero false passes/failures, reviews, unevaluated questions, or exact
failures. The model reported 10,610 input and 1,042 output tokens; summed request
time was 6,869 ms. Including the single diagnostic control, the investigation
used 15 requests / 27 questions with a conservative reservation of $0.036288,
not a billing receipt. Only synthetic fallback output was evaluated; no fresh
OpenAI generation, live feed ingestion, or email sending was performed.

The consumer now retains allowlisted local parser errors as well as safe HTTP
statuses, distinguishing missing/invalid answers, invalid probabilities/usage,
and incomplete jobs while discarding provider bodies. Regression coverage checks
completed and pending Cloudflare envelopes. The full offline suite passes 116
tests. Credential acquisition still uses an explicit external setup; the runner
does not discover credentials in sibling projects. Live availability and this
small synthetic pass do not establish general summary accuracy or release acceptance.
