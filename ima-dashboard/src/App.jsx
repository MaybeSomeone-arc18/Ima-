import React from 'react';
import { useLiveFeed } from './hooks/useLiveFeed';
import { NewsGrid } from './NewsGrid';

function App() {
  const { feed, loading, error } = useLiveFeed();

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-white selection:bg-[#E60033] selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0A0A0C]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-mono tracking-widest font-bold">
            <span className="text-[#E60033] mr-3">今 IMA</span>
            <span className="text-white/40 font-light">// LIVE NEWS</span>
          </h1>
          
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${loading ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'} shadow-[0_0_8px_currentColor]`} />
            <span className="font-mono text-xs text-white/50 hidden md:inline-block">
              {loading ? 'SYNCING...' : 'LIVE'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-8">
        {error && (
          <div className="max-w-7xl mx-auto px-6 mb-8">
            <div className="p-4 rounded border border-red-500/30 bg-red-500/10 text-red-400 font-mono text-sm">
              ERROR: {error}
            </div>
          </div>
        )}
        
        <NewsGrid feed={feed} />
      </main>
    </div>
  );
}

export default App;
