// Gemini API key pool with per-key quota backoff. GEMINI_API_KEYS (comma-
// separated) lets multiple keys - ideally from separate Google Cloud
// projects, since keys under the same project share its quota - stand in
// for each other: when one hits its daily/per-minute cap, calls route to the
// next key that isn't currently backed off instead of failing outright.
// Falls back to the single GEMINI_API_KEY var if GEMINI_API_KEYS isn't set,
// so nothing changes for a single-key setup.
//
// Keys are read fresh from process.env on every call (not cached at module
// load) so this still picks up a key set by dotenv.config() or a test's
// `process.env.GEMINI_API_KEY ||= ...` regardless of module import order -
// mirrors how the old single-key version of this file read process.env
// inside each function rather than at the top of the module.
function getKeys() {
  return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

// The 429 Gemini returns for this quota is a *daily* limit
// (GenerateRequestsPerDayPerProjectPerModel-FreeTier), but the retryDelay it
// reports is only seconds - clearly meant for a per-minute quota, not a
// per-day one. Back off for real once a key sees a 429, doubling on repeated
// hits (in case quota was only partially available) up to a few hours, and
// reset the moment a call on that key actually succeeds. Backoff is tracked
// per key (keyed by the key string itself, in a Map that grows as new keys
// are seen) rather than globally, since one key's exhaustion says nothing
// about another key's remaining quota.
const QUOTA_BACKOFF_INITIAL_MS = 15 * 60 * 1000;
const QUOTA_BACKOFF_MAX_MS = 4 * 60 * 60 * 1000;
const keyState = new Map(); // key string -> { backoffMs, backoffUntil }

function stateFor(key) {
  let state = keyState.get(key);
  if (!state) {
    state = { backoffMs: 0, backoffUntil: 0 };
    keyState.set(key, state);
  }
  return state;
}

function isAvailable(key) {
  return Date.now() >= stateFor(key).backoffUntil;
}

function recordSuccess(key) {
  const state = stateFor(key);
  state.backoffMs = 0;
  state.backoffUntil = 0;
}

function recordExhaustion(key, keys) {
  const state = stateFor(key);
  state.backoffMs = state.backoffMs ? Math.min(state.backoffMs * 2, QUOTA_BACKOFF_MAX_MS) : QUOTA_BACKOFF_INITIAL_MS;
  state.backoffUntil = Date.now() + state.backoffMs;
  const keyNum = keys.indexOf(key) + 1;
  console.log(`Gemini key #${keyNum}/${keys.length} exhausted - backing off until ${new Date(state.backoffUntil).toISOString()}`);
}

// Round-robins which key each call *starts* trying from, so load spreads
// across the pool instead of hammering key 0 until it dies before key 1 is
// ever touched.
let nextIndex = 0;

// Cheap up-front check for callers that want to skip a batch of work
// entirely rather than start it and fail partway through (e.g. index.js's
// auto-summarize/auto-embed loops).
export function hasAvailableKey() {
  return getKeys().some(isAvailable);
}

export function keyCount() {
  return getKeys().length;
}

export function quotaExceededError() {
  return Object.assign(
    new Error(
      getKeys().length > 1
        ? 'Rate limit reached on every configured Gemini API key. Please wait a bit and try again.'
        : 'Rate limit reached on the Gemini API free tier. Please wait a bit and try again.'
    ),
    { status: 429 }
  );
}

// Calls fn(apiKey) once per available key, starting from the round-robin
// position, until one succeeds. A 429 marks that key backed off and moves on
// to the next available key; any other error (or exhaustion of every key)
// propagates to the caller. fn must throw an error shaped like @google/genai's
// (a `status` field) for a quota rejection to be recognized as one - anything
// else is assumed to not be a quota problem and isn't retried on another key.
export async function withKeyRotation(fn) {
  const keys = getKeys();
  if (keys.length === 0) {
    throw Object.assign(new Error('GEMINI_API_KEY(S) is missing.'), { status: 500 });
  }

  const order = keys.map((_, i) => (i + nextIndex) % keys.length).sort(
    (a, b) => Number(isAvailable(keys[b])) - Number(isAvailable(keys[a]))
  );
  nextIndex = (nextIndex + 1) % keys.length;

  let lastError;
  for (const i of order) {
    const key = keys[i];
    if (!isAvailable(key)) continue;

    try {
      const result = await fn(key);
      recordSuccess(key);
      return result;
    } catch (error) {
      lastError = error;
      if (error.status === 429) {
        recordExhaustion(key, keys);
        continue; // try the next available key
      }
      throw error; // not a quota error - not a reason to burn through the rest of the pool
    }
  }

  // Every key was either backed off already or just got exhausted above.
  throw (lastError && lastError.status === 429) || !lastError ? quotaExceededError() : lastError;
}
