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
        model: 'gemini-1.5-flash',
        contents: prompt
    });

    res.json({ response: response.text });
  } catch (error) {
    console.error("Chat API error:", error);
    res.status(500).json({ error: "Failed to communicate with Neural Link." });
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
