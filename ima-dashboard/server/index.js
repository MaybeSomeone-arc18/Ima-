import express from 'express';
import cors from 'cors';
import { fetchAndNormalizeFeeds } from './ingestion.js';
import { clusterArticles } from './clustering.js';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import {
  dbEnabled,
  loadArticlesFromDb,
  upsertArticles,
  getSummary,
  saveSummary,
  filterIdsWithoutSummary,
  incrementClickCount
} from './db.js';

const CATEGORIES = ['AI', 'Security', 'Hardware', 'Startups/Funding', 'Policy', 'DevTools', 'General'];

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// In-memory store for the feed - now backed by Supabase (see db.js), so a
// cold start (a Render restart, a redeploy) loads whatever was last
// persisted instead of serving an empty feed until the next scrape finishes.
let currentFeed = [];

// Fallback cache used only when Supabase isn't configured (e.g. local dev
// without SUPABASE_URL set). When the DB is available it's the source of
// truth for summaries instead, since it's shared and survives restarts.
const SUMMARY_CACHE_MAX = 200;
const summaryCache = new Map();

function cacheSummary(id, summary) {
  if (summaryCache.size >= SUMMARY_CACHE_MAX) {
    summaryCache.delete(summaryCache.keys().next().value);
  }
  summaryCache.set(id, summary);
}

const TOP_N_TO_AUTO_SUMMARIZE = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The 429 Gemini returns for this quota is a *daily* limit
// (GenerateRequestsPerDayPerProjectPerModel-FreeTier), but the retryDelay it
// reports is only seconds - clearly meant for a per-minute quota, not a
// per-day one. Retrying every 5-minute ingestion cycle on that advice just
// burns more of the next window's quota on guaranteed failures. Instead,
// back off for real once we see a 429, doubling on repeated hits (in case
// quota was only partially available) up to a few hours, and reset the
// moment a call actually succeeds.
const QUOTA_BACKOFF_INITIAL_MS = 15 * 60 * 1000;
const QUOTA_BACKOFF_MAX_MS = 4 * 60 * 60 * 1000;
let quotaBackoffMs = 0;
let quotaBackoffUntil = 0;

function isQuotaBackoffActive() {
  return Date.now() < quotaBackoffUntil;
}

function recordQuotaExhaustion() {
  quotaBackoffMs = quotaBackoffMs ? Math.min(quotaBackoffMs * 2, QUOTA_BACKOFF_MAX_MS) : QUOTA_BACKOFF_INITIAL_MS;
  quotaBackoffUntil = Date.now() + quotaBackoffMs;
  console.log(`Gemini quota exhausted - backing off auto-summarization until ${new Date(quotaBackoffUntil).toISOString()}`);
}

function recordQuotaSuccess() {
  quotaBackoffMs = 0;
  quotaBackoffUntil = 0;
}

