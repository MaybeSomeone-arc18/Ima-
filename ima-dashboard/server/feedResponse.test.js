import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { createFeedResponder } from './feedResponse.js';
import { validFeed } from '../src/lib/feedCache.js';

function response() {
  return { headers: {}, code: 200, set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; },
    vary() { return this; }, type() { return this; }, send(body) { this.body = body; return this; } };
}
const article = { id: '1', title: 'Test story', url: 'https://example.com/story' };
test('empty startup feed is retryable, never a successful empty array', async () => {
  const res = response();
  await createFeedResponder(() => [])({}, res, assert.fail);
  assert.equal(res.code, 503);
  assert.equal(res.headers['Retry-After'], '2');
});
test('gzip preserves every article and refreshes after ingestion', async () => {
  let feed = [article];
  const handler = createFeedResponder(() => feed);
  const req = { acceptsEncodings: () => 'gzip' };
  const first = response();
  await handler(req, first, assert.fail);
  assert.deepEqual(JSON.parse(gunzipSync(first.body)), feed);
  feed = [...feed, { ...article, id: '2' }];
  const next = response();
  await handler(req, next, assert.fail);
  assert.deepEqual(JSON.parse(gunzipSync(next.body)), feed);
});
test('plain JSON works for clients without gzip', async () => {
  const res = response();
  await createFeedResponder(() => [article])({ acceptsEncodings: () => false }, res, assert.fail);
  assert.deepEqual(JSON.parse(res.body), [article]);
  assert.equal(res.headers['Content-Encoding'], undefined);
});
test('empty, malformed and invalid feeds cannot replace a cached snapshot', () => {
  assert.equal(validFeed([]), false);
  assert.equal(validFeed({ error: 'warming' }), false);
  assert.equal(validFeed([null]), false);
  assert.equal(validFeed([{ id: '1' }]), false);
  assert.equal(validFeed([article]), true);
});
