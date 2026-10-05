export function assessCoverage({ successfulFeeds, activeFeedCount, failures, articles, notices = [], allowPartial = true }) {
  const missing = failures.map(feed => feed.title);
  const usable = successfulFeeds > 0 && successfulFeeds / activeFeedCount >= 0.5 && (!failures.length || articles.length > 0);
  const canSend = usable && (allowPartial || !failures.length);
  const messages = [...notices];
  if (missing.length) messages.push(`Partial coverage: ${missing.join(", ")} could not be loaded. Their articles are missing from this edition.`);
  if (!canSend) messages.unshift("Delivery held: too little source coverage to produce a reliable edition.");
  else if (!articles.length) messages.push("No new articles were published by the available feeds during this window.");
  return { canSend, successfulFeeds, activeFeedCount, missing, messages };
}
