import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, ExternalLink, Volume2, Square, Sparkles, X, Bookmark, Flame, Layers } from 'lucide-react';
import { getApiBaseUrl } from './lib/api';

const TRENDING_THRESHOLD = 3;

export function trackClick(id) {
  if (!id) return;
  try {
    const url = `${getApiBaseUrl()}/api/track-click`;
    const payload = JSON.stringify({ id });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
    }
  } catch {
    // best-effort only - a failed click ping shouldn't affect navigation
  }
}

function generateMeshGradient(id) {
  // Simple deterministic hash for consistent colors per article
  let hash = 0;
  for (let i = 0; i < (id || '').length; i++) {
    hash = (id.charCodeAt(i) + ((hash << 5) - hash)) | 0;
  }

  // Generate 4 related hues based on the hash
  const hue1 = Math.abs(hash % 360);
  const hue2 = (hue1 + 60) % 360;
  const hue3 = (hue1 + 120) % 360;
  const hue4 = (hue1 + 180) % 360;

  return { hue1, hue2, hue3, hue4 };
}

function meshGradientCss({ hue1, hue2, hue3, hue4 }) {
  return `
    radial-gradient(at 0% 0%, hsla(${hue1}, 80%, 60%, 0.15) 0px, transparent 60%),
    radial-gradient(at 100% 0%, hsla(${hue2}, 80%, 60%, 0.15) 0px, transparent 60%),
    radial-gradient(at 0% 100%, hsla(${hue3}, 80%, 60%, 0.15) 0px, transparent 60%),
    radial-gradient(at 100% 100%, hsla(${hue4}, 80%, 60%, 0.15) 0px, transparent 60%)
  `;
}

const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

