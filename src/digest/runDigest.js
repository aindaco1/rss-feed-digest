import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/loadConfig.js";
import { fetchArticles, hydrateMissingImages } from "../feeds/fetchFeeds.js";
import { prepareSubscriptions } from "../feeds/prepareSubscriptions.js";
import { clusterArticles } from "../cluster/clusterArticles.js";
import { embedArticles } from "../ai/embeddings.js";
import { summarizeClusters } from "../ai/summarizeClusters.js";
import { renderDigestEmail } from "../email/renderDigestEmail.js";
import { buildDigestEmail } from "../email/sendDigestEmail.js";
import { parseArgs, hasFlag, hasNegativeFlag } from "../util/args.js";
import { resolveDigestWindow } from "../util/dates.js";
import { isDirectRun } from "../util/modules.js";
import { assessCoverage } from "./coverage.js";
import { createStateClient, editionKey } from "./stateClient.js";

export async function runDigest(args = parseArgs(), options = {}) {
  const env = options.env || process.env;
  let config = options.config || loadConfig(undefined, { generatedFeedPaths: [] });
  const window = resolveDigestWindow(args, config.digest, options.now);
  const outDir = options.outDir || new URL("../../out/", import.meta.url);
  const dryRun = hasFlag(args, "dry-run") || (!hasFlag(args, "send") && env.SEND_DIGEST !== "true");
  const state = dryRun ? null : options.state || createStateClient(env);
  const key = editionKey(window, config.digest);
  const owner = randomUUID();
  const windowRecord = { start: window.start.toISOString(), end: window.end.toISOString(), timezone: window.timezone, dateLabel: window.dateLabel };
  const deadline = Date.now() + 9 * 60_000;
  const stageDeadline = ms => Math.min(deadline, Date.now() + ms);
  console.log(`Digest window: ${window.startLabel} -> ${window.endLabel}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "send"}`);
  if (state) {
    const claim = await state(key, "claim", { key, owner, window: windowRecord });
    if (!claim.acquired) {
      const current = claim.resume ? await state(key, "deliver", {}) : claim.state;
      console.log(`Existing edition: ${current.status}${current.providerId ? ` (${current.providerId})` : ""}.`);
      if (["review", "retry"].includes(current.status)) throw new Error("Edition awaiting delivery recovery or reconciliation");
      return current;
    }
  }

  const { notices, generatedFeedPaths } = options.config ? { notices: [], generatedFeedPaths: [] } : await prepareSubscriptions({ env, state, maintenance: !dryRun });
  if (!options.config) config = loadConfig(undefined, { generatedFeedPaths });
  const { articles, failures, skippedFeeds, successfulFeeds, activeFeedCount } = await fetchArticles(config, window, { env, deadline: stageDeadline(180_000), fetchImpl: options.fetchImpl });
  console.log(`Fetched ${articles.length} articles; ${successfulFeeds}/${activeFeedCount} feeds loaded; ${failures.length} failures.`);
  for (const failure of failures) console.warn(`- ${failure.title}: ${failure.message}`);
  const unavailable = skippedFeeds.filter(feed => feed.skipReason);
  if (unavailable.length) notices.push(`Unavailable subscription feeds skipped: ${unavailable.map(feed => feed.title).join(", ")}.`);
  const coverage = assessCoverage({ successfulFeeds, activeFeedCount, failures, articles, notices, allowPartial: hasFlag(args, "allow-feed-failures") || env.ALLOW_PARTIAL_DIGEST_SEND !== "false" });
  const subject = `${config.digest.title} - ${window.dateLabel}`;
  let clusters = clusterArticles(articles);
  let digest = await summarizeClusters(clusters, config, { disableAI: true, env });

  function save(digest, phase) {
    const messages = [...coverage.messages];
    if (digest.articles.some(article => article.summaryKind !== "ai")) messages.push("Some items have headlines and source links only because summaries were unavailable.");
    const html = renderDigestEmail({ title: config.digest.title, dateLabel: window.dateLabel, headerImageUrl: config.digest.headerImageUrl, topics: digest.topics, notices: messages });
    mkdirSync(outDir, { recursive: true });
    const htmlPath = new URL(`digest-${window.slug}.html`, outDir);
    writeFileSync(htmlPath, html);
    writeFileSync(new URL(`digest-${window.slug}.json`, outDir), JSON.stringify({ phase, window: windowRecord, coverage, failures, skippedFeeds, articleCount: articles.length, clusterCount: clusters.length, aiCalls: digest.aiCalls, aiFailures: digest.aiFailures, aiRetries: digest.aiRetries, summaryCounts: digest.summaryCounts, topics: digest.topics }, null, 2));
    console.log(`Saved ${phase} edition: ${fileURLToPath(htmlPath)}`);
    return html;
  }

  // A complete headline/link edition survives failure of every optional stage.
  let html = save(digest, "checkpoint");
  if (state && !coverage.canSend) {
    await state(key, "blocked", { owner, reason: "insufficient_coverage" });
    throw new Error("Delivery held because source coverage is insufficient");
  }
  if (state) await state(key, "checkpoint", { owner, payload: buildDigestEmail({ html, subject, env }) });

  if (!hasNegativeFlag(args, "og-images") && env.FETCH_OG_IMAGES !== "false") {
    await hydrateMissingImages(articles, { env, deadline: stageDeadline(20_000), fetchImpl: options.fetchImpl });
  }
  let vectorsById = new Map();
  if (env.OPENAI_API_KEY && !hasNegativeFlag(args, "embeddings") && env.USE_EMBEDDINGS !== "false") {
    try { vectorsById = await embedArticles(articles, { apiKey: env.OPENAI_API_KEY, env, deadline: stageDeadline(30_000) }); }
    catch { console.warn("Embeddings unavailable; using heuristic grouping."); }
  }
  clusters = clusterArticles(articles, { vectorsById });
  if (dryRun && hasFlag(args, "capture-inputs")) {
    const fields = ["id", "title", "url", "canonicalUrl", "sourceName", "sourceType", "topicHint", "publishedAt", "summary", "text"];
    writeFileSync(new URL(`grouping-inputs-${window.slug}.json`, outDir), JSON.stringify({
      articles: articles.map(article => Object.fromEntries(fields.map(field => [field, article[field]]))), vectors: [...vectorsById],
      settings: Object.fromEntries(Object.entries(env).filter(([name]) => /^(?:CLUSTER_|EMBEDDING_CLUSTER_|NO_BROAD_CLUSTER_TOPICS$)/.test(name)))
    }));
  }
  digest = await summarizeClusters(clusters, config, { apiKey: env.OPENAI_API_KEY, disableAI: !env.OPENAI_API_KEY || hasNegativeFlag(args, "ai"), env, model: env.OPENAI_MODEL, deadline: stageDeadline(240_000) });
  html = save(digest, "complete");
  console.log(`Summary coverage: ${JSON.stringify(digest.summaryCounts)}`);
  if (!state) return { status: "preview", coverage };
  await state(key, "ready", { owner, payload: buildDigestEmail({ html, subject, env }) });
  const receipt = await state(key, "deliver", {});
  writeFileSync(new URL(`receipt-${window.slug}.json`, outDir), JSON.stringify(receipt, null, 2));
  console.log(`Delivery: ${receipt.status}${receipt.providerId ? ` (${receipt.providerId})` : ""}`);
  if (receipt.status !== "accepted") throw new Error("Email not yet accepted; durable recovery will retry eligible failures");
  return receipt;
}

if (isDirectRun(import.meta.url)) {
  try { await runDigest(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
