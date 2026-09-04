// Groups articles covering the same story across different sources, purely
// by title token overlap - no AI call, so it costs nothing and can run on
// every ingestion cycle regardless of the Gemini quota.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'at', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it',
  'its', 'this', 'that', 'these', 'those', 'as', 'how', 'why', 'what', 'who',
  'after', 'before', 'into', 'about', 'over', 'under', 'new', 'vs', 'says',
  'says', 'you', 'your', 'we', 'our', 'has', 'have', 'had', 'not', 'now',
  'up', 'out', 'just', 'more', 'than', 'will', 'can', 'could', 'would'
]);

function tokenize(title) {
  return new Set(
    (title || '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function sharedTokenCount(setA, setB) {
  let shared = 0;
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const token of smaller) {
    if (larger.has(token)) shared++;
  }
  return shared;
}

const SIMILARITY_THRESHOLD = 0.45; // shared / union of significant title tokens
const MIN_SHARED_TOKENS = 3; // avoid clustering short titles on a couple of generic words

// Mutates the given articles in place: non-primary members of a cluster get
// `clusterPrimaryId` pointing at the primary (earliest-published) article;
// the primary gets `relatedSources`, a list of the others covering the
// same story. Singleton stories are untouched.
export function clusterArticles(articles) {
  const n = articles.length;
  const tokenSets = articles.map((a) => tokenize(a.title));

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(x, y) {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const setA = tokenSets[i];
      const setB = tokenSets[j];
      const shared = sharedTokenCount(setA, setB);
      if (shared < MIN_SHARED_TOKENS) continue;

      const union_ = setA.size + setB.size - shared;
      const similarity = union_ === 0 ? 0 : shared / union_;
      if (similarity >= SIMILARITY_THRESHOLD) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  for (const indices of groups.values()) {
    if (indices.length < 2) continue;

    const sorted = [...indices].sort(
      (a, b) => new Date(articles[a].pubDate).getTime() - new Date(articles[b].pubDate).getTime()
    );
    const primaryIdx = sorted[0];
    const primary = articles[primaryIdx];

    primary.relatedSources = indices
      .filter((idx) => idx !== primaryIdx)
      .map((idx) => ({
        id: articles[idx].id,
        title: articles[idx].title,
        url: articles[idx].url,
        source: articles[idx].source
      }));

    for (const idx of indices) {
      if (idx !== primaryIdx) {
        articles[idx].clusterPrimaryId = primary.id;
      }
    }
  }

  return articles;
}
