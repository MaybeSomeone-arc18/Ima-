const DB_NAME = 'ima-feed';
const STORE = 'snapshots';
const MAX_AGE = 24 * 60 * 60 * 1000;

export function validFeed(data) {
  return Array.isArray(data) && data.length > 0 && data.every(item =>
    item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.url === 'string');
}

async function openCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readFeedCache() {
  let db;
  try {
    db = await openCache();
    return await new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).get('latest');
      request.onsuccess = () => {
        const snapshot = request.result;
        resolve(snapshot && Date.now() - snapshot.savedAt < MAX_AGE && validFeed(snapshot.feed) ? snapshot.feed : []);
      };
      request.onerror = () => resolve([]);
    });
  } catch { return []; }
  finally { db?.close(); }
}

export async function writeFeedCache(feed) {
  if (!validFeed(feed)) return;
  let db;
  try {
    db = await openCache();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ savedAt: Date.now(), feed }, 'latest');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { /* Storage may be disabled or full; the live feed still works. */ }
  finally { db?.close(); }
}
