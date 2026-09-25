import { GoogleGenAI } from '@google/genai';
import { getAllArticlesForNaiveSearch, getArticlesByIds, searchArticlesByTitle } from './db.js';
import { runAnswerPipeline } from './lib/qaPipeline.js';
import { embedText } from './lib/embedQuery.js';
import { hasAvailableKey } from './quota.js';

const NAIVE_TOP_K = 5;

function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// The "no persistent index" baseline: every hop re-fetches the entire
// articles table over the network (fetchArticles), embeds the query with the
// same Gemini model used to embed the articles, and scores every candidate
// in JS - an O(n) linear scan with no ANN structure. This is what a team
// gets by default from Postgres + app code alone, honestly built (no
// artificial slowdowns), which is exactly the comparison worth making
// against pgvector.js's HNSW-indexed retrieval - same embedding step, only
// the search itself (linear scan vs. an index) differs.
async function retrieveNaive(query, createAiClient, fetchArticles, fallbackSearch) {
  if (!hasAvailableKey()) return fallbackSearch(query, NAIVE_TOP_K);
  let queryVector;
  try {
    queryVector = await embedText(createAiClient, query, { taskType: 'RETRIEVAL_QUERY' });
  } catch (error) {
    if (error.status !== 429) throw error;
    return fallbackSearch(query, NAIVE_TOP_K);
  }
  if (queryVector.length === 0) return [];

  const articles = await fetchArticles();
  const scored = [];
  for (const article of articles) {
    if (!Array.isArray(article.embedding) || article.embedding.length === 0) continue;
    scored.push({
      id: article.id,
      text: article.title,
      score: cosineSimilarity(queryVector, article.embedding)
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, NAIVE_TOP_K);
}

// Same signature and return shape as answerQuestion() (server/agent.js) - the
// only thing that differs is the retrieval mechanism, since both share
// runAnswerPipeline() for sub-query planning and grounded-answer synthesis.
export async function answerQuestionNaive(question, deps = {}) {
  const {
    createAiClient = (apiKey) => new GoogleGenAI({ apiKey }),
    lookupArticles = getArticlesByIds,
    fetchArticles = getAllArticlesForNaiveSearch,
    fallbackSearch = searchArticlesByTitle
  } = deps;

  const retrieve = (query, createAiClientFn) => retrieveNaive(query, createAiClientFn, fetchArticles, fallbackSearch);

  return runAnswerPipeline(question, { retrieve, createAiClient, lookupArticles });
}
