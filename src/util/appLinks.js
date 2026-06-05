export function appLinkForArticle(article, env = process.env) {
  if (article?.sourceType === "podcast" && isWebUrl(article.overcastUrl)) {
    return {
      label: "Open in Overcast",
      url: article.overcastUrl
    };
  }

  if (article?.sourceType === "youtube" && article.url) {
    const template = env.VIDEO_LITE_URL_TEMPLATE || "";
    if (!template) return null;

    return {
      label: "Open in Video Lite",
      url: applyUrlTemplate(template, article.url)
    };
  }

  return null;
}

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function applyUrlTemplate(template, url) {
  const videoId = youtubeVideoId(url) || "";
  return String(template)
    .replaceAll("{url}", url)
    .replaceAll("{encodedUrl}", encodeURIComponent(url))
    .replaceAll("{videoId}", encodeURIComponent(videoId));
}

function youtubeVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (host.endsWith("youtube.com")) {
      if (url.searchParams.get("v")) return url.searchParams.get("v");

      const [first, second] = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "v"].includes(first)) return second || "";
    }
  } catch {
    return "";
  }

  return "";
}
