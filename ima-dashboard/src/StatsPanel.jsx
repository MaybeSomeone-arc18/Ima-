import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BarChart3, Flame, Layers } from 'lucide-react';
import { getApiBaseUrl } from './lib/api';

function Bar({ label, count, max }) {
  const pct = max > 0 ? Math.max((count / max) * 100, 4) : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-28 shrink-0 truncate text-white/60">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#E60033]/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 shrink-0 text-right font-mono text-white/40">{count}</span>
    </div>
  );
}

export function StatsPanel({ isOpen, onClose }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    fetch(`${getApiBaseUrl()}/api/stats`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        return res.json();
      })
      .then((data) => { if (!cancelled) setStats(data); })
      .catch((err) => { if (!cancelled) setError(err.message); });

    return () => { cancelled = true; };
  }, [isOpen]);

  const maxSource = stats ? Math.max(...stats.bySource.map((s) => s.count), 1) : 1;
  const maxCategory = stats ? Math.max(...stats.byCategory.map((c) => c.count), 1) : 1;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-start justify-center pt-[8vh] px-4 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-[#0a0a0a]/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 sticky top-0 bg-[#0a0a0a]/95 backdrop-blur-2xl">
              <div className="flex items-center gap-2">
                <BarChart3 size={16} className="text-[#E60033]" />
                <h2 className="text-sm font-medium tracking-wide uppercase text-white/80">Feed Stats</h2>
              </div>
              <button type="button" onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {error && <p className="text-xs text-red-400 font-mono">Failed to load stats: {error}</p>}

              {!stats && !error && (
                <p className="text-xs text-white/30 font-mono text-center py-8">Loading...</p>
              )}

              {stats && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-white/10 p-4 text-center">
                      <p className="text-2xl font-light">{stats.totalArticles}</p>
                      <p className="text-[10px] uppercase tracking-wide text-white/30 mt-1">Live articles</p>
                    </div>
                    <div className="rounded-xl border border-white/10 p-4 text-center">
                      <p className="text-2xl font-light">{stats.summarizedCount}</p>
                      <p className="text-[10px] uppercase tracking-wide text-white/30 mt-1">AI summarized</p>
                    </div>
                    <div className="rounded-xl border border-white/10 p-4 text-center">
                      <p className="text-2xl font-light">{stats.clusteredStories}</p>
                      <p className="text-[10px] uppercase tracking-wide text-white/30 mt-1">Clustered stories</p>
                    </div>
                  </div>

                  {stats.topClicked.length > 0 && (
                    <div>
                      <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/30 mb-3">
                        <Flame size={11} className="text-[#E60033]" /> Top clicked
                      </h3>
                      <div className="space-y-2">
                        {stats.topClicked.map((item, i) => (
                          <a
                            key={item.id}
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 text-xs group"
                          >
                            <span className="w-4 shrink-0 font-mono text-white/20">{i + 1}</span>
                            <span className="flex-1 truncate text-white/70 group-hover:text-white transition-colors">{item.title}</span>
                            <span className="shrink-0 font-mono text-[#E60033]">{item.clickCount}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {stats.byCategory.length > 0 && (
                    <div>
                      <h3 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">By category</h3>
                      <div className="space-y-2">
                        {stats.byCategory.map((c) => (
                          <Bar key={c.category} label={c.category} count={c.count} max={maxCategory} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/30 mb-3">
                      <Layers size={11} /> By source
                    </h3>
                    <div className="space-y-2">
                      {stats.bySource.map((s) => (
                        <Bar key={s.source} label={s.source} count={s.count} max={maxSource} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
