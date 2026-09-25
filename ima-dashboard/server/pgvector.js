import { GoogleGenAI } from '@google/genai';
import { getArticlesByIds, queryPgvectorIndex, searchArticlesByTitle } from './db.js';
import { runAnswerPipeline } from './lib/qaPipeline.js';
import { embedText } from './lib/embedQuery.js';
import { hasAvailableKey } from './quota.js';

const PGVECTOR_TOP_K = 5;

// The indexed counterpart to naive.js's linear scan: same embedding step
// (embedText), but the search itself runs as an HNSW-indexed nearest-
// neighbor query inside Postgres (queryPgvectorIndex -> the match_articles()
// function) instead of fetching every row and scoring it in JS. Isolating
// retrieval to "index vs. no index" is the whole point of the comparison -
// see naive.js and server/lib/qaPipeline.js for the shared orchestration.
export async function answerQuestion(question, deps = {}) {
  const {
    createAiClient = (apiKey) => new GoogleGenAI({ apiKey }),
    lookupArticles = getArticlesByIds,
    queryIndex = queryPgvectorIndex,
    fallbackSearch = searchArticlesByTitle
  } = deps;

  const retrieve = async (query, createAiClientFn) => {
    if (!hasAvailableKey()) return fallbackSearch(query, PGVECTOR_TOP_K);
    let queryVector;
    try {
      queryVector = await embedText(createAiClientFn, query, { taskType: 'RETRIEVAL_QUERY' });
    } catch (error) {
      if (error.status !== 429) throw error;
      return fallbackSearch(query, PGVECTOR_TOP_K);
    }
    if (queryVector.length === 0) return [];

    const rows = await queryIndex(queryVector, PGVECTOR_TOP_K);
    return rows.map((row) => ({ id: row.id, text: row.text, score: row.similarity }));
  };

  return runAnswerPipeline(question, { retrieve, createAiClient, lookupArticles });
}
