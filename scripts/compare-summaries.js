import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { summarizeClusters } from "../src/ai/summarizeClusters.js";
import { renderDigestEmail } from "../src/email/renderDigestEmail.js";

// Manual diagnostic: reuse production generation, validation, retry and rendering.
// The supplied public source snapshots stay in ignored output, not the repository.
const inputPath = process.argv.find(arg => arg.startsWith("--input="))?.slice(8);
const raw = inputPath ? readFileSync(inputPath, "utf8") : process.env.SUMMARY_COMPARISON_ARTICLES || "";
if (Buffer.byteLength(raw) > 48_000) throw new Error("Comparison input exceeds 48 KB");
const cases = JSON.parse(raw);
if (!Array.isArray(cases) || !cases.length || cases.length > 8 || cases.some(c =>
  !c.id || !Array.isArray(c.articles) || !c.articles.length || c.articles.length > 3 ||
  c.articles.some(a => !a.title || !a.url || !a.sourceName || !a.topicHint || !a.publishedAt ||
    typeof a.summary !== "string" || typeof a.text !== "string"))) {
  throw new Error("Expected 1-8 cases containing 1-3 normalized articles each");
}
const clusters = cases.map(c => ({ id: c.id, articles: c.articles, topicHint: c.articles[0].topicHint,
  latestPublishedAt: c.articles.map(a => a.publishedAt).sort().at(-1) }));
const config = { topics: [...new Set(cases.flatMap(c => c.articles.map(a => a.topicHint)))] };
// Standard USD/million token rates, checked against official docs 2026-09-27.
const models = { "gpt-4.1-mini": [0.40, 0.10, 1.60], "gpt-5.4-mini": [0.75, 0.075, 4.50] };
const rounds = 2;
const live = process.argv.includes("--live");
const output = `out/summary-comparison/${new Date().toISOString().replaceAll(":", "-")}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/inputs.json`, raw);
const report = { live, inputSha256: createHash("sha256").update(raw).digest("hex"),
  cases: cases.map(c => ({ id: c.id, review: c.review })),
  maxRequests: clusters.length * Object.keys(models).length * rounds * 2,
  complete: false, semanticReview: "required", results: [] };
const save = () => writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
save();
console.log(JSON.stringify({ output, live, cases: cases.length, maxRequests: report.maxRequests }));
if (live) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for --live");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  for (const [model, [inputRate, cachedRate, outputRate]] of Object.entries(models)) {
    for (let round = 1; round <= rounds; round += 1) {
      const requests = [];
      const recordingClient = { responses: { create: async (payload, options) => {
        const started = performance.now();
        try {
          const response = await client.responses.create(payload, options);
          const usage = response.usage;
          const cached = usage?.input_tokens_details?.cached_tokens || 0;
          requests.push({ model: response.model, elapsedMs: Math.round(performance.now() - started), usage,
            estimatedUsd: usage ? ((usage.input_tokens - cached) * inputRate + cached * cachedRate +
              usage.output_tokens * outputRate) / 1_000_000 : null });
          return response;
        } catch (error) {
          requests.push({ elapsedMs: Math.round(performance.now() - started), error: error.name, status: error.status });
          throw error;
        }
      } } };
      const digest = await summarizeClusters(clusters, config, { model, client: recordingClient,
        apiKey: process.env.OPENAI_API_KEY, env: { AI_CONCURRENCY: "2" } });
      const name = `${model}-${round}`;
      writeFileSync(`${output}/${name}.json`, JSON.stringify(digest, null, 2));
      writeFileSync(`${output}/${name}.html`, renderDigestEmail({
        title: "Summary model comparison", dateLabel: name, topics: digest.topics }));
      report.results.push({ model, round, aiCalls: digest.aiCalls, aiRetries: digest.aiRetries,
        aiFailures: digest.aiFailures, requests });
      save();
      console.log(JSON.stringify({ model, round, calls: digest.aiCalls, failures: digest.aiFailures }));
      if (requests.some(r => r.status === 401 || r.status === 403 || r.status === 404)) {
        throw new Error("Comparison stopped: credentials or model access unavailable");
      }
    }
  }
  report.complete = true;
  save();
}
