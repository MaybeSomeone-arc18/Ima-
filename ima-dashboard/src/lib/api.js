export function getApiBaseUrl() {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  // A localhost override only makes sense in local dev. If a stale value
  // like http://localhost:3001 leaks into a production build (e.g. left set
  // in the Vercel project env), the deployed site calls the visitor's own
  // machine and the feed fails with "Failed to fetch" - so ignore it in prod.
  if (envUrl && !(import.meta.env.PROD && /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/.test(envUrl))) {
    return envUrl;
  }
  return import.meta.env.DEV
    ? 'http://localhost:3001'
    : 'https://ima-9ay9.onrender.com';
}
