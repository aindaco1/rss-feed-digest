import crypto from "node:crypto";

const STOP_WORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "all",
  "also",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "can",
  "could",
  "did",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "more",
  "new",
  "not",
  "of",
  "on",
  "or",
  "out",
  "over",
  "than",
  "that",
  "the",
  "their",
  "this",
  "through",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your"
]);

const LOW_SIGNAL_TERMS = new Set([
  "1hr",
  "allegedly",
  "announce",
  "announced",
  "announcement",
  "announces",
  "apple",
  "according",
  "best",
  "books",
  "code",
  "coming",
  "confirmed",
  "coupon",
  "daily",
  "day",
  "deal",
  "discount",
  "edition",
  "effectively",
  "every",
  "everything",
  "faster",
  "fix",
  "genre",
  "future",
  "game",
  "google",
  "hack",
  "help",
  "horror",
  "image",
  "include",
  "install",
  "imdb",
  "know",
  "latest",
  "launch",
  "min",
  "movie",
  "nearly",
  "news",
  "now",
  "off",
  "open",
  "partnership",
  "patch",
  "phone",
  "podcast",
  "promo",
  "quote",
  "rating",
  "ready",
  "report",
  "reported",
  "reportedly",
  "review",
  "right",
  "rumored",
  "runtime",
  "see",
  "search",
  "security",
  "show",
  "showcase",
  "should",
  "size",
  "star",
  "streaming",
  "tip",
  "tips",
  "top",
  "trailer",
  "thriller",
  "update",
  "user",
  "using",
  "watch",
  "watching",
  "watt",
  "weekend",
  "work",
  "year",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
]);

const FIELD_WEIGHTS = {
  titleTerm: 4,
  summaryTerm: 2,
  bodyTerm: 0.65,
  titlePhrase: 7,
  leadPhrase: 3
};

export function clusterArticles(articles, options = {}) {
  const settings = clusterSettings(options);
  const vectorsById = options.vectorsById || new Map();
  const sorted = [...articles].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const profilesById = buildArticleProfiles(sorted);
  const clusters = [];

  for (const article of sorted) {
    const articleProfile = profilesById.get(article.id);
    let match = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      const score = similarity(article, articleProfile, cluster, vectorsById, settings);
      if (score > bestScore) {
        bestScore = score;
        match = cluster;
      }
    }

    if (match && bestScore >= settings.threshold) {
      match.articles.push(article);
      match.profiles.push(articleProfile);
      match.latestPublishedAt = maxDate(match.latestPublishedAt, article.publishedAt);
      continue;
    }

    clusters.push({
      id: hash(article.id),
      topicHint: article.topicHint,
      latestPublishedAt: article.publishedAt,
      profiles: [articleProfile],
      articles: [article]
    });
  }

  return mergeClusters(clusters, settings)
    .map((cluster) => ({
      ...cluster,
      id: hash(cluster.articles.map((article) => article.id).sort().join(":")),
      topicHint: dominantTopic(cluster.articles)
    }))
    .sort((a, b) => new Date(b.latestPublishedAt) - new Date(a.latestPublishedAt));
}

