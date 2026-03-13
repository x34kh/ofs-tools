/**
 * app.js – Shared utilities and credentials management for OFS Tools.
 *
 * Credentials are kept in sessionStorage for the current tab session.
 * If the user checks "Remember credentials", they are also stored in a
 * cookie (30-day expiry) so they survive browser restarts.
 */
const OFSApp = (() => {
  const COOKIE_NAME = 'ofs_creds';
  const COOKIE_DAYS = 30;

  /* ---------- cookie helpers ---------- */
  function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie =
      `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`;
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }

  /* ---------- persistence ---------- */

  /**
   * Returns stored credentials or null.
   * Priority: sessionStorage > cookie.
   */
  function getStoredCredentials() {
    let raw = sessionStorage.getItem('ofs_creds');
    if (!raw) raw = getCookie(COOKIE_NAME);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /**
   * Persist credentials.  Pass remember=true to also write the cookie.
   */
  function storeCredentials(creds, remember) {
    const json = JSON.stringify(creds);
    sessionStorage.setItem('ofs_creds', json);
    if (remember) {
      setCookie(COOKIE_NAME, json, COOKIE_DAYS);
    } else {
      deleteCookie(COOKIE_NAME);
    }
  }

  function clearStoredCredentials() {
    sessionStorage.removeItem('ofs_creds');
    deleteCookie(COOKIE_NAME);
  }

  /* ---------- form helpers (index page only) ---------- */

  function _val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  /** Populate the credentials form from storage. */
  function loadCredentials() {
    const creds = getStoredCredentials();
    if (!creds) return;

    const urlEl = document.getElementById('ofsUrl');
    const userEl = document.getElementById('ofsUser');
    const passEl = document.getElementById('ofsPassword');
    const rememberEl = document.getElementById('rememberCredentials');

    if (urlEl) urlEl.value = creds.url || '';
    if (userEl) userEl.value = creds.user || '';
    if (passEl) passEl.value = creds.password || '';

    // If a cookie was present (not just session), tick remember
    if (rememberEl) rememberEl.checked = !!getCookie(COOKIE_NAME);

    _updateBadge();
  }

  /** Read form and save credentials. */
  function saveCredentials() {
    const url = _val('ofsUrl');
    const user = _val('ofsUser');
    const passEl = document.getElementById('ofsPassword');
    const password = passEl ? passEl.value : '';
    const remember = document.getElementById('rememberCredentials')?.checked ?? false;

    if (!url || !user || !password) {
      showToast('Please fill in URL, Username and Password.', 'warning');
      return false;
    }

    storeCredentials({ url, user, password }, remember);
    _updateBadge();
    showToast('Credentials saved!', 'success');
    return true;
  }

  /** Wipe form and storage. */
  function clearCredentials() {
    clearStoredCredentials();
    ['ofsUrl', 'ofsUser', 'ofsPassword'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const rememberEl = document.getElementById('rememberCredentials');
    if (rememberEl) rememberEl.checked = false;

    _updateBadge();
    showToast('Credentials cleared.', 'info');
  }

  /* ---------- connection test ---------- */

  async function testConnection() {
    const urlEl = document.getElementById('ofsUrl');
    const userEl = document.getElementById('ofsUser');
    const passEl = document.getElementById('ofsPassword');

    const creds = {
      url:      urlEl  ? urlEl.value.trim()  : '',
      user:     userEl ? userEl.value.trim() : '',
      password: passEl ? passEl.value        : '',
    };

    if (!creds.url || !creds.user || !creds.password) {
      showToast('Fill in all credential fields first.', 'warning');
      return;
    }

    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
      statusEl.innerHTML =
        '<div class="text-muted small mt-2">' +
        '<span class="spinner-border spinner-border-sm me-2"></span>Testing connection…</div>';
    }

    try {
      const result = await OFSAPI.testConnection(creds);
      if (statusEl) {
        statusEl.innerHTML =
          `<div class="alert alert-success py-2 mt-2 mb-0">
            <i class="bi bi-check-circle-fill me-2"></i>${result.message}
          </div>`;
      }
    } catch (e) {
      if (statusEl) {
        const corsHint = e.cors
          ? '<br><small>This looks like a CORS error. The OFS instance must ' +
            'allow cross-origin requests from this page. See the README for details.</small>'
          : '';
        const statusHint = e.status
          ? `<br><small>HTTP status: ${escHtml(String(e.status))}</small>`
          : '';
        const endpointHint = e.url
          ? `<br><small>Endpoint: ${escHtml(e.url)}</small>`
          : '';
        const authHint = e.status === 401
          ? '<br><small>Authentication works in curl but fails in browser when an Origin header is present. ' +
            'This usually means OFS origin-level security/CORS policy is rejecting browser-based Basic auth for this origin. ' +
            'Try adding this exact site origin in OFS CORS settings or call OFS through a same-origin backend proxy.</small>'
          : '';
        statusEl.innerHTML =
          `<div class="alert alert-danger py-2 mt-2 mb-0">
            <i class="bi bi-x-circle-fill me-2"></i>${escHtml(e.message)}${statusHint}${endpointHint}${authHint}${corsHint}
          </div>`;
      }
    }
  }

  /* ---------- badge / alert helpers ---------- */

  function _updateBadge() {
    const badge = document.getElementById('credentialsBadge');
    const alert = document.getElementById('credentialsAlert');
    const creds = getStoredCredentials();
    const ok = !!(creds && creds.url && creds.user && creds.password);

    if (badge) {
      badge.className = 'badge me-3 ' + (ok ? 'cred-badge-ok' : 'cred-badge-fail');
      badge.innerHTML = ok
        ? '<i class="bi bi-key-fill me-1"></i>Credentials Set'
        : '<i class="bi bi-key me-1"></i>Not Configured';
    }
    if (alert) {
      alert.classList.toggle('d-none', ok);
    }
  }

  /* ---------- toast notifications ---------- */

  function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      container.style.zIndex = 9999;
      document.body.appendChild(container);
    }

    const iconMap = {
      success: 'check-circle-fill text-success',
      danger:  'x-circle-fill text-danger',
      warning: 'exclamation-triangle-fill text-warning',
      info:    'info-circle-fill text-primary',
    };

    const id = 'toast_' + Date.now();
    container.insertAdjacentHTML('beforeend', `
      <div id="${id}" class="toast align-items-center border-0 shadow-sm" role="alert">
        <div class="d-flex">
          <div class="toast-body">
            <i class="bi bi-${iconMap[type] || iconMap.info} me-2"></i>${escHtml(message)}
          </div>
          <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
      </div>`);

    const el = document.getElementById(id);
    const toast = new bootstrap.Toast(el, { delay: 3500 });
    toast.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }

  /* ---------- HTML escaping ---------- */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- page initialiser (non-index pages) ---------- */

  /**
   * Call on DOMContentLoaded on tool pages.
   * Restores the credentials badge / alert and returns stored creds (or null).
   */
  function initPage() {
    _updateBadge();
    return getStoredCredentials();
  }

  /* ---------- public API ---------- */
  return {
    loadCredentials,
    saveCredentials,
    clearCredentials,
    getStoredCredentials,
    testConnection,
    initPage,
    showToast,
    escHtml,
  };
})();
