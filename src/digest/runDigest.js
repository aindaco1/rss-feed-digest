import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/loadConfig.js";
import { fetchArticles, hydrateMissingImages } from "../feeds/fetchFeeds.js";
import { clusterArticles } from "../cluster/clusterArticles.js";
import { embedArticles } from "../ai/embeddings.js";
import { summarizeClusters } from "../ai/summarizeClusters.js";
import { renderDigestEmail } from "../email/renderDigestEmail.js";
import { sendDigestEmail } from "../email/sendDigestEmail.js";
import { parseArgs, hasFlag, hasNegativeFlag } from "../util/args.js";
import { resolveDigestWindow } from "../util/dates.js";

const args = parseArgs();
const config = loadConfig();
const window = resolveDigestWindow(args, config.digest);
const outDir = new URL("../../out/", import.meta.url);
const dryRun = hasFlag(args, "dry-run") || (!hasFlag(args, "send") && process.env.SEND_DIGEST !== "true");
const apiKey = process.env.OPENAI_API_KEY;
const useAI = Boolean(apiKey) && !hasNegativeFlag(args, "ai");
const useEmbeddings = Boolean(apiKey) && !hasNegativeFlag(args, "embeddings") && process.env.USE_EMBEDDINGS !== "false";
const fetchOgImages = !hasNegativeFlag(args, "og-images") && process.env.FETCH_OG_IMAGES !== "false";

console.log(`Digest window: ${window.startLabel} -> ${window.endLabel}`);
console.log(`Mode: ${dryRun ? "dry-run" : "send"}`);

const { articles, failures } = await fetchArticles(config, window);
console.log(`Fetched ${articles.length} articles from ${config.feeds.length} feeds.`);

if (failures.length) {
  console.warn(`Feed failures: ${failures.length}`);
  failures.forEach((failure) => console.warn(`- ${failure.title}: ${failure.message}`));
}

if (fetchOgImages) {
  await hydrateMissingImages(articles);
  console.log(`Image coverage: ${articles.filter((article) => article.imageUrl).length}/${articles.length}`);
}

let vectorsById = new Map();
if (useEmbeddings && articles.length) {
  try {
    vectorsById = await embedArticles(articles, { apiKey });
    console.log(`Embedded ${vectorsById.size} articles for clustering.`);
  } catch (error) {
    console.warn(`Embedding step failed, using heuristic clustering: ${error.message}`);
  }
}

const clusters = clusterArticles(articles, { vectorsById });
console.log(`Clustered into ${clusters.length} digest items.`);

const digest = await summarizeClusters(clusters, config, {
  apiKey,
  disableAI: !useAI,
  model: process.env.OPENAI_MODEL
});

console.log(`AI summary calls: ${digest.aiCalls}`);

const subject = `${config.digest.title} - ${window.dateLabel}`;
const html = renderDigestEmail({
  title: config.digest.title,
  dateLabel: window.dateLabel,
  headerImageUrl: config.digest.headerImageUrl,
  topics: digest.topics
});

mkdirSync(outDir, { recursive: true });

const htmlPath = new URL(`digest-${window.slug}.html`, outDir);
const jsonPath = new URL(`digest-${window.slug}.json`, outDir);

writeFileSync(htmlPath, html);
writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        timezone: window.timezone,
        dateLabel: window.dateLabel
      },
      failures,
      articleCount: articles.length,
      clusterCount: clusters.length,
      aiCalls: digest.aiCalls,
      topics: digest.topics
    },
    null,
    2
  )
);

console.log(`Wrote ${fileURLToPath(htmlPath)}`);
console.log(`Wrote ${fileURLToPath(jsonPath)}`);

if (!dryRun) {
  const idempotencyKey = `daily-digest/${window.slug}`;
  const response = await sendDigestEmail({ html, subject, idempotencyKey });
  console.log(`Sent digest through Resend: ${response.id || JSON.stringify(response)}`);
}

process.exit(0);