function clusterSettings(options) {
  return {
    threshold: numberSetting(options.threshold, "CLUSTER_THRESHOLD", 0.42),
    embeddingThreshold: numberSetting(options.embeddingThreshold, "EMBEDDING_CLUSTER_THRESHOLD", 0.84),
    crossSourceStrongSemanticThreshold: numberSetting(
      options.crossSourceStrongSemanticThreshold,
      "CLUSTER_CROSS_SOURCE_STRONG_SEMANTIC_THRESHOLD",
      0.24
    ),
    crossSourceSemanticThreshold: numberSetting(
      options.crossSourceSemanticThreshold,
      "CLUSTER_CROSS_SOURCE_SEMANTIC_THRESHOLD",
      0.075
    ),
    crossSourcePhraseSemanticThreshold: numberSetting(
      options.crossSourcePhraseSemanticThreshold,
      "CLUSTER_CROSS_SOURCE_PHRASE_SEMANTIC_THRESHOLD",
      0.03
    ),
    crossSourceSparseSemanticThreshold: numberSetting(
      options.crossSourceSparseSemanticThreshold,
      "CLUSTER_CROSS_SOURCE_SPARSE_SEMANTIC_THRESHOLD",
      0.02
    ),
    sameSourceStrongSemanticThreshold: numberSetting(
      options.sameSourceStrongSemanticThreshold,
      "CLUSTER_SAME_SOURCE_STRONG_SEMANTIC_THRESHOLD",
      0.3
    ),
    sameSourceSemanticThreshold: numberSetting(
      options.sameSourceSemanticThreshold,
      "CLUSTER_SAME_SOURCE_SEMANTIC_THRESHOLD",
      0.07
    ),
    sameSourcePhraseSemanticThreshold: numberSetting(
      options.sameSourcePhraseSemanticThreshold,
      "CLUSTER_SAME_SOURCE_PHRASE_SEMANTIC_THRESHOLD",
      0.045
    ),
    sameSourceLeadPhraseSemanticThreshold: numberSetting(
      options.sameSourceLeadPhraseSemanticThreshold,
      "CLUSTER_SAME_SOURCE_LEAD_PHRASE_SEMANTIC_THRESHOLD",
      0.02
    ),
    minSharedSignals: numberSetting(options.minSharedSignals, "CLUSTER_MIN_SHARED_SIGNALS", 2),
    minSharedPhrases: numberSetting(options.minSharedPhrases, "CLUSTER_MIN_SHARED_PHRASES", 1),
    minSharedStrongPhrases: numberSetting(options.minSharedStrongPhrases, "CLUSTER_MIN_SHARED_STRONG_PHRASES", 2),
    noBroadClusterTopics: topicSet(
      options.noBroadClusterTopics ||
        process.env.NO_BROAD_CLUSTER_TOPICS ||
        options.noCrossSourceClusterTopics ||
        process.env.NO_CROSS_SOURCE_CLUSTER_TOPICS ||
        "Downloads,Sports,Local"
    )
  };
}

function numberSetting(optionValue, envName, defaultValue) {
  if (optionValue !== undefined) return Number(optionValue);
  if (process.env[envName] !== undefined) return Number(process.env[envName]);
  return defaultValue;
}

function similarity(article, articleProfile, cluster, vectorsById, settings) {
  const sameCanonical = cluster.articles.some((candidate) => candidate.canonicalUrl === article.canonicalUrl);
  if (sameCanonical) return 1;

  const sameSourceCluster = cluster.articles.every((candidate) => candidate.sourceName === article.sourceName);

  const vector = vectorsById.get(article.id);
  if (vector && !sameSourceCluster) {
    const vectorScore = Math.max(
      ...cluster.articles.map((candidate) => {
        const candidateVector = vectorsById.get(candidate.id);
        return candidateVector ? cosine(vector, candidateVector) : 0;
      })
    );

    if (vectorScore >= settings.embeddingThreshold) return vectorScore;
  }

  if (isTopicExcluded(article.topicHint, settings.noBroadClusterTopics)) return 0;
  if (cluster.articles.some((candidate) => isTopicExcluded(candidate.topicHint, settings.noBroadClusterTopics))) {
    return 0;
  }
  if (cluster.profiles.some((candidateProfile) => candidateProfile.isCommerce !== articleProfile.isCommerce)) {
    return 0;
  }

  const pairScores = cluster.profiles.map((candidateProfile, index) =>
    pairScore(articleProfile, candidateProfile, article.sourceName === cluster.articles[index].sourceName, settings)
  );
  const acceptedScores = pairScores.filter((score) => score.accepted);
  if (!acceptedScores.length) return 0;

  const clusterIsCoherent = pairScores.every((score) => score.accepted || isClusterCompatible(score.evidence, settings));
  if (!clusterIsCoherent) return 0;

  const bestPairScore = Math.max(...acceptedScores.map((score) => score.score));
  return Math.max(settings.threshold, bestPairScore);
}

function pairScore(articleProfile, candidateProfile, sameSource, settings) {
  const evidence = pairEvidence(articleProfile, candidateProfile);
  const accepted = sameSource
    ? isSameSourceMatch(evidence, settings)
    : isCrossSourceMatch(evidence, settings);
  return {
    accepted,
    score: evidence.semanticScore,
    evidence
  };
}

