import crypto from "node:crypto";

const STOP_WORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "new",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
  "you",
  "your"
]);

export function clusterArticles(articles, options = {}) {
  const threshold = Number(options.threshold || process.env.CLUSTER_THRESHOLD || 0.42);
  const embeddingThreshold = Number(options.embeddingThreshold || process.env.EMBEDDING_CLUSTER_THRESHOLD || 0.84);
  const vectorsById = options.vectorsById || new Map();
  const sorted = [...articles].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const clusters = [];

  for (const article of sorted) {
    const articleTerms = termsForArticle(article);
    let match = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      const score = similarity(article, articleTerms, cluster, vectorsById);
      if (score > bestScore) {
        bestScore = score;
        match = cluster;
      }
    }

    if (match && (bestScore >= threshold || bestScore >= embeddingThreshold)) {
      match.articles.push(article);
      match.terms = union(match.terms, articleTerms.combined);
      match.latestPublishedAt = maxDate(match.latestPublishedAt, article.publishedAt);
      continue;
    }

    clusters.push({
      id: hash(article.id),
      topicHint: article.topicHint,
      latestPublishedAt: article.publishedAt,
      terms: articleTerms.combined,
      titleTerms: articleTerms.title,
      articles: [article]
    });
  }

  return clusters
    .map((cluster) => ({
      ...cluster,
      id: hash(cluster.articles.map((article) => article.id).sort().join(":")),
      topicHint: dominantTopic(cluster.articles)
    }))
    .sort((a, b) => new Date(b.latestPublishedAt) - new Date(a.latestPublishedAt));
}

function similarity(article, articleTerms, cluster, vectorsById) {
  const sameCanonical = cluster.articles.some((candidate) => candidate.canonicalUrl === article.canonicalUrl);
  if (sameCanonical) return 1;

  const sameSourceCluster = cluster.articles.every((candidate) => candidate.sourceName === article.sourceName);
  if (sameSourceCluster) return 0;

  const vector = vectorsById.get(article.id);
  if (vector) {
    const vectorScore = Math.max(
      ...cluster.articles.map((candidate) => {
        const candidateVector = vectorsById.get(candidate.id);
        return candidateVector ? cosine(vector, candidateVector) : 0;
      })
    );

    if (vectorScore >= 0.84) return vectorScore;
  }

  const titleScore = jaccard(articleTerms.title, cluster.titleTerms);
  const bodyScore = jaccard(articleTerms.combined, cluster.terms);

  if (titleScore >= 0.58 && bodyScore >= 0.2) return Math.max(titleScore, bodyScore);
  return bodyScore;
}

function termsForArticle(article) {
  const title = tokenize(article.title);
  const combined = tokenize(`${article.title} ${article.summary} ${article.text.slice(0, 1200)}`);
  return { title, combined };
}

function tokenize(value) {
  const terms = String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));

  return new Set(terms);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function union(a, b) {
  return new Set([...a, ...b]);
}

function cosine(a, b) {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    aMag += a[index] * a[index];
    bMag += b[index] * b[index];
  }

  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function dominantTopic(articles) {
  const counts = new Map();
  for (const article of articles) {
    counts.set(article.topicHint, (counts.get(article.topicHint) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Culture";
}

function maxDate(a, b) {
  return new Date(a) > new Date(b) ? a : b;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}
