import { useState, useEffect } from 'react';

export function useLiveFeed() {
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchFeed() {
      try {
        const baseUrl = import.meta.env.DEV ? 'http://localhost:3001' : 'https://ima-9ay9.onrender.com';
        const apiUrl = import.meta.env.VITE_API_URL || `${baseUrl}/api/feed`;
        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error('Failed to fetch feed');
        }
        const data = await response.json();
        setFeed(data);
        setError(null);
      } catch (err) {
        setError(err.message);
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
