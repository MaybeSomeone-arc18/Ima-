# 今 IMA — Live Neural Feed

A dark, glassmorphic news dashboard that aggregates Hacker News, TechCrunch, Stratechery, the GitHub Changelog, The Verge, Ars Technica, and WIRED into one live feed, with a Gemini-powered chat assistant, per-article AI summaries, and a multi-hop Q&A "Ask" bar — typed or spoken — that benchmarks Moss's semantic search against a DIY baseline in real time.


## Features

- **Live aggregated feed** — pulls and normalizes 7 RSS/Atom feeds every 5 minutes, deduplicated by content hash
- **Persisted to Supabase** — every ingestion cycle upserts into Postgres, and the feed loads from there on startup, so a Render restart or redeploy serves data immediately instead of waiting on a fresh scrape (optional — falls back to in-memory-only if unconfigured)
- **Real cover images** — most source feeds don't embed images, so the backend scrapes each article's `og:image` as a fallback and caches the result
- **AI chat assistant** — ask questions about current headlines, answered by Google's Gemini API with the live feed as context
- **Ask IMA — Moss vs. naive retrieval, side by side** — a floating "Ask" bar (`⚡`, bottom-left) answers multi-hop questions over the full article history, grounded with inline citations. Toggle between two retrieval backends for the same question: **Moss** (a purpose-built semantic search index) and **Naive** (a DIY Postgres + app-side cosine-similarity linear scan, embedded with Gemini) — both share the same sub-query planning and answer synthesis, so retrieval mechanism is the only variable. A live latency HUD shows retrieval time hop-by-hop for whichever mode(s) you've run
- **Ask IMA by voice** — the Ask bar's mic button starts a real-time voice call (via [`ima-voice-agent`](ima-voice-agent), a LiveKit agent) that answers spoken questions against the same Moss index, speaking the answer back and streaming the same latency HUD live over a data channel
- **AI summaries + categories** — a per-card "summarize" button that gets a short Gemini-generated summary (plus a category, from the same call) in a flyout. The top 5 stories are auto-summarized in the background as they enter the feed; every summary is cached in Supabase by article id so it's generated once, ever, across every visitor. Category chips only list categories that actually exist among summarized articles, since classifying all ~150 up front isn't affordable on the free tier — the list grows as more get summarized
- **Read aloud** — every card and every AI summary can be read aloud via the browser's built-in text-to-speech (Web Speech API)
- **Bookmarks** — save articles for later; persisted in `localStorage` with the full article data, so saved items survive the feed's 5-minute rotation
- **Search, source and category filters, and a command palette** — filter by keyword, source, or AI-assigned category, or hit `Cmd/Ctrl+K` for a quick-search overlay
- **Keyboard navigation** — `j`/`k` move focus between cards, `Enter` opens the focused story, `s` bookmarks it, `/` jumps to search — all disabled while any text field has focus so they never hijack typing
- **Story clustering** — same-story coverage from different sources (e.g. three outlets on one Tesla story) collapses into one card with a "+N more sources" expander, computed purely by title similarity server-side — no AI cost
- **Trending badge** — link clicks are tracked per article; anything past a threshold gets a 🔥 badge
- **Feed stats** — a stats panel (bar chart icon in the header) shows top-clicked stories, category and source breakdowns, and cluster counts, computed on the fly from the live feed with no extra DB round-trip
- **Installable PWA** — has a manifest, icons, and a conservative service worker (API calls always hit the network; only hashed build assets are cached)
- **Responsive, animated UI** — React 19 + Tailwind v4 + Framer Motion, built mobile-first

## Project structure

