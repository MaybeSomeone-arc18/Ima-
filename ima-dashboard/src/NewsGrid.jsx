import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function NewsGrid({ feed }) {
  if (!feed || feed.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <p className="text-white/50 font-mono tracking-widest animate-pulse">
          LOADING_FEED...
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto">
      <AnimatePresence>
        {feed.map((item) => (
          <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            key={item.id}
            className={`
              relative flex flex-col p-6 rounded-2xl 
              bg-white/[0.03] border border-white/10 backdrop-blur-md
              hover:bg-white/[0.05] hover:border-white/20 transition-colors
              overflow-hidden
            `}
          >
            {/* Crimson accent line for high importance */}
            {item.importanceScore > 80 && (
              <div className="absolute top-0 left-0 w-full h-1 bg-[#E60033]" />
            )}

            <div className="flex justify-between items-start mb-4">
              <span className="text-xs font-mono text-white/50 bg-black/30 px-2 py-1 rounded">
                {item.source}
              </span>
              <span className={`text-xs font-mono px-2 py-1 rounded ${item.importanceScore > 80 ? 'text-[#E60033] bg-[#E60033]/10' : 'text-white/50 bg-black/30'}`}>
                SCORE:{item.importanceScore || 'N/A'}
              </span>
            </div>

            <h2 className="text-xl font-bold mb-3 leading-tight tracking-tight text-white/90">
              <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
                {item.title}
              </a>
            </h2>

            {item.tldr && (
              <p className="text-sm text-white/70 mb-4 line-clamp-3">
                {item.tldr}
              </p>
            )}

            <div className="mt-auto pt-4 border-t border-white/5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-white/40">
                  {new Date(item.pubDate).toLocaleTimeString()}
                </span>
                {item.category && (
                  <span className="text-xs font-mono text-white/40 uppercase tracking-wider">
                    //{item.category}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
