import React, { useEffect, useState } from 'react';
import { useLiveFeed } from './hooks/useLiveFeed';
import { NewsGrid } from './NewsGrid';

function App() {
  const { feed, loading, error } = useLiveFeed();
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    const moveCursor = (e) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
    };
    
    // Add event listeners to detect hovering over interactive elements
    const handleMouseOver = (e) => {
      if (e.target.tagName.toLowerCase() === 'a' || e.target.closest('a')) {
        setHovering(true);
      }
    };
    
    const handleMouseOut = () => setHovering(false);

    window.addEventListener('mousemove', moveCursor);
    document.body.addEventListener('mouseover', handleMouseOver);
    document.body.addEventListener('mouseout', handleMouseOut);

    return () => {
      window.removeEventListener('mousemove', moveCursor);
      document.body.removeEventListener('mouseover', handleMouseOver);
      document.body.removeEventListener('mouseout', handleMouseOut);
    };
  }, []);

  return (
    <>
      <div 
        className={`custom-cursor hidden md:block ${hovering ? 'hovering' : ''}`} 
        style={{ left: cursorPos.x, top: cursorPos.y }}
      />
      
      <div className="surreal-bg">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>

      <div className="min-h-screen text-white selection:bg-[#E60033] selection:text-white relative z-10">
        {/* Minimalist Header */}
        <header className="pt-12 pb-6 px-6 max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between">
          <div>
            <h1 className="text-4xl md:text-6xl font-light tracking-tighter">
              <span className="text-crimson-500 font-bold mr-4">今</span>IMA
            </h1>
            <p className="text-white/40 tracking-[0.2em] uppercase text-xs mt-2 ml-1">
              Live Neural Feed
            </p>
          </div>
          
          <div className="flex items-center space-x-3 mt-6 md:mt-0 opacity-60">
            <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-white animate-pulse' : 'bg-white'} shadow-[0_0_10px_currentColor]`} />
            <span className="font-mono text-[10px] tracking-widest uppercase">
              {loading ? 'Synchronizing' : 'Connected'}
            </span>
          </div>
        </header>

        {/* Main Content */}
        <main className="py-12">
          {error && (
            <div className="max-w-7xl mx-auto px-6 mb-8">
              <div className="p-4 rounded border border-red-500/30 bg-red-500/10 text-red-400 font-mono text-sm backdrop-blur-md">
                SYS_ERROR: {error}
              </div>
            </div>
          )}
          
          <NewsGrid feed={feed} />
        </main>
      </div>
    </>
  );
}

export default App;
