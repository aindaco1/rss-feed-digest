import test from "node:test";
import assert from "node:assert/strict";
import { articles, captureCorpus, inspectCapture } from "../scripts/jev-corpus.js";
import { outcome, prepareBudget, projectReport, runEvaluation } from "../scripts/jev-evaluation.js";
import { renderDigestEmail } from "../src/email/renderDigestEmail.js";

const sample = { id: "control", expected: "fail", candidate: "Everyone is eligible.",
  reference: "Invited desktop users only.", requirements: { scope: "Retain the invitation restriction." } };
function response(request, decision = "pass", model = "jev-1.13.0") {
  return { model, debug: "provider metadata must not persist", usage: { input_tokens: 20, output_tokens: 4 },
    answers: Object.fromEntries(Object.keys(request.input.questions).map(key => [key, {
      type: "choice", choice: decision, probabilities: { pass: decision === "pass" ? 0.98 : 0.01,
        fail: decision === "fail" ? 0.98 : 0.01, uncertain: 0.01 }
    }])) };
}

test("offline capture runs the production aggregation, fallback and renderer without network", async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("Offline capture attempted network");
  try {
    const captured = await captureCorpus();
    assert.deepEqual(captured.deterministicFailures, []);
    assert.equal(captured.metrics.articles, 9);
    assert.equal(captured.metrics.clusters, 6);
    assert.equal(captured.metrics.embeddingCandidates, 6);
    const report = await runEvaluation(captured.cases);
    assert.equal(report.complete, false);
    assert.equal(report.networkAttempts, 0);
    assert.equal(report.releaseAccepted, false);
    assert.equal(outcome(report, captured.cases).unevaluated, 26);
    assert.equal(prepareBudget(captured.cases, true).maxSummaryRequests, 3);
    assert.ok(!JSON.stringify(report.cases.map(row => row.request)).includes('"expected"'));
  } finally { globalThis.fetch = fetch; }
});

test("exact checks catch summary clipping, missing sources, and lost topics", async () => {
  const c = await captureCorpus();
  const shortened = structuredClone(c.digest);
  shortened.topics.forEach(t => t.articles.forEach(a => { a.summary = a.summary.slice(0, 280); }));
  const html = renderDigestEmail({ topics: shortened.topics });
  assert.ok(inspectCapture(c.clusters, c.digest, html).some(f => /summary missing/.test(f)));
  assert.ok(inspectCapture(c.clusters, c.digest, c.html.replaceAll(articles[0].url, "https://example.test/wrong")).length);
  assert.ok(inspectCapture(c.clusters, { ...c.digest, topics: [] }, c.html).some(f => /Topic grouping/.test(f)));
});

test("judge controls distinguish correct rejection, false passes, and unknown-model reviews", async () => {
  const correct = await runEvaluation([sample], { call: async r => response(r, "fail") });
  assert.equal(outcome(correct, [sample]).correctControls, 1);
  assert.equal(outcome(correct, [sample]).exitCode, 0);
  const wrong = await runEvaluation([sample], { call: async r => response(r) });
  assert.equal(outcome(wrong, [sample]).falsePasses, 1);
  assert.equal(outcome(wrong, [sample]).exitCode, 1);
  const review = await runEvaluation([sample], { call: async r => response(r, "pass", "new-model") });
  assert.equal(outcome(review, [sample]).reviews, 1);
  assert.equal(outcome(review, [sample]).exitCode, 1);
});

test("pre-call persistence blocks transport and partial errors cannot become passes", async () => {
  let calls = 0;
  const blocked = await runEvaluation([sample], { call: async r => { calls++; return response(r); },
    save: async report => { if (report.cases.some(row => row.pending)) throw new Error("Disk unavailable"); } });
  assert.equal(calls, 0);
  assert.equal(blocked.complete, false);
  assert.equal(outcome(blocked, [sample]).exitCode, 2);
  const snapshots = [];
  const failed = await runEvaluation([sample, { ...sample, id: "second" }], {
    call: async () => { calls++; throw new Error("SECRET provider failure"); },
    save: async report => snapshots.push(structuredClone(report))
  });
  assert.equal(calls, 1);
  assert.equal(failed.complete, false);
  assert.equal(snapshots.some(r => r.cases.some(row => row.pending)), true);
  assert.equal(typeof snapshots.at(-1).cases[0].elapsedMs, "number");
  assert.equal(JSON.stringify(snapshots).includes("SECRET"), false);
  const rejected = await runEvaluation([sample], { call: async () => { throw new Error("Cloudflare HTTP 403"); } });
  assert.equal(projectReport(rejected).cases[0].transportError, "Cloudflare HTTP 403");
});

test("malformed judge responses stop the batch and raw metadata is never persisted", async () => {
  let calls = 0;
  const failed = await runEvaluation([sample, { ...sample, id: "second" }], {
    call: async () => { calls++; return { answers: {}, secret: "SECRET" }; }
  });
  assert.equal(calls, 1);
  assert.equal(failed.complete, false);
  assert.equal(JSON.stringify(projectReport(failed)).includes("SECRET"), false);
  assert.equal(projectReport(failed).cases[0].validationError, "Jev response has missing or unexpected answers/model");
  const good = await runEvaluation([sample], { call: async r => response(r) });
  assert.equal(JSON.stringify(projectReport(good)).includes("provider metadata"), false);
});

test("completed Cloudflare jobs validate and pending jobs retain a safe diagnostic", async () => {
  const completed = await runEvaluation([sample], { call: async r => ({ success: true,
    result: { state: "Completed", result: response(r, "fail") } }) });
  assert.equal(outcome(completed, [sample]).exitCode, 0);
  const pending = await runEvaluation([sample], { call: async () => ({ success: true,
    result: { state: "Pending", privateMetadata: "SECRET" } }) });
  assert.equal(projectReport(pending).cases[0].validationError, "Jev response incomplete");
  assert.equal(JSON.stringify(projectReport(pending)).includes("SECRET"), false);
  assert.equal(outcome(pending, [sample]).exitCode, 2);
});

test("budgets preflight the whole batch before any provider call", async () => {
  const tooMany = Array.from({ length: 41 }, (_, i) => ({ ...sample, id: String(i) }));
  assert.throws(() => prepareBudget(tooMany), /budget/);
  await assert.rejects(runEvaluation(tooMany, { call: () => assert.fail("Preflight must prevent transport") }), /budget/);
  assert.throws(() => prepareBudget([{ ...sample, candidate: "x".repeat(32_000) }]), /32000/);
});
