import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, providerOrder } from './generation.js';
import { runAnswerPipeline } from './qaPipeline.js';

test('Groq answers without touching quota-exhausted Gemini', async () => {
  process.env.GROQ_API_KEY = 'test-not-real';
  process.env.CHAT_PROVIDER = 'groq,gemini';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, request) => {
    assert.match(request.headers.Authorization, /^Bearer test-not-real$/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Real answer [1].' } }] }) };
  };
  try {
    const result = await generateText({ messages: [{ role: 'user', content: 'test' }], geminiCall: () => { throw new Error('Gemini should not run'); } });
    assert.equal(result, 'Real answer [1].');
  } finally { globalThis.fetch = originalFetch; delete process.env.GROQ_API_KEY; delete process.env.CHAT_PROVIDER; }
});

test('Groq failure falls back to Gemini', async () => {
  process.env.GROQ_API_KEY = 'test-not-real';
  process.env.GEMINI_API_KEYS = 'provider-test-key';
  process.env.CHAT_PROVIDER = 'groq,gemini';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    const result = await generateText({ messages: [{ role: 'user', content: 'test' }], geminiCall: async (_key, model) => ({ text: `Gemini on ${model}` }) });
    assert.equal(result, 'Gemini on gemini-3.6-flash');
  } finally { globalThis.fetch = originalFetch; delete process.env.GROQ_API_KEY; delete process.env.CHAT_PROVIDER; }
});

test('RAG pipeline uses Groq for planning and synthesis when Gemini is unavailable', async () => {
  process.env.GROQ_API_KEY = 'test-not-real';
  process.env.CHAT_PROVIDER = 'groq,gemini';
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: ++calls === 1 ? '{"sufficient":true,"subQueries":[]}' : 'Grounded answer [1].' } }] }) });
  try {
    const result = await runAnswerPipeline('What is new?', {
      retrieve: async () => [{ id: 'a1', text: 'News of a new release', score: 0.5 }],
      createAiClient: () => { throw new Error('Gemini should not run'); },
      lookupArticles: async () => new Map([['a1', { title: 'New release', url: 'https://example.com/news', source: 'Test' }]])
    });
    assert.equal(result.answer, 'Grounded answer [1].');
    assert.equal(result.citations[0].url, 'https://example.com/news');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; delete process.env.GROQ_API_KEY; delete process.env.CHAT_PROVIDER; }
});

test('provider order is configurable', () => {
  process.env.CHAT_PROVIDER = 'gemini,groq';
  assert.deepEqual(providerOrder(), ['gemini', 'groq']);
  delete process.env.CHAT_PROVIDER;
});
