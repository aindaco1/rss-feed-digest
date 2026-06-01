const REQUIRED_FOR_SEND = [
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "DIGEST_FROM_EMAIL",
  "DIGEST_TO_EMAIL"
];

const OPTIONAL = [
  "OPENAI_MODEL",
  "OPENAI_EMBEDDING_MODEL",
  "USE_EMBEDDINGS",
  "FETCH_OG_IMAGES",
  "FEED_CONCURRENCY",
  "FEED_FETCH_ATTEMPTS",
  "SUBSTACK_ARCHIVE_LIMIT",
  "ALLOW_PARTIAL_DIGEST_SEND",
  "AI_MAX_CLUSTERS",
  "AI_SUMMARIZE_SINGLE_ARTICLES"
];

const missing = REQUIRED_FOR_SEND.filter((name) => !process.env[name]);

console.log("Required for scheduled send:");
for (const name of REQUIRED_FOR_SEND) {
  console.log(`- ${name}: ${process.env[name] ? "set" : "missing"}`);
}

console.log("\nOptional:");
for (const name of OPTIONAL) {
  console.log(`- ${name}: ${process.env[name] ? "set" : "default"}`);
}

if (missing.length) {
  console.log(`\nMissing ${missing.length} required value(s): ${missing.join(", ")}`);
  process.exit(1);
}

console.log("\nEnvironment is ready for sending.");
