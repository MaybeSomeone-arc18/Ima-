import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const dbEnabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!dbEnabled) {
  console.warn('Warning: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - persistence and cached summaries are disabled, running in-memory only.');
}

// The service role key bypasses RLS, which is correct here: this client only
// ever runs server-side (never shipped to the browser), and is the sole writer.
const supabase = dbEnabled ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

function rowToArticle(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    imageUrl: row.image_url,
    text: row.text,
    source: row.source,
    category: row.category,
    importanceScore: row.importance_score,
    pubDate: row.pub_date,
    summary: row.summary
  };
}

// Loads whatever was persisted from the last ingestion run, so the feed has
// data immediately on a cold start instead of waiting for a fresh scrape.
export async function loadArticlesFromDb() {
  if (!dbEnabled) return [];

  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .order('pub_date', { ascending: false });

  if (error) {
    console.error('Failed to load articles from Supabase:', error.message);
    return [];
  }

  return (data || []).map(rowToArticle);
}

// Upserts the raw scraped fields only - summary/summary_generated_at are
// deliberately omitted from the payload so this never clobbers a summary
// that was already generated for an article on a previous ingestion cycle.
export async function upsertArticles(articles) {
  if (!dbEnabled || articles.length === 0) return;

  const rows = articles.map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    image_url: a.imageUrl,
    text: a.text,
    source: a.source,
    category: a.category || null,
    importance_score: a.importanceScore || null,
    pub_date: a.pubDate,
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase.from('articles').upsert(rows, { onConflict: 'id' });
  if (error) {
    console.error('Failed to upsert articles to Supabase:', error.message);
  }
}

export async function getSummary(id) {
  if (!dbEnabled) return null;

  const { data, error } = await supabase
    .from('articles')
    .select('summary')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Failed to read summary from Supabase:', error.message);
    return null;
  }

  return data?.summary || null;
}

export async function saveSummary(id, summary) {
  if (!dbEnabled) return;

  const { error } = await supabase
    .from('articles')
    .update({ summary, summary_generated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('Failed to save summary to Supabase:', error.message);
  }
}

// Ids (from the given candidate list, most-recent-first) that don't have a
// summary yet - used to drive automatic summarization of the top of the feed.
export async function filterIdsWithoutSummary(ids) {
  if (!dbEnabled || ids.length === 0) return ids;

  const { data, error } = await supabase
    .from('articles')
    .select('id')
    .in('id', ids)
    .not('summary', 'is', null);

  if (error) {
    console.error('Failed to check existing summaries in Supabase:', error.message);
    return ids;
  }

  const alreadySummarized = new Set((data || []).map((row) => row.id));
  return ids.filter((id) => !alreadySummarized.has(id));
}
