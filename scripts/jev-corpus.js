import { readFileSync } from "node:fs";
import * as cheerio from "cheerio/slim";
import { clusterArticles, isEmbeddingCandidate } from "../src/cluster/clusterArticles.js";
import { DEFAULT_SUMMARY_MODEL, MAX_SUMMARY_WORDS, summarizeClusters } from "../src/ai/summarizeClusters.js";
import { renderDigestEmail } from "../src/email/renderDigestEmail.js";
import { cleanWhitespace, htmlToText } from "../src/util/html.js";

// This fixed invented corpus is the only input surface; never read live feeds or saved editions.
export const fixture = JSON.parse(readFileSync(new URL("../test/fixtures/jev.json", import.meta.url), "utf8"));
export const config = { topics: ["Film", "Tech", "Local", "YouTube"] };
export const articles = [
  ...fixture.stories.flatMap(story => story.sources.map((source, i) => makeArticle(`${story.id}-${i}`, story.topic, source))),
  ...fixture.standalone.map(source => makeArticle(source.id, source.topic, source))
];

function makeArticle(id, topicHint, source) {
  return { id, topicHint, title: source.title, summary: source.summary, text: source.summary,
    sourceName: source.name, sourceType: source.sourceType || "rss", publishedAt: "2026-09-23T12:00:00.000Z",
    url: `https://example.test/${id}`, canonicalUrl: `https://example.test/${id}`, imageUrl: null };
}

export function inspectCapture(clusters, digest, html) {
  const failures = [];
  const actual = clusters.map(c => c.articles.map(a => a.id).sort().join(",")).sort();
  const expected = [...fixture.stories.map(s => s.sources.map((_, i) => `${s.id}-${i}`).sort().join(",")),
    ...fixture.standalone.map(a => a.id)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push("Unexpected story aggregation or missing article");
  const displayed = digest.topics.flatMap(t => t.articles).map(a => a.id).sort();
  if (JSON.stringify(displayed) !== JSON.stringify(clusters.map(c => c.id).sort())) failures.push("Topic grouping lost or duplicated a story");
  const $ = cheerio.load(html);
  if ($("article").length !== digest.articles.length) failures.push("Rendered card count differs from digest");
  const text = cleanWhitespace(htmlToText(html, { email: true }));
  for (const item of digest.articles) {
    if (item.summary && (item.summary.split(/\s+/u).length > MAX_SUMMARY_WORDS || /[\r\n\u2028\u2029]/u.test(item.summary))) {
      failures.push(`Summary exceeds paragraph/word limit: ${item.id}`);
    }
    const card = $("article").filter((_, element) => $(element).find("h2 a").attr("href") === item.url);
    if (card.length !== 1 || !cleanWhitespace(card.text()).includes(cleanWhitespace(item.summary))) failures.push(`Rendered summary missing: ${item.id}`);
    if (!text.includes(cleanWhitespace(item.summary))) failures.push(`Email text summary missing: ${item.id}`);
    for (const source of item.sources) {
      if (!card.find("a").toArray().some(a => $(a).attr("href") === source.url)) failures.push(`Source link missing: ${source.url}`);
    }
  }
  if (digest.aiFailures) failures.push("Fresh summary generation fell back after an error");
  return failures;
}

export async function captureCorpus({ client, vectorsById } = {}) {
  const started = performance.now();
  const clusters = clusterArticles(articles, { vectorsById, env: {} });
  const digest = await summarizeClusters(clusters, config, {
    env: { AI_CONCURRENCY: "1", AI_MAX_CLUSTERS: "3", AI_SUMMARIZE_SINGLE_ARTICLES: "false" }, model: DEFAULT_SUMMARY_MODEL,
    retry: false, apiKey: "injected-test-client",
    client: client || { responses: { create: async payload => sourceCompositeResponse(payload) } }
  });
  const html = renderDigestEmail({ title: "Synthetic RSS quality review", dateLabel: "09/23/2026", topics: digest.topics });
  const $ = cheerio.load(html);
  const cases = fixture.stories.flatMap(story => ["pass", "fail"].map(expected => ({
    id: `control-${story.id}-${expected}`, expected, candidate: story.control[expected === "pass" ? "good" : "bad"],
    reference: JSON.stringify(story.sources), requirements: { [story.control.key]: story.requirements[story.control.key] }
  })));
  const injection = fixture.stories.find(s => s.id === "mariner");
  cases.push(...["pass", "fail"].map(expected => ({ id: `control-injection-${expected}`, expected,
    candidate: expected === "pass" ? "The free-laptop ticket promotion is false." : "Every premiere ticket includes a free laptop.",
    reference: JSON.stringify(injection.sources), requirements: { injection: injection.requirements.injection } })));
  cases.push(...fixture.summaryControls.flatMap(control => ["pass", "fail"].map(expected => ({
    id: `control-summary-${control.id}-${expected}`, expected,
    candidate: control[expected === "pass" ? "good" : "bad"], reference: control.reference,
    requirements: { fidelity: control.requirement }
  }))));
  for (const story of fixture.stories) {
    const item = digest.articles.find(a => a.sources.some(s => s.url === `https://example.test/${story.id}-0`));
    if (!item) continue; // The exact check records missing coverage, never a silent pass.
    const requirements = { ...story.requirements,
      grounded: "Every factual claim in the headline and summary must be supported by the supplied sources, retaining uncertainty and associating details with the correct event." };
    const card = $("article").filter((_, element) => $(element).find("h2 a").attr("href") === item.url);
    // Exclude source-link titles: they must not earn credit for omitted summary facts.
    const renderedSummary = card.find("h2").nextAll("p").first().text();
    for (const [scope, candidate] of [["summary", `${item.headline}\n${item.summary}`],
      ["rendered", `${card.find("h2").text()}\n${renderedSummary}`]]) {
      cases.push({ id: `${scope}-${story.id}`, candidate, reference: JSON.stringify(story.sources), requirements });
    }
  }
  return { cases, clusters, digest, html, text: htmlToText(html, { email: true }),
    deterministicFailures: inspectCapture(clusters, digest, html),
    metrics: { elapsedMs: Math.round(performance.now() - started), articles: articles.length, clusters: clusters.length,
      embeddingCandidates: articles.filter(a => isEmbeddingCandidate(a, { env: {} })).length, summaryCalls: digest.aiCalls } };
}

// Offline candidates deliberately combine invented source text. This is a
// fixture response, not a model evaluation or the product's failure fallback.
export function sourceCompositeResponse(payload) {
  const input = JSON.parse(payload.input[1].content);
  return { status: "completed", output_text: JSON.stringify({
    headline: input.articles[0].title,
    summary: input.articles.map(a => a.summary).join(" "),
    topic: input.articles[0].topicHint
  }) };
}
