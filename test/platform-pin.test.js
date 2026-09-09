import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
const root = fileURLToPath(new URL("../", import.meta.url));
test("email transport uses the reviewed immutable Worker Core package", () => {
  assert.equal(execFileSync("git", ["-C", "shared/dust-wave-platform", "rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), "af2a5e5e4b65f218e627652b8243feb9704c48a1");
  const pkg = JSON.parse(readFileSync(new URL("../shared/dust-wave-platform/packages/worker-core/package.json", import.meta.url)));
  assert.equal(pkg.version, "0.13.0");
  assert.match(readFileSync(new URL("../.gitmodules", import.meta.url), "utf8"), /url = https:\/\/github\.com\/aindaco1\/dust-wave-platform\.git/);
});
