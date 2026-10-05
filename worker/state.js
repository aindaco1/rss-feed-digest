import { validSubscriptionCache } from "../src/feeds/subscriptionCache.js";
import { readBoundedJson } from "@dustwave/worker-core/response-body";
import { outboxRetryDelayMs, outboxDeliveryErrorEvidence } from "@dustwave/worker-core/outbox";
import { deliverFrozenEmail } from "../src/email/resendDelivery.js";
import { fetchText } from "../src/util/network.js";

export const LEASE_MS = 12 * 60_000;
export const RETRY_WINDOW_MS = 23 * 60 * 60_000; // Leave margin before Resend's 24-hour expiry.
export const MAX_PAYLOAD_BYTES = 1_500_000; // Below SQLite Durable Object's 2 MB value limit.
const RETENTION_MS = 7 * 86_400_000;
const terminal = state => ["accepted", "review"].includes(state?.status);
const json = (body, status = 200) => Response.json(body ?? null, { status });

export async function payloadHash(payload) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)))].map(n => n.toString(16).padStart(2, "0")).join("");
}

// One object per edition: storage transactions serialize claims, checkpoints,
// and attempts. Network I/O always happens outside the transaction.
export class DigestState {
  constructor(ctx, env) { this.storage = ctx.storage; this.env = env; }

  async fetch(request) {
    const action = new URL(request.url).pathname.split("/").at(-1);
    try {
      if (request.method === "GET") {
        if (action === "cache") return json(await this.storage.get("cache") || null);
        return json(await this.storage.get("state") || null);
      }
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const input = await readBoundedJson(request, MAX_PAYLOAD_BYTES * 2 + 100_000);
      if (action === "cache") {
        if (!validSubscriptionCache(input) || new TextEncoder().encode(JSON.stringify(input)).length > MAX_PAYLOAD_BYTES) throw new Error("Invalid cache");
        await this.storage.put("cache", input);
        return json({ saved: true });
      }
      if (action === "deliver") return json(await this.deliver());
      if (action === "reconcile") return json(await this.reconcile(input.providerId));
      if (action === "check") { await this.checkReceipt(); return json(await this.storage.get("state") || null); }
      if (!["claim", "checkpoint", "ready", "blocked", "dispatch"].includes(action)) return json({ error: "Unknown action" }, 404);
      let payload;
      let hash;
      if (action === "checkpoint" || action === "ready") {
        payload = input.payload;
        if (typeof payload !== "string" || new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES) throw new Error("Invalid or oversized email");
        const envelope = JSON.parse(payload);
        if (!envelope.html || !envelope.subject || !envelope.from || !Array.isArray(envelope.to) || !envelope.to.length) throw new Error("Invalid email envelope");
        hash = await payloadHash(payload);
      }
      const result = await this.storage.transaction(async tx => {
        const now = Date.now();
        const state = await tx.get("state") || { key: input.key, window: input.window, createdAt: now, attempts: 0 };
        if (action === "dispatch") {
          const dispatchDay = new Date(now).toISOString().slice(0, 10);
          if (state.dispatchDay !== dispatchDay) { state.dispatchDay = dispatchDay; state.dispatches = 0; }
          if (terminal(state) || state.leaseUntil > now || state.payloadHash || state.dispatches >= 3 || now - (state.lastDispatchAt || 0) < 15 * 60_000) return { state, dispatch: false };
          state.dispatches = (state.dispatches || 0) + 1;
          state.lastDispatchAt = now;
          await tx.put("state", state);
          return { state, dispatch: true };
        }
        if (action === "claim") {
          if (terminal(state)) return { state, acquired: false };
          if (state.leaseUntil > now) return { state, acquired: false };
          if (state.payloadHash) return { state, acquired: false, resume: true };
          if (!input.owner || !input.key || !input.window?.start || !input.window?.end) throw new Error("Invalid claim");
          Object.assign(state, { key: input.key, window: input.window, owner: input.owner, leaseUntil: now + LEASE_MS, status: "generating" });
          await tx.put("state", state);
          return { state, acquired: true };
        }
        if (!input.owner || input.owner !== state.owner || state.leaseUntil <= now || state.attempts || terminal(state)) return { error: "Edition is no longer owned by this generator", conflict: true };
        if (action === "blocked") {
          Object.assign(state, { status: "blocked", reason: String(input.reason || "insufficient_coverage"), leaseUntil: 0 });
        } else {
          await tx.put("payload", payload);
          Object.assign(state, { payloadHash: hash, status: action === "ready" ? "ready" : "draft" });
          if (action === "ready") state.leaseUntil = 0;
          await tx.setAlarm(action === "ready" ? now + 60_000 : state.leaseUntil + 1);
        }
        await tx.put("state", state);
        return { state };
      });
      return json(result, result.conflict ? 409 : 200);
    } catch (error) {
      console.error("State request failed", error.name);
      return json({ error: "Invalid state request or storage unavailable" }, 400);
    }
  }

