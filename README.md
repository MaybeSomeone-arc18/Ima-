# 今 IMA — Live Neural Feed

A dark, glassmorphic news dashboard that aggregates Hacker News, TechCrunch, Stratechery, and the GitHub Changelog into one live feed, with a Gemini-powered chat assistant that can answer questions about what's currently in the feed.

## Features

- **Live aggregated feed** — pulls and normalizes multiple RSS/Atom feeds every 5 minutes, deduplicated by content hash
- **Real cover images** — most source feeds don't embed images, so the backend scrapes each article's `og:image` as a fallback and caches the result
- **AI chat assistant** — ask questions about current headlines, answered by Google's Gemini API with the live feed as context
- **Responsive, animated UI** — React 19 + Tailwind v4 + Framer Motion, built mobile-first

## Project structure

```
ima-dashboard/
├── src/                  # React frontend (Vite)
│   ├── App.jsx           # Layout, header, feed polling
│   ├── NewsGrid.jsx       # Masonry card grid
│   ├── ChatBot.jsx        # Floating AI chat widget
│   └── hooks/useLiveFeed.js
├── server/                # Express backend
│   ├── index.js           # API routes (/api/feed, /api/chat) + ingestion scheduler
│   ├── ingestion.js        # RSS fetching, dedup, og:image scraping
│   ├── enricher.js         # Gemini-based categorization (not currently wired in)
│   └── cache.js            # Disk cache used by enricher.js
└── kaisen-bridge/          # Standalone helper script for an external tool integration
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
| `GEMINI_API_KEY` | Yes | Google Gemini API key, used by `/api/chat`. Get one at [Google AI Studio](https://aistudio.google.com/apikey). |
| `PORT` | No | Port for the Express server. Defaults to `3001`. |
| `NODE_ENV` | No | Standard Node environment flag. |

**Gemini free-tier note:** the free tier caps out at roughly 20 requests/day per model. If the chat widget replies with "Rate limit reached," that's Google's quota, not a bug — either wait for the daily reset or enable billing on the Google Cloud project behind your key.


## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server (frontend) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run start` | Start the Express backend |
| `npm run lint` | Run oxlint |


## Deployment

The frontend expects a deployed backend at `https://ima-9ay9.onrender.com` in production (see the `baseUrl` logic in `ChatBot.jsx` and `useLiveFeed.js`). If you deploy your own backend elsewhere, update those URLs or wire them through `VITE_API_URL`. The backend is a plain Express app — any Node host (Render, Railway, Fly.io, etc.) works; just set `GEMINI_API_KEY` in that host's environment settings.


## Known limitations

- `server/enricher.js` (Gemini-based categorization/scoring) and `kaisen-bridge/ima-skill.js` (an external integration helper) exist in the codebase but aren't called from the running app.
- Image scraping is best-effort: sites that block scraping or omit Open Graph tags fall back to a stylized placeholder card.
