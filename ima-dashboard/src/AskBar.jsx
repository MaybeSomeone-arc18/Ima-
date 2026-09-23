import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, X, Send } from 'lucide-react';
import { getApiBaseUrl } from './lib/api';
import { LatencyHUD } from './LatencyHUD';

// Blue reuses the existing surreal-bg blob-2 tint (see index.css) rather
// than introducing a new color, so Naive gets its own identity without a
// new visual language.
const MODES = [
  { key: 'pgvector', label: 'Indexed', accent: '#E60033' },
  { key: 'naive', label: 'Naive', accent: '#3C3CFF' }
];

function AnswerPanel({ result, accent, label, isRefreshing }) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <LatencyHUD
          label={label}
          retrievals={result.retrievals}
          totalRetrievalMs={result.totalRetrievalMs}
          totalLlmMs={result.totalLlmMs}
          totalMs={result.totalMs}
          accent={accent}
        />
        {isRefreshing && (
          <div className="absolute inset-0 rounded-2xl bg-[#050505]/60 backdrop-blur-[1px] flex items-center justify-center">
            <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/50">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accent }} />
              Re-running {label}...
            </span>
          </div>
        )}
      </div>

      <p className="text-sm leading-relaxed text-white/85">{result.answer}</p>

      {result.citations?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.citations.map((c) => (
            <a
              key={c.n}
              href={c.url || undefined}
              target={c.url ? '_blank' : undefined}
              rel={c.url ? 'noreferrer' : undefined}
              title={c.title}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono border border-white/10 bg-white/5 text-white/60 transition-colors ${c.url ? 'hover:text-white hover:border-white/30' : 'cursor-default opacity-60'}`}
            >
              <span style={{ color: accent }}>[{c.n}]</span>
              <span className="max-w-[10rem] truncate">{c.source || c.title}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AskBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState('pgvector');
  const [resultsByMode, setResultsByMode] = useState({ pgvector: null, naive: null });
  const [loadingMode, setLoadingMode] = useState(null);
  const [error, setError] = useState(null);

  const hasAnyResult = Boolean(resultsByMode.pgvector || resultsByMode.naive);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || loadingMode) return;

    setError(null);
    setLoadingMode(mode);

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, mode })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Network response was not ok');

      setResultsByMode((prev) => ({ ...prev, [mode]: data }));
    } catch (err) {
      setError(err.message || 'Failed to reach the neural link.');
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        onClick={() => setIsOpen(true)}
        aria-label="Open Ask IMA"
        className={`fixed bottom-6 left-6 w-14 h-14 rounded-full bg-[#0a0a0a]/80 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white shadow-[0_0_30px_rgba(255,255,255,0.08)] hover:border-white/25 z-50 transition-all ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      >
        <Zap size={20} className="text-[#E60033]" />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.96 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-6 left-6 right-6 md:right-auto md:w-[46rem] max-w-[calc(100vw-3rem)] max-h-[85vh] flex flex-col bg-[#050505]/90 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-[0_0_60px_rgba(0,0,0,0.6)] z-50 overflow-hidden"
          >
            <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#E60033] to-transparent opacity-60" />

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
              <div className="flex items-center space-x-2.5">
                <Zap size={14} className="text-[#E60033]" />
                <span className="text-white font-medium tracking-wide text-sm uppercase">Ask IMA</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-white/50 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Mode toggle */}
            <div className="flex items-center gap-2 px-6 py-3 border-b border-white/10 bg-white/[0.02]">
              <span className="text-[9px] font-mono text-white/20 uppercase shrink-0">Mode</span>
              {MODES.map((m) => {
                const active = mode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMode(m.key)}
                    className="shrink-0 px-3 py-1.5 rounded-full text-[10px] tracking-wide uppercase font-medium border transition-colors"
                    style={
                      active
                        ? { color: m.accent, borderColor: `${m.accent}66`, backgroundColor: `${m.accent}22` }
                        : { borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }
                    }
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {error && (
                <p className="text-xs text-red-400 font-mono">{error}</p>
              )}

              {!hasAnyResult && !error && !loadingMode && (
                <p className="text-xs text-white/30 font-mono text-center py-10">
                  Ask a question about the live feed. Run it in both Indexed and Naive mode to compare retrieval speed side by side.
                </p>
              )}

              <div className={`grid gap-4 ${resultsByMode.pgvector && resultsByMode.naive ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                {MODES.map((m) => {
                  const result = resultsByMode[m.key];
                  const isLoadingThis = loadingMode === m.key;
                  if (!result && isLoadingThis) {
                    return (
                      <div key={m.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: m.accent }} />
                        <span className="text-[11px] font-mono uppercase tracking-widest text-white/40">
                          Running {m.label}...
                        </span>
                      </div>
                    );
                  }
                  if (!result) return null;
                  return (
                    <AnswerPanel
                      key={m.key}
                      result={result}
                      accent={m.accent}
                      label={m.label}
                      isRefreshing={isLoadingThis}
                    />
                  );
                })}
              </div>
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="p-4 border-t border-white/10 bg-white/[0.02]">
              <div className="relative flex items-center gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={`Ask in ${MODES.find((m) => m.key === mode)?.label} mode...`}
                  disabled={Boolean(loadingMode)}
                  className="w-full bg-white/5 border border-white/10 rounded-full py-3 pl-5 pr-14 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20 transition-colors disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!question.trim() || Boolean(loadingMode)}
                  className="absolute right-2 p-2 text-white/50 hover:text-white disabled:opacity-50 transition-colors"
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
      `}</style>
    </>
  );
}
