import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function NewsGrid({ feed }) {
  if (!feed || feed.length === 0) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <p className="text-white/20 font-mono tracking-widest text-sm animate-pulse">
          INITIALIZING_NEURAL_LINK...
        </p>
      </div>
    );
  }

  return (
    <div className="masonry-grid px-6 max-w-7xl mx-auto pb-24">
      <AnimatePresence>
        {feed.map((item, index) => {
          // Deterministic height based on index to prevent layout thrashing on re-render
          const pseudoRandom = (index * 7 + 13) % 10;
          const rowSpan = 15 + pseudoRandom;
          
          return (
            <motion.div
              layout
              initial={{ opacity: 0, y: 40, filter: 'blur(15px)', scale: 0.98 }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)', scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
              transition={{ 
                duration: 1.2, 
                ease: [0.16, 1, 0.3, 1], // Deep ease-out for surreal floating entrance
                delay: index * 0.08 
              }}
              key={item.id}
              style={{ gridRowEnd: `span ${rowSpan}` }}
              whileHover={{ 
                scale: 1.015,
                backgroundColor: 'rgba(255,255,255,0.02)',
                borderColor: 'rgba(230,0,51,0.2)',
                boxShadow: '0 0 40px -10px rgba(230,0,51,0.15)'
              }}
              className="group relative flex flex-col p-6 rounded-3xl bg-white/[0.01] border border-white/5 backdrop-blur-3xl overflow-hidden shadow-2xl transition-all duration-700 ease-out"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none group-hover:opacity-50 transition-opacity duration-1000" />
              
              <div className="flex justify-between items-start mb-6">
                <span className="text-[10px] tracking-widest text-white/30 uppercase">
                  {item.source}
                </span>
                
                <div className="flex items-center space-x-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${item.importanceScore > 80 ? 'bg-crimson-500 shadow-[0_0_8px_#E60033]' : 'bg-white/20'}`} />
                  <span className="text-[10px] font-mono text-white/30">
                    {item.importanceScore || '—'}
                  </span>
                </div>
              </div>

              <h3 className="text-white/90 text-xl md:text-2xl font-medium tracking-tight leading-snug mb-4">
                <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-white transition-colors duration-300">
                  {item.title}
                </a>
              </h3>
              
              {item.tldr && (
                <p className="text-sm text-white/50 leading-relaxed font-light mt-auto">
                  {item.tldr}
                </p>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
