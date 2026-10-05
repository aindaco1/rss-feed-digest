export const CACHE_MAX_AGE_MS = 7 * 86_400_000;

export function validSubscriptionCache(value, now = Date.now()) {
  const age = now - Date.parse(value?.generatedAt);
  return Number.isFinite(age) && age >= -300_000 && age <= CACHE_MAX_AGE_MS &&
    Array.isArray(value.feeds) && value.feeds.length > 0 && value.feeds.every(feed => {
      try { return Boolean(feed.title && feed.topic && ["https:", "http:"].includes(new URL(feed.feedUrl).protocol)); }
      catch { return false; }
    });
}