```
ima-dashboard/
├── src/                       # React frontend (Vite)
│   ├── App.jsx                # Layout, header, search/filter state, keyboard shortcuts
│   ├── NewsGrid.jsx            # Masonry card grid, per-card summary + read-aloud + bookmark
│   ├── ChatBot.jsx             # Floating AI chat widget
│   ├── AskBar.jsx              # Floating "Ask IMA" bar - typed Q&A (Moss/Naive toggle) + voice call via LiveKit
│   ├── LatencyHUD.jsx          # Retrieval-latency HUD, shared by AskBar's typed and voice paths
│   ├── CommandPalette.jsx      # Cmd/Ctrl+K quick search overlay
│   ├── StatsPanel.jsx           # Feed stats panel (top clicked, category/source breakdown)
│   ├── lib/api.js              # Shared API base URL resolution
│   └── hooks/
│       ├── useLiveFeed.js      # Polls /api/feed
│       └── useBookmarks.js     # localStorage-backed bookmarks
└── server/                    # Express backend
    ├── index.js                # API routes (/api/feed, /api/stats, /api/chat, /api/summarize, /api/ask, /api/livekit-token, /api/track-click) + ingestion scheduler
    ├── ingestion.js             # RSS fetching, dedup, og:image scraping, HTML entity decoding
    ├── clustering.js            # Same-story detection across sources (title token overlap, no AI)
    ├── db.js                    # Supabase persistence: load/upsert articles, get/save summaries/embeddings, click tracking
    ├── moss.js                  # Moss semantic search index: create/load the index, upsert articles per ingestion cycle
    ├── agent.js                 # /api/ask, mode "moss" - multi-hop Q&A retrieving from the Moss index
    ├── naive.js                 # /api/ask, mode "naive" - the same Q&A pipeline over a DIY Postgres + app-side cosine-similarity scan, as a fair baseline to benchmark Moss against
    ├── lib/qaPipeline.js        # Shared multi-hop orchestration (sub-query planning, grounded answer synthesis) used by both agent.js and naive.js - retrieval mechanism is the only variable between them
    └── quota.js                 # Shared Gemini quota-backoff state across every route/job that calls Gemini

ima-voice-agent/               # Python LiveKit agent - voice counterpart to AskBar's typed "Ask IMA"
├── agent.py                    # Joins the shared LiveKit room, answers via Moss (search_knowledge_base tool) + Gemini/OpenAI, streams the latency HUD over a data message
├── requirements.txt
└── .env.example
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
     click_count integer not null default 0,
     embedding jsonb,
     updated_at timestamptz not null default now()
   );
   create index if not exists articles_pub_date_idx on articles (pub_date desc);
   create index if not exists articles_click_count_idx on articles (click_count desc);
   alter table articles enable row level security;
   create policy "Public read access" on articles for select using (true);

   create or replace function increment_click_count(article_id text)
   returns void
   language sql
   security definer
   set search_path = public
   as $$
     update articles set click_count = click_count + 1 where id = article_id;
   $$;
   ```
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → service_role secret — **not** the anon/publishable key, since the backend needs to bypass RLS to write) in `.env`.


## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes* | Google Gemini API key, used by `/api/chat`, `/api/summarize`, and `/api/ask` (both the `moss` and `naive` retrieval modes — `naive` embeds articles/queries with Gemini directly). Get one at [Google AI Studio](https://aistudio.google.com/apikey). *Not required if `GEMINI_API_KEYS` is set. |
| `GEMINI_API_KEYS` | No | Comma-separated pool of Gemini API keys, as an alternative to a single `GEMINI_API_KEY` — ideally one key per separate Google Cloud project, since keys under the *same* project share its quota. When a key hits a 429, `withKeyRotation()` (`server/quota.js`) automatically retries on the next key in the pool that isn't currently backed off, so one key's daily cap doesn't take the app down. Falls back to `GEMINI_API_KEY` if unset. |
| `SUPABASE_URL` | No | Supabase project API URL. Enables persistence and shared summary caching — see above. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase **service role** (secret) key — server-side only, never exposed to the frontend. |
| `MOSS_PROJECT_ID` | No | Moss project id. Enables indexing articles into a Moss semantic search index and the `moss` mode of `/api/ask`, additive to Supabase persistence — see `server/moss.js`. |
| `MOSS_PROJECT_KEY` | No | Moss project key — server-side only, never exposed to the frontend. |
| `LIVEKIT_URL` | No | LiveKit project WebSocket URL. Enables `/api/livekit-token` and the Ask bar's voice mode. Must match the value `ima-voice-agent` runs with. |
| `LIVEKIT_API_KEY` | No | LiveKit API key — server-side only. Must match `ima-voice-agent`'s. |
| `LIVEKIT_API_SECRET` | No | LiveKit API secret — server-side only. Must match `ima-voice-agent`'s. |
| `PORT` | No | Port for the Express server. Defaults to `3001`. Render sets this automatically in production — don't override it there. |
| `NODE_ENV` | No | Standard Node environment flag. |
| `VITE_API_BASE_URL` | No | Frontend override for the backend origin (see `src/lib/api.js`). Defaults to `localhost:3001` in dev, the deployed Render URL in production. Nothing else on the frontend needs a build-time variable — the LiveKit room URL and token are both fetched from `/api/livekit-token` at connect time. |

