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

async function updateFeed() {
  console.log('Starting feed update cycle...');
  try {
    // 1. Fetch raw stories
    const rawStories = await fetchAndNormalizeFeeds();
    
    // Sort raw stories initially
    currentFeed = [...rawStories].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    console.log(`Fetched ${rawStories.length} raw stories.`);
    
    // 2. Enrich stories
    try {
      const enrichedData = await enrichBatchWithGemini(rawStories);
      
      // 3. Merge raw and enriched data
      const mergedMap = new Map();
      
      // First populate with raw stories
      for (const story of rawStories) {
        mergedMap.set(story.id, { ...story });
      }
      
      // Then merge in enrichment data
      for (const enriched of enrichedData) {
        if (mergedMap.has(enriched.id)) {
          mergedMap.set(enriched.id, { ...mergedMap.get(enriched.id), ...enriched });
        } else {
          mergedMap.set(enriched.id, enriched);
        }
      }
      
      // Convert to array and sort by importanceScore (if available) then pubDate
      const feedArray = Array.from(mergedMap.values());
      feedArray.sort((a, b) => {
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
  
  // Repeat every 60 seconds
  setInterval(updateFeed, 60000);
});
