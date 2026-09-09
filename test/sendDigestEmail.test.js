import test from "node:test";
import assert from "node:assert/strict";
import { buildDigestIdempotencyKey, sendDigestEmail } from "../src/email/sendDigestEmail.js";

test("uses one stable idempotency key per digest window", () => {
  assert.equal(buildDigestIdempotencyKey("2026-09-01"), "daily-digest/2026-09-01");
});

test("rejects malformed digest window slugs", () => {
  assert.throws(() => buildDigestIdempotencyKey("September 1"), /Invalid digest window slug/);
});

test("preserves the digest HTML and subject while adding readable text and delivery headers", async (t) => {
  const html = '<html><head><style>h1{color:red}</style></head><body><h1>Today &amp; tomorrow</h1><p>Read <a href="https://example.com/story">the story</a>.</p></body></html>';
  let sent;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sent = JSON.parse(init.body);
    assert.equal(init.headers["Idempotency-Key"], "daily-digest/2026-09-09");
    return Response.json({ id: "fixture" });
  });
  await sendDigestEmail({ html, subject: "Authored subject", idempotencyKey: "daily-digest/2026-09-09", env: {
    RESEND_API_KEY: "fixture", DIGEST_FROM_EMAIL: "Digest <digest@example.com>",
    DIGEST_TO_EMAIL: "owner@example.com", DIGEST_REPLY_TO_EMAIL: "support@example.com"
  }});
  assert.equal(sent.html, html);
  assert.equal(sent.subject, "Authored subject");
  assert.deepEqual(sent.to, ["owner@example.com"]);
  assert.equal(sent.text, "Today & tomorrow\n\nRead the story (https://example.com/story).");
  assert.equal(sent.reply_to, "support@example.com");
  assert.deepEqual(sent.headers, { "Auto-Submitted": "auto-generated" });
});