`ima-voice-agent` (a separate Python process, deployed independently — see [Deployment](#deployment)) needs its own env: the same `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` and `MOSS_PROJECT_ID`/`MOSS_PROJECT_KEY` as above (plus `MOSS_INDEX_NAME=ima-articles`), a `DEEPGRAM_API_KEY` (STT + TTS), and either `GOOGLE_API_KEY` (preferred - runs the LLM step on Gemini) or `OPENAI_API_KEY` (fallback to gpt-4o if unset) — see `ima-voice-agent/.env.example`.

**Gemini free-tier note:** the free tier caps out at roughly 20 requests/day per model, shared across the chat assistant *and* the summarize feature. If either replies with "Rate limit reached," that's Google's quota, not a bug. With Supabase configured this is much harder to hit day-to-day: every summary is generated once and cached forever (shared across all visitors, survives restarts), and a background job keeps the top 5 stories pre-summarized rather than waiting for someone to click. Without Supabase, wait for the daily reset, enable billing on the Google Cloud project behind your key, or set `GEMINI_API_KEYS` to a pool of keys from separate projects so a 429 on one routes to the next automatically.


## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server (frontend) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run start` | Start the Express backend |
| `npm run lint` | Run oxlint |
| `npm run test` | Run the server-side test suite (`node --test server/*.test.js`) |


## Deployment

The stack is three independently-deployed pieces: the Vercel frontend, the Render backend, and (optionally, for voice) the `ima-voice-agent` worker.

### Frontend (Vercel)

The frontend expects a deployed backend at `https://ima-9ay9.onrender.com` in production (see `src/lib/api.js`). If you deploy your own backend elsewhere, set `VITE_API_BASE_URL` to override it. No other environment variable is needed — see the note under [Environment variables](#environment-variables) about voice mode not needing a build-time LiveKit variable.

### Backend (Render)

The backend is a plain Express app — any Node host (Render, Railway, Fly.io, etc.) works; just set the variables in [Environment variables](#environment-variables) above in that host's environment settings so the deployed instance persists to the same Supabase/Moss/LiveKit projects as local dev (or its own, if you want separate data).

**Moss and Render's free tier don't mix well for a live demo.** Moss loads its index into the backend process's memory on startup (`ensureMossIndex()` in `server/moss.js`) and keeps it fresh via polling — but Render's free tier sleeps the process after periods of inactivity, and a cold start means that load happens all over again before the first `moss`-mode `/api/ask` can answer. `updateFeed()` already triggers `ensureMossIndex()` on every server start via `indexArticles()`, so nothing extra needs to run on startup — the fix is operational, not code: before a demo or recording, either ping the deployed URL a few minutes ahead of time to force it warm, or use a paid (always-on) Render instance for the duration.

### Voice worker (`ima-voice-agent`)

Deploy this as its own process, separate from the Render backend — pick whichever is faster to stand up:

- **LiveKit Cloud** (recommended): `lk agent create` from inside `ima-voice-agent/` builds and deploys it directly to your LiveKit Cloud project. No Dockerfile to write by hand (the CLI generates one), and LiveKit Cloud injects `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` for its own project automatically — you only need to push the remaining secrets (`MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`, `MOSS_INDEX_NAME`, `DEEPGRAM_API_KEY`, `GOOGLE_API_KEY`). It also sidesteps Render's free-tier sleep entirely, since LiveKit Cloud manages agent worker uptime itself.
- **A second Render worker service**: works too, but you're back to the same free-tier sleep/cold-start tradeoff as the main backend, plus a Dockerfile you maintain yourself.

Either way, its `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` must match the Render backend's exactly — both sides mint/consume tokens for the same LiveKit project — and its Moss credentials must point at the same project as the backend's, since it queries the `ima-articles` index the backend builds rather than building its own.


## Known limitations

- Image scraping is best-effort: sites that block scraping or omit Open Graph tags fall back to a stylized placeholder card.
- Click counts (and therefore the trending badge) update in the served feed once per ingestion cycle (~5 min), not in real time - `/api/track-click` writes straight to Supabase, but `currentFeed` only re-syncs from there on the next cycle.
- Articles summarized before the category feature shipped won't retroactively get a category - it only backfills as the feed rotates and they're replaced by newly-summarized stories.
- After a Gemini 429 on a given key, that key backs off for 15 minutes (doubling on repeated hits, up to 4 hours) - see `server/quota.js`. With a single key configured this means every Gemini-backed route (chat, summarize, auto-embed, `/api/ask`) is effectively down until it recovers; with `GEMINI_API_KEYS` set to a pool, calls transparently route to the next available key instead. Backoff state is in-memory only, so it resets on a server restart. The free tier's 20-requests/day cap is still easy to exhaust during active development even with a pool (chat, summarize, embed, and both `/api/ask` modes all draw from the same per-model daily quota on *each* key) - if every configured key is exhausted, that's the daily cap on all of them, not a bug, and none resets until Google's next day boundary unless billing is enabled on that key's project.
- Naive mode's embeddings backfill gradually, not all at once: `autoEmbedArticles()` embeds at most 5 already-summarized articles per 5-minute ingestion cycle (mirroring the auto-summarize restraint, for the same quota reason above). A large backlog - e.g. articles summarized before the `embedding` column existed - can take hours to fully embed after a fresh start; naive-mode answers over that window are grounded in whatever subset has embeddings so far, not the full article history moss mode already has access to.
- Voice mode (`ima-voice-agent`) is implemented but, as of this writing, not yet deployed anywhere and not yet exercised in a live end-to-end voice call - it's been verified by syntax/build checks and by testing Moss retrieval and the LiveKit token/room-connect plumbing independently, not as a full round trip with real STT/TTS providers. Treat it as needing its own smoke test (see Deployment) before relying on it for a live demo.
