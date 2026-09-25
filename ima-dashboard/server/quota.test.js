import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withKeyRotation, generationModels } from './quota.js';

const unavailable = () => Object.assign(new Error('unavailable'), { status: 503 });

test('retries a 503 and preserves the model', async () => {
  process.env.GEMINI_API_KEYS = 'retry-key';
  let calls = 0;
  const result = await withKeyRotation((key, model) => {
    assert.equal(key, 'retry-key');
    assert.equal(model, 'primary');
    if (++calls < 2) throw unavailable();
    return 'recovered';
  }, { models: ['primary', 'fallback'] });
  assert.equal(result, 'recovered');
  assert.equal(calls, 2);
});

test('tries next key after three 503s and keeps primary model', async () => {
  process.env.GEMINI_API_KEYS = 'key-a,key-b';
  const seen = [];
  const result = await withKeyRotation((key, model) => {
    seen.push([key, model]);
    if (seen.length <= 3) throw unavailable();
    return 'second key worked';
  }, { models: ['primary', 'fallback'] });
  assert.equal(result, 'second key worked');
  assert.deepEqual(seen.map((x) => x[0]), [seen[0][0], seen[0][0], seen[0][0], seen[3][0]]);
  assert.notEqual(seen[0][0], seen[3][0]);
  assert.ok(seen.every((x) => x[1] === 'primary'));
});

test('uses configured fallback after all keys return 503', async () => {
  process.env.GEMINI_API_KEYS = 'fallback-key';
  const seen = [];
  const result = await withKeyRotation((_key, model) => {
    seen.push(model);
    if (model === 'primary') throw unavailable();
    return 'fallback answered';
  }, { models: ['primary', 'fallback'] });
  assert.equal(result, 'fallback answered');
  assert.deepEqual(seen, ['primary', 'primary', 'primary', 'fallback']);
});

test('429 rotates without immediately retrying the exhausted key', async () => {
  process.env.GEMINI_API_KEYS = 'quota-key,other-key';
  const seen = [];
  const result = await withKeyRotation((key) => {
    seen.push(key);
    if (seen.length === 1) throw Object.assign(new Error('quota'), { status: 429 });
    return 'other key answered';
  });
  assert.equal(result, 'other key answered');
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1]);
});

test('generation fallback list can be configured', () => {
  process.env.GEMINI_GENERATION_MODELS = ' model-a, model-b ';
  assert.deepEqual(generationModels(), ['model-a', 'model-b']);
  delete process.env.GEMINI_GENERATION_MODELS;
  assert.deepEqual(generationModels(), ['gemini-3.6-flash', 'gemini-2.5-flash']);
});
