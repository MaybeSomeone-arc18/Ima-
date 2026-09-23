import json
import logging
import os
import time
from dataclasses import dataclass, field

from dotenv import load_dotenv

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    ChatContext,
    ChatMessage,
    JobContext,
    RunContext,
    WorkerOptions,
    cli,
    function_tool,
)
from livekit.plugins import deepgram, google, openai, silero
from livekit.plugins.turn_detector.english import EnglishModel

# Moss imports - same SDK, same "ima-articles" index the Node ingestion
# pipeline (ima-dashboard/server/moss.js) already builds and keeps fresh.
from moss import DocumentInfo, MossClient, QueryOptions

load_dotenv()

MOSS_PROJECT_ID = os.getenv("MOSS_PROJECT_ID")
MOSS_PROJECT_KEY = os.getenv("MOSS_PROJECT_KEY")
KNOWLEDGE_INDEX = os.getenv("MOSS_INDEX_NAME", "ima-articles")
MOSS_TOP_K = 5
MOSS_ALPHA = 0.8

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ima-voice-agent")

INSTRUCTIONS = """
    You are Ima's voice assistant for tech news. Call search_knowledge_base
    for facts. Speak naturally, no markdown, don't read citation numbers
    aloud.
"""


@dataclass
class TurnLatency:
    """Moss retrieval trace for the user turn currently in flight - reset in
    on_user_turn_completed so each turn's HUD reflects only its own hops."""

    started_at: float = field(default_factory=time.perf_counter)
    hops: list = field(default_factory=list)


class ImaVoiceAgent(Agent):
    def __init__(self, moss_client: MossClient, moss_session, room: rtc.Room):
        super().__init__(instructions=INSTRUCTIONS)
        self.moss = moss_client
        self.moss_session = moss_session  # short-term, per-call SessionIndex
        self._room = room
        self._turn = TurnLatency()
        self._turn_count = 0

    @function_tool
    async def search_knowledge_base(self, context: RunContext, query: str) -> str:
        """Search Ima's tech news knowledge base for facts relevant to the
        user's question. Call it again with a narrower query if the first
        results don't answer the question - each call is a new retrieval hop.

        Args:
            query: A focused natural-language search query.
        """
        start = time.perf_counter()
        results = await self.moss.query(
            KNOWLEDGE_INDEX, query, QueryOptions(top_k=MOSS_TOP_K, alpha=MOSS_ALPHA)
        )
        moss_ms = (time.perf_counter() - start) * 1000
        docs = results.docs or []

        self._turn.hops.append(
            {
                "hop": len(self._turn.hops) + 1,
                "query": query,
                "mossMs": round(moss_ms, 2),
                "hitCount": len(docs),
            }
        )
        await self._publish_latency_hud()

        if not docs:
            return "No relevant articles were found for that query."
        return "\n\n".join(f"[{i + 1}] {d.text}" for i, d in enumerate(docs))

    @function_tool
    async def search_conversation(self, context: RunContext, query: str) -> str:
        """Recall something said earlier in this same call - use it when the
        user refers back to a previous topic ("what did I ask about before",
        "go back to that first story").

        Args:
            query: What to look for in the earlier conversation.
        """
        results = await self.moss_session.query(query, QueryOptions(top_k=3))
        docs = results.docs or []
        if not docs:
            return "Nothing relevant was said earlier in this call."
        return "\n".join(f"- {d.text}" for d in docs)

    async def on_user_turn_completed(self, turn_ctx: ChatContext, new_message: ChatMessage) -> None:
        # A fresh user turn starts a fresh latency trace, so the HUD shows
        # this turn's hops rather than accumulating across the whole call.
        self._turn = TurnLatency()

        # Record the turn into the per-call session (short-term memory) so
        # search_conversation can recall it later - local write, no cloud
        # round trip. Doesn't inject anything into the prompt itself.
        self._turn_count += 1
        try:
            await self.moss_session.add_docs(
                [DocumentInfo(id=f"turn-{self._turn_count}", text=new_message.text_content)]
            )
        except Exception:
            logger.exception("Failed to index turn %d into the session", self._turn_count)

        await super().on_user_turn_completed(turn_ctx, new_message)

    async def _publish_latency_hud(self) -> None:
        """Pushes the in-flight turn's Moss retrieval trace to the frontend
        over a LiveKit data message, in the same shape LatencyHUD.jsx already
        renders for the text Ask bar (see ima-dashboard/src/LatencyHUD.jsx) -
        so the same component drives both the typed and spoken paths."""
        total_moss_ms = sum(h["mossMs"] for h in self._turn.hops)
        payload = {
            "type": "latency_hud",
            "label": "Voice",
            "retrievals": [
                {
                    "hop": h["hop"],
                    "query": h["query"],
                    "retrievalMs": h["mossMs"],
                    "hitCount": h["hitCount"],
                }
                for h in self._turn.hops
            ],
            "totalRetrievalMs": round(total_moss_ms, 2),
            "totalLlmMs": 0,
            "totalMs": round((time.perf_counter() - self._turn.started_at) * 1000, 2),
        }
        try:
            await self._room.local_participant.publish_data(
                json.dumps(payload).encode("utf-8"), reliable=True, topic="latency_hud"
            )
        except Exception:
            logger.exception("Failed to publish latency HUD data over the data channel")


