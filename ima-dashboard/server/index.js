import express from 'express';
import cors from 'cors';
import { fetchAndNormalizeFeeds } from './ingestion.js';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// In-memory store for the feed
let currentFeed = [];

// Cache is no longer used for raw feeds

// Summaries are cached per article id so repeat clicks (from any visitor)
// never re-hit the Gemini API - the free tier is capped at 20 requests/day,
// so a shared, bounded cache is a hard requirement, not just an optimization.
const SUMMARY_CACHE_MAX = 200;
const summaryCache = new Map();

function cacheSummary(id, summary) {
  if (summaryCache.size >= SUMMARY_CACHE_MAX) {
    summaryCache.delete(summaryCache.keys().next().value);
  }
  summaryCache.set(id, summary);
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
    
    // Write to KAISEN integration directory
    const kaizenDir = path.join(os.homedir(), '.kaizen');
    await fs.mkdir(kaizenDir, { recursive: true });
    await fs.writeFile(path.join(kaizenDir, 'ima_feed.json'), JSON.stringify(currentFeed, null, 2), 'utf8');
    
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

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is missing." });
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

    if (summaryCache.has(id)) {
      return res.json({ summary: summaryCache.get(id) });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is missing." });
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Summarize this news item in 2-3 short, punchy sentences for a busy reader. Plain text, no preamble, no markdown.

Title: ${article.title}
Source: ${article.source}
Content: ${(article.text || '').slice(0, 4000)}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt
    });

    const summary = (response.text || '').trim();
    cacheSummary(id, summary);

    res.json({ summary });
  } catch (error) {
    sendGeminiError(res, error, "Failed to generate summary.");
  }
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
