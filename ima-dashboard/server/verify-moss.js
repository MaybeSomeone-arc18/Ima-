// One-off check that a real article round-trips through Moss: index it, then
// confirm a query for its own headline returns it back. Not wired into any
// endpoint or npm script - run manually after setting MOSS_PROJECT_ID /
// MOSS_PROJECT_KEY:
//
//   node server/verify-moss.js
import { MossClient } from '@moss-js/moss';
import dotenv from 'dotenv';
import { mossEnabled, indexArticles } from './moss.js';

dotenv.config();

if (!mossEnabled) {
  console.error('MOSS_PROJECT_ID / MOSS_PROJECT_KEY not set - nothing to verify.');
  process.exit(1);
}

const sample = {
  id: 'moss-verify-sample',
  title: 'OpenAI announces GPT-5 with major reasoning improvements',
  summary: 'The new model reportedly outperforms prior versions on complex benchmarks.',
  text: 'OpenAI today announced GPT-5, its latest large language model, claiming significant gains in reasoning and coding tasks compared to GPT-4.',
  source: 'TechCrunch',
  category: 'AI',
  pubDate: new Date().toISOString()
};

await indexArticles([sample]);

const client = new MossClient(process.env.MOSS_PROJECT_ID, process.env.MOSS_PROJECT_KEY);
await client.loadIndex('ima-articles');
const result = await client.query('ima-articles', sample.title, { topK: 3 });

const match = result.docs.find((doc) => doc.id === sample.id);
console.log(`Query: ${result.query}`);
result.docs.forEach((doc) => console.log(`  ${doc.id}: score=${doc.score.toFixed(4)}`));
console.log(match ? `PASS - sample article returned (score ${match.score.toFixed(4)})` : 'FAIL - sample article not in results');

await client.close();
process.exit(match ? 0 : 1);