  async deliver() {
    const attempt = await this.storage.transaction(async tx => {
      const state = await tx.get("state");
      const now = Date.now();
      if (!state || terminal(state) || !state.payloadHash || state.leaseUntil > now || state.nextAttemptAt > now) return { state };
      if (state.attempts >= 6 || (state.firstAttemptAt && now - state.firstAttemptAt >= RETRY_WINDOW_MS)) {
        state.status = "review";
        state.reason = "Delivery needs reconciliation; automatic retry limit reached";
        await tx.put("state", state);
        return { state };
      }
      const payload = await tx.get("payload");
      if (!payload || await payloadHash(payload) !== state.payloadHash) throw new Error("Frozen payload missing or changed");
      Object.assign(state, { status: "sending", firstAttemptAt: state.firstAttemptAt || now, lastAttemptAt: now, attempts: state.attempts + 1, leaseUntil: now + 60_000 });
      await tx.put("state", state); // Commit BEFORE the provider can accept anything.
      await tx.setAlarm(state.leaseUntil + 1); // Survives process death or lost response.
      return { state, payload };
    });
    if (!attempt.payload) return attempt.state;
    let receipt;
    let failure;
    try { receipt = await deliverFrozenEmail(attempt.payload, attempt.state.key, { apiKey: this.env.RESEND_API_KEY }); }
    catch (error) { failure = error; }
    return this.storage.transaction(async tx => {
      const state = await tx.get("state");
      if (state.attempts !== attempt.state.attempts || state.status !== "sending") throw new Error("Delivery ownership changed");
      state.leaseUntil = 0;
      if (receipt) {
        Object.assign(state, { status: "accepted", providerId: receipt.id, acceptedAt: Date.now(), deliveryStatus: "accepted" });
        await tx.setAlarm(Date.now() + 5 * 60_000);
      } else {
        state.error = outboxDeliveryErrorEvidence(failure);
        state.status = failure.retryable ? "retry" : "review";
        state.nextAttemptAt = Date.now() + outboxRetryDelayMs(failure, state.attempts, { minimumMs: 60_000, maximumMs: RETRY_WINDOW_MS });
        if (failure.retryable) await tx.setAlarm(state.nextAttemptAt);
        else await tx.deleteAlarm();
      }
      await tx.put("state", state);
      return state;
    });
  }

  async checkReceipt() {
    const state = await this.storage.get("state");
    if (state?.status !== "accepted") return;
    // Retain the acceptance tombstone permanently; remove private content after a week.
    if (Date.now() - state.acceptedAt >= RETENTION_MS) {
      await this.storage.delete("payload");
      await this.storage.deleteAlarm();
      return;
    }
    try {
      const { response, text } = await fetchText(`https://api.resend.com/emails/${encodeURIComponent(state.providerId)}`, {
        headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}` }
      }, { maxBytes: MAX_PAYLOAD_BYTES + 100_000 });
      const result = JSON.parse(text);
      if (!response.ok || result.id !== state.providerId || typeof result.last_event !== "string") throw new Error("Receipt lookup unavailable");
      state.deliveryStatus = result.last_event;
      state.receiptCheckedAt = Date.now();
      delete state.receiptCheckFailed;
    } catch { state.receiptCheckFailed = true; }
    await this.storage.put("state", state);
    await this.storage.setAlarm(["delivered", "bounced", "complained", "failed", "suppressed"].includes(state.deliveryStatus)
      ? state.acceptedAt + RETENTION_MS : Date.now() + 30 * 60_000);
  }

  async reconcile(providerId) {
    if (typeof providerId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(providerId)) throw new Error("Invalid provider ID");
    const original = await this.storage.get("state");
    if (original?.status === "accepted") return original;
    if (!original?.attempts || original.leaseUntil > Date.now()) throw new Error("No uncertain send available to reconcile");
    const payload = await this.storage.get("payload");
    const { response, text } = await fetchText(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`, {
      headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}` }
    }, { maxBytes: MAX_PAYLOAD_BYTES + 100_000 });
    const email = JSON.parse(text);
    const expected = JSON.parse(payload);
    if (!response.ok || email.id !== providerId || ["from", "subject", "html"].some(field => email[field] !== expected[field]) ||
        JSON.stringify([...(email.to || [])].sort()) !== JSON.stringify([...expected.to].sort())) throw new Error("Provider email does not match the frozen edition");
    return this.storage.transaction(async tx => {
      const state = await tx.get("state");
      if (state.payloadHash !== original.payloadHash || state.leaseUntil > Date.now()) throw new Error("Edition changed during reconciliation");
      Object.assign(state, { status: "accepted", providerId, acceptedAt: Date.now(), deliveryStatus: email.last_event || "accepted", reconciledAt: Date.now(), leaseUntil: 0 });
      await tx.put("state", state);
      await tx.setAlarm(Date.now() + 5 * 60_000);
      return state;
    });
  }

  async alarm() {
    const state = await this.storage.get("state");
    if (state?.status === "accepted") await this.checkReceipt();
    else await this.deliver();
  }
}
