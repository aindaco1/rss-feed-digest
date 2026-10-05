import { deliverFrozenEmail } from "./resendDelivery.js";
import { prepareResendEmail } from "@dustwave/worker-core/email";
import { htmlToText } from "../util/html.js";

export function buildDigestIdempotencyKey(windowSlug) {
  const normalizedSlug = String(windowSlug || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedSlug)) {
    throw new Error(`Invalid digest window slug: ${windowSlug}`);
  }

  return `daily-digest/${normalizedSlug}`;
}

export function buildDigestEmail({ html, subject, env = process.env }) {
  const from = env.DIGEST_FROM_EMAIL;
  const to = splitEmails(env.DIGEST_TO_EMAIL);
  if (!from) throw new Error("Missing DIGEST_FROM_EMAIL.");
  if (!to.length) throw new Error("Missing DIGEST_TO_EMAIL.");
  return JSON.stringify(prepareResendEmail({
    from, to, subject, html, text: htmlToText(html, { email: true })
  }, { replyTo: env.DIGEST_REPLY_TO_EMAIL }));
}

export async function sendDigestEmail({ html, subject, idempotencyKey, env = process.env }) {
  return deliverFrozenEmail(buildDigestEmail({ html, subject, env }), idempotencyKey, { apiKey: env.RESEND_API_KEY });
}

function splitEmails(value = "") {
  return String(value)
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}
