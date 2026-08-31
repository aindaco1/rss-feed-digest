const DEFAULT_API_BASE = "https://api.feedbin.com/v2";

export function feedbinAuthorization(env = process.env) {
  return `Basic ${Buffer.from(`${env.FEEDBIN_EMAIL}:${env.FEEDBIN_PASSWORD}`).toString("base64")}`;
}

export function feedbinApiUrl(path, options = {}) {
  const env = options.env || process.env;
  const apiBase = String(options.apiBase || env.FEEDBIN_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
  return new URL(path.replace(/^\//, ""), `${apiBase}/`);
}
