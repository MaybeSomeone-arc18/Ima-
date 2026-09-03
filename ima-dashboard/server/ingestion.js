import Parser from 'rss-parser';
import crypto from 'crypto';
import jsdom from 'jsdom';
import { Readability } from '@mozilla/readability';
import dotenv from 'dotenv';

dotenv.config();

const parser = new Parser({
  timeout: 5000, // 5 second timeout so a dead RSS feed doesn't freeze the server
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['content:encoded', 'contentEncoded']
    ]
  }
});
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

// Most feeds (Hacker News, TechCrunch) don't embed images in the RSS payload,
// so real cover images have to be scraped from the article page itself.
// Cached in-memory per URL so we don't re-fetch the same article every ingestion cycle.
const ogImageCache = new Map();

async function fetchOgImage(url) {
  if (ogImageCache.has(url)) return ogImageCache.get(url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ImaBot/1.0)' }
    });
    clearTimeout(timeoutId);

    const html = await response.text();
    const doc = new JSDOM(html, { url });
    const meta =
      doc.window.document.querySelector('meta[property="og:image"]') ||
      doc.window.document.querySelector('meta[name="twitter:image"]');
    const rawImageUrl = meta ? meta.getAttribute('content') : null;
    // og:image should be absolute per spec, but not every site complies -
    // resolve against the article URL so relative paths don't 404 client-side.
    const imageUrl = rawImageUrl ? new URL(rawImageUrl, url).href : null;

    ogImageCache.set(url, imageUrl);
    return imageUrl;
  } catch {
    clearTimeout(timeoutId);
    ogImageCache.set(url, null);
    return null;
  }
}

async function fillMissingImages(stories, concurrency = 8) {
  const needsImage = stories.filter(s => s.url && !s.imageUrl);
  let cursor = 0;

  async function worker() {
    while (cursor < needsImage.length) {
      const story = needsImage[cursor++];
      story.imageUrl = await fetchOgImage(story.url);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
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
        
        let imageUrl = null;
        if (item.enclosure && item.enclosure.url) {
          imageUrl = item.enclosure.url;
        } else if (item.mediaContent && item.mediaContent.length > 0 && item.mediaContent[0].$) {
          imageUrl = item.mediaContent[0].$.url;
        } else {
          const htmlContent = item.contentEncoded || item.content || item.contentSnippet || '';
          const imgMatch = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
          if (imgMatch) imageUrl = imgMatch[1];
        }
        
        allStories.push({
          id,
          title,
          url,
          imageUrl,
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

  await fillMissingImages(uniqueStories);

  return uniqueStories;
}
