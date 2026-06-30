const REQUIRED_FOR_SEND = [
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "DIGEST_FROM_EMAIL",
  "DIGEST_TO_EMAIL",
  "FEEDBIN_EMAIL",
  "FEEDBIN_PASSWORD"
];

const OPTIONAL = [
  "OPENAI_MODEL",
  "OPENAI_EMBEDDING_MODEL",
  "USE_EMBEDDINGS",
  "FETCH_OG_IMAGES",
  "FEED_CONCURRENCY",
  "FEED_FETCH_ATTEMPTS",
  "FEEDBIN_PER_PAGE",
  "FEEDBIN_SYNC_SUBSCRIPTIONS",
  "FEEDBIN_SYNC_EXTRA_TITLES",
  "SUBSTACK_ARCHIVE_LIMIT",
  "ALLOW_PARTIAL_DIGEST_SEND",
  "AI_MAX_CLUSTERS",
  "AI_SUMMARIZE_SINGLE_ARTICLES",
  "OVERCAST_SYNC_SUBSCRIPTIONS",
  "OVERCAST_TOPIC",
  "OVERCAST_MAX_SUBSCRIPTIONS",
  "OVERCAST_MAX_EPISODES_PER_FEED",
  "OVERCAST_OPML_ENCRYPTED_PATH",
  "OVERCAST_SKIP_UNAVAILABLE",
  "OVERCAST_CHECK_CONCURRENCY",
  "OVERCAST_CHECK_TIMEOUT_MS",
  "OVERCAST_SUBSCRIPTIONS_PATH",
  "YOUTUBE_SYNC_SUBSCRIPTIONS",
  "YOUTUBE_SYNC_REQUIRED",
  "YOUTUBE_TOPIC",
  "YOUTUBE_MAX_SUBSCRIPTIONS",
  "YOUTUBE_SKIP_UNAVAILABLE",
  "YOUTUBE_CHECK_CONCURRENCY",
  "YOUTUBE_CHECK_TIMEOUT_MS",
  "YOUTUBE_SUBSCRIPTIONS_PATH",
  "VIDEO_LITE_URL_TEMPLATE"
];

const REQUIRED_FOR_YOUTUBE_SYNC = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"];
const OVERCAST_OPML_SOURCES = ["OVERCAST_OPML_BASE64", "OVERCAST_OPML", "OVERCAST_OPML_PATH"];
const youtubeSyncEnabled = process.env.YOUTUBE_SYNC_SUBSCRIPTIONS === "true";
const youtubeSyncRequired = process.env.YOUTUBE_SYNC_REQUIRED === "true";
const overcastSyncEnabled = process.env.OVERCAST_SYNC_SUBSCRIPTIONS === "true";
const required = youtubeSyncEnabled && youtubeSyncRequired ? [...REQUIRED_FOR_SEND, ...REQUIRED_FOR_YOUTUBE_SYNC] : REQUIRED_FOR_SEND;
const missing = [
  ...required.filter((name) => !process.env[name]),
  ...(overcastSyncEnabled && !OVERCAST_OPML_SOURCES.some((name) => process.env[name]) ? ["one Overcast OPML source"] : [])
];

console.log("Required for scheduled send:");
for (const name of REQUIRED_FOR_SEND) {
  console.log(`- ${name}: ${process.env[name] ? "set" : "missing"}`);
}

console.log("\nOptional:");
for (const name of OPTIONAL) {
  console.log(`- ${name}: ${process.env[name] ? "set" : "default"}`);
}

if (youtubeSyncEnabled) {
  console.log(`\n${youtubeSyncRequired ? "Required" : "Optional"} for YouTube subscription sync:`);
  for (const name of REQUIRED_FOR_YOUTUBE_SYNC) {
    console.log(`- ${name}: ${process.env[name] ? "set" : "missing"}`);
  }
}

if (overcastSyncEnabled) {
  console.log("\nRequired for Overcast subscription sync:");
  for (const name of OVERCAST_OPML_SOURCES) {
    console.log(`- ${name}: ${process.env[name] ? "set" : "missing"}`);
  }
}

if (missing.length) {
  console.log(`\nMissing ${missing.length} required value(s): ${missing.join(", ")}`);
  process.exit(1);
}

console.log("\nEnvironment is ready for sending.");
