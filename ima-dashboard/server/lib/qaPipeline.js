import { Type } from '@google/genai';
import { generationModels } from '../quota.js';
import { generateText } from './generation.js';

export const MAX_HOPS = 5;
export const MAX_SUBQUERIES = 3;
export const MAX_UNIQUE_SOURCES = 8;

// Times a call that itself rotates through the Gemini key pool (see
// quota.js) - a 429 on one key retries on the next available key inside
// withKeyRotation, transparent to the timing measured here, so a rotation
// only shows up as extra latency, never as a failed hop.
async function timeRotatedCall(fn) {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
}

// Runs one retrieval hop against whatever mechanism the caller supplies
// (indexed ANN search, a naive linear scan, ...), timing it and recording it into
// `retrievals` regardless of outcome so callers get a full hop-by-hop trace
// even when a hop comes back empty or errors out. `retrieve` is the only
// thing that differs between retrieval paths - everything downstream of the
// returned hits is identical. `createAiClient` (not a fixed client) is
// passed through so a retrieval path that itself calls Gemini (naive's query
// embedding) can rotate keys independently of the plan/synthesize calls.
async function runRetrievalHop(retrieve, createAiClient, query, hop, retrievals) {
  const start = performance.now();
  let hits = [];
  try {
    hits = (await retrieve(query, createAiClient)) || [];
  } catch (error) {
    console.error(`Retrieval failed (hop ${hop}, "${query}"):`, error.message);
  }
  const retrievalMs = performance.now() - start;
  retrievals.push({ hop, query, retrievalMs, hitCount: hits.length });
  return hits;
}

// Asks Gemini whether the hits retrieved so far are enough to answer the
// question, and if not, for up to MAX_SUBQUERIES follow-up searches to fill
// the gaps. Mirrors generateSummary()'s use of a JSON responseSchema.
export async function planNextHops(createAiClient, question, hitsSoFar) {
  const context = hitsSoFar
    .slice(0, 5)
    .map((hit, i) => `[${i + 1}] ${(hit.text || '').slice(0, 500)}`)
    .join('\n\n');

  const prompt = `You are deciding whether enough context has been retrieved to answer a question about tech news.

Question: ${question}

Retrieved context so far:
${context || '(none)'}

Decide if this context is sufficient to answer the question well. If not, propose up to ${MAX_SUBQUERIES} focused follow-up search queries that would help fill in what's missing (specific entities, related events, or angles not yet covered). Keep sub-queries short and search-engine-like, not full sentences.`;

  const text = await generateText({
    messages: [{ role: 'system', content: 'Return only a JSON object with sufficient (boolean) and subQueries (array of short strings).' }, { role: 'user', content: prompt }],
    json: true,
    geminiCall: (apiKey, model) => createAiClient(apiKey).models.generateContent({
      model,
      contents: prompt,
      config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sufficient: { type: Type.BOOLEAN, description: 'Whether the retrieved context is sufficient to answer the question.' },
          subQueries: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: `Up to ${MAX_SUBQUERIES} short follow-up search queries. Empty if sufficient.`
          }
        },
        required: ['sufficient', 'subQueries']
      }
      }
    })
  });

  try {
    const parsed = JSON.parse(text || '{}');
    return {
      sufficient: Boolean(parsed.sufficient),
      subQueries: Array.isArray(parsed.subQueries)
        ? parsed.subQueries.filter((q) => typeof q === 'string' && q.trim()).slice(0, MAX_SUBQUERIES)
        : []
    };
  } catch {
    // Malformed JSON - treat what we already have as sufficient rather than
    // failing the whole answer over a planning hiccup.
    return { sufficient: true, subQueries: [] };
  }
}

// Final grounded answer, citing sources inline as "[1]", "[2]", etc. Tone
// matches /api/chat's systemPrompt.
export async function synthesizeAnswer(createAiClient, question, sources) {
  const context = sources
    .map((s) => `[${s.n}] ${s.title} (${s.source})\n${(s.text || '').slice(0, 700)}`)
    .join('\n\n');

  const systemPrompt = `You are a highly intelligent, concise, and futuristic AI neural assistant for IMA.
You live in a floating glassmorphic dashboard.
Answer the user's question strictly based on the sources below. Cite sources inline using bracketed numbers like [1] right after the claim they support. If the sources don't cover the question, say so briefly. Limit the answer to three short bullet points. Never invent facts or source line numbers. Only mention facts explicitly present in these excerpts. Use ONLY [1], [2], etc. for citations, never another citation style.

Sources:
${context || '(none)'}`;

  const text = await generateText({
    messages: [
      { role: 'system', content: systemPrompt.slice(0, 10500) },
      { role: 'user', content: `${question.slice(0, 1500)}\n\nGive a short answer with only claims supported by the supplied excerpts and citations in [n] form.` }
    ],
    geminiCall: (apiKey, model) => createAiClient(apiKey).models.generateContent({
      model,
      contents: `${systemPrompt}\n\nUser: ${question}\nAI:`
    })
  });
  // Groq may render references as 【1】 or  despite the prompt.
  // Normalize only citation numbers present in the retrieved source list.
  const validNumbers = new Set(sources.map((source) => source.n));
  return text.trim().replace(/【(\d+)(?:†[^】]*)?】/g, (full, number) =>
    validNumbers.has(Number(number)) ? `[${number}]` : ''
  );
}

