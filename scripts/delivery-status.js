import { parseArgs } from "../src/util/args.js";
import { buildDigestIdempotencyKey } from "../src/email/sendDigestEmail.js";
import { createStateClient } from "../src/digest/stateClient.js";

// GET by default. Reconciliation verifies the provider's stored email against
// the frozen envelope; it records acceptance and never sends an email.
try {
  const args = parseArgs();
  if (!args.date) throw new Error("Usage: node scripts/delivery-status.js --date YYYY-MM-DD [--refresh | --reconcile PROVIDER_ID]");
  const state = createStateClient();
  const key = buildDigestIdempotencyKey(args.date);
  const result = args.reconcile
    ? await state(key, "reconcile", { providerId: args.reconcile })
    : args.refresh ? await state(key, "check", {}) : await state(key, "status");
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
