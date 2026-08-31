import {
  OPTIONAL_VARIABLES,
  OVERCAST_OPML_SOURCES,
  REQUIRED_FOR_SEND,
  REQUIRED_FOR_YOUTUBE_SYNC,
  evaluateEnvironment
} from "./environment.js";

const { missing, overcastSyncEnabled, youtubeSyncEnabled, youtubeSyncRequired } =
  evaluateEnvironment(process.env);

console.log("Required for scheduled send:");
for (const name of REQUIRED_FOR_SEND) {
  console.log(`- ${name}: ${process.env[name] ? "set" : "missing"}`);
}

console.log("\nOptional:");
for (const name of OPTIONAL_VARIABLES) {
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
