import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson } from "./generatedSubscriptions.js";

const exec = promisify(execFile);
import { validSubscriptionCache } from "./subscriptionCache.js";
export { validSubscriptionCache, CACHE_MAX_AGE_MS } from "./subscriptionCache.js";
const specs = [
  { name: "youtube", flag: "YOUTUBE", file: "youtube-subscriptions.json", script: "syncYouTubeSubscriptions.js", output: "YOUTUBE_SUBSCRIPTIONS_PATH" },
  { name: "podcast", flag: "OVERCAST", file: "podcast-subscriptions.json", script: "syncOvercastSubscriptions.js", output: "OVERCAST_SUBSCRIPTIONS_PATH" }
];

// Child-process deadlines also bound decryption, pagination and availability
// probes; failed refreshes never overwrite the last valid private cache.
export async function prepareSubscriptions({ env = process.env, state, maintenance = false, logger = console, refresh = refreshSubscriptions, outputDirectory = new URL("../../config/", import.meta.url) } = {}) {
  const notices = [];
  const generatedFeedPaths = [];
  for (const spec of specs) {
    const output = new URL(spec.file, outputDirectory);
    if (env[`${spec.flag}_SYNC_SUBSCRIPTIONS`] !== "true") {
      continue;
    }
    let cached;
    try { cached = state ? await state(`subscriptions/${spec.name}`, "cache") : JSON.parse(readFileSync(output, "utf8")); }
    catch { /* A failed cache read does not prevent a fresh provider refresh. */ }
    try {
      const value = await refresh(spec, env);
      if (!validSubscriptionCache(value)) throw new Error("Refresh returned empty or invalid subscriptions");
      writeJson(output, value);
      generatedFeedPaths.push(output);
      if (state) {
        try { await state(`subscriptions/${spec.name}`, "cache", value); }
        catch { notices.push(`${spec.flag} subscriptions refreshed, but their recovery cache could not be saved.`); }
      }
    } catch {
      const available = validSubscriptionCache(cached);
      if (available) { writeJson(output, cached); generatedFeedPaths.push(output); }
      const notice = available
        ? `${spec.flag} refresh unavailable; using subscriptions saved ${cached.generatedAt.slice(0, 10)}.`
        : `${spec.flag} subscriptions are missing: refresh failed and no valid cache from the last seven days was available.`;
      notices.push(notice);
      logger.warn(notice);
      if (spec.name === "youtube" && env.YOUTUBE_SYNC_REQUIRED === "true") throw new Error("Required YouTube refresh failed");
    }
  }
  // Feedbin provisioning is maintenance, not a prerequisite for direct RSS.
  if (maintenance && env.FEEDBIN_SYNC_SUBSCRIPTIONS === "true" && env.FEEDBIN_EMAIL && env.FEEDBIN_PASSWORD) {
    try { await exec(process.execPath, [fileURLToPath(new URL("syncFeedbinSubscriptions.js", import.meta.url))], { env, timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 1_000_000 }); }
    catch { logger.warn("Feedbin subscription maintenance unavailable; continuing with existing subscriptions and direct RSS."); }
  }
  return { notices, generatedFeedPaths };
}

async function refreshSubscriptions(spec, env) {
  const temp = mkdtempSync(join(tmpdir(), "digest-subscriptions-"));
  try {
    const output = join(temp, "subscriptions.json");
    const childEnv = { ...env, [spec.output]: output };
    const encrypted = env.OVERCAST_OPML_ENCRYPTED_PATH;
    if (spec.name === "podcast" && encrypted && existsSync(encrypted)) {
      if (!env.OVERCAST_OPML_GPG_PASSPHRASE) throw new Error("Missing OPML decryption secret");
      const child = exec("gpg", ["--batch", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--decrypt", encrypted], { timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 5_000_000 });
      child.child.stdin.end(`${env.OVERCAST_OPML_GPG_PASSPHRASE}\n`);
      const { stdout } = await child;
      childEnv.OVERCAST_OPML_PATH = join(temp, "subscriptions.opml");
      writeFileSync(childEnv.OVERCAST_OPML_PATH, stdout, { mode: 0o600 });
    }
    delete childEnv.OVERCAST_OPML_GPG_PASSPHRASE;
    await exec(process.execPath, [fileURLToPath(new URL(spec.script, import.meta.url))], { env: childEnv, timeout: 45_000, killSignal: "SIGKILL", maxBuffer: 1_000_000 });
    return JSON.parse(readFileSync(output, "utf8"));
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
