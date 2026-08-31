import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOCAL_ONLY_VARIABLES,
  OVERCAST_OPML_SOURCES,
  REQUIRED_FOR_SEND,
  REQUIRED_FOR_YOUTUBE_SYNC,
  WORKFLOW_VARIABLES,
  evaluateEnvironment
} from "../src/config/environment.js";

const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/daily-digest.yml", import.meta.url), "utf8");

function envExampleNames(value) {
  return new Set(
    value
      .split("\n")
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter(Boolean)
  );
}

function envExampleValues(value) {
  return new Map(
    value
      .split("\n")
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
      .filter(Boolean)
      .map(([, name, defaultValue]) => [name, defaultValue])
  );
}

function workflowVariableDefaults(value) {
  return new Map(
    value
      .split("\n")
      .map((line) =>
        line.match(/^\s*([A-Z][A-Z0-9_]*): \$\{\{ vars\.([A-Z][A-Z0-9_]*) \|\| '([^']*)' \}\}$/)
      )
      .filter((match) => match && match[1] === match[2])
      .map(([, name, , defaultValue]) => [name, defaultValue])
  );
}

test("documents every supported environment variable in the example file", () => {
  const documented = envExampleNames(envExample);
  const supported = [
    ...REQUIRED_FOR_SEND,
    ...REQUIRED_FOR_YOUTUBE_SYNC,
    ...OVERCAST_OPML_SOURCES,
    ...WORKFLOW_VARIABLES,
    ...LOCAL_ONLY_VARIABLES
  ];

  assert.deepEqual(
    [...new Set(supported)].filter((name) => !documented.has(name)),
    []
  );
});

test("forwards every scheduled-workflow variable from repository variables", () => {
  const missing = WORKFLOW_VARIABLES.filter(
    (name) => !workflow.includes(`${name}: \${{ vars.${name}`)
  );

  assert.deepEqual(missing, []);
});

test("keeps scheduled-workflow defaults aligned with the environment example", () => {
  const documentedDefaults = envExampleValues(envExample);
  const workflowDefaults = workflowVariableDefaults(workflow);
  const mismatches = WORKFLOW_VARIABLES.flatMap((name) => {
    const documented = documentedDefaults.get(name);
    const deployed = workflowDefaults.get(name);
    return documented === deployed ? [] : [{ name, documented, deployed }];
  });

  assert.deepEqual(mismatches, []);
});

test("requires optional sync credentials only when their blocking mode is enabled", () => {
  const sendEnv = Object.fromEntries(REQUIRED_FOR_SEND.map((name) => [name, "set"]));

  assert.deepEqual(evaluateEnvironment(sendEnv).missing, []);
  assert.deepEqual(
    evaluateEnvironment({
      ...sendEnv,
      YOUTUBE_SYNC_SUBSCRIPTIONS: "true",
      YOUTUBE_SYNC_REQUIRED: "true",
      OVERCAST_SYNC_SUBSCRIPTIONS: "true"
    }).missing,
    [...REQUIRED_FOR_YOUTUBE_SYNC, "one Overcast OPML source"]
  );
});
