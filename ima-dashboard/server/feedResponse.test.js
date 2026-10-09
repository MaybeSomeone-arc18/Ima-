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

// Recovery must distinguish expected startup from a persistent outage.
import { FEED_REQUEST_TIMEOUT_MS, feedFailurePolicy } from '../src/lib/feedRecovery.js';
test('cold-start request budget exceeds the observed 45-second restore', () => {
  assert.equal(FEED_REQUEST_TIMEOUT_MS, 90000);
});
test('startup 503 retries promptly without raising an error before the wake budget', () => {
  const policy = feedFailurePolicy({ failures: 8, hasFeed: true, warming: true, elapsedMs: 45000 });
  assert.deepEqual(policy, { status: 'Cached', showError: false, nextDelay: 2000 });
});
test('persistent startup failure still surfaces an error', () => {
  assert.equal(feedFailurePolicy({ failures: 8, hasFeed: false, warming: true, elapsedMs: 90000 }).showError, true);
});
test('non-startup failure stays visible and backs off without claiming Connected', () => {
  const policy = feedFailurePolicy({ failures: 6, hasFeed: false, warming: false, elapsedMs: 4000 });
  assert.deepEqual(policy, { status: 'Reconnecting', showError: true, nextDelay: 30000 });
});

import { loadArticlePages } from './db.js';
test('startup publishes the newest page before older history resolves', async () => {
  const newest = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), title: 'Story', url: 'https://example.com' }));
  let releaseOlder;
  const older = new Promise(resolve => { releaseOlder = resolve; });
  const client = { from: () => ({ select() { return this; }, order() { return this; },
    range(from) { return from === 0 ? Promise.resolve({ data: newest }) : older; } }) };
  const published = [];
  const loading = loadArticlePages(client, page => published.push(page));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(published[0].length, 1000);
  releaseOlder({ data: [{ id: 'old', title: 'Older story', url: 'https://example.com/old' }] });
  const all = await loading;
  assert.equal(all.length, 1001);
  assert.equal(published[1].length, 1001);
});
test('an older-page database error preserves the already published newest page', async () => {
  const newest = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), title: 'Story', url: 'https://example.com' }));
  const client = { from: () => ({ select() { return this; }, order() { return this; },
    range(from) { return Promise.resolve(from === 0 ? { data: newest } : { error: { message: 'temporary failure' } }); } }) };
  const published = [];
  const all = await loadArticlePages(client, page => published.push(page));
  assert.equal(all.length, 1000);
  assert.equal(published.length, 1);
});
