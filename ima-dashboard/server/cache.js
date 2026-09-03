import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, 'data', 'cache.json');

export async function readCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    console.error('Error reading cache:', error);
    return [];
  }
}

export async function writeCache(items) {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    
    const existingCache = await readCache();
    const existingIds = new Set(existingCache.map(item => item.id));
    
    const newItems = items.filter(item => !existingIds.has(item.id));
    
    if (newItems.length > 0) {
      const updatedCache = [...existingCache, ...newItems];
      await fs.writeFile(CACHE_FILE, JSON.stringify(updatedCache, null, 2), 'utf-8');
    }
  } catch (error) {
    console.error('Error writing cache:', error);
  }
}

export async function getUncachedItems(items) {
  const cache = await readCache();
  const cachedIds = new Set(cache.map(item => item.id));
  return items.filter(item => !cachedIds.has(item.id));
}