function pairEvidence(a, b) {
  return {
    semanticScore: weightedCosine(a.vector, b.vector),
    sharedSignals: intersectionSize(a.signals, b.signals),
    sharedPhraseSignals: intersectionSize(a.phraseSignals, b.phraseSignals),
    sharedTitleSignals: intersectionSize(a.titleSignals, b.titleSignals),
    sharedLeadSignals: intersectionSize(a.leadSignals, b.leadSignals),
    sharedTitlePhraseSignals: intersectionSize(a.titlePhraseSignals, b.titlePhraseSignals),
    sharedTitleLeadPhraseSignals:
      intersectionSize(a.titlePhraseSignals, b.leadPhraseSignals) +
      intersectionSize(a.leadPhraseSignals, b.titlePhraseSignals)
  };
}

function isCrossSourceMatch(evidence, settings) {
  return (
    (evidence.semanticScore >= settings.crossSourceStrongSemanticThreshold &&
      evidence.sharedPhraseSignals >= settings.minSharedPhrases &&
      evidence.sharedSignals >= settings.minSharedSignals + 1) ||
    (evidence.semanticScore >= settings.crossSourceSemanticThreshold &&
      evidence.sharedSignals >= settings.minSharedSignals + 2 &&
      evidence.sharedPhraseSignals >= settings.minSharedPhrases) ||
    (evidence.semanticScore >= settings.crossSourcePhraseSemanticThreshold &&
      evidence.sharedTitlePhraseSignals >= settings.minSharedPhrases &&
      evidence.sharedTitleSignals >= settings.minSharedSignals) ||
    (evidence.semanticScore >= settings.crossSourceSparseSemanticThreshold &&
      evidence.sharedSignals >= settings.minSharedSignals + 6 &&
      evidence.sharedPhraseSignals >= settings.minSharedStrongPhrases + 1) ||
    (evidence.semanticScore >= settings.crossSourcePhraseSemanticThreshold &&
      evidence.sharedPhraseSignals >= settings.minSharedStrongPhrases)
  );
}

function isSameSourceMatch(evidence, settings) {
  const sharedTitleInvolvedPhrases =
    evidence.sharedTitlePhraseSignals + evidence.sharedTitleLeadPhraseSignals;

  return (
    (evidence.semanticScore >= settings.sameSourceStrongSemanticThreshold &&
      sharedTitleInvolvedPhrases >= settings.minSharedPhrases &&
      evidence.sharedSignals >= settings.minSharedSignals + 1) ||
    (evidence.semanticScore >= settings.sameSourceSemanticThreshold &&
      evidence.sharedSignals >= settings.minSharedSignals + 2 &&
      sharedTitleInvolvedPhrases >= settings.minSharedPhrases) ||
    (evidence.semanticScore >= settings.sameSourceLeadPhraseSemanticThreshold &&
      evidence.sharedSignals >= settings.minSharedSignals + 1 &&
      evidence.sharedTitleLeadPhraseSignals >= settings.minSharedPhrases) ||
    (evidence.semanticScore >= settings.sameSourcePhraseSemanticThreshold &&
      sharedTitleInvolvedPhrases >= settings.minSharedStrongPhrases)
  );
}

function isClusterCompatible(evidence, settings) {
  return (
    evidence.sharedPhraseSignals >= settings.minSharedPhrases ||
    evidence.sharedSignals >= settings.minSharedSignals + 1 ||
    (evidence.semanticScore >= settings.crossSourcePhraseSemanticThreshold &&
      evidence.sharedSignals >= settings.minSharedSignals)
  );
}

function mergeClusters(clusters, settings) {
  const merged = [...clusters];
  let changed = true;

  while (changed) {
    changed = false;

    for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < merged.length; rightIndex += 1) {
        if (!clustersCanMerge(merged[leftIndex], merged[rightIndex], settings)) continue;

        merged[leftIndex] = combineClusters(merged[leftIndex], merged[rightIndex]);
        merged.splice(rightIndex, 1);
        changed = true;
        break;
      }

      if (changed) break;
    }
  }

  return merged;
}

