# 今 IMA — Live Neural Feed

A dark, glassmorphic news dashboard that aggregates Hacker News, TechCrunch, Stratechery, the GitHub Changelog, The Verge, Ars Technica, and WIRED into one live feed, with a Gemini-powered chat assistant and per-article AI summaries.


## Features

- **Live aggregated feed** — pulls and normalizes 7 RSS/Atom feeds every 5 minutes, deduplicated by content hash
- **Persisted to Supabase** — every ingestion cycle upserts into Postgres, and the feed loads from there on startup, so a Render restart or redeploy serves data immediately instead of waiting on a fresh scrape (optional — falls back to in-memory-only if unconfigured)
- **Real cover images** — most source feeds don't embed images, so the backend scrapes each article's `og:image` as a fallback and caches the result
- **AI chat assistant** — ask questions about current headlines, answered by Google's Gemini API with the live feed as context
- **AI summaries** — a per-card "summarize" button that gets a short Gemini-generated summary in a flyout. The top 5 stories are auto-summarized in the background as they enter the feed; every summary is cached in Supabase by article id so it's generated once, ever, across every visitor
- **Read aloud** — every card and every AI summary can be read aloud via the browser's built-in text-to-speech (Web Speech API)
- **Bookmarks** — save articles for later; persisted in `localStorage` with the full article data, so saved items survive the feed's 5-minute rotation
- **Search, source filters, and a command palette** — filter by keyword or source, or hit `Cmd/Ctrl+K` for a quick-search overlay
- **Responsive, animated UI** — React 19 + Tailwind v4 + Framer Motion, built mobile-first

## Project structure

```
ima-dashboard/
├── src/                       # React frontend (Vite)
│   ├── App.jsx                # Layout, header, search/filter state, keyboard shortcuts
│   ├── NewsGrid.jsx            # Masonry card grid, per-card summary + read-aloud + bookmark
│   ├── ChatBot.jsx             # Floating AI chat widget
│   ├── CommandPalette.jsx      # Cmd/Ctrl+K quick search overlay
│   ├── lib/api.js              # Shared API base URL resolution
│   └── hooks/
│       ├── useLiveFeed.js      # Polls /api/feed
│       └── useBookmarks.js     # localStorage-backed bookmarks
├── server/                    # Express backend
│   ├── index.js                # API routes (/api/feed, /api/chat, /api/summarize) + ingestion scheduler
│   ├── ingestion.js             # RSS fetching, dedup, og:image scraping
│   ├── db.js                    # Supabase persistence: load/upsert articles, get/save summaries
│   ├── enricher.js              # Gemini-based categorization (not currently wired in)
│   └── cache.js                 # Disk cache used by enricher.js
└── kaisen-bridge/              # Standalone helper script for an external tool integration
```

## Getting started

```bash
cd ima-dashboard
npm install
cp .env.example .env   # then fill in GEMINI_API_KEY
```

Run the backend and frontend in two separate terminals:

```bash
npm run start   # Express API on http://localhost:3001
npm run dev     # Vite dev server on http://localhost:5173
```

Open `http://localhost:5173`. The frontend talks to `localhost:3001` automatically in dev mode.

Supabase is optional for local dev — without it the app still runs, it just re-scrapes from scratch on every restart and keeps summaries in memory only (lost on restart). To enable it:

1. Create a Supabase project.
2. Run this migration in the SQL editor (also in `server/db.js`'s comments):
   ```sql
   create table if not exists articles (
     id text primary key,
     title text not null,
     url text not null,
     image_url text,
     text text,
     source text,
     category text,
     importance_score integer,
     pub_date timestamptz,
     summary text,
     summary_generated_at timestamptz,
     updated_at timestamptz not null default now()
   );
   create index if not exists articles_pub_date_idx on articles (pub_date desc);
   alter table articles enable row level security;
   create policy "Public read access" on articles for select using (true);
   ```
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → service_role secret — **not** the anon/publishable key, since the backend needs to bypass RLS to write) in `.env`.


## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini API key, used by `/api/chat` and `/api/summarize`. Get one at [Google AI Studio](https://aistudio.google.com/apikey). |
| `SUPABASE_URL` | No | Supabase project API URL. Enables persistence and shared summary caching — see above. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase **service role** (secret) key — server-side only, never exposed to the frontend. |
| `PORT` | No | Port for the Express server. Defaults to `3001`. |
| `NODE_ENV` | No | Standard Node environment flag. |
| `VITE_API_BASE_URL` | No | Frontend override for the backend origin (see `src/lib/api.js`). Defaults to `localhost:3001` in dev, the deployed Render URL in production. |

**Gemini free-tier note:** the free tier caps out at roughly 20 requests/day per model, shared across the chat assistant *and* the summarize feature. If either replies with "Rate limit reached," that's Google's quota, not a bug. With Supabase configured this is much harder to hit day-to-day: every summary is generated once and cached forever (shared across all visitors, survives restarts), and a background job keeps the top 5 stories pre-summarized rather than waiting for someone to click. Without Supabase, wait for the daily reset or enable billing on the Google Cloud project behind your key.


## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server (frontend) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run start` | Start the Express backend |
| `npm run lint` | Run oxlint |


## Deployment

The frontend expects a deployed backend at `https://ima-9ay9.onrender.com` in production (see `src/lib/api.js`). If you deploy your own backend elsewhere, set `VITE_API_BASE_URL` to override it. The backend is a plain Express app — any Node host (Render, Railway, Fly.io, etc.) works; just set `GEMINI_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in that host's environment settings so the deployed instance persists to the same Supabase project as local dev (or its own, if you want separate data).


## Known limitations

- `server/enricher.js` (Gemini-based categorization/scoring) and `kaisen-bridge/ima-skill.js` (an external integration helper) exist in the codebase but aren't called from the running app.
- Image scraping is best-effort: sites that block scraping or omit Open Graph tags fall back to a stylized placeholder card.
