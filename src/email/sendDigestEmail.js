export async function sendDigestEmail({ html, subject, idempotencyKey, env = process.env }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.DIGEST_FROM_EMAIL;
  const to = splitEmails(env.DIGEST_TO_EMAIL);

  if (!apiKey) throw new Error("Missing RESEND_API_KEY.");
  if (!from) throw new Error("Missing DIGEST_FROM_EMAIL.");
  if (!to.length) throw new Error("Missing DIGEST_TO_EMAIL.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Resend failed (${response.status}): ${body.message || JSON.stringify(body)}`);
  }

  return body;
}

function splitEmails(value = "") {
  return String(value)
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}