function clustersCanMerge(left, right, settings) {
  if (left.articles.some((article) => isTopicExcluded(article.topicHint, settings.noBroadClusterTopics))) return false;
  if (right.articles.some((article) => isTopicExcluded(article.topicHint, settings.noBroadClusterTopics))) return false;
  if (left.profiles.some((leftProfile) => right.profiles.some((rightProfile) => leftProfile.isCommerce !== rightProfile.isCommerce))) {
    return false;
  }

  let hasAcceptedPair = false;

  for (let leftIndex = 0; leftIndex < left.profiles.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.profiles.length; rightIndex += 1) {
      const sameSource = left.articles[leftIndex].sourceName === right.articles[rightIndex].sourceName;
      const score = pairScore(left.profiles[leftIndex], right.profiles[rightIndex], sameSource, settings);
      if (score.accepted) {
        hasAcceptedPair = true;
        continue;
      }
      if (!isClusterCompatible(score.evidence, settings)) return false;
    }
  }

  return hasAcceptedPair;
}

function combineClusters(left, right) {
  return {
    id: left.id,
    topicHint: dominantTopic([...left.articles, ...right.articles]),
    latestPublishedAt: maxDate(left.latestPublishedAt, right.latestPublishedAt),
    profiles: [...left.profiles, ...right.profiles],
    articles: [...left.articles, ...right.articles]
  };
}

function buildArticleProfiles(articles) {
  const rawProfiles = articles.map(rawArticleProfile);
  const documentFrequency = featureDocumentFrequency(rawProfiles);
  const articleCount = rawProfiles.length;

  return new Map(
    rawProfiles.map((rawProfile) => [
      rawProfile.article.id,
      finalizeProfile(rawProfile, documentFrequency, articleCount)
    ])
  );
}

function rawArticleProfile(article) {
  const titleTokens = tokenList(article.title);
  const summaryTokens = tokenList(String(article.summary || "").slice(0, 900));
  const bodyTokens = tokenList(String(article.text || "").slice(0, 1800));
  const leadTokens = tokenList(
    `${article.title || ""} ${String(article.summary || "").slice(0, 600)} ${String(article.text || "").slice(0, 600)}`
  );
  const titlePhrases = phrasePairs(titleTokens);
  const leadPhrases = phrasePairs(leadTokens);
  const featureCounts = new Map();

  addFeatures(featureCounts, titleTokens.map(termFeature), FIELD_WEIGHTS.titleTerm);
  addFeatures(featureCounts, summaryTokens.map(termFeature), FIELD_WEIGHTS.summaryTerm);
  addFeatures(featureCounts, bodyTokens.map(termFeature), FIELD_WEIGHTS.bodyTerm);
  addFeatures(featureCounts, titlePhrases.map(phraseFeature), FIELD_WEIGHTS.titlePhrase);
  addFeatures(featureCounts, leadPhrases.map(phraseFeature), FIELD_WEIGHTS.leadPhrase);

  return {
    article,
    isCommerce: isCommerceArticle(article),
    titleTokens,
    leadTokens,
    titlePhrases,
    leadPhrases,
    featureCounts
  };
}

function finalizeProfile(rawProfile, documentFrequency, articleCount) {
  const vector = new Map();
  for (const [feature, count] of rawProfile.featureCounts) {
    const inverseDocumentFrequency = idf(articleCount, documentFrequency.get(feature) || 0);
    vector.set(feature, Math.sqrt(count) * inverseDocumentFrequency);
  }

  const titleSignals = signalFeatures(rawProfile.titleTokens, rawProfile.titlePhrases, documentFrequency, articleCount);
  const leadSignals = signalFeatures(rawProfile.leadTokens, rawProfile.leadPhrases, documentFrequency, articleCount);
  const titlePhraseSignals = phraseSignalFeatures(rawProfile.titlePhrases, documentFrequency, articleCount);
  const leadPhraseSignals = phraseSignalFeatures(rawProfile.leadPhrases, documentFrequency, articleCount);
  const signals = union(titleSignals, leadSignals);
  const phraseSignals = new Set([...signals].filter((feature) => feature.startsWith("p:")));

  return {
    vector,
    signals,
    phraseSignals,
    titleSignals,
    leadSignals,
    titlePhraseSignals,
    leadPhraseSignals,
    isCommerce: rawProfile.isCommerce,
    magnitude: magnitude(vector)
  };
}

function isCommerceArticle(article) {
  const value = `${article.title || ""} ${String(article.summary || "").slice(0, 600)} ${String(article.text || "").slice(0, 400)}`;
  return /\b(?:coupon|promo code|discount|deal|sale|save\s+\$|\$\d+(?:\.\d{2})?\s+off|off right now|price drop|lowest price|prime day|get deal)\b/i.test(
    value
  );
}

