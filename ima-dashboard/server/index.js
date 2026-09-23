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
  saveEmbedding,
  filterIdsWithoutEmbedding,
  incrementClickCount
} from './db.js';
import { hasAvailableKey, withKeyRotation } from './quota.js';
import { answerQuestion } from './pgvector.js';
import { answerQuestionNaive } from './naive.js';
import { EMBEDDING_MODEL } from './lib/embedQuery.js';
import { AccessToken } from 'livekit-server-sdk';
import { randomUUID } from 'crypto';

// Background cloud SDKs (Supabase, LiveKit) can emit a socket-level 'error'
// with no listener attached, which Node treats as an uncaught exception and
// kills the whole process - observed in
// practice as a `SocketError: other side closed` on an HTTP/2 connection,
// unrelated to any in-flight request. Log and keep serving rather than let a
// transient network blip on a background connection take the whole app down.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception (server staying up):', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (server staying up):', reason);
});

const CATEGORIES = ['AI', 'Security', 'Hardware', 'Startups/Funding', 'Policy', 'DevTools', 'General'];

// Single shared room the ima-voice-agent worker listens on - dispatched
// automatically to any room a participant joins, so there's no per-session
// room-creation step here, just one well-known name both sides agree on.
const VOICE_ROOM_NAME = 'ima-voice';

dotenv.config();

const livekitEnabled = Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.LIVEKIT_URL);
if (!livekitEnabled) {
  console.warn('Warning: LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set - voice mode is disabled.');
}

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
const MAX_EMBEDS_PER_CYCLE = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns { summary, category } from a single Gemini call - piggybacking
// category classification onto the summary request rather than a separate
// call, since every request against the free tier's 20/day quota counts.
// Routed through withKeyRotation so a 429 on one configured key falls
// through to the next before the whole call is treated as failed.
async function generateSummary(article) {
  const prompt = `Summarize this news item in 2-3 short, punchy sentences for a busy reader, and classify it into exactly one category.

Title: ${article.title}
Source: ${article.source}
Content: ${(article.text || '').slice(0, 4000)}`;

  const response = await withKeyRotation((apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    return ai.models.generateContent({
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

  if (!hasAvailableKey()) {
    console.log('Skipping auto-summarize - every configured Gemini key is in quota backoff.');
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
      console.log(`Auto-summarized (${category || 'uncategorized'}): ${article.title}`);
    } catch (error) {
      console.error(`Auto-summarize failed for "${article.title}":`, error.message);
      // generateSummary() already rotated through every configured key before
      // surfacing a 429 here, so this means the whole pool is exhausted - no
      // point trying the rest of this batch.
      if (error.status === 429) break;
    }

    await sleep(2000); // stay polite to the free-tier rate limit
  }
}

// Embeds an article's title+summary with Gemini for the naive retrieval path
// (server/naive.js) to do its own cosine-similarity search against, as a
// fair comparison to pgvector.js's indexed ANN search. Uses RETRIEVAL_DOCUMENT,
// the task type meant for content that will be searched over (paired with
// RETRIEVAL_QUERY on the query side in naive.js).
async function generateEmbedding(article) {
  const response = await withKeyRotation((apiKey) => {
    const ai = new GoogleGenAI({ apiKey });
    return ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: `${article.title}\n\n${article.summary || ''}`,
      config: { taskType: 'RETRIEVAL_DOCUMENT', title: article.title }
    });
  });

  return response.embeddings?.[0]?.values || [];
}

// Embeds summarized articles that don't have an embedding yet, once each,
// capped at MAX_EMBEDS_PER_CYCLE per cycle - mirrors
// autoSummarizeTopArticles()'s top-5-per-cycle restraint above so a large
// backlog (e.g. summaries that existed before the embedding column did)
// trickles in over several cycles instead of bursting through the free
// tier's daily quota in one run.
async function autoEmbedArticles() {
  if (!dbEnabled) return;

  if (!hasAvailableKey()) {
    console.log('Skipping auto-embed - every configured Gemini key is in quota backoff.');
    return;
  }

  const summarizedIds = currentFeed.filter((a) => a.summary).map((a) => a.id);
  const idsNeedingEmbedding = (await filterIdsWithoutEmbedding(summarizedIds)).slice(0, MAX_EMBEDS_PER_CYCLE);
  if (idsNeedingEmbedding.length === 0) return;

  console.log(`Embedding ${idsNeedingEmbedding.length} article(s)...`);

  for (const id of idsNeedingEmbedding) {
    const article = currentFeed.find((a) => a.id === id);
    if (!article) continue;

    try {
      const vector = await generateEmbedding(article);
      if (vector.length > 0) {
        await saveEmbedding(id, vector);
        console.log(`Embedded: ${article.title}`);
      }
    } catch (error) {
      console.error(`Embedding failed for "${article.title}":`, error.message);
      // generateEmbedding() already rotated through every configured key
      // before surfacing a 429 here, so the whole pool is exhausted.
      if (error.status === 429) break;
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

    await autoEmbedArticles();

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

    if (!hasAvailableKey()) {
      return res.status(429).json({ error: "Rate limit reached on the Gemini API free tier. Please wait a bit and try again." });
    }

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

    const response = await withKeyRotation((apiKey) => {
      const ai = new GoogleGenAI({ apiKey });
      return ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt
      });
    });

    res.json({ response: response.text });
  } catch (error) {
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

    if (!hasAvailableKey()) {
      return res.status(429).json({ error: "Rate limit reached on the Gemini API free tier. Please wait a bit and try again." });
    }

    const { summary, category } = await generateSummary(article);

    if (dbEnabled) {
      await saveSummary(id, summary, category);
    } else {
      cacheSummary(id, { summary, category });
    }

    res.json({ summary });
  } catch (error) {
    sendGeminiError(res, error, "Failed to generate summary.");
  }
});

