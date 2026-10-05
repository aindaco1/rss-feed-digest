import { ResendApiError, classifyResendFailure } from "@dustwave/worker-core/resend";
import { fetchText } from "../util/network.js";

// One attempt. The durable outbox owns retries so a runner restart cannot reset
// the retry window or replace a payload that may already have reached Resend.
export async function deliverFrozenEmail(payload, idempotencyKey, options = {}) {
  if (!options.apiKey) throw new ResendApiError("Missing RESEND_API_KEY", { type: "configuration" });
  if (!idempotencyKey) throw new Error("Missing idempotency key");
  let response;
  try {
    const result = await fetchText("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: payload
    }, { ...options, timeoutMs: options.timeoutMs ?? 15_000, maxBytes: 64_000 });
    response = result.response;
    let body;
    try { body = JSON.parse(result.text); } catch { /* Classify below, including malformed success. */ }
    if (response.ok && typeof body?.id === "string" && body.id.trim()) return { id: body.id };
    const evidence = classifyResendFailure(response.status, { retryAfter: response.headers.get("retry-after") });
    if (response.ok) Object.assign(evidence, { retryable: true, ambiguous: true });
    if (body?.name === "invalid_idempotent_request") evidence.retryable = false;
    throw new ResendApiError(`Resend did not confirm acceptance (${response.status})`, {
      ...evidence, type: body?.name || (response.ok ? "invalid_receipt" : "provider_error")
    });
  } catch (error) {
    if (error instanceof ResendApiError) throw error;
    throw new ResendApiError("Resend response unavailable", {
      ...classifyResendFailure(response?.status || 0), retryable: true, ambiguous: true, type: "transport"
    });
  }
}
