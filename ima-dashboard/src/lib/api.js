export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV
    ? 'http://localhost:3001'
    : 'https://ima-9ay9.onrender.com');
}
