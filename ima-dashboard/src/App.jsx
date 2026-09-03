import React from 'react';
import { NewsGrid } from './NewsGrid';
import { CustomCursor } from './CustomCursor';
import ChatBot from './ChatBot';
import { useLiveFeed } from './hooks/useLiveFeed';

function App() {
  const { feed, loading, error } = useLiveFeed();

  return (
    <>
      <CustomCursor />
      
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

      <ChatBot />
    </>
  );
}

export default App;
