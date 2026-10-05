import config from "../config/feeds.json" with { type: "json" };
import { timingSafeEqual } from "@dustwave/worker-core/crypto";
import { prepareResendEmail } from "@dustwave/worker-core/email";
import { formatInTimeZone } from "date-fns-tz";
import { resolveDigestWindow, previousLocalDate } from "../src/util/dates.js";
import { fetchText } from "../src/util/network.js";
export { DigestState } from "./state.js";

const digestConfig = config.digest;
export const stateStub = (env, key) => env.DIGEST_STATE.get(env.DIGEST_STATE.idFromName(key));
export async function callState(env, key, action, data) {
  const response = await stateStub(env, key).fetch(new Request(`https://state/${action}`, {
    method: data === undefined ? "GET" : "POST",
    body: data === undefined ? undefined : JSON.stringify(data)
  }));
  if (!response.ok) throw new Error(`State operation failed: ${action}`);
  return response.json();
}

export async function monitor(env, now = new Date()) {
  // Activation is explicit, preventing a fresh deployment from mailing old editions.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env.START_DATE || "")) throw new Error("Set START_DATE before enabling the monitor");
  const hour = Number(formatInTimeZone(now, digestConfig.timezone, "H"));
  const sendHour = Number(digestConfig.sendTime.split(":")[0]);
  if (hour < sendHour || hour > sendHour + 3) return;
  const today = resolveDigestWindow({}, digestConfig, now);
  let date = today.slug;
  const issues = [];
  for (let offset = 0; offset < 3 && date >= env.START_DATE; offset++, date = previousLocalDate(date)) {
    const window = resolveDigestWindow({ start: `${previousLocalDate(date)}T${digestConfig.sendTime}:00`, end: `${date}T${digestConfig.sendTime}:00` }, digestConfig);
    const key = `daily-digest/${date}`;
    let state;
    try {
      state = await callState(env, key, "deliver", {});
      if (state?.status === "accepted") {
        // Alarms check provider delivery independently of GitHub.
        if (["bounced", "complained", "failed", "suppressed"].includes(state.deliveryStatus)) issues.push(`${date}: provider reports ${state.deliveryStatus}`);
        else if (state.receiptCheckFailed) issues.push(`${date}: accepted by Resend; delivery lookup unavailable`);
        else if (state.deliveryStatus !== "delivered" && +now - state.acceptedAt > 45 * 60_000) issues.push(`${date}: accepted by Resend; delivery not yet confirmed`);
        continue;
      }
      const decision = await callState(env, key, "dispatch", { key, window: { start: window.start.toISOString(), end: window.end.toISOString() } });
      state = decision.state;
      if (decision.dispatch) {
        const { response } = await fetchText(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/daily-digest.yml/dispatches`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "rss-feed-digest-monitor", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
          body: JSON.stringify({ ref: env.GITHUB_REF || "main", inputs: { dry_run: "false", start: window.start.toISOString(), end: window.end.toISOString() } })
        }, { maxBytes: 64_000 });
        if (response.status !== 204) throw new Error(`GitHub dispatch failed (${response.status})`);
      }
      if (+now - +window.end >= 15 * 60_000) issues.push(`${date}: ${state?.status || "no edition generated"}`);
    } catch (error) { issues.push(`${date}: ${error.message}`); }
  }
  if (issues.length) {
    console.error("Digest deadline check", issues.join("; "));
    // Use the same durable sender for one alert per day, never an untracked send.
    const key = `digest-alert/${today.slug}`;
    const owner = crypto.randomUUID();
    const claim = await callState(env, key, "claim", { key, owner, window: { start: today.start.toISOString(), end: today.end.toISOString() } });
    if (claim.acquired) {
      const text = `The daily digest needs attention.\n\n${issues.join("\n")}\n\nhttps://github.com/${env.GITHUB_REPOSITORY}/actions/workflows/daily-digest.yml\nAn accepted edition will not be resent automatically.`;
      const payload = JSON.stringify(prepareResendEmail({ from: env.DIGEST_FROM_EMAIL, to: String(env.DIGEST_TO_EMAIL || "").split(",").map(x => x.trim()).filter(Boolean), subject: `Daily digest delivery needs attention — ${today.slug}`, text }));
      // Alerts are text-only. Wrap the already escaped plain text for the common envelope contract.
      const envelope = JSON.parse(payload);
      envelope.html = `<pre>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`;
      await callState(env, key, "ready", { owner, payload: JSON.stringify(envelope) });
    }
    await callState(env, key, "deliver", {});
  }
}

export default {
  async fetch(request, env) {
    if (!env.DIGEST_STATE_TOKEN || !timingSafeEqual(request.headers.get("Authorization") || "", `Bearer ${env.DIGEST_STATE_TOKEN}`)) return new Response("Unauthorized", { status: 401 });
    const parts = new URL(request.url).pathname.split("/");
    if (parts.length !== 4 || parts[1] !== "state") return new Response("Not found", { status: 404 });
    let key;
    try { key = decodeURIComponent(parts[2]); } catch { return new Response("Invalid key", { status: 400 }); }
    if (!/^(daily-digest|digest-alert|subscriptions)\/[a-z0-9_-]{1,80}$/.test(key)) return new Response("Invalid key", { status: 400 });
    return stateStub(env, key).fetch(request);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(monitor(env, new Date(event.scheduledTime))); }
};
