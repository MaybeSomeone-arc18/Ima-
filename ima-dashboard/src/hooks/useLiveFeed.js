import { useState, useEffect } from 'react';
import { FEED_REQUEST_TIMEOUT_MS, feedFailurePolicy } from '../lib/feedRecovery';
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
    let outageStartedAt = Date.now();

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
      const timeout = setTimeout(() => controller.abort(), FEED_REQUEST_TIMEOUT_MS);
      let nextDelay = 30000;
      try {
        const override = import.meta.env.VITE_API_URL;
        const apiUrl = override && !(import.meta.env.PROD && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/.test(override))
          ? override : `${getApiBaseUrl()}/api/feed`;
        const response = await fetch(apiUrl, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          const failure = new Error(response.status === 503
            ? 'Feed is warming up. Retrying automatically.'
            : 'Feed is reconnecting. Retrying automatically.');
          failure.warming = response.status === 503;
          throw failure;
        }
        const data = await response.json();
        // A backend that has just restarted can be reachable but not ready.
        if (!validFeed(data)) throw new Error('Feed returned invalid data. Retrying automatically.');
        if (disposed) return;
        liveReceived = true;
        hasFeed = true;
        failures = 0;
        outageStartedAt = null;
        setFeed(data);
        setLoading(false);
        setError(null);
        setStatus('Connected');
        void writeFeedCache(data);
      } catch (err) {
        if (disposed) return;
        failures += 1;
        outageStartedAt ??= Date.now();
        const policy = feedFailurePolicy({ failures, hasFeed, warming: err.warming, elapsedMs: Date.now() - outageStartedAt });
        // Keep good data during outages and never claim Connected on failure.
        setLoading(!hasFeed);
        setStatus(policy.status);
        if (policy.showError) setError(err.name === 'AbortError' ? 'Feed request timed out. Retrying automatically.' : err.message);
        nextDelay = policy.nextDelay;
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
