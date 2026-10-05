import { fetchText } from "../util/network.js";
import { buildDigestIdempotencyKey } from "../email/sendDigestEmail.js";
import { resolveDigestWindow } from "../util/dates.js";
import { createHash } from "node:crypto";

export function editionKey(window, config) {
  const standard = resolveDigestWindow({}, config, window.end);
  const key = buildDigestIdempotencyKey(window.slug);
  if (+standard.start === +window.start && +standard.end === +window.end) return key;
  return `${key}-${createHash("sha256").update(`${window.start.toISOString()}/${window.end.toISOString()}`).digest("hex").slice(0, 16)}`;
}

export function createStateClient(env = process.env, options = {}) {
  if (!env.DIGEST_STATE_URL || !env.DIGEST_STATE_TOKEN) throw new Error("DIGEST_STATE_URL and DIGEST_STATE_TOKEN are required for durable delivery");
  const base = new URL(env.DIGEST_STATE_URL);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Digest state requires HTTPS");
  return async function stateRequest(key, action, data) {
    const url = new URL(`/state/${encodeURIComponent(key)}/${action}`, base);
    const { response, text } = await fetchText(url, {
      method: data === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${env.DIGEST_STATE_TOKEN}`, "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data)
    }, { ...options, timeoutMs: action === "deliver" ? 25_000 : 15_000, maxBytes: 1_600_000 });
    if (!response.ok) throw new Error(`Digest state ${action} failed (${response.status})`);
    return JSON.parse(text);
  };
}
