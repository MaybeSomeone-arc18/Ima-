import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Bookmark, Command, Sparkles, ArrowUp, BarChart3 } from 'lucide-react';
import { NewsGrid, trackClick } from './NewsGrid';
import { CustomCursor } from './CustomCursor';
import { CommandPalette } from './CommandPalette';
import { StatsPanel } from './StatsPanel';
import ChatBot from './ChatBot';
import { useLiveFeed } from './hooks/useLiveFeed';
import { useBookmarks } from './hooks/useBookmarks';

function matchesQuery(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (item.title && item.title.toLowerCase().includes(q)) ||
    (item.text && item.text.toLowerCase().includes(q))
  );
}

function App() {
  const { feed, loading, error } = useLiveFeed();
  const { bookmarks, isBookmarked, toggleBookmark } = useBookmarks();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Tracks which stories have been seen so a "N new" pill can appear when
  // the 30s feed poll brings in something fresh, without needing to force
  // a scroll or re-render the whole grid - the feed already updates live.
  const seenIdsRef = useRef(null);
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    if (feed.length === 0) return;
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(feed.map((item) => item.id));
      return;
    }
    const unseenCount = feed.filter((item) => !seenIdsRef.current.has(item.id)).length;
    if (unseenCount > 0) setNewCount(unseenCount);
  }, [feed]);

  const dismissNewStories = () => {
    seenIdsRef.current = new Set(feed.map((item) => item.id));
    setNewCount(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Global Cmd/Ctrl+K to open the command palette, Escape to close it, plus
  // HN-style single-key navigation (j/k/Enter/s) for anyone who'd rather not
  // touch the mouse. Single-key shortcuts bail out while any text input has
  // focus (search box, chatbot, palette) so they don't hijack typing.
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
        return;
      }
      if (e.key === 'Escape') {
        setIsPaletteOpen(false);
        setIsStatsOpen(false);
        return;
      }

      const tag = e.target.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
      if (isTyping) return;

      if (e.key === '/') {
        e.preventDefault();
        setIsPaletteOpen(true);
      } else if (e.key === 'j') {
        setFocusedIndex((prev) => Math.min(prev + 1, navigableItemsRef.current.length - 1));
      } else if (e.key === 'k') {
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        const item = navigableItemsRef.current[focusedIndexRef.current];
        if (item) {
          trackClick(item.id);
          window.open(item.url, '_blank', 'noopener');
        }
      } else if (e.key === 's') {
        const item = navigableItemsRef.current[focusedIndexRef.current];
        if (item) onToggleBookmarkRef.current(item);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const sources = useMemo(() => {
    const unique = new Set(feed.map((item) => item.source).filter(Boolean));
    return ['All', ...Array.from(unique).sort()];
  }, [feed]);

  // Only articles that have gone through the AI summary pipeline carry a
  // category (deliberately: classifying all 150 articles up front would
  // burn through the free-tier quota in one ingestion cycle), so this list
  // - and the chip row it drives - grows organically as more get summarized.
  const categories = useMemo(() => {
    const unique = new Set(feed.map((item) => item.category).filter(Boolean));
    return Array.from(unique).sort();
  }, [feed]);

  const savedList = useMemo(
    () => Object.values(bookmarks).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)),
    [bookmarks]
  );

  const visibleFeed = useMemo(() => {
    const base = showSavedOnly ? savedList : feed;
    return base.filter(
      (item) =>
        (selectedSource === 'All' || item.source === selectedSource) &&
        (selectedCategory === 'All' || item.category === selectedCategory) &&
        matchesQuery(item, searchQuery)
    );
  }, [showSavedOnly, savedList, feed, selectedSource, selectedCategory, searchQuery]);

  const paletteResults = useMemo(
    () => feed.filter((item) => matchesQuery(item, searchQuery)),
    [feed, searchQuery]
  );

  // Mirrors NewsGrid's own clusterPrimaryId filtering so j/k indices line up
  // with what's actually rendered as its own card (clustered secondary
  // stories only show up inside another card's "+N more sources" expander).
  const navigableItems = useMemo(
    () => visibleFeed.filter((item) => !item.clusterPrimaryId),
    [visibleFeed]
  );

  // Kept in refs rather than read directly in the keydown handler, since
  // that listener is registered once (empty deps) to avoid re-binding on
  // every keystroke - reading state directly there would close over stale
  // values from the first render.
  const navigableItemsRef = useRef(navigableItems);
  const focusedIndexRef = useRef(focusedIndex);
  const onToggleBookmarkRef = useRef(toggleBookmark);
  navigableItemsRef.current = navigableItems;
  focusedIndexRef.current = focusedIndex;
  onToggleBookmarkRef.current = toggleBookmark;

  // A filter change can leave focusedIndex pointing at a completely
  // different story than the one the user was just looking at - clearer to
  // drop focus than to silently jump.
  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery, selectedSource, selectedCategory, showSavedOnly]);

  const focusedItem = focusedIndex >= 0 ? navigableItems[focusedIndex] : null;

  const emptyMessage = loading
    ? 'INITIALIZING_NEURAL_LINK...'
    : showSavedOnly
    ? 'NO SAVED STORIES — TAP THE BOOKMARK ICON ON A CARD'
    : 'NO STORIES MATCH YOUR FILTERS';

  return (
    <>
      <CustomCursor />

      <div className="surreal-bg">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>

      <div className="min-h-screen text-white selection:bg-[#E60033] selection:text-white relative z-10">
        {/* Sticky Header */}
        <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#050505]/60 border-b border-white/5">
          <div className="py-6 px-6 max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between">
            <div>
              <h1 className="text-4xl md:text-5xl font-light tracking-tighter leading-none">
                <span className="text-crimson-500 font-bold mr-3">今</span>IMA
              </h1>
              <p className="text-white/40 tracking-[0.2em] uppercase text-xs mt-2 ml-1">
                Live Neural Feed
              </p>
            </div>

            <div className="flex items-center gap-5 mt-4 md:mt-0">
              {newCount > 0 && (
                <button
                  type="button"
                  onClick={dismissNewStories}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E60033]/15 border border-[#E60033]/30 text-[#E60033] text-[10px] font-mono uppercase tracking-wide animate-pulse hover:animate-none transition-colors"
                >
                  <ArrowUp size={10} />
                  {newCount} new
                </button>
              )}
              {!loading && (
                <span className="font-mono text-[10px] tracking-widest text-white/30 uppercase">
                  {visibleFeed.length} {visibleFeed.length === 1 ? 'story' : 'stories'}
                </span>
              )}
              <button
                type="button"
                onClick={() => setIsStatsOpen(true)}
                aria-label="View feed stats"
                className="text-white/40 hover:text-white transition-colors"
              >
                <BarChart3 size={15} />
              </button>

              <div className="flex items-center space-x-2 opacity-70">
                <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-white/60 animate-pulse' : 'bg-emerald-400'} shadow-[0_0_10px_currentColor]`} />
                <span className="font-mono text-[10px] tracking-widest uppercase">
                  {loading ? 'Synchronizing' : 'Connected'}
                </span>
              </div>
            </div>
          </div>

          {/* Search + filters row */}
          <div className="px-6 pb-4 max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPaletteOpen(true)}
              className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/40 hover:text-white hover:border-white/20 transition-colors text-left"
            >
              <Search size={14} />
              <span className="text-sm flex-1 truncate">{searchQuery || 'Search headlines...'}</span>
              <span className="hidden sm:flex items-center gap-0.5 text-[10px] font-mono text-white/30 border border-white/10 rounded px-1.5 py-0.5">
                <Command size={9} />K
              </span>
            </button>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              {sources.map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => setSelectedSource(source)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[10px] tracking-wide uppercase font-medium border transition-colors ${
                    selectedSource === source
                      ? 'bg-[#E60033]/20 border-[#E60033]/40 text-[#E60033]'
                      : 'border-white/10 text-white/40 hover:text-white hover:border-white/30'
                  }`}
                >
                  {source}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setShowSavedOnly((prev) => !prev)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] tracking-wide uppercase font-medium border transition-colors ${
                  showSavedOnly
                    ? 'bg-[#E60033]/20 border-[#E60033]/40 text-[#E60033]'
                    : 'border-white/10 text-white/40 hover:text-white hover:border-white/30'
                }`}
              >
                <Bookmark size={11} fill={showSavedOnly ? 'currentColor' : 'none'} />
                Saved{savedList.length > 0 ? ` (${savedList.length})` : ''}
              </button>
            </div>
          </div>

          {categories.length > 0 && (
            <div className="px-6 pb-4 max-w-7xl mx-auto flex items-center gap-2 overflow-x-auto -mt-1">
              <span className="flex items-center gap-1 text-[9px] font-mono text-white/20 uppercase shrink-0">
                <Sparkles size={9} />
                Category
              </span>
              {['All', ...categories].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`shrink-0 px-3 py-1 rounded-full text-[10px] tracking-wide uppercase font-medium border transition-colors ${
                    selectedCategory === cat
                      ? 'bg-[#E60033]/20 border-[#E60033]/40 text-[#E60033]'
                      : 'border-white/10 text-white/40 hover:text-white hover:border-white/30'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
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

          <NewsGrid
            feed={visibleFeed}
            isBookmarked={isBookmarked}
            onToggleBookmark={toggleBookmark}
            emptyMessage={emptyMessage}
            focusedId={focusedItem?.id}
          />
        </main>
      </div>

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        results={paletteResults}
        showSavedOnly={showSavedOnly}
        onToggleSaved={() => setShowSavedOnly((prev) => !prev)}
      />

      <StatsPanel isOpen={isStatsOpen} onClose={() => setIsStatsOpen(false)} />

      <ChatBot />
    </>
  );
}

export default App;
