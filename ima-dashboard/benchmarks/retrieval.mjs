// Manual integration benchmark against a configured Supabase database.
// No Gemini calls and no writes. Never run against a production service role
// account unless read traffic is acceptable. Results depend on DB size/cache.
import { performance } from 'node:perf_hooks';
import { dbEnabled, getAllArticlesForNaiveSearch, queryPgvectorIndex } from '../server/db.js';

const rounds = Number(process.argv[2] ?? 5);
if (!dbEnabled || !Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run npm run benchmark:retrieval -- [rounds 1..20].');
  process.exit(1);
}

const articles = await getAllArticlesForNaiveSearch();
const candidates = articles.filter((row) => Array.isArray(row.embedding) && row.embedding.length > 0);
if (!candidates.length) {
  console.error('No embedded articles found. Use a database with populated embeddings.');
  process.exit(1);
}

const query = candidates[0].embedding; // fixed, existing vector; no API bill or nondeterministic LLM
const topK = 5;
function cosine(a, b) {
  if (a.length !== b.length) return -Infinity;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -Infinity;
}
function linearScan(rows) {
  return rows.filter((row) => Array.isArray(row.embedding) && row.embedding.length)
    .map((row) => ({ id: row.id, score: cosine(query, row.embedding) }))
    .sort((a, b) => b.score - a.score).slice(0, topK);
}
async function measure(method) {
  const start = performance.now();
  const hits = method === 'indexed'
    ? await queryPgvectorIndex(query, topK)
    : linearScan(await getAllArticlesForNaiveSearch());
  if (method === 'indexed' && !hits.length) throw new Error('Indexed query returned no hits; check RPC errors and configuration.');
  return { ms: performance.now() - start, ids: hits.map((hit) => hit.id) };
}
const samples = { indexed: [], linear: [] };
await measure('indexed'); await measure('linear'); // warm-up; excluded
for (let i = 0; i < rounds; i++) {
  // Alternate order to limit cache/order bias; neither path includes embedding or LLM time.
  for (const method of i % 2 ? ['linear', 'indexed'] : ['indexed', 'linear']) {
    samples[method].push(await measure(method));
  }
}
function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
const ids = (method) => samples[method][0].ids;
console.log(JSON.stringify({
  rounds, totalArticles: articles.length, embeddedArticles: candidates.length,
  vectorDimensions: query.length, topK,
  indexedMedianMs: median(samples.indexed.map((s) => s.ms)),
  linearMedianMs: median(samples.linear.map((s) => s.ms)),
  topKOverlap: ids('indexed').filter((id) => ids('linear').includes(id)).length,
  indexedIds: ids('indexed'), linearIds: ids('linear')
}, null, 2));