// Multi-hop retrieval-augmented answer pipeline, shared by every retrieval
// path (indexed ANN search, naive linear scan, ...):
//   1. Retrieve with the raw question (hop 1).
//   2. Ask Gemini whether that's enough, and for up to 3 follow-up queries.
//   3. Run each follow-up as its own retrieval hop (hop 2..n), capped at
//      MAX_HOPS total hops.
//   4. Dedupe hits by doc id, keep the top ~8 by score, and join back to
//      Supabase for title/url/source (retrieval hits only carry an id and
//      the indexed text).
//   5. Ask Gemini for a grounded, cited answer over those sources.
//
// `retrieve(query, createAiClient)` is the ONLY thing that varies between
// retrieval paths - it must resolve to an array of { id, text, score } hits.
export async function runAnswerPipeline(question, { retrieve, createAiClient, lookupArticles }) {
  const totalStart = performance.now();
  const retrievals = [];
  const allHits = [];
  let totalLlmMs = 0;

  // Hop 1: the raw question.
  allHits.push(...(await runRetrievalHop(retrieve, createAiClient, question, 1, retrievals)));

  const { result: plan, ms: planMs } = await timeRotatedCall(() =>
    planNextHops(createAiClient, question, allHits)
  );
  totalLlmMs += planMs;

  if (!plan.sufficient) {
import { generationModels } from '../quota.js';
import { generateText } from './generation.js';

export const MAX_HOPS = 5;
export const MAX_SUBQUERIES = 3;
export const MAX_UNIQUE_SOURCES = 8;

// Times a call that itself rotates through the Gemini key pool (see
// quota.js) - a 429 on one key retries on the next available key inside
// withKeyRotation, transparent to the timing measured here, so a rotation
// only shows up as extra latency, never as a failed hop.
async function timeRotatedCall(fn) {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
}

// Runs one retrieval hop against whatever mechanism the caller supplies
// (indexed ANN search, a naive linear scan, ...), timing it and recording it into
// `retrievals` regardless of outcome so callers get a full hop-by-hop trace
// even when a hop comes back empty or errors out. `retrieve` is the only
// thing that differs between retrieval paths - everything downstream of the
// returned hits is identical. `createAiClient` (not a fixed client) is
// passed through so a retrieval path that itself calls Gemini (naive's query
// embedding) can rotate keys independently of the plan/synthesize calls.
async function runRetrievalHop(retrieve, createAiClient, query, hop, retrievals) {
  const start = performance.now();
  let hits = [];
  try {
    hits = (await retrieve(query, createAiClient)) || [];
  } catch (error) {
    console.error(`Retrieval failed (hop ${hop}, "${query}"):`, error.message);
  }
  const retrievalMs = performance.now() - start;
  retrievals.push({ hop, query, retrievalMs, hitCount: hits.length });
  return hits;
}

// Asks Gemini whether the hits retrieved so far are enough to answer the
// question, and if not, for up to MAX_SUBQUERIES follow-up searches to fill
// the gaps. Mirrors generateSummary()'s use of a JSON responseSchema.
export async function planNextHops(createAiClient, question, hitsSoFar) {
  const context = hitsSoFar
    .slice(0, 5)
    .map((hit, i) => `[${i + 1}] ${(hit.text || '').slice(0, 500)}`)
    .join('\n\n');

  const prompt = `You are deciding whether enough context has been retrieved to answer a question about tech news.

Question: ${question}

Retrieved context so far:
${context || '(none)'}

Decide if this context is sufficient to answer the question well. If not, propose up to ${MAX_SUBQUERIES} focused follow-up search queries that would help fill in what's missing (specific entities, related events, or angles not yet covered). Keep sub-queries short and search-engine-like, not full sentences.`;

  const text = await generateText({
    messages: [{ role: 'system', content: 'Return only a JSON object with sufficient (boolean) and subQueries (array of short strings).' }, { role: 'user', content: prompt }],
    json: true,
    geminiCall: (apiKey, model) => createAiClient(apiKey).models.generateContent({
      model,
      contents: prompt,
      config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sufficient: { type: Type.BOOLEAN, description: 'Whether the retrieved context is sufficient to answer the question.' },
          subQueries: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: `Up to ${MAX_SUBQUERIES} short follow-up search queries. Empty if sufficient.`
          }
        },
        required: ['sufficient', 'subQueries']
      }
      }
    })
  });

  try {
    const parsed = JSON.parse(text || '{}');
    return {
      sufficient: Boolean(parsed.sufficient),
      subQueries: Array.isArray(parsed.subQueries)
        ? parsed.subQueries.filter((q) => typeof q === 'string' && q.trim()).slice(0, MAX_SUBQUERIES)
        : []
    };
  } catch {
    // Malformed JSON - treat what we already have as sufficient rather than
    // failing the whole answer over a planning hiccup.
    return { sufficient: true, subQueries: [] };
  }
}

