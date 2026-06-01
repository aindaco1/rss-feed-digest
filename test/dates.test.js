import test from "node:test";
import assert from "node:assert/strict";
import { resolveDigestWindow } from "../src/util/dates.js";

const digestConfig = {
  timezone: "America/Denver",
  sendTime: "07:00",
  dateFormat: "MM/dd/yyyy"
};

test("resolves requested test window in America/Denver", () => {
  const window = resolveDigestWindow({ "test-window": true }, digestConfig);

  assert.equal(window.start.toISOString(), "2026-05-30T13:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-06-01T13:00:00.000Z");
  assert.equal(window.dateLabel, "06/01/2026");
});

test("requires both start and end", () => {
  assert.throws(() => resolveDigestWindow({ start: "2026-05-30T07:00:00" }, digestConfig), /both --start and --end/);
});
