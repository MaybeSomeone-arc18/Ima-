import express from 'express';
import cors from 'cors';
import { fetchAndNormalizeFeeds } from './ingestion.js';
import { enrichBatchWithGemini } from './enricher.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// In-memory store for the feed
let currentFeed = [];

// Preload cache instantly on startup
try {
  const cachePath = path.join(process.cwd(), 'server', 'data', 'cache.json');
  const cacheData = await fs.readFile(cachePath, 'utf8');
  currentFeed = JSON.parse(cacheData);
  console.log(`Successfully preloaded ${currentFeed.length} articles from cache on boot.`);
} catch (error) {
  console.log('No existing cache found or failed to read on boot. Starting fresh.');
}

async function updateFeed() {
  console.log('Starting feed update cycle...');
  try {
    // 1. Ingest raw stories (Fast RSS Pass)
    const rawStories = await fetchAndNormalizeFeeds();
    
    // Immediately populate currentFeed if it's empty or outdated so frontend renders instantly
    if (currentFeed.length === 0) {
      currentFeed = rawStories;
      console.log(`Instant Boot: Populated ${currentFeed.length} raw stories.`);
    }

    try {
      // 2. Enrich stories (Slow Background AI Pass)
      const enrichedStories = await enrichBatchWithGemini(rawStories);
      
      // 3. Merge raw and enriched data
      const mergedMap = new Map();
      
      // First, add all raw stories
      for (const raw of rawStories) {
        mergedMap.set(raw.id, raw);
      }
      
      // Then, overwrite with enriched data where available
      for (const enriched of enrichedStories) {
        if (mergedMap.has(enriched.id)) {
          mergedMap.set(enriched.id, { ...mergedMap.get(enriched.id), ...enriched });
        } else {
          mergedMap.set(enriched.id, enriched);
        }
      }
      
      const mergedArray = Array.from(mergedMap.values());
      
      // Update the in-memory feed with fully enriched data
      currentFeed = mergedArray;
      currentFeed.sort((a, b) => {
        const scoreA = a.importanceScore || 0;
        const scoreB = b.importanceScore || 0;
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        return new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
      });
      
      currentFeed = feedArray;
      console.log(`Feed update complete. Current feed size: ${currentFeed.length}`);
      
      // Write to KAISEN integration directory
      const kaizenDir = path.join(os.homedir(), '.kaizen');
      await fs.mkdir(kaizenDir, { recursive: true });
      await fs.writeFile(path.join(kaizenDir, 'ima_feed.json'), JSON.stringify(currentFeed, null, 2), 'utf8');
      console.log('Successfully wrote to ~/.kaizen/ima_feed.json');
    } catch (enrichError) {
      console.error('Error during enrichment (using raw stories instead):', enrichError.message);
    }
  } catch (error) {
    console.error('Error fetching raw stories:', error);
  } finally {
    // Schedule the next cycle recursively after 60 seconds (prevents overlapping)
    setTimeout(updateFeed, 60000);
  }
}

app.get('/api/feed', (req, res) => {
  res.json(currentFeed);
});

// Root endpoint for health checks
app.get('/', (req, res) => {
  res.send('Ima Backend is running. Use /api/feed to get the latest news.');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  
  // Trigger initial feed ingestion and enrichment
  updateFeed();
});
