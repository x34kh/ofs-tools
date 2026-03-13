/**
 * ofs-api.js – Lightweight Oracle Field Service REST API client.
 *
 * All requests use HTTP Basic Authentication (base64-encoded user:password).
 * The OFS instance URL is provided by the user (e.g.
 * https://mycompany.fs.ocs.oraclecloud.com).
 *
 * OFS Core REST API reference:
 *   https://docs.oracle.com/en/cloud/saas/field-service/faser/index.html
 */
const OFSAPI = (() => {

  /* ---------- helpers ---------- */

  function buildHeaders(creds) {
    const encoded = btoa(unescape(encodeURIComponent(`${creds.user}:${creds.password}`)));
    return {
      'Authorization': `Basic ${encoded}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
    };
  }

  function normalizeUrl(raw) {
    return raw.replace(/\/+$/, '');
  }

  /**
   * Generic fetch wrapper.
   * Throws an enriched Error on non-2xx responses or network failure.
   */
  async function apiFetch(creds, path, opts = {}) {
    if (!creds || !creds.url || !creds.user || !creds.password) {
      throw new Error('OFS credentials are not configured. Please set them on the Home page.');
    }

    const url = `${normalizeUrl(creds.url)}${path}`;

    let response;
    try {
      response = await fetch(url, {
        method:  opts.method || 'GET',
        headers: { ...buildHeaders(creds), ...(opts.headers || {}) },
        body:    opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (networkErr) {
      // fetch() rejects only on genuine network errors (DNS, CORS preflight fail, etc.)
      const err = new Error(
        `Network error when connecting to OFS. ` +
        `Verify the instance URL is correct and that CORS is enabled for this origin. ` +
        `(${networkErr.message})`
      );
      err.cors = true;
      throw err;
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        detail = body.detail || body.message || body.title || detail;
      } catch (_) { /* ignore JSON parse errors */ }
      const err = new Error(detail);
      err.status = response.status;
      throw err;
    }

    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) return response.json();
    return response.text();
  }

  /* ---------- public methods ---------- */

  /**
   * Quick connectivity test.
   * Attempts to list a single activity to verify the URL and credentials.
   */
  async function testConnection(creds) {
    // Use the activities collection endpoint with a minimal page size
    await apiFetch(creds, '/rest/ofscCore/v1/activities?limit=1&offset=0');
    return { message: 'Connection successful – OFS API is reachable.' };
  }

  /**
   * Fetch a single activity by its numeric or string ID.
   * Returns the raw OFS activity object.
   */
  async function getActivity(creds, activityId) {
    if (!activityId) throw new Error('activityId is required');
    return apiFetch(creds, `/rest/ofscCore/v1/activities/${encodeURIComponent(activityId)}`);
  }

  /**
   * Fetch multiple activities sequentially.
   *
   * @param {object}   creds        – OFS credentials
   * @param {string[]} activityIds  – array of activity IDs
   * @param {Function} onProgress   – optional callback(current, total, message)
   * @param {number}   delayMs      – optional ms to wait between requests (default 150)
   * @returns {{ results: Array, errors: Array }}
   */
  async function getActivities(creds, activityIds, onProgress, delayMs = 150) {
    const results = [];
    const errors  = [];

    for (let i = 0; i < activityIds.length; i++) {
      const id = String(activityIds[i]).trim();
      if (!id) continue;

      if (onProgress) onProgress(i, activityIds.length, `Fetching activity ${id}…`);

      try {
        const data = await getActivity(creds, id);
        results.push({ id, data, error: null });
      } catch (e) {
        results.push({ id, data: null, error: e.message });
        errors.push({ id, error: e.message });
      }

      // Polite rate limiting
      if (delayMs > 0 && i < activityIds.length - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    if (onProgress) onProgress(activityIds.length, activityIds.length, 'All activities fetched.');
    return { results, errors };
  }

  return { testConnection, getActivity, getActivities };
})();
