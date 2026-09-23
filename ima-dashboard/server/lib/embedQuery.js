import { withKeyRotation } from '../quota.js';

export const EMBEDDING_MODEL = 'gemini-embedding-001';

// 768 rather than the model's default 3072: pgvector's HNSW/IVFFlat index
// types have a hard 2000-dimension limit, and Gemini's embedding model is
// trained with Matryoshka representation learning, so requesting a smaller
// outputDimensionality yields a properly-renormalized (not just truncated)
// lower-dimensional embedding rather than a degraded one.
export const EMBEDDING_DIMENSIONS = 768;

// Embeds a piece of text with Gemini, shared by every path that needs a
// vector: naive.js's linear scan, pgvector.js's indexed ANN search, and
// index.js's generateEmbedding() (for storage) all call this - a mismatch
// in model or dimensions between any of them would silently break cosine
// similarity, since they'd no longer be comparable vectors.
export async function embedText(createAiClient, text, config) {
  const response = await withKeyRotation((apiKey) =>
    createAiClient(apiKey).models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS, ...config }
    })
  );
  return response.embeddings?.[0]?.values || [];
}
