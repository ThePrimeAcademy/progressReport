import axios from 'axios';

const RAILWAY_URL = 'https://progressreport-production.up.railway.app/api';

// The live Railway backend by default - it has the webhook data. Set
// VITE_API_URL to point a local build at a local backend instead, e.g.
//   VITE_API_URL=http://localhost:5000/api npm run dev
const baseURL = import.meta.env.VITE_API_URL || RAILWAY_URL;

const apiClient = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 60000,
});

// ── Automatic retry ───────────────────────────────────────────
// Railway's edge drops idle connections and the backend can be briefly slow
// right after a redeploy (cold ClassMarker cache). Instead of surfacing a
// "network error" for the user to retry by hand, wait and retry:
//   - any GET (idempotent by definition)
//   - the job-based POSTs, which the server dedupes by content hash, so a
//     retried request reuses the in-flight job instead of duplicating work
//   - reorder, which is idempotent: replaying it just re-sets the same absolute
//     order, so a transient drop no longer surfaces as a "Network Error" that
//     silently loses the drag.
// Retries trigger on connection-level failures (no response) and 502/503/504.
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRYABLE_POSTS = [/^\/report$/, /^\/report\/preview$/, /^\/report\/email$/, /^\/exams\/reorder$/];
const MAX_RETRIES = 4;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config || {};
    const method = String(config.method || 'get').toLowerCase();
    const isNetworkError = !error.response;
    const isRetryableStatus = RETRYABLE_STATUS.has(error.response?.status);
    const isSafeMethod =
      method === 'get' ||
      (method === 'post' && RETRYABLE_POSTS.some((re) => re.test(config.url || '')));

    config.__retryCount = config.__retryCount || 0;
    if ((isNetworkError || isRetryableStatus) && isSafeMethod && config.__retryCount < MAX_RETRIES) {
      config.__retryCount += 1;
      await sleep(1200 * config.__retryCount); // 1.2s, 2.4s, 3.6s, 4.8s
      return apiClient(config);
    }

    const message =
      error.response?.data?.error ||
      error.message ||
      'An unexpected error occurred';
    const failure = new Error(message);
    // Callers sometimes need to tell "this endpoint doesn't exist (yet)"
    // apart from a real failure, e.g. right after a release, when the new
    // frontend is live a few minutes before Railway finishes the backend.
    failure.status = error.response?.status ?? null;
    return Promise.reject(failure);
  }
);

export default apiClient;