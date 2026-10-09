// Render free instances can need 50+ seconds to wake. Keep one request alive
// through that window instead of aborting and restarting it every 20 seconds.
export const FEED_REQUEST_TIMEOUT_MS = 90000;
export function feedFailurePolicy({ failures, hasFeed, warming, elapsedMs }) {
  return {
    status: hasFeed ? 'Cached' : 'Reconnecting',
    showError: failures >= 2 && (!warming || elapsedMs >= FEED_REQUEST_TIMEOUT_MS),
    nextDelay: warming ? 2000 : Math.min(2000 * 2 ** (failures - 1), 30000),
  };
}
