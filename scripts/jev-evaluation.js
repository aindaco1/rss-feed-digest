import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { callCloudflareJev, createJevRequest, evaluateJevCases, judgeJevResponse } from "@dustwave/test-core/jev";
import { captureCorpus, fixture } from "./jev-corpus.js";
import { isDirectRun } from "../src/util/modules.js";
import { parseSummaryResponse } from "../src/ai/summarizeClusters.js";

export const POLICY = { minimumMargin: 0.10, models: ["jev-1.13.0"] };
const MAX_QUESTIONS = 40;
const MAX_SUMMARIES = 3;
const MAX_SUMMARY_BYTES = 10_000;
const MAX_OUTPUT_TOKENS = 1000;
const sha256 = value => createHash("sha256").update(value).digest("hex");

export function prepareBudget(cases, generate = false) {
  const questionCount = cases.reduce((sum, row) => sum + Object.keys(createJevRequest(
    row.candidate, row.requirements, { reference: row.reference }).input.questions).length, 0);
  // Vendor reference rates checked 2026-09-23, not provider-enforced billing caps.
  const reservedEstimateUsd = questionCount * 32_000 * 0.042 / 1e6 +
    (generate ? MAX_SUMMARIES * (MAX_SUMMARY_BYTES * 0.40 + MAX_OUTPUT_TOKENS * 1.60) / 1e6 : 0);
  if (questionCount > MAX_QUESTIONS || reservedEstimateUsd > 0.15) throw new Error("Pilot exceeds budget");
  return { questionCount, maxJevRequests: cases.length, maxSummaryRequests: generate ? MAX_SUMMARIES : 0,
    reservedEstimateUsd, estimatedLimitUsd: 0.15, isBillingCap: false };
}

export function outcome(report, cases, failures = []) {
  const counts = { correctControls: 0, falsePasses: 0, falseFailures: 0, passes: 0, failures: 0, reviews: 0, unevaluated: 0 };
  const rows = new Map(report.cases.map(row => [row.id, row]));
  for (const source of cases) for (const key of Object.keys(source.requirements)) {
    const finding = rows.get(source.id)?.result?.findings[key];
    if (!finding) counts.unevaluated++;
    else if (finding.decision === "review") counts.reviews++;
    else if (source.expected) {
      if (finding.decision === source.expected) counts.correctControls++;
      else if (finding.decision === "pass") counts.falsePasses++;
      else counts.falseFailures++;
    } else counts[finding.decision === "pass" ? "passes" : "failures"]++;
  }
  const incomplete = !report.complete || report.error || counts.unevaluated;
  const flagged = failures.length + counts.falsePasses + counts.falseFailures + counts.failures + counts.reviews;
  return { ...counts, deterministicFailures: failures, exitCode: incomplete ? 2 : flagged ? 1 : 0 };
}

// Persist only the shared parser's validated projection, never arbitrary provider metadata.
export function projectReport(report) {
  return { ...report, cases: report.cases.map(({ raw, ...row }) => {
    if (raw !== undefined && row.error && !row.result) {
      try { judgeJevResponse(raw, row.request.input.questions, report.policy); }
      catch (error) {
        // These messages come from the pinned local parser, never provider prose.
        const known = ["Jev response failed", "Jev response incomplete",
          "Jev response has missing or unexpected answers/model", "Jev response has invalid usage",
          "Jev response has invalid choice/probabilities"];
        row.validationError = known.includes(error.message) ? error.message : "Jev response validation failed";
      }
    }
    return { ...row, pending: Boolean(report.networkAttempts && !row.result && !row.error) };
  }) };
}

export async function runEvaluation(cases, { call, save = async () => {} } = {}) {
  let current;
  const onProgress = async report => { current = report; await save(projectReport(report)); };
  const report = await evaluateJevCases(cases, { policy: POLICY, maxQuestions: MAX_QUESTIONS, onProgress,
    call: call ? async payload => {
      // The shared batch helper adds this row before invoking call. A failed
      // pre-call checkpoint must prevent transport, including after interruption.
      await save(projectReport(current));
      try { return await call(payload); }
      catch (error) {
        current.cases.at(-1).transportError = /^Cloudflare HTTP \d{3}$/.test(error?.message || "")
          ? error.message : "Transport failed; private provider details omitted";
        throw error;
      }
    } : undefined
  });
  // Include elapsed time on errors too (the shared helper sets it in finally).
  await save(projectReport(report));
  return report;
}