// Returns { summary, category } from a single Gemini call - piggybacking
// category classification onto the summary request rather than a separate
// call, since every request against the free tier's 20/day quota counts.
async function generateSummary(article) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('GEMINI_API_KEY is missing.'), { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Summarize this news item in 2-3 short, punchy sentences for a busy reader, and classify it into exactly one category.

Title: ${article.title}
Source: ${article.source}
Content: ${(article.text || '').slice(0, 4000)}`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING, description: '2-3 short, punchy sentences. Plain text, no preamble, no markdown.' },
          category: { type: Type.STRING, enum: CATEGORIES }
        },
        required: ['summary', 'category']
      }
    }
  });

  try {
    const parsed = JSON.parse(response.text || '{}');
    return {
      summary: (parsed.summary || '').trim(),
      category: CATEGORIES.includes(parsed.category) ? parsed.category : null
    };
  } catch {
    // Fall back gracefully if the model ever returns malformed JSON - a
    // missing category isn't worth failing the whole summary over.
    return { summary: (response.text || '').trim(), category: null };
  }
}

// Keeps the top of the feed pre-summarized so most visitors never trigger a
// live Gemini call at all. Only ever summarizes articles that don't already
// have one (checked against Supabase), so once the top 5 are covered this
// is a no-op on every subsequent ingestion cycle until new stories rotate
// in - the free tier's 20 requests/day makes that restraint necessary, not
// optional.
async function autoSummarizeTopArticles() {
  if (!dbEnabled) return;

  if (isQuotaBackoffActive()) {
    console.log(`Skipping auto-summarize - in quota backoff until ${new Date(quotaBackoffUntil).toISOString()}`);
    return;
  }

  const topIds = currentFeed.slice(0, TOP_N_TO_AUTO_SUMMARIZE).map((a) => a.id);
  const idsNeedingSummary = await filterIdsWithoutSummary(topIds);
  if (idsNeedingSummary.length === 0) return;

  console.log(`Auto-summarizing ${idsNeedingSummary.length} of the top ${TOP_N_TO_AUTO_SUMMARIZE} stories...`);

  for (const id of idsNeedingSummary) {
    const article = currentFeed.find((a) => a.id === id);
    if (!article) continue;

    try {
      const { summary, category } = await generateSummary(article);
      await saveSummary(id, summary, category);
      recordQuotaSuccess();
      console.log(`Auto-summarized (${category || 'uncategorized'}): ${article.title}`);
    } catch (error) {
      console.error(`Auto-summarize failed for "${article.title}":`, error.message);
      if (error.status === 429) {
        recordQuotaExhaustion();
        break; // quota exhausted - no point trying the rest
      }
    }

    await sleep(2000); // stay polite to the free-tier rate limit
  }
}

async function updateFeed() {
  console.log('Starting feed update cycle...');
  try {
    // 1. Ingest raw stories (Fast RSS Pass)
    const rawStories = await fetchAndNormalizeFeeds();

    // Sort raw stories
    rawStories.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

    // Update the in-memory feed
    currentFeed = rawStories;
    console.log(`Feed update complete. Current feed size: ${currentFeed.length}`);

    await upsertArticles(currentFeed);

    // Reload from Supabase so currentFeed picks up any summary already
    // stored for these articles (from a previous cycle's auto-summarize, or
    // a visitor's manual request) instead of only ever reflecting the raw
    // scrape - upsertArticles() never writes the summary columns itself.
    if (dbEnabled) {
      const merged = await loadArticlesFromDb();
      if (merged.length > 0) currentFeed = merged;
    }

    // Write to KAISEN integration directory
    const kaizenDir = path.join(os.homedir(), '.kaizen');
    await fs.mkdir(kaizenDir, { recursive: true });
    await fs.writeFile(path.join(kaizenDir, 'ima_feed.json'), JSON.stringify(currentFeed, null, 2), 'utf8');

    await autoSummarizeTopArticles();

    // autoSummarizeTopArticles() may have just written new summaries - pull
    // them into currentFeed now instead of leaving visitors to wait for the
    // next 5-minute cycle to see them on freshly-summarized top stories.
    if (dbEnabled) {
      const refreshed = await loadArticlesFromDb();
      if (refreshed.length > 0) currentFeed = refreshed;
    }

    // Cheap (no AI call), so it runs every cycle regardless of dbEnabled -
    // groups same-story coverage across sources for the frontend to collapse.
    clusterArticles(currentFeed);

  } catch (error) {
    console.error('Error fetching raw stories:', error);
  } finally {
    // Schedule the next cycle recursively after 5 minutes
    setTimeout(updateFeed, 300000);
  }
}

function sendGeminiError(res, error, fallbackMessage) {
  console.error(fallbackMessage, error);
  if (error.status === 429) {
    return res.status(429).json({ error: "Rate limit reached on the Gemini API free tier. Please wait a bit and try again." });
  }
  if (error.status === 401 || error.status === 403) {
    return res.status(error.status).json({ error: "Gemini API key was rejected. Check GEMINI_API_KEY." });
  }
  if (error.status === 503) {
    return res.status(503).json({ error: "Gemini is experiencing high demand right now. Please try again shortly." });
  }
  res.status(500).json({ error: fallbackMessage });
}

app.get('/api/feed', (req, res) => {
  res.json(currentFeed);
});

// Pure aggregation over whatever's already in currentFeed - no extra DB
// round-trip and no AI cost, so this is safe to poll freely from the UI.
app.get('/api/stats', (req, res) => {
  const bySource = new Map();
  const byCategory = new Map();
  let summarizedCount = 0;
  let clusteredCount = 0;

  for (const item of currentFeed) {
    if (item.source) bySource.set(item.source, (bySource.get(item.source) || 0) + 1);
    if (item.category) byCategory.set(item.category, (byCategory.get(item.category) || 0) + 1);
    if (item.summary) summarizedCount += 1;
    if (item.relatedSources && item.relatedSources.length > 0) clusteredCount += 1;
  }

  const topClicked = [...currentFeed]
    .filter((item) => (item.clickCount || 0) > 0)
    .sort((a, b) => (b.clickCount || 0) - (a.clickCount || 0))
    .slice(0, 10)
    .map((item) => ({ id: item.id, title: item.title, source: item.source, clickCount: item.clickCount || 0, url: item.url }));

  res.json({
    totalArticles: currentFeed.length,
    summarizedCount,
    clusteredStories: clusteredCount,
    bySource: Array.from(bySource, ([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    byCategory: Array.from(byCategory, ([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    topClicked
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is missing." });
    }

    if (isQuotaBackoffActive()) {
      return res.status(429).json({ error: "Rate limit reached on the Gemini API free tier. Please wait a bit and try again." });
    }

    const ai = new GoogleGenAI({ apiKey });

    const context = currentFeed.slice(0, 10).map(item => `- ${item.title} (${item.source})`).join('\n');
    const systemPrompt = `You are a highly intelligent, concise, and futuristic AI neural assistant for IMA.
You live in a floating glassmorphic dashboard.
Here are the current top 10 news headlines in the system right now:\n${context}\n
Answer the user's questions strictly based on the news, or just be generally helpful and concise. Keep responses short.`;

    let prompt = `${systemPrompt}\n\n`;
    if (history && history.length > 0) {
      history.forEach(msg => {
        prompt += `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.content}\n`;
      });
    }
    prompt += `User: ${message}\nAI:`;

    const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt
    });
    recordQuotaSuccess();

    res.json({ response: response.text });
  } catch (error) {
    if (error.status === 429) recordQuotaExhaustion();
    sendGeminiError(res, error, "Failed to communicate with Neural Link.");
  }
});

