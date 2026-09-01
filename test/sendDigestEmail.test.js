import test from "node:test";
import assert from "node:assert/strict";
import { buildDigestIdempotencyKey } from "../src/email/sendDigestEmail.js";

test("uses one stable idempotency key per digest window", () => {
  assert.equal(buildDigestIdempotencyKey("2026-09-01"), "daily-digest/2026-09-01");
});

test("rejects malformed digest window slugs", () => {
  assert.throws(() => buildDigestIdempotencyKey("September 1"), /Invalid digest window slug/);
});