function featureDocumentFrequency(rawProfiles) {
  const counts = new Map();
  for (const profile of rawProfiles) {
    for (const feature of profile.featureCounts.keys()) {
      counts.set(feature, (counts.get(feature) || 0) + 1);
    }
  }
  return counts;
}

function signalFeatures(tokens, phrases, documentFrequency, articleCount) {
  const signals = new Set();
  for (const token of tokens) {
    const feature = termFeature(token);
    if (isSignalFeature(feature, documentFrequency, articleCount)) signals.add(feature);
  }
  for (const phrase of phrases) {
    const feature = phraseFeature(phrase);
    if (isSignalFeature(feature, documentFrequency, articleCount)) signals.add(feature);
  }
  return signals;
}

function phraseSignalFeatures(phrases, documentFrequency, articleCount) {
  const signals = new Set();
  for (const phrase of phrases) {
    const feature = phraseFeature(phrase);
    if (isSignalFeature(feature, documentFrequency, articleCount)) signals.add(feature);
  }
  return signals;
}

function isSignalFeature(feature, documentFrequency, articleCount) {
  const value = feature.slice(2);
  const frequency = documentFrequency.get(feature) || 0;
  const inverseDocumentFrequency = idf(articleCount, frequency);

  if (feature.startsWith("t:")) {
    return inverseDocumentFrequency >= 1.06 && isSignalToken(value);
  }

  const terms = value.split(" ");
  return (
    inverseDocumentFrequency >= 1.03 &&
    terms.filter(isSignalToken).length >= 2 &&
    !terms.every((term) => /^\d+$/.test(term))
  );
}

function isSignalToken(term) {
  return (
    term.length > 2 &&
    !LOW_SIGNAL_TERMS.has(term) &&
    !/^\d+$/.test(term) &&
    !/^(?:19|20)\d{2}$/.test(term) &&
    !/^(?:720p|1080p|2160p|web(?:rip|dl)|bluray|yts)$/i.test(term)
  );
}

function addFeatures(counts, features, weight) {
  for (const feature of features) {
    counts.set(feature, (counts.get(feature) || 0) + weight);
  }
}

function tokenList(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
    .map(normalizeToken);
}

function normalizeToken(term) {
  if (term.length > 5 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && term.endsWith("es") && !/(?:ss|us)$/.test(term)) return term.slice(0, -2);
  if (term.length > 4 && term.endsWith("s") && !/(?:ss|us)$/.test(term)) return term.slice(0, -1);
  return term;
}

function phrasePairs(tokens) {
  const phrases = new Set();
  const signalTokens = tokens.filter((token) => !/^\d+$/.test(token));

  for (let index = 0; index < signalTokens.length - 1; index += 1) {
    for (let offset = index + 1; offset < Math.min(index + 5, signalTokens.length); offset += 1) {
      phrases.add(`${signalTokens[index]} ${signalTokens[offset]}`);
    }
  }

  return [...phrases];
}

function termFeature(term) {
  return `t:${term}`;
}

function phraseFeature(phrase) {
  return `p:${phrase}`;
}

function idf(articleCount, frequency) {
  return Math.log((articleCount + 1) / (frequency + 0.5)) + 1;
}

function weightedCosine(a, b) {
  const aMagnitude = magnitude(a);
  const bMagnitude = magnitude(b);
  if (!aMagnitude || !bMagnitude) return 0;

  let dot = 0;
  const [smaller, larger] = a.size < b.size ? [a, b] : [b, a];
  for (const [feature, weight] of smaller) {
    dot += weight * (larger.get(feature) || 0);
  }

  return dot / (aMagnitude * bMagnitude);
}

function magnitude(vector) {
  let sum = 0;
  for (const weight of vector.values()) {
    sum += weight * weight;
  }
  return Math.sqrt(sum);
}

function intersectionSize(a, b) {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  return intersection;
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

function topicSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set(
    String(value || "")
      .split(",")
      .map((topic) => topic.trim())
      .filter(Boolean)
  );
}

function isTopicExcluded(topic, excludedTopics) {
  return topic && excludedTopics.has(topic);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}
