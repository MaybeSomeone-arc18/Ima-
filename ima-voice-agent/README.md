# ima-voice-agent

A LiveKit voice agent that lets people ask Ima's tech news feed questions out
loud instead of typing them into the Ask bar. Built on Moss's official
LiveKit integration ([docs.moss.dev/docs/integrations/livekit](https://docs.moss.dev/docs/integrations/livekit)).

## What it is

- On join, it loads the **`ima-articles`** Moss index - the same cloud index
  [`ima-dashboard/server/moss.js`](../ima-dashboard/server/moss.js) already
  builds and keeps in sync with the RSS feed every 5 minutes. This agent
  never builds or rebuilds that index; there's no `build_index.py` here.
- The LLM answers by calling a `search_knowledge_base` function tool, which
  runs a Moss query (`top_k=5, alpha=0.8`) against that index. The model can
  call it more than once per turn to refine or broaden a search - that's the
  multi-hop retrieval.
- A second tool, `search_conversation`, queries a per-call Moss session (a
  local, ~1-5ms index of this call's own turns) so the agent can recall
  something said earlier without a cloud round trip. The session is pushed
  to Moss's cloud when the call ends.
- Every `search_knowledge_base` call is timed with `time.perf_counter()`.
  The accumulated hops for the in-flight user turn (`{hop, query, mossMs,
  hitCount}`) are pushed to the frontend over a LiveKit data message
  (topic `latency_hud`) in the same shape
  [`LatencyHUD.jsx`](../ima-dashboard/src/LatencyHUD.jsx) already renders for
  the typed Ask bar - so the same HUD component drives both paths.

## Requirements

- Python >= 3.10
- A LiveKit server or LiveKit Cloud project
- A Moss project with the `ima-articles` index already built (i.e.
  `ima-dashboard`'s Node backend has ingested and indexed at least once)
- Deepgram API key (STT)
- OpenAI API key (`OPENAI_API_KEY`, required - always used for TTS, and as the
  LLM fallback if `GOOGLE_API_KEY` isn't set)
- Gemini API key (`GOOGLE_API_KEY`, optional - preferred for the LLM if set)

## Setup

```bash
cd ima-voice-agent
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env   # then fill in the values
```

## Running locally

Start a local LiveKit server in dev mode (matches the `.env.example`
defaults - `devkey` / `secret` / `ws://localhost:7880`):

```bash
livekit-server --dev
```

In a second terminal, download the STT/VAD/turn-detector models once, then
run the agent:

```bash
python agent.py download-files
python agent.py console
```

`console` mode talks to the agent directly in the terminal without a
frontend. To join from the Ima dashboard's mic button instead, run:

```bash
python agent.py dev
```

and make sure `ima-dashboard`'s backend has matching `LIVEKIT_URL` /
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` set, since it mints the room token
the browser uses to connect.

## Notes

- `search_conversation` and the per-call session are the short-term-memory
  half of Moss's integration - useful, but skippable under time pressure;
  the core "Best Use of Moss" case is `search_knowledge_base` against the
  long-term `ima-articles` index.
- The LLM choice is decided at startup by `build_llm()` in
  [`agent.py`](agent.py): Gemini if `GOOGLE_API_KEY` is set, otherwise
  `gpt-4o`.
- TTS is OpenAI's `gpt-4o-mini-tts` (voice `ash`), with `instructions` tuned
  in `build_tts()` for a crisp, confident, slightly futuristic tech-news-anchor
  tone. ElevenLabs was tried first, but its Free plan blocks all library
  voices via the API (`402 payment_required`) regardless of which voice is
  picked - only a paid ElevenLabs plan lifts that, so OpenAI TTS is the
  default until/unless that's worth paying for.