// mode 'pgvector' (default) uses the indexed ANN retrieval path (pgvector.js);
// mode 'naive' uses the DIY Postgres + app-side linear-scan path (naive.js) -
// same question in, same response shape out, so the two are directly
// comparable. See naive.js for what "naive" means here: no artificial
// slowdown, just an honestly-built baseline with no persistent vector index.
app.post('/api/ask', async (req, res) => {
  try {
    const { question, mode } = req.body;
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: "Missing question." });
    }
    if (mode !== undefined && mode !== 'pgvector' && mode !== 'naive') {
      return res.status(400).json({ error: "Invalid mode. Use 'pgvector' or 'naive'." });
    }

    const useNaive = mode === 'naive';

    if (!dbEnabled) {
      return res.status(503).json({ error: "Retrieval requires Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." });
    }

    const result = useNaive
      ? await answerQuestionNaive(question.trim())
      : await answerQuestion(question.trim());
    res.json(result);
  } catch (error) {
    // answerQuestion()/answerQuestionNaive() make multiple Gemini calls
    // internally, each already routed through withKeyRotation() (see
    // server/quota.js) - a 429 here means every configured key was tried
    // and exhausted, not just one.
    sendGeminiError(res, error, "Failed to answer question.");
  }
});

// Mints a short-lived LiveKit room token for the Ask bar's mic button. A
// fresh random identity per request keeps re-joins from colliding with a
// stale connection under the same identity; the room itself is shared
// (VOICE_ROOM_NAME) since ima-voice-agent's worker only needs to find it.
app.get('/api/livekit-token', async (req, res) => {
  if (!livekitEnabled) {
    return res.status(503).json({ error: 'Voice mode is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.' });
  }

  try {
    const identity = `visitor-${randomUUID()}`;
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, ttl: '10m' });
    at.addGrant({
      room: VOICE_ROOM_NAME,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true
    });

    const token = await at.toJwt();
    res.json({ token, url: process.env.LIVEKIT_URL, room: VOICE_ROOM_NAME, identity });
  } catch (error) {
    console.error('Failed to mint LiveKit token:', error);
    res.status(500).json({ error: 'Failed to mint LiveKit token.' });
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
