import test from "node:test";
import assert from "node:assert/strict";
import { mapLimit } from "../src/util/concurrency.js";

test("processes every item when a concurrency setting is invalid", async () => {
  const results = await mapLimit([1, 2, 3], Number.NaN, async (value) => value * 2);
  assert.deepEqual(results, [2, 4, 6]);
});

test("does not call the mapper for an empty collection", async () => {
  let calls = 0;
  const results = await mapLimit([], 4, async () => {
    calls += 1;
  });

  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});
