import { GoogleGenAI } from '@google/genai';
import { queryMossIndex } from './moss.js';
import { getArticlesByIds } from './db.js';
import { runAnswerPipeline } from './lib/qaPipeline.js';

const MOSS_TOP_K = 5;

// Moss's own purpose-built retrieval: a single indexed query, no manual
// embedding step and no app-side scoring. See naive.js for the DIY
// counterpart this is benchmarked against - runAnswerPipeline() (in
// server/lib/qaPipeline.js) is the shared orchestration, so retrieval
// mechanism is the only variable between the two.
export async function answerQuestion(question, deps = {}) {
  const {
    queryMoss = queryMossIndex,
    createAiClient = (apiKey) => new GoogleGenAI({ apiKey }),
    lookupArticles = getArticlesByIds
  } = deps;

  const retrieve = async (query) => {
    const result = await queryMoss(query, { topK: MOSS_TOP_K });
    const docs = result?.docs || [];
    return docs.map((doc) => ({ id: doc.id, text: doc.text, score: doc.score }));
  };

  return runAnswerPipeline(question, { retrieve, createAiClient, lookupArticles });
}
