// Run with: node --test server/naive.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestionNaive } from './naive.js';

process.env.GEMINI_API_KEY ||= 'test-key';

function makeArticle(id, title, embedding) {
  return { id, title, url: `https://example.com/${id}`, source: 'TestSource', embedding };
}

// A fake GoogleGenAI client: `embed` answers embedContent calls (one per
// retrieval hop, keyed by call order), `plan`/`answer` answer the
// sufficiency-check and synthesis generateContent calls, in the order
// runAnswerPipeline issues them relative to retrieval.
function makeAiStub({ embeddings, generations }) {
  const embedQueue = [...embeddings];
  const genQueue = [...generations];
  return {
    models: {
      embedContent: async () => {
        const next = embedQueue.shift();
        if (!next) throw new Error('makeAiStub: no more queued embeddings');
        return { embeddings: [{ values: next }] };
      },
      generateContent: async () => {
        const next = genQueue.shift();
        if (!next) throw new Error('makeAiStub: no more queued generations');
        return { text: next };
      }
    }
  };
}

test('answerQuestionNaive returns the same documented shape as answerQuestion', async () => {
  const articles = [
    makeArticle('a1', 'Exact match article', [1, 0, 0]),
    makeArticle('a2', 'Orthogonal article', [0, 1, 0]),
    makeArticle('a3', 'No embedding yet', null)
  ];

  const ai = makeAiStub({
    embeddings: [[1, 0, 0]],
    generations: [
      JSON.stringify({ sufficient: true, subQueries: [] }),
      'Exact match answered the question [1].'
    ]
  });

  const result = await answerQuestionNaive('what matches exactly', {
    createAiClient: () => ai,
    fetchArticles: async () => articles,
    lookupArticles: async (ids) =>
      new Map(ids.map((id) => [id, { title: `Title ${id}`, url: `https://example.com/${id}`, source: 'TestSource' }]))
  });

  assert.equal(typeof result.answer, 'string');
  assert.ok(result.answer.length > 0);

  assert.ok(Array.isArray(result.citations));
  assert.ok(result.citations.length > 0);
  assert.deepEqual(Object.keys(result.citations[0]).sort(), ['n', 'source', 'title', 'url'].sort());

  // The article with no embedding must never be scored/returned.
  assert.ok(!result.citations.some((c) => c.title === 'Title a3'));

  // Highest cosine similarity (a1, identical to the query vector) must rank first.
  assert.equal(result.citations[0].title, 'Title a1');

  assert.ok(Array.isArray(result.retrievals));
  assert.equal(result.retrievals.length, 1);
  assert.deepEqual(Object.keys(result.retrievals[0]).sort(), ['hop', 'hitCount', 'query', 'retrievalMs'].sort());

  for (const key of ['totalRetrievalMs', 'totalLlmMs', 'totalMs']) {
    assert.equal(typeof result[key], 'number');
    assert.ok(result[key] >= 0, `${key} should be non-negative`);
  }
});

test('answerQuestionNaive re-fetches articles fresh on every hop (no cache)', async () => {
  const articles = [makeArticle('a1', 'Some article', [1, 0])];
  let fetchCount = 0;

  const ai = makeAiStub({
    embeddings: [[1, 0], [1, 0]],
    generations: [
      JSON.stringify({ sufficient: false, subQueries: ['follow up'] }),
      'answer'
    ]
  });

  await answerQuestionNaive('question', {
    createAiClient: () => ai,
    fetchArticles: async () => {
      fetchCount += 1;
      return articles;
    },
    lookupArticles: async (ids) => new Map(ids.map((id) => [id, { title: id, url: '', source: 'S' }]))
  });

  assert.equal(fetchCount, 2, 'expected one fresh fetch per retrieval hop');
});
