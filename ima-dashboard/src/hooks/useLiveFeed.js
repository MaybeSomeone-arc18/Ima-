import { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../lib/api';
import { readFeedCache, writeFeedCache, validFeed } from '../lib/feedCache';

export function useLiveFeed() {
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Synchronizing');

  useEffect(() => {
    let disposed = false;
    let timer;
    let controller;
    let hasFeed = false;
    let liveReceived = false;
    let failures = 0;

    // Read the last successful feed while the live request starts, not before it.
    readFeedCache().then(cached => {
      if (disposed || liveReceived || !cached.length) return;
      hasFeed = true;
      setFeed(cached);
      setLoading(false);
      setStatus('Synchronizing');
    });

    async function fetchFeed() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let nextDelay = 30000;
      try {
        const override = import.meta.env.VITE_API_URL;
        const apiUrl = override && !(import.meta.env.PROD && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/.test(override))
          ? override : `${getApiBaseUrl()}/api/feed`;
        const response = await fetch(apiUrl, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Feed is reconnecting. Retrying automatically.');
        const data = await response.json();
        // A backend that has just restarted can be reachable but not ready.
        if (!validFeed(data)) throw new Error('Feed is warming up. Retrying automatically.');
        if (disposed) return;
        liveReceived = true;
        hasFeed = true;
        failures = 0;
        setFeed(data);
        setLoading(false);
        setError(null);
        setStatus('Connected');
        void writeFeedCache(data);
      } catch (err) {
        if (disposed) return;
        failures += 1;
        // Keep good data during outages and never claim Connected on failure.
        setLoading(!hasFeed);
        setStatus(hasFeed ? 'Cached' : 'Reconnecting');
        if (failures >= 2) setError(err.name === 'AbortError' ? 'Feed request timed out. Retrying automatically.' : err.message);
        nextDelay = Math.min(2000 * 2 ** (failures - 1), 30000);
      } finally {
        clearTimeout(timeout);
        if (!disposed) timer = setTimeout(fetchFeed, nextDelay);
      }
    }

    fetchFeed();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  return { feed, loading, error, status };
}
