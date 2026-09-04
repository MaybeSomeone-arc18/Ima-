# 今 IMA — Live Neural Feed

A dark, glassmorphic news dashboard that aggregates Hacker News, TechCrunch, Stratechery, the GitHub Changelog, The Verge, Ars Technica, and WIRED into one live feed, with a Gemini-powered chat assistant and per-article AI summaries.


## Features

- **Live aggregated feed** — pulls and normalizes 7 RSS/Atom feeds every 5 minutes, deduplicated by content hash
- **Real cover images** — most source feeds don't embed images, so the backend scrapes each article's `og:image` as a fallback and caches the result
- **AI chat assistant** — ask questions about current headlines, answered by Google's Gemini API with the live feed as context
- **AI summaries** — a per-card "summarize" button that gets a short Gemini-generated summary in a flyout, cached server-side by article id
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


## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini API key, used by `/api/chat` and `/api/summarize`. Get one at [Google AI Studio](https://aistudio.google.com/apikey). |
| `PORT` | No | Port for the Express server. Defaults to `3001`. |
| `NODE_ENV` | No | Standard Node environment flag. |
| `VITE_API_BASE_URL` | No | Frontend override for the backend origin (see `src/lib/api.js`). Defaults to `localhost:3001` in dev, the deployed Render URL in production. |

**Gemini free-tier note:** the free tier caps out at roughly 20 requests/day per model, shared across the chat assistant *and* the summarize feature. If either replies with "Rate limit reached," that's Google's quota, not a bug — summaries are cached server-side per article so repeat clicks don't re-spend it, but wait for the daily reset or enable billing on the Google Cloud project behind your key if you need more headroom.


## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server (frontend) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run start` | Start the Express backend |
| `npm run lint` | Run oxlint |


## Deployment

The frontend expects a deployed backend at `https://ima-9ay9.onrender.com` in production (see `src/lib/api.js`). If you deploy your own backend elsewhere, set `VITE_API_BASE_URL` to override it. The backend is a plain Express app — any Node host (Render, Railway, Fly.io, etc.) works; just set `GEMINI_API_KEY` in that host's environment settings.


## Known limitations

- `server/enricher.js` (Gemini-based categorization/scoring) and `kaisen-bridge/ima-skill.js` (an external integration helper) exist in the codebase but aren't called from the running app.
- Image scraping is best-effort: sites that block scraping or omit Open Graph tags fall back to a stylized placeholder card.
