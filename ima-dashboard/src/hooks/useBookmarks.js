import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ima_bookmarks';

function readStoredBookmarks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Bookmarks store the full article object, not just its id - the live feed
// rotates every 5 minutes and old articles fall out of it entirely, so an
// id-only bookmark would silently disappear from the Saved view once the
// article aged out of the current ingestion window.
export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState(readStoredBookmarks);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
    } catch {
      // localStorage can throw (private browsing, quota) - saved state just
      // won't persist across reloads, which is an acceptable degradation.
    }
  }, [bookmarks]);

  const isBookmarked = (id) => Boolean(bookmarks[id]);

  const toggleBookmark = (item) => {
    setBookmarks((prev) => {
      const next = { ...prev };
      if (next[item.id]) {
        delete next[item.id];
      } else {
        next[item.id] = item;
      }
      return next;
    });
  };

  return { bookmarks, isBookmarked, toggleBookmark };
}
