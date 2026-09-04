import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Bookmark, LayoutGrid, CornerDownLeft } from 'lucide-react';

const MAX_RESULTS = 6;

export function CommandPalette({
  isOpen,
  onClose,
  query,
  onQueryChange,
  results,
  showSavedOnly,
  onToggleSaved
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-[#0a0a0a]/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
              <Search size={16} className="text-white/40 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Search headlines..."
                className="w-full bg-transparent text-white placeholder-white/30 text-sm focus:outline-none"
              />
              <kbd className="text-[10px] font-mono text-white/30 border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
            </div>

            <div className="p-2">
              <button
                type="button"
                onClick={() => { onToggleSaved(); onClose(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/80 hover:bg-white/5 transition-colors text-left"
              >
                <Bookmark size={14} className={showSavedOnly ? 'text-[#E60033]' : 'text-white/40'} fill={showSavedOnly ? 'currentColor' : 'none'} />
                {showSavedOnly ? 'Show all stories' : 'Show saved only'}
              </button>

              {query.trim() && (
                <div className="mt-1 pt-1 border-t border-white/5">
                  {results.length === 0 && (
                    <p className="px-3 py-4 text-xs text-white/30 font-mono text-center">No matches</p>
                  )}
                  {results.slice(0, MAX_RESULTS).map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/80 hover:bg-white/5 hover:text-white transition-colors group"
                    >
                      <LayoutGrid size={13} className="text-white/30 shrink-0" />
                      <span className="truncate flex-1">{item.title}</span>
                      <CornerDownLeft size={12} className="text-white/0 group-hover:text-white/30 shrink-0 transition-colors" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
