import { pathToFileURL } from "node:url";

export function isDirectRun(moduleUrl, entryPath = process.argv[1]) {
  return Boolean(entryPath && moduleUrl === pathToFileURL(entryPath).href);
}
