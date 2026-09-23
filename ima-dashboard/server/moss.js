import { MossClient } from '@moss-js/moss';
import dotenv from 'dotenv';

dotenv.config();

const MOSS_PROJECT_ID = process.env.MOSS_PROJECT_ID;
const MOSS_PROJECT_KEY = process.env.MOSS_PROJECT_KEY;

export const mossEnabled = Boolean(MOSS_PROJECT_ID && MOSS_PROJECT_KEY);

if (!mossEnabled) {
  console.warn('Warning: MOSS_PROJECT_ID / MOSS_PROJECT_KEY not set - Moss semantic search indexing is disabled.');
}

const INDEX_NAME = 'ima-articles';

// Matches Ima's 5-minute ingestion cycle - no point polling the cloud index
// for changes faster than new documents can actually arrive.
const AUTO_REFRESH_POLLING_SECONDS = 300;

// addDocs uploads and rebuilds server-side; batching keeps any one call's
// payload (and the embedding job behind it) to a reasonable size instead of
// sending the whole feed - up to ~150 articles - in one shot.
const ADD_DOCS_BATCH_SIZE = 100;

const moss = mossEnabled ? new MossClient(MOSS_PROJECT_ID, MOSS_PROJECT_KEY) : null;

let indexLoaded = false;

function toDocument(article) {
  return {
    id: article.id,
    text: `${article.title}\n\n${article.summary || ''}\n\n${(article.text || '').slice(0, 4000)}`,
    metadata: {
      source: article.source || '',
      category: article.category || '',
      pubDate: article.pubDate || ''
    }
  };
}

// Creates the "ima-articles" index on first use, then loads it into memory
// with auto-refresh so subsequent addDocs/query calls see documents from
// earlier ingestion cycles (including ones from a previous server process).
// Moss's createIndex rejects an empty doc list, so the index can only be
// created once at least one seed document is available (i.e. once an
// ingestion cycle has run) - a query that arrives before that just sees an
// empty result via the indexLoaded check below.
export async function ensureMossIndex(seedDocs = []) {
  if (!mossEnabled || indexLoaded) return;

  try {
    const indexes = await moss.listIndexes();
    const exists = indexes.some((index) => index.name === INDEX_NAME);

    if (!exists) {
      if (seedDocs.length === 0) return;

      try {
        await moss.createIndex(INDEX_NAME, seedDocs, { modelId: 'moss-minilm' });
      } catch (error) {
        // Guard against a race between the listIndexes check above and this
        // call (e.g. two server instances starting at once) rather than
        // trusting the check alone.
        if (!/already exists/i.test(error.message)) throw error;
      }
    }

    await moss.loadIndex(INDEX_NAME, {
      autoRefresh: true,
      pollingIntervalInSeconds: AUTO_REFRESH_POLLING_SECONDS
    });

    indexLoaded = true;
  } catch (error) {
    console.error('Failed to set up Moss index:', error.message);
  }
}

// Upserts the current ingestion cycle's articles into the Moss index in
// batches, so Moss stays in sync with Supabase on the same cadence without
// one addDocs call per article.
export async function indexArticles(articles) {
  if (!mossEnabled || articles.length === 0) return;

  const docs = articles.map(toDocument);

  await ensureMossIndex(docs);
  if (!indexLoaded) return;

  for (let i = 0; i < docs.length; i += ADD_DOCS_BATCH_SIZE) {
    const batch = docs.slice(i, i + ADD_DOCS_BATCH_SIZE);
    try {
      await moss.addDocs(INDEX_NAME, batch, { upsert: true });
    } catch (error) {
      console.error(`Failed to index batch of ${batch.length} articles to Moss:`, error.message);
    }
  }
}

// Runs a semantic query against the "ima-articles" index, loading it first
// if this is the process's first query (e.g. it hasn't ingested anything
// yet this run). Returns { docs: [] } rather than throwing when Moss isn't
// configured or the index couldn't be loaded, so callers can treat a query
// as simply empty instead of special-casing availability everywhere.
export async function queryMossIndex(query, options = {}) {
  if (!mossEnabled) return { docs: [] };

  await ensureMossIndex();
  if (!indexLoaded) return { docs: [] };

  return moss.query(INDEX_NAME, query, options);
}
