import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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
  
  // Return a complex, highly blurred radial mesh gradient
  return `
    radial-gradient(at 0% 0%, hsla(${hue1}, 80%, 60%, 0.15) 0px, transparent 60%),
    radial-gradient(at 100% 0%, hsla(${hue2}, 80%, 60%, 0.15) 0px, transparent 60%),
    radial-gradient(at 0% 100%, hsla(${hue3}, 80%, 60%, 0.15) 0px, transparent 60%),
    radial-gradient(at 100% 100%, hsla(${hue4}, 80%, 60%, 0.15) 0px, transparent 60%)
  `;
}

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
                y: -8,
                x: index % 2 === 0 ? 3 : -3, // Subtle organic sway
                scale: 1.015,
                backgroundColor: 'rgba(255,255,255,0.02)',
                borderColor: 'rgba(230,0,51,0.2)',
                boxShadow: '0 20px 40px -10px rgba(230,0,51,0.15)',
                transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] }
              }}
              className="group relative flex flex-col p-6 rounded-3xl bg-white/[0.01] border border-white/5 backdrop-blur-3xl overflow-hidden shadow-2xl transition-all duration-700 ease-out"
            >
              {/* Surrealistic Unique Mesh Gradient Background */}
              <div 
                className="absolute inset-0 pointer-events-none group-hover:opacity-80 transition-opacity duration-1000 opacity-40 mix-blend-screen blur-xl"
                style={{ backgroundImage: generateMeshGradient(item.id) }} 
              />
              {/* Additional dark fade to ensure text readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#050505]/90 via-[#050505]/40 to-transparent pointer-events-none" />
              
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
