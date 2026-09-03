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
              {/* Blog Image Layer */}
              {item.imageUrl && (
                <div 
                  className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-luminosity group-hover:opacity-50 transition-opacity duration-700 pointer-events-none"
                  style={{ backgroundImage: `url(${item.imageUrl})` }}
                />
              )}

              {/* Surrealistic Unique Mesh Gradient Background */}
              <div 
                className="absolute inset-0 pointer-events-none group-hover:opacity-80 transition-opacity duration-1000 opacity-40 mix-blend-screen blur-xl"
                style={{ backgroundImage: generateMeshGradient(item.id) }} 
              />
              {/* Additional dark fade to ensure text readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#050505]/95 via-[#050505]/60 to-transparent pointer-events-none" />
              
              <div className="flex justify-between items-start mb-6 relative z-10">
                <span className="text-[10px] tracking-widest text-white/50 uppercase font-medium">
                  {item.source}
                </span>
                
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${item.importanceScore > 85 ? 'bg-[#E60033] shadow-[0_0_8px_#E60033]' : 'bg-white/30'}`} />
                  <span className="text-xs font-mono text-white/50">
                    {item.importanceScore || '...'}
                  </span>
                </div>
              </div>

              <h3 className="text-white text-xl md:text-2xl font-bold tracking-tight leading-snug mb-4 relative z-10">
                <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-[#E60033] transition-colors duration-300">
                  {item.title}
                </a>
              </h3>

              <div className="relative z-10 mb-4 w-full h-40 overflow-hidden rounded-2xl border border-white/10 group-hover:border-white/20 transition-colors">
                <img 
                  src={item.imageUrl || '/default-card-img.png'} 
                  alt={item.title || "News cover"} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                  onError={(e) => { 
                    if (!e.target.src.endsWith('/default-card-img.png')) {
                      e.target.src = '/default-card-img.png';
                    } else {
                      e.target.style.display = 'none';
                    }
                  }}
                />
              </div>

              <p className="text-sm text-white/80 leading-relaxed font-light mt-auto relative z-10">
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
          );
        })}
      </AnimatePresence>
    </div>
  );
}