async function preflightGeneration() {
  const requests = [];
  const captured = await captureCorpus({ client: { responses: { create: async payload => {
    const input = JSON.parse(payload.input[1].content);
    const request = { ...payload, max_output_tokens: MAX_OUTPUT_TOKENS, store: false };
    if (Buffer.byteLength(JSON.stringify(request)) > MAX_SUMMARY_BYTES) throw new Error("Summary request too large");
    requests.push(request);
    return { status: "completed", output_text: JSON.stringify({ headline: input.articles[0].title,
      summary: input.articles.map(a => a.summary).join(" "), topic: input.articles[0].topicHint }) };
  } } } });
  if (requests.length !== MAX_SUMMARIES || captured.deterministicFailures.length) throw new Error("Generation preflight failed");
  return requests;
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("npm run test:jev -- [--live [--generate]]\nDefault: offline preview. --live judges synthetic source-excerpt output; --generate also calls the production OpenAI summarizer. Never reads live feeds or sends email.");
    return 0;
  }
  if (args.some(a => !["--live", "--generate"].includes(a)) || new Set(args).size !== args.length ||
      (args.includes("--generate") && !args.includes("--live"))) throw new Error("Invalid evaluation arguments");
  const live = args.includes("--live");
  const generate = args.includes("--generate");
  if (live && process.env.CI) throw new Error("CI evaluation must remain offline");
  let captured = await captureCorpus();
  const generationRequests = await preflightGeneration();
  const budget = prepareBudget(captured.cases, generate);
  const output = new URL(`../out/jev/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}/`, import.meta.url);
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const save = (name, value) => {
    const target = new URL(name, output);
    const pending = new URL(`${name}.tmp`, output);
    writeFileSync(pending, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(pending, target);
  };
  const sourcePaths = ["package.json", "package-lock.json", "test/fixtures/jev.json", "scripts/jev-corpus.js", "scripts/jev-evaluation.js",
    "src/ai/summarizeClusters.js", "src/ai/embeddings.js", "src/cluster/clusterArticles.js", "src/email/renderDigestEmail.js",
    "src/util/html.js", "src/util/appLinks.js", "src/util/concurrency.js", "src/util/hash.js", "src/util/urls.js",
    "shared/dust-wave-platform/packages/test-core/src/jev.js", "shared/dust-wave-platform/packages/worker-core/src/response-body.js"];
  const metadata = { mode: live ? "live" : "preview", candidateOrigin: generate ? "pending-generation" : "source-excerpts",
    classification: fixture.classification, labelProvenance: fixture.labelProvenance, policyCalibrated: false, budget,
    sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, sha256(readFileSync(new URL(`../${path}`, import.meta.url)))])) };
  const generation = [];
  const saveCapture = () => {
    save("corpus.json", captured.cases); save("digest.html", captured.html); save("digest.txt", captured.text);
    save("digest.json", captured.digest); save("generation-requests.json", generationRequests);
  };
  const saveReport = report => save("report.json", { ...projectReport(report), ...metadata, generation,
    metrics: captured.metrics, corpusSha256: sha256(JSON.stringify(captured.cases)),
    candidateHashes: Object.fromEntries(captured.cases.map(row => [row.id, sha256(row.candidate)])),
    summary: outcome(report, captured.cases, captured.deterministicFailures) });
  saveCapture();
  let report = await runEvaluation(captured.cases, { save: saveReport });
  console.log(`RSS Jev ${live ? "live" : "preview"}: ${budget.questionCount} questions; estimated reservation $${budget.reservedEstimateUsd.toFixed(4)}. Evidence: ${fileURLToPath(output)}`);
  if (live && !captured.deterministicFailures.length) {
    try {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      const token = process.env.CLOUDFLARE_API_TOKEN;
      if (!/^[a-f\d]{32}$/i.test(accountId || "") || !token?.trim() || (generate && !process.env.OPENAI_API_KEY?.trim())) {
        throw new Error("Missing evaluation credentials");
      }
      if (generate) {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 45_000 });
        let stopped = false;
        captured = await captureCorpus({ client: { responses: { create: async payload => {
          if (stopped || generation.length >= MAX_SUMMARIES) throw new Error("Generation stopped");
          const request = { ...payload, max_output_tokens: MAX_OUTPUT_TOKENS, store: false };
          if (JSON.stringify(request) !== JSON.stringify(generationRequests[generation.length])) throw new Error("Unreviewed summary request");
          const row = { pending: true };
          generation.push(row);
          const started = performance.now();
          try {
            save("generation.json", generation);
            const response = await client.responses.create(request);
            if (response.status !== "completed") throw new Error("Incomplete generation");
            parseSummaryResponse(response, JSON.parse(payload.input[1].content).allowedTopics);
            row.model = response.model; row.usage = response.usage; row.output = response.output_text;
            row.pending = false;
            return response;
          } catch {
            stopped = true; row.pending = false; row.error = "Summary request failed; no retry";
            throw new Error(row.error);
          } finally { row.elapsedMs = Math.round(performance.now() - started); save("generation.json", generation); }
        } } } });
        metadata.candidateOrigin = "fresh-openai-summaries";
        saveCapture();
        if (captured.deterministicFailures.length) throw new Error("Generated capture failed exact checks");
        prepareBudget(captured.cases, true);
      }
      report = await runEvaluation(captured.cases, { save: saveReport, call: payload => callCloudflareJev(payload, { accountId, token }) });
    } catch {
      report.complete = false;
      report.error = "Evaluation incomplete: check process credentials, generation evidence, and limits. No automatic retries.";
    }
  }
  await saveReport(report);
  const summary = outcome(report, captured.cases, captured.deterministicFailures);
  const flagged = captured.cases.flatMap(source => {
    const row = report.cases.find(r => r.id === source.id);
    return Object.entries(source.requirements).filter(([key]) => row?.result?.findings[key]?.decision !== (source.expected || "pass"))
      .map(([key, requirement]) => ({ case: source.id, requirement, candidate: source.candidate, finding: row?.result?.findings[key] || "unevaluated" }));
  });
  save("review.json", { summary, flagged, advisory: true, releaseAccepted: false });
  const exitCode = live ? summary.exitCode : captured.deterministicFailures.length ? 1 : 0;
  console.log(JSON.stringify({ complete: report.complete, ...summary, commandExitCode: exitCode }));
  return exitCode;
}

if (isDirectRun(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(() => {
  console.error("RSS evaluation could not prepare or persist evidence. Check arguments, fixtures, and dependencies; no private errors logged.");
  process.exitCode = 2;
});