def build_tts():
    # gpt-4o-mini-tts (unlike tts-1/tts-1-hd) takes free-text `instructions`
    # to steer delivery, so the crisp/confident tech-news-anchor tone is set
    # here instead of needing a specific hand-picked voice.
    return openai.TTS(
        model="gpt-4o-mini-tts",
        voice="ash",
        instructions=(
            "Speak with a crisp, confident, slightly futuristic tone, like a "
            "sharp tech-news anchor. Natural pacing, not overly enthusiastic."
        ),
    )


def build_llm():
    # Prefer the Gemini plugin so the call runs against the granted 100K
    # Gemini token budget; fall back to gpt-4o (Moss's own official example
    # default) if no Google key is configured.
    if os.getenv("GOOGLE_API_KEY"):
        logger.info("Using Gemini LLM (livekit.plugins.google)")
        return google.LLM(model="gemini-3-flash-preview")
    logger.info("GOOGLE_API_KEY not set - falling back to OpenAI gpt-4o")
    return openai.LLM(model="gpt-4o")


async def entrypoint(ctx: JobContext):
    await ctx.connect()

    moss_client = MossClient(project_id=MOSS_PROJECT_ID, project_key=MOSS_PROJECT_KEY)

    # Long-term context: the same "ima-articles" index the Node ingestion
    # pipeline builds and keeps fresh - loaded here for in-process queries,
    # never rebuilt.
    await moss_client.load_index(KNOWLEDGE_INDEX)
    logger.info("Loaded knowledge index: %s", KNOWLEDGE_INDEX)

    # Short-term context: a session keyed to this call, for search_conversation.
    call_id = f"call-{ctx.room.name}"
    moss_session = await moss_client.session(index_name=call_id)
    logger.info("Opened session '%s' (%d docs loaded)", call_id, moss_session.doc_count)

    async def persist_session():
        try:
            result = await moss_session.push_index()
            logger.info("Pushed session '%s': %d docs", call_id, result.doc_count)
        except Exception:
            logger.exception("Failed to push session '%s'", call_id)

    ctx.add_shutdown_callback(persist_session)

    session = AgentSession(
        stt=deepgram.STT(model="nova-3"),
        llm=build_llm(),
        tts=build_tts(),
        turn_detection=EnglishModel(),
        vad=silero.VAD.load(),
    )

    await session.start(
        room=ctx.room,
        agent=ImaVoiceAgent(moss_client, moss_session, ctx.room),
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
