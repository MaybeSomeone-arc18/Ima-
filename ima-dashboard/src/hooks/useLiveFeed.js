import { useState, useEffect, useRef } from 'react';
import { getApiBaseUrl } from '../lib/api';

// Only surface an error banner after repeated consecutive failures, so a
// single transient blip (a Render restart, a dropped request) doesn't flash
// an alarming SYS_ERROR the moment one poll fails - the next 30s poll will
// likely succeed on its own.
const FAILURE_THRESHOLD = 2;

export function useLiveFeed() {
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const failureCount = useRef(0);

  useEffect(() => {
    async function fetchFeed() {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || `${getApiBaseUrl()}/api/feed`;
        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error('Failed to fetch feed');
        }
        const data = await response.json();
        setFeed(data);
        setError(null);
        failureCount.current = 0;
      } catch (err) {
        failureCount.current += 1;
        if (failureCount.current >= FAILURE_THRESHOLD) {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }

    // Initial fetch
    fetchFeed();

    // Poll every 30 seconds
    const interval = setInterval(fetchFeed, 30000);

    return () => clearInterval(interval);
  }, []);

  return { feed, loading, error };
}