app.post('/api/summarize', async (req, res) => {
  try {
    const { id } = req.body;
    const article = currentFeed.find(a => a.id === id);
    if (!article) {
      return res.status(404).json({ error: "Article not found in the current feed." });
    }

    const cached = dbEnabled ? await getSummary(id) : summaryCache.get(id)?.summary;
    if (cached) {
      return res.json({ summary: cached });
    }

    if (isQuotaBackoffActive()) {
      return res.status(429).json({ error: "Rate limit reached on the Gemini API free tier. Please wait a bit and try again." });
    }

    const { summary, category } = await generateSummary(article);
    recordQuotaSuccess();

    if (dbEnabled) {
      await saveSummary(id, summary, category);
    } else {
      cacheSummary(id, { summary, category });
    }

    res.json({ summary });
  } catch (error) {
    if (error.status === 429) recordQuotaExhaustion();
    sendGeminiError(res, error, "Failed to generate summary.");
  }
});

app.post('/api/track-click', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing article id.' });

  // Fire-and-forget from the caller's perspective (sendBeacon doesn't wait
  // on a response body anyway) - don't let a DB hiccup surface as an error
  // for something this low-stakes.
  incrementClickCount(id).catch(() => {});
  res.status(204).end();
});

// Root endpoint for health checks
app.get('/', (req, res) => {
  res.send('Ima Backend is running. Use /api/feed to get the latest news.');
});

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);

  // Serve whatever was last persisted immediately, so a cold start (a
  // Render restart, a redeploy) doesn't leave the feed empty for however
  // long the first fresh scrape takes.
  const persisted = await loadArticlesFromDb();
  if (persisted.length > 0) {
    currentFeed = persisted;
    clusterArticles(currentFeed);
    console.log(`Loaded ${persisted.length} articles from Supabase.`);
  }

  // Trigger initial feed ingestion and enrichment
  updateFeed();
});
