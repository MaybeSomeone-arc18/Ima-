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
    summary: row.summary,
    clickCount: row.click_count || 0
  };
}

const PAGE_SIZE = 1000;

// Loads whatever was persisted from the last ingestion run, so the feed has
// data immediately on a cold start instead of waiting for a fresh scrape.
// Paginated because Supabase/PostgREST caps a single select at 1000 rows by
// default - without this the feed silently truncated to the newest 1000 of
// what's actually a 3000+ row table.
export async function loadArticlesFromDb() {
  if (!dbEnabled) return [];

  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('articles')
      .select('*')
      .order('pub_date', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Failed to load articles from Supabase:', error.message);
      return rows.map(rowToArticle);
    }

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return rows.map(rowToArticle);
}

// Upserts the raw scraped fields only. summary/summary_generated_at and
// category are deliberately omitted from the payload - none of them are
// ever set by the RSS scrape, so including them (even as null) would wipe
// out whatever the AI pipeline previously wrote on every 5-minute cycle.
export async function upsertArticles(articles) {
  if (!dbEnabled || articles.length === 0) return;

  const rows = articles.map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    image_url: a.imageUrl,
    text: a.text,
    source: a.source,
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

export async function saveSummary(id, summary, category) {
  if (!dbEnabled) return;

  const update = { summary, summary_generated_at: new Date().toISOString() };
  if (category) update.category = category;

  const { error } = await supabase.from('articles').update(update).eq('id', id);

  if (error) {
    console.error('Failed to save summary to Supabase:', error.message);
  }
}

// Looks up display metadata (title, url, source) for a set of article ids -
// used to join retrieval hits (which only carry an id and the indexed text)
// back to the fields the frontend needs to render a citation.
export async function getArticlesByIds(ids) {
  if (!dbEnabled || ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('articles')
    .select('id, title, url, source')
    .in('id', ids);

  if (error) {
    console.error('Failed to load article metadata from Supabase:', error.message);
    return new Map();
  }

  return new Map((data || []).map((row) => [row.id, { title: row.title, url: row.url, source: row.source }]));
}

// `embedding` is a pgvector column, not jsonb - sent as a bracketed string
// ("[0.1,0.2,...]") rather than a raw JS array, since that's pgvector's text
// input format and PostgREST has no JSON->vector cast to fall back on.
export async function saveEmbedding(id, vector) {
  if (!dbEnabled) return;

  const { error } = await supabase.from('articles').update({ embedding: JSON.stringify(vector) }).eq('id', id);

  if (error) {
    console.error('Failed to save embedding to Supabase:', error.message);
  }
}

// Runs the match_articles() pgvector similarity search (see the
// replace_moss_with_pgvector migration) - an HNSW-indexed nearest-neighbor
// search over every embedded article, done in Postgres instead of the
// app-side linear scan getAllArticlesForNaiveSearch() below feeds naive.js.
export async function queryPgvectorIndex(queryVector, matchCount) {
  if (!dbEnabled) return [];

  const { data, error } = await supabase.rpc('match_articles', {
    query_embedding: queryVector,
    match_count: matchCount
  });

  if (error) {
    console.error('Failed to query pgvector index:', error.message);
    return [];
  }

  return data || [];
}

// Ids (from the given candidate list) that don't have an embedding yet -
// used to drive one-time embedding generation, mirroring
// filterIdsWithoutSummary() above.
//
// Chunked (unlike filterIdsWithoutSummary, which only ever sees a handful of
// top-N ids) because this candidate list is every summarized article - as
// that grows into the hundreds, a single `.in('id', ids)` GET request's query
// string grows past Supabase's URL length limit and 400s outright.
const FILTER_CHUNK_SIZE = 150;

export async function filterIdsWithoutEmbedding(ids) {
  if (!dbEnabled || ids.length === 0) return ids;

  const alreadyEmbedded = new Set();

  for (let i = 0; i < ids.length; i += FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + FILTER_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('articles')
      .select('id')
      .in('id', chunk)
      .not('embedding', 'is', null);

    if (error) {
      console.error('Failed to check existing embeddings in Supabase:', error.message);
      continue;
    }

    for (const row of data || []) alreadyEmbedded.add(row.id);
  }

  return ids.filter((id) => !alreadyEmbedded.has(id));
}

// PostgREST caps any single select at this many rows by default - a plain
// unbounded select() silently truncates rather than erroring, which is the
// same cap loadArticlesFromDb() above hits ("Loaded 1000 articles..." at
// 3000+ rows in the table). getAllArticlesForNaiveSearch() below pages past
// it rather than fixing this: fetching genuinely every row is the whole
// point of the "no persistent index" baseline it's used for.
const NAIVE_FETCH_PAGE_SIZE = 1000;

// A fresh, uncached select of every article's id/title/url/source/embedding -
// used by the naive retrieval path (server/naive.js) to honestly mirror a
// setup with no persistent vector index: every hop re-fetches the full table
// over the network (paginating past PostgREST's row cap if needed) and scores
// every candidate in JS, instead of an indexed search like pgvector.js's.
export async function getAllArticlesForNaiveSearch() {
  if (!dbEnabled) return [];

  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('articles')
      .select('id,title,url,source,embedding')
      .range(from, from + NAIVE_FETCH_PAGE_SIZE - 1);

    if (error) {
      console.error('Failed to load articles for naive search from Supabase:', error.message);
      break;
    }

    rows.push(...(data || []));
    if (!data || data.length < NAIVE_FETCH_PAGE_SIZE) break;
    from += NAIVE_FETCH_PAGE_SIZE;
  }

  // PostgREST serializes a pgvector column as its text form ("[0.1,0.2,...]"),
  // not a JSON array - parse it back so naive.js's cosine similarity scan can
  // index into it numerically.
  return rows.map((row) => ({
    ...row,
    embedding: typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding
  }));
}

export async function incrementClickCount(id) {
  if (!dbEnabled) return;

  const { error } = await supabase.rpc('increment_click_count', { article_id: id });
  if (error) {
    console.error('Failed to record click in Supabase:', error.message);
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
