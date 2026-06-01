import { readFileSync } from "node:fs";

export function loadConfig(path = new URL("../../config/feeds.json", import.meta.url)) {
  return JSON.parse(readFileSync(path, "utf8"));
}