function IconButton({ active, onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex items-center justify-center w-6 h-6 rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#E60033]/60 ${
        active
          ? 'bg-[#E60033]/20 border-[#E60033]/40 text-[#E60033]'
          : 'border-white/10 text-white/40 hover:text-white hover:border-white/30'
      }`}
    >
      {children}
    </button>
  );
}

function SummaryFlyout({ state, isSpeaking, onSpeak, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="mt-3 overflow-hidden rounded-2xl border border-[#E60033]/30 bg-[#0a0a0a]/95 backdrop-blur-2xl"
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={13} className="text-[#E60033]" />
            <span className="text-[10px] tracking-[0.15em] text-white/50 uppercase font-semibold">
              AI Summary
            </span>
          </div>
          <div className="flex items-center gap-2">
            {speechSupported && state.text && (
              <IconButton active={isSpeaking} onClick={onSpeak} label={isSpeaking ? 'Stop reading summary' : 'Read summary aloud'}>
                {isSpeaking ? <Square size={11} fill="currentColor" /> : <Volume2 size={13} />}
              </IconButton>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close summary"
              className="flex items-center justify-center w-6 h-6 rounded-full text-white/40 hover:text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#E60033]/60 rounded-full"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {state.loading && (
          <p className="text-xs text-white/40 font-mono tracking-wide animate-pulse">Generating summary...</p>
        )}
        {state.error && (
          <p className="text-xs text-red-400">{state.error}</p>
        )}
        {state.text && (
          <p className="text-sm text-white/85 leading-relaxed">{state.text}</p>
        )}
      </div>
    </motion.div>
  );
}

function NewsCard({ item, index, isSpeaking, onToggleSpeak, isSummaryOpen, summaryState, isSummarySpeaking, onToggleSummary, onSpeakSummary, isBookmarked, onToggleBookmark, isFocused, cardRef }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [showRelated, setShowRelated] = useState(false);
  const hues = generateMeshGradient(item.id);
  const showImage = item.imageUrl && !imageFailed;
  const isTrending = (item.clickCount || 0) >= TRENDING_THRESHOLD;

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, filter: 'blur(15px)', scale: 0.98 }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)', scale: 1 }}
      transition={{
        duration: 0.8,
        ease: [0.16, 1, 0.3, 1], // Deep ease-out for surreal floating entrance
        delay: Math.min(index, 8) * 0.06
      }}
      className="mb-6 break-inside-avoid"
    >
      <motion.div
        ref={cardRef}
        whileHover={{
          y: -8,
          scale: 1.015,
          backgroundColor: 'rgba(255,255,255,0.03)',
          borderColor: 'rgba(230,0,51,0.25)',
          boxShadow: '0 20px 45px -10px rgba(230,0,51,0.18)',
          transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] }
        }}
        className={`group relative flex flex-col p-6 rounded-3xl bg-white/[0.02] border backdrop-blur-2xl overflow-hidden shadow-xl transition-colors duration-500 ${
          isFocused ? 'ring-2 ring-[#E60033] ring-offset-2 ring-offset-[#050505]' : ''
        } ${isSpeaking ? 'border-[#E60033]/40' : 'border-white/10'}`}
      >
        {/* Blog Image Layer: blurred color wash behind the content */}
        {showImage && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-25 mix-blend-luminosity group-hover:opacity-40 transition-opacity duration-700 pointer-events-none"
            style={{ backgroundImage: `url(${item.imageUrl})` }}
          />
        )}

        {/* Surrealistic unique mesh gradient background */}
        <div
          className="absolute inset-0 pointer-events-none group-hover:opacity-80 transition-opacity duration-1000 opacity-40 mix-blend-screen blur-xl"
          style={{ backgroundImage: meshGradientCss(hues) }}
        />
        {/* Dark fade to guarantee text readability regardless of image */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505]/95 via-[#050505]/70 to-[#050505]/20 pointer-events-none" />

        <div className="flex justify-between items-center mb-5 relative z-10">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] tracking-[0.15em] text-white/50 uppercase font-semibold">
              {item.source}
            </span>
            {isTrending && (
              <span className="flex items-center gap-1 text-[9px] font-mono text-orange-400 uppercase tracking-wide">
                <Flame size={10} fill="currentColor" />
                Trending
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <IconButton active={isBookmarked} onClick={() => onToggleBookmark(item)} label={isBookmarked ? 'Remove bookmark' : 'Save for later'}>
              <Bookmark size={12} fill={isBookmarked ? 'currentColor' : 'none'} />
            </IconButton>

            <IconButton active={isSummaryOpen} onClick={() => onToggleSummary(item)} label={isSummaryOpen ? 'Close AI summary' : 'Get an AI summary'}>
              <Sparkles size={12} />
            </IconButton>

            {speechSupported && (
              <IconButton active={isSpeaking} onClick={() => onToggleSpeak(item)} label={isSpeaking ? 'Stop reading aloud' : 'Read this post aloud'}>
                {isSpeaking ? <Square size={11} fill="currentColor" /> : <Volume2 size={13} />}
              </IconButton>
            )}

            {item.importanceScore ? (
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${item.importanceScore > 85 ? 'bg-[#E60033] shadow-[0_0_8px_#E60033]' : 'bg-white/30'}`} />
                <span className="text-xs font-mono text-white/50">{item.importanceScore}</span>
              </div>
            ) : (
              <ExternalLink size={12} className="text-white/20 group-hover:text-white/40 transition-colors" />
            )}
          </div>
        </div>

        <h3 className="text-white text-xl md:text-[1.35rem] font-bold tracking-tight leading-snug mb-2 relative z-10">
          <a href={item.url} target="_blank" rel="noreferrer" onClick={() => trackClick(item.id)} className="hover:text-[#E60033] transition-colors duration-300">
            {item.title}
          </a>
        </h3>

        {item.relatedSources?.length > 0 && (
          <div className="mb-4 relative z-10">
            <button
              type="button"
              onClick={() => setShowRelated((s) => !s)}
              className="flex items-center gap-1.5 text-[10px] font-mono text-white/40 hover:text-white transition-colors"
            >
              <Layers size={11} />
              {showRelated ? 'Hide other sources' : `+${item.relatedSources.length} more source${item.relatedSources.length > 1 ? 's' : ''} covering this`}
            </button>

            {showRelated && (
              <div className="mt-2 space-y-1.5 pl-1 border-l border-white/10">
                {item.relatedSources.map((rel) => (
                  <a
                    key={rel.id}
                    href={rel.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => trackClick(rel.id)}
                    className="block pl-3 text-xs text-white/60 hover:text-[#E60033] transition-colors truncate"
                  >
                    <span className="text-white/40">{rel.source}:</span> {rel.title}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="relative z-10 mb-4 w-full h-44 overflow-hidden rounded-2xl border border-white/10 group-hover:border-white/20 transition-colors">
          {showImage ? (
            <img
              src={item.imageUrl}
              alt={item.title || 'News cover'}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center bg-white/[0.03]"
              style={{ backgroundImage: meshGradientCss(hues) }}
            >
              <Radio size={22} className="text-white/20" strokeWidth={1.5} />
            </div>
          )}
        </div>

        <p className="text-sm text-white/75 leading-relaxed font-light mt-auto relative z-10">
          {item.text && item.text.length > 150 ? item.text.substring(0, 150) + '...' : item.text}
        </p>

        {item.category && (
          <div className="mt-6 pt-4 border-t border-white/10 relative z-10">
            <span className="text-[9px] font-mono tracking-widest text-[#E60033] uppercase">
              {item.category}
            </span>
          </div>
        )}
      </motion.div>

      {/* Rendered as a sibling (not a child of the card) so it isn't clipped
          by the card's own overflow-hidden, and simply pushes the next
          masonry item down instead of needing absolute positioning. */}
      <AnimatePresence>
        {isSummaryOpen && (
          <SummaryFlyout
            state={summaryState}
            isSpeaking={isSummarySpeaking}
            onSpeak={() => onSpeakSummary(item, summaryState.text)}
            onClose={() => onToggleSummary(item)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const EMPTY_SUMMARY_STATE = { loading: false, error: null, text: null };

export function NewsGrid({ feed, isBookmarked, onToggleBookmark, emptyMessage = 'INITIALIZING_NEURAL_LINK...', focusedId }) {
  const [speakingKey, setSpeakingKey] = useState(null);
  const [openSummaryId, setOpenSummaryId] = useState(null);
  const [summaries, setSummaries] = useState({});
  const cardRefs = useRef({});

  // Keyboard nav (see App.jsx's j/k handler) drives focus by id rather than
  // DOM order, since this grid's own clusterPrimaryId filtering can differ
  // from whatever list the caller is iterating - scroll to whichever card
  // actually matches instead of assuming an index lines up.
  useEffect(() => {
    if (focusedId && cardRefs.current[focusedId]) {
      cardRefs.current[focusedId].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusedId]);

  // Stop any speech in progress if the component unmounts (e.g. hot reload, navigation)
  useEffect(() => {
    return () => {
      if (speechSupported) window.speechSynthesis.cancel();
    };
  }, []);

  const speak = (key, text) => {
    if (!speechSupported || !text) return;

    window.speechSynthesis.cancel();

    if (speakingKey === key) {
      setSpeakingKey(null);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeakingKey(null);
    utterance.onerror = () => setSpeakingKey(null);

    setSpeakingKey(key);
    window.speechSynthesis.speak(utterance);
  };

  const handleToggleSpeak = (item) => {
    speak(item.id, [item.title, item.text].filter(Boolean).join('. '));
  };

  const handleSpeakSummary = (item, summaryText) => {
    speak(`${item.id}:summary`, summaryText);
  };

  const handleToggleSummary = async (item) => {
    if (openSummaryId === item.id) {
      setOpenSummaryId(null);
      return;
    }

    setOpenSummaryId(item.id);
    if (summaries[item.id]?.text) return; // already fetched, just reopen

    if (item.summary) {
      // Already auto-summarized server-side (top-of-feed background job) -
      // no need to hit the API at all.
      setSummaries(prev => ({ ...prev, [item.id]: { loading: false, error: null, text: item.summary } }));
      return;
    }

    setSummaries(prev => ({ ...prev, [item.id]: { loading: true, error: null, text: null } }));

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate summary.');

      setSummaries(prev => ({ ...prev, [item.id]: { loading: false, error: null, text: data.summary } }));
    } catch (err) {
      setSummaries(prev => ({ ...prev, [item.id]: { loading: false, error: err.message, text: null } }));
    }
  };

  // Articles clustered under another story (see server/clustering.js) are
  // surfaced through that story's "+N more sources" expander instead of
  // getting their own card, so a multi-source event doesn't repeat itself
  // 3-4 times across the grid.
  const visibleFeed = feed.filter((item) => !item.clusterPrimaryId);

  if (!visibleFeed || visibleFeed.length === 0) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <p className="text-white/20 font-mono tracking-widest text-sm animate-pulse">
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="masonry-grid px-6 max-w-7xl mx-auto pb-24">
      {visibleFeed.map((item, index) => (
        <NewsCard
          key={item.id}
          item={item}
          index={index}
          isSpeaking={speakingKey === item.id}
          onToggleSpeak={handleToggleSpeak}
          isSummaryOpen={openSummaryId === item.id}
          summaryState={summaries[item.id] || EMPTY_SUMMARY_STATE}
          isSummarySpeaking={speakingKey === `${item.id}:summary`}
          onToggleSummary={handleToggleSummary}
          onSpeakSummary={handleSpeakSummary}
          isBookmarked={isBookmarked(item.id)}
          onToggleBookmark={onToggleBookmark}
          isFocused={focusedId === item.id}
          cardRef={(el) => { if (el) cardRefs.current[item.id] = el; }}
        />
      ))}
    </div>
  );
}