// Final grounded answer, citing sources inline as "[1]", "[2]", etc. Tone
// matches /api/chat's systemPrompt.
export async function synthesizeAnswer(createAiClient, question, sources) {
  const context = sources
    .map((s) => `[${s.n}] ${s.title} (${s.source})\n${(s.text || '').slice(0, 700)}`)
    .join('\n\n');

  const systemPrompt = `You are a highly intelligent, concise, and futuristic AI neural assistant for IMA.
You live in a floating glassmorphic dashboard.
Answer the user's question strictly based on the sources below. Cite sources inline using bracketed numbers like [1] right after the claim they support. If the sources don't cover the question, say so briefly. Limit the answer to three short bullet points. Never invent facts or source line numbers. Only mention facts explicitly present in these excerpts. Use ONLY [1], [2], etc. for citations, never another citation style.

Sources:
${context || '(none)'}`;

  const text = await generateText({
    messages: [
      { role: 'system', content: systemPrompt.slice(0, 10500) },
      { role: 'user', content: `${question.slice(0, 1500)}\n\nGive a short answer with only claims supported by the supplied excerpts and citations in [n] form.` }
    ],
    geminiCall: (apiKey, model) => createAiClient(apiKey).models.generateContent({
      model,
      contents: `${systemPrompt}\n\nUser: ${question}\nAI:`
    })
  });
  // Groq may render references as 【1】 or  despite the prompt.
  // Normalize only citation numbers present in the retrieved source list.
  const validNumbers = new Set(sources.map((source) => source.n));
  return text.trim().replace(/【(\d+)(?:†[^】]*)?】/g, (full, number) =>
    validNumbers.has(Number(number)) ? `[${number}]` : ''
  );
}

// Multi-hop retrieval-augmented answer pipeline, shared by every retrieval
// path (indexed ANN search, naive linear scan, ...):
//   1. Retrieve with the raw question (hop 1).
//   2. Ask Gemini whether that's enough, and for up to 3 follow-up queries.
//   3. Run each follow-up as its own retrieval hop (hop 2..n), capped at
//      MAX_HOPS total hops.
//   4. Dedupe hits by doc id, keep the top ~8 by score, and join back to
//      Supabase for title/url/source (retrieval hits only carry an id and
//      the indexed text).
//   5. Ask Gemini for a grounded, cited answer over those sources.
//
// `retrieve(query, createAiClient)` is the ONLY thing that varies between
// retrieval paths - it must resolve to an array of { id, text, score } hits.
export async function runAnswerPipeline(question, { retrieve, createAiClient, lookupArticles }) {
  const totalStart = performance.now();
  const retrievals = [];
  const allHits = [];
  let totalLlmMs = 0;

  // Hop 1: the raw question.
  allHits.push(...(await runRetrievalHop(retrieve, createAiClient, question, 1, retrievals)));

  const { result: plan, ms: planMs } = await timeRotatedCall(() =>
    planNextHops(createAiClient, question, allHits)
  );
  totalLlmMs += planMs;

  if (!plan.sufficient) {
    const availableHops = Math.max(0, MAX_HOPS - retrievals.length);
    const subQueries = plan.subQueries.slice(0, Math.min(MAX_SUBQUERIES, availableHops));

    for (const subQuery of subQueries) {
      const hop = retrievals.length + 1;
      allHits.push(...(await runRetrievalHop(retrieve, createAiClient, subQuery, hop, retrievals)));
    }
  }

  // Dedupe by doc id, keeping the highest-scoring occurrence, then take the
  // top ~8 by score.
  const uniqueById = new Map();
  for (const hit of allHits) {
    const existing = uniqueById.get(hit.id);
    if (!existing || hit.score > existing.score) uniqueById.set(hit.id, hit);
  }
  const topHits = [...uniqueById.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_UNIQUE_SOURCES);

  const metaById = await lookupArticles(topHits.map((hit) => hit.id));

  const sources = topHits.map((hit, i) => {
    const meta = metaById.get(hit.id) || {};
    return {
      n: i + 1,
      id: hit.id,
      title: meta.title || hit.id,
      url: meta.url || '',
      source: meta.source || '',
      text: hit.text
    };
  });

  const { result: answer, ms: answerMs } = await timeRotatedCall(() =>
    synthesizeAnswer(createAiClient, question, sources)
  );
  totalLlmMs += answerMs;

  const totalRetrievalMs = retrievals.reduce((sum, r) => sum + r.retrievalMs, 0);
  const totalMs = performance.now() - totalStart;

  return {
    answer,
    citations: sources.map(({ n, title, url, source }) => ({ n, title, url, source })),
    retrievals,
    totalRetrievalMs,
    totalLlmMs,
    totalMs
  };
}
