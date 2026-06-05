import axios from 'axios';

const RAILWAY_URL = 'https://progressreport-production.up.railway.app/api';
const LOCAL_URL = `http://${window.location.hostname}:5000/api`;

// Always use Railway — it has the webhook data and full backend
const baseURL = RAILWAY_URL;

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
// Retries trigger on connection-level failures (no response) and 502/503/504.
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const DEDUPED_POSTS = [/^\/report\/preview$/, /^\/report\/email$/];
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
      (method === 'post' && DEDUPED_POSTS.some((re) => re.test(config.url || '')));

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
    return Promise.reject(new Error(message));
  }
);

export default apiClient;