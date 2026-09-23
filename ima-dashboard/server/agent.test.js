// Run with: node --test server/agent.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion } from './agent.js';

process.env.GEMINI_API_KEY ||= 'test-key';

function makeMossStub(docsByQuery) {
  const calls = [];
  return {
    calls,
    queryMoss: async (query, opts) => {
      calls.push(query);
      return { docs: docsByQuery[query] || [], query, ...opts };
    }
  };
}

// A fake GoogleGenAI client: `plan` answers the sufficiency-check call,
// `answer` answers the final synthesis call. Each call to
// ai.models.generateContent consumes the next queued response.
function makeAiStub(responses) {
  const queue = [...responses];
  return {
    models: {
      generateContent: async () => {
        const next = queue.shift();
        if (!next) throw new Error('makeAiStub: no more queued responses');
        return { text: next };
      }
    }
  };
}

test('answerQuestion returns the documented shape for a single-hop (sufficient) answer', async () => {
  const { queryMoss, calls } = makeMossStub({
    'what happened at openai': [
      { id: 'a1', text: 'OpenAI shipped a new model.', score: 0.9 },
      { id: 'a2', text: 'Investors reacted positively.', score: 0.7 }
    ]
  });

  const ai = makeAiStub([
    JSON.stringify({ sufficient: true, subQueries: [] }),
    'OpenAI shipped a new model [1] and investors reacted well [2].'
  ]);

  const result = await answerQuestion('what happened at openai', {
    queryMoss,
    createAiClient: () => ai,
    lookupArticles: async (ids) =>
      new Map(ids.map((id) => [id, { title: `Title ${id}`, url: `https://example.com/${id}`, source: 'TestSource' }]))
  });

  assert.equal(calls.length, 1, 'sufficient plan should stop after hop 1');
  assert.equal(typeof result.answer, 'string');
  assert.ok(result.answer.length > 0);

  assert.ok(Array.isArray(result.citations));
  assert.equal(result.citations.length, 2);
  assert.deepEqual(Object.keys(result.citations[0]).sort(), ['n', 'source', 'title', 'url'].sort());
  assert.equal(result.citations[0].n, 1);

  assert.ok(Array.isArray(result.retrievals));
  assert.equal(result.retrievals.length, 1);
  assert.deepEqual(Object.keys(result.retrievals[0]).sort(), ['hop', 'hitCount', 'query', 'retrievalMs'].sort());
  assert.equal(result.retrievals[0].hop, 1);
  assert.equal(result.retrievals[0].hitCount, 2);

  for (const key of ['totalRetrievalMs', 'totalLlmMs', 'totalMs']) {
    assert.equal(typeof result[key], 'number');
    assert.ok(result[key] >= 0, `${key} should be non-negative`);
  }
  assert.ok(result.totalMs >= result.totalRetrievalMs + result.totalLlmMs - 1, 'totalMs should roughly cover retrieval + llm time');
});

test('answerQuestion runs follow-up sub-queries as additional hops when insufficient', async () => {
  const { queryMoss, calls } = makeMossStub({
    'broad question': [{ id: 'a1', text: 'Some partial context.', score: 0.5 }],
    'sub query one': [{ id: 'a2', text: 'More detail one.', score: 0.8 }],
    'sub query two': [{ id: 'a3', text: 'More detail two.', score: 0.6 }]
  });

  const ai = makeAiStub([
    JSON.stringify({ sufficient: false, subQueries: ['sub query one', 'sub query two'] }),
    'Combined answer citing [1], [2] and [3].'
  ]);

  const result = await answerQuestion('broad question', {
    queryMoss,
    createAiClient: () => ai,
    lookupArticles: async (ids) => new Map(ids.map((id) => [id, { title: id, url: '', source: 'Src' }]))
  });

  assert.deepEqual(calls, ['broad question', 'sub query one', 'sub query two']);
  assert.equal(result.retrievals.length, 3);
  assert.deepEqual(result.retrievals.map((r) => r.hop), [1, 2, 3]);
  assert.equal(result.citations.length, 3);
});

test('answerQuestion caps total hops at 5 even if the model proposes more sub-queries', async () => {
  const docsByQuery = {
    'question': [{ id: 'a0', text: 'seed', score: 0.4 }],
    'sq1': [{ id: 'a1', text: 't1', score: 0.5 }],
    'sq2': [{ id: 'a2', text: 't2', score: 0.5 }],
    'sq3': [{ id: 'a3', text: 't3', score: 0.5 }],
    'sq4': [{ id: 'a4', text: 't4', score: 0.5 }] // should never be queried - would exceed the 5-hop cap
  };
  const { queryMoss, calls } = makeMossStub(docsByQuery);

  const ai = makeAiStub([
    // A misbehaving/overshooting model proposing more than the schema's
    // documented max of 3 sub-queries.
    JSON.stringify({ sufficient: false, subQueries: ['sq1', 'sq2', 'sq3', 'sq4'] }),
    'answer'
  ]);

  const result = await answerQuestion('question', {
    queryMoss,
    createAiClient: () => ai,
    lookupArticles: async () => new Map()
  });

  assert.ok(calls.length <= 5, `expected at most 5 Moss hops, got ${calls.length}`);
  assert.ok(result.retrievals.length <= 5);
  assert.deepEqual(calls, ['question', 'sq1', 'sq2', 'sq3']);
});

test('answerQuestion dedupes overlapping hits across hops, keeping the higher score', async () => {
  const { queryMoss } = makeMossStub({
    'q': [{ id: 'shared', text: 'v1', score: 0.3 }],
    'sub': [{ id: 'shared', text: 'v2', score: 0.9 }]
  });

  const ai = makeAiStub([
    JSON.stringify({ sufficient: false, subQueries: ['sub'] }),
    'answer'
  ]);

  const result = await answerQuestion('q', {
    queryMoss,
    createAiClient: () => ai,
    lookupArticles: async (ids) => new Map(ids.map((id) => [id, { title: id, url: '', source: 'S' }]))
  });

  assert.equal(result.citations.length, 1, 'the same doc id retrieved twice should only appear once');
});
