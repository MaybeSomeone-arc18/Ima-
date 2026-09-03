import Parser from 'rss-parser';
import crypto from 'crypto';
import jsdom from 'jsdom';
import { Readability } from '@mozilla/readability';
import dotenv from 'dotenv';

dotenv.config();

const parser = new Parser();
const { JSDOM } = jsdom;

const feeds = [
  'https://techcrunch.com/feed/',
  'https://news.ycombinator.com/rss',
  'https://stratechery.com/feed/',
  'https://blog.github.com/changelog/all.atom'
];

function generateHash(url, title) {
  return crypto.createHash('sha256').update(url + title).digest('hex');
}

export async function extractFullText(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    const html = await response.text();
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();
    return article ? article.textContent : '';
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`Failed to extract text from ${url}:`, error.message);
    return '';
  }
}

export async function fetchAndNormalizeFeeds() {
  const allStories = [];

  for (const feedUrl of feeds) {
    try {
      const feed = await parser.parseURL(feedUrl);
      
      for (const item of feed.items) {
        const title = item.title || '';
        const url = item.link || '';
        const rawText = item.contentSnippet || item.content || '';
        const id = generateHash(url, title);
        
        allStories.push({
          id,
          title,
          url,
          text: rawText.trim(),
          source: feed.title || feedUrl,
          pubDate: item.pubDate || new Date().toISOString()
        });
      }
    } catch (error) {
      console.error(`Failed to process feed ${feedUrl}:`, error.message);
    }
  }

  // Deduplicate based on ID
  const uniqueStories = Array.from(new Map(allStories.map(s => [s.id, s])).values());
  
  return uniqueStories;
}
