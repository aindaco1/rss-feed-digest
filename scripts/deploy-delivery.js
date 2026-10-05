import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createStateClient } from "../src/digest/stateClient.js";

const target = process.env.DELIVERY_TARGET;
assert(["staging", "production"].includes(target), "Set DELIVERY_TARGET to staging or production");
const names = ["DIGEST_STATE_TOKEN", "RESEND_API_KEY", "DIGEST_FROM_EMAIL", "DIGEST_TO_EMAIL", "GITHUB_DISPATCH_TOKEN"];
for (const name of [...names, "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) {
  assert(process.env[name]?.trim(), `Missing ${name}`);
}
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
assert(/^\d{4}-\d{2}-\d{2}$/.test(config.vars.START_DATE), "Set the first production edition in wrangler.jsonc");
config.main = resolve(config.main);
if (target === "staging") {
  config.name += "-staging";
  config.triggers.crons = [];
}

// Verify receipt-read access before deploying; never print provider data or keys.
const provider = await fetch("https://api.resend.com/emails?limit=1", {
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  signal: AbortSignal.timeout(15_000)
});
await provider.body?.cancel();
assert(provider.ok, `Resend email-read verification failed (${provider.status})`);

const cloudflare = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`, {
  headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
  signal: AbortSignal.timeout(15_000)
});
assert(cloudflare.ok, `Worker subdomain lookup failed (${cloudflare.status})`);
const { result } = await cloudflare.json();
assert(result?.subdomain, "Missing workers.dev subdomain");
const url = `https://${config.name}.${result.subdomain}.workers.dev`;
const dir = await mkdtemp(join(tmpdir(), "digest-deploy-"));
try {
  const configPath = join(dir, "wrangler.json");
  const secretsPath = join(dir, "secrets.json");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await writeFile(secretsPath, JSON.stringify(Object.fromEntries(names.map(name => [name, process.env[name]]))), { mode: 0o600 });
  const deploy = spawnSync(resolve("node_modules/.bin/wrangler"), ["deploy", "--config", configPath, "--secrets-file", secretsPath], { stdio: "inherit" });
  assert.equal(deploy.status, 0, "Worker deployment failed");
} finally {
  await rm(dir, { recursive: true, force: true });
}

// A newly created workers.dev route may return 404 briefly after upload succeeds.
let status;
for (let attempt = 0; attempt < 6; attempt++) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  status = response.status;
  await response.body?.cancel();
  if (status !== 404 && status < 500) break;
  if (attempt < 5) await delay(5_000);
}
assert.equal(status, 401, "Worker must become available and reject unauthenticated access");
const state = createStateClient({ ...process.env, DIGEST_STATE_URL: url });
const key = `daily-digest/deploy-${Date.now()}`;
const owner = randomUUID();
const window = { start: new Date().toISOString(), end: new Date().toISOString() };
const claim = await state(key, "claim", { key, owner, window });
assert(claim.acquired, "Durable claim failed");
const duplicate = await state(key, "claim", { key, owner: randomUUID(), window });
assert.equal(duplicate.acquired, false, "Concurrent claims must be rejected");
// No email payload or alarm is created by this storage-only probe.
await state(key, "blocked", { owner, reason: "deployment_storage_probe" });
assert.equal((await state(key, "status")).status, "blocked", "Durable state did not persist");
console.log(`Verified ${target}: ${url} (authentication, durable writes, concurrent claim protection, provider read access). No email sent.`);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `Deployed **${target}**: ${url}\n\nVerified authentication, durable storage, concurrent claims, and Resend read access. No email sent.\n`);
}
