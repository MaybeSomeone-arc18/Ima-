import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, ExternalLink } from 'lucide-react';

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

function NewsCard({ item, index }) {
  const [imageFailed, setImageFailed] = useState(false);
  const hues = generateMeshGradient(item.id);
  const showImage = item.imageUrl && !imageFailed;

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
        delay: Math.min(index, 8) * 0.06
      }}
      style={{ gridRowEnd: `span ${rowSpan}` }}
      whileHover={{
        y: -8,
        scale: 1.015,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderColor: 'rgba(230,0,51,0.25)',
        boxShadow: '0 20px 45px -10px rgba(230,0,51,0.18)',
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] }
      }}
      className="group relative flex flex-col p-6 rounded-3xl bg-white/[0.02] border border-white/10 backdrop-blur-2xl overflow-hidden shadow-xl transition-colors duration-500"
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
        <span className="text-[10px] tracking-[0.15em] text-white/50 uppercase font-semibold">
          {item.source}
        </span>

        {item.importanceScore ? (
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${item.importanceScore > 85 ? 'bg-[#E60033] shadow-[0_0_8px_#E60033]' : 'bg-white/30'}`} />
            <span className="text-xs font-mono text-white/50">{item.importanceScore}</span>
          </div>
        ) : (
          <ExternalLink size={12} className="text-white/20 group-hover:text-white/40 transition-colors" />
        )}
      </div>

      <h3 className="text-white text-xl md:text-[1.35rem] font-bold tracking-tight leading-snug mb-4 relative z-10">
        <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-[#E60033] transition-colors duration-300">
          {item.title}
        </a>
      </h3>

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
  );
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
        {feed.map((item, index) => (
          <NewsCard key={item.id} item={item} index={index} />
        ))}
      </AnimatePresence>
    </div>
  );
}
