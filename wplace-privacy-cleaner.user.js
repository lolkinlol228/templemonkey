// ==UserScript==
// @name         Wplace Privacy Cleaner
// @namespace    local.wplace.privacy
// @version      1.3.0
// @description  Blocks or sanitizes Wplace profile endpoints in the page and cleans local browser-side traces.
// @match        https://wplace.live/*
// @match        https://backend.wplace.live/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const page = window;

  // "soft" lets /me reach Wplace so login can complete, then scrubs the profile
  // before page scripts read response.json()/response.text().
  // "passthrough" does not modify /me at all; it only keeps login/logout cleanup.
  // "block" keeps the older hard mode: /me is not sent and the page sees 401.
  // "fake" does not send /me and returns a minimal logged-in-looking profile.
  const ME_MODE = 'soft';

  // Keep this false for normal use. Blocking broad endpoints such as store/frames
  // and map/hotspots can make the app behave oddly. /me is still protected.
  const PROTECT_EXTRA_ENDPOINTS = false;

  // Auto-cleaning during OAuth redirects can break login flows. Use the visible
  // clean/logout buttons when you actually want to clean local browser state.
  const AUTO_CLEAN_ON_PAGEHIDE = false;
  const LOG_PREFIX = '[Wplace Privacy Cleaner]';
  const VERSION = '1.3.0';

  const protectedRoutes = [
    { method: 'GET', path: '/me', kind: 'me' },
    { method: 'GET', path: '/me/badges', kind: 'badges' },
    { method: 'GET', path: '/me/profile-pictures', kind: 'profilePictures' },
    { method: 'GET', path: '/notification/count', kind: 'notificationCount' },
    { method: 'GET', path: '/store/name', kind: 'storeName' },
    { method: 'GET', path: '/store/frames', kind: 'storeFrames' },
    { method: 'GET', path: '/map/hotspots', kind: 'hotspots' }
  ];

  function toUrl(value) {
    try {
      return new URL(String(value || ''), location.href);
    } catch (error) {
      return null;
    }
  }

  function requestUrl(input) {
    return typeof input === 'string' ? input : (input && input.url) || '';
  }

  function requestMethod(input, init) {
    return String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  }

  function classify(urlValue, method) {
    const url = toUrl(urlValue);
    if (!url || url.hostname !== 'backend.wplace.live') return null;

    const route = protectedRoutes.find(item => (
      item.method === method &&
      item.path === url.pathname &&
      (item.kind === 'me' || PROTECT_EXTRA_ENDPOINTS)
    ));

    return route ? route.kind : null;
  }

  function isLogoutRequest(urlValue, method) {
    const url = toUrl(urlValue);
    return Boolean(url && url.hostname === 'backend.wplace.live' && url.pathname === '/auth/logout' && method === 'POST');
  }

  function isCaptchaFlowUrl(urlValue) {
    const url = toUrl(urlValue);
    return Boolean(url && url.hostname === 'backend.wplace.live' && (
      url.pathname.startsWith('/anticheat/captcha/') ||
      url.pathname.startsWith('/anticheat/challenge/')
    ));
  }

  function fakePayload(kind) {
    if (kind === 'me') {
      if (ME_MODE === 'scrub' || ME_MODE === 'soft' || ME_MODE === 'fake') {
        return {
          id: 0,
          name: '',
          role: 'user',
          allianceId: null,
          allianceName: '',
          allianceRole: '',
          country: '',
          discord: '',
          discordId: '',
          droplets: 0,
          level: 0,
          pixelsPainted: 0,
          picture: '',
          equippedBadges: [null, null, null],
          equippedFlag: 0,
          equippedFrameId: 0,
          equippedFrameUrl: '',
          equippedNameCosmetic: null,
          favoriteLocations: [],
          maxFavoriteLocations: 0,
          showDiscord: false,
          showLastPixel: false,
          rulesRead: false,
          hotspotsOptOut: true,
          isCustomer: false,
          freeFlag: false,
          charges: { count: 0, max: 0, cooldownMs: 30000 },
          timeoutUntil: '1970-01-01T00:00:00Z'
        };
      }

      return { error: 'blocked-by-wplace-privacy-cleaner' };
    }

    if (kind === 'badges') return [];
    if (kind === 'profilePictures') return [];
    if (kind === 'notificationCount') return { count: 0 };
    if (kind === 'storeName') return { name: '' };
    if (kind === 'storeFrames') return [];
    if (kind === 'hotspots') return [];
    return {};
  }

  function fakeStatus(kind) {
    return kind === 'me' && ME_MODE === 'block' ? 401 : 200;
  }

  function fakeResponse(kind, urlValue) {
    const body = JSON.stringify(fakePayload(kind));
    const status = fakeStatus(kind);
    return new Response(body, {
      status,
      statusText: status === 401 ? 'Blocked by Wplace Privacy Cleaner' : 'OK',
      headers: {
        'Content-Type': 'application/json',
        'X-Wplace-Privacy-Cleaner': '1'
      }
    });
  }

  function scrubPayload(kind, payload) {
    if (kind !== 'me') return fakePayload(kind);
    if (ME_MODE !== 'soft') return fakePayload(kind);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;

    // Preserve functional game/account fields so login, charges, level, drawing,
    // and normal UI state keep working. Only hide obvious display/contact fields.
    // Wplace uses more of /me than it looks like; changing alliance/country/favorites
    // can stop the client before it sends /paint.
    return {
      ...payload,
      name: 'Private',
      discord: '',
      discordId: '',
      picture: '',
      equippedNameCosmetic: null,
      showDiscord: false,
      showLastPixel: false
    };
  }

  function responseKind(response) {
    try {
      const method = 'GET';
      return classify(response && response.url, method);
    } catch (error) {
      return null;
    }
  }

  function patchResponseReaders() {
    if (!page.Response || page.Response.prototype.__wplacePrivacyCleaner) return;

    const originalJson = page.Response.prototype.json;
    const originalText = page.Response.prototype.text;

    page.Response.prototype.json = function () {
      const kind = responseKind(this);
      if (kind) {
        if (kind === 'me' && ME_MODE === 'passthrough') return originalJson.apply(this, arguments);
        console.info(LOG_PREFIX, 'scrubbed response.json()', this.url);
        if (kind === 'me' && ME_MODE === 'soft') {
          return originalJson.apply(this, arguments).then(payload => scrubPayload(kind, payload));
        }
        return Promise.resolve(fakePayload(kind));
      }
      return originalJson.apply(this, arguments);
    };

    page.Response.prototype.text = function () {
      const kind = responseKind(this);
      if (kind) {
        if (kind === 'me' && ME_MODE === 'passthrough') return originalText.apply(this, arguments);
        console.info(LOG_PREFIX, 'scrubbed response.text()', this.url);
        if (kind === 'me' && ME_MODE === 'soft') {
          return originalText.apply(this, arguments).then(text => {
            try {
              return JSON.stringify(scrubPayload(kind, JSON.parse(text)));
            } catch (error) {
              return text;
            }
          });
        }
        return Promise.resolve(JSON.stringify(fakePayload(kind)));
      }
      return originalText.apply(this, arguments);
    };

    page.Response.prototype.__wplacePrivacyCleaner = true;
  }

  function patchFetch() {
    if (!page.fetch || page.fetch.__wplacePrivacyCleaner) return;

    const originalFetch = page.fetch;
    const wrappedFetch = function (input, init) {
      const url = requestUrl(input);
      const method = requestMethod(input, init);
      const kind = classify(url, method);

      if (isCaptchaFlowUrl(url)) return originalFetch.apply(this, arguments);

      if (isLogoutRequest(url, method)) {
        console.info(LOG_PREFIX, 'logout detected, cleaning after response');
        return originalFetch.apply(this, arguments).finally(() => {
          cleanLocalTraces();
        });
      }

      if (kind) {
        if (kind === 'me' && ME_MODE === 'passthrough') {
          console.info(LOG_PREFIX, 'passthrough fetch', method, url);
          return originalFetch.apply(this, arguments);
        }

        if (kind === 'me' && ME_MODE === 'soft') {
          console.info(LOG_PREFIX, 'soft-protect fetch', method, url);
          return originalFetch.apply(this, arguments);
        }

        console.info(LOG_PREFIX, 'blocked/faked fetch', method, url);
        return Promise.resolve(fakeResponse(kind, url));
      }

      return originalFetch.apply(this, arguments);
    };

    wrappedFetch.__wplacePrivacyCleaner = true;
    wrappedFetch.__wplacePrivacyOriginal = originalFetch;
    page.fetch = wrappedFetch;
  }

  function patchXhr() {
    const XHR = page.XMLHttpRequest;
    if (!XHR || !XHR.prototype || XHR.prototype.open.__wplacePrivacyCleaner) return;

    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__wpcMethod = String(method || 'GET').toUpperCase();
      this.__wpcUrl = String(url || '');
      this.__wpcKind = classify(this.__wpcUrl, this.__wpcMethod);
      this.__wpcIsLogout = isLogoutRequest(this.__wpcUrl, this.__wpcMethod);
      this.__wpcIsCaptchaFlow = isCaptchaFlowUrl(this.__wpcUrl);
      return originalOpen.apply(this, arguments);
    };
    XHR.prototype.open.__wplacePrivacyCleaner = true;

    XHR.prototype.send = function () {
      if (!this.__wpcKind || (this.__wpcKind === 'me' && ME_MODE === 'soft')) {
        if (this.__wpcIsCaptchaFlow) return originalSend.apply(this, arguments);
        if (this.__wpcKind === 'me') console.info(LOG_PREFIX, 'soft-protect xhr', this.__wpcMethod, this.__wpcUrl);
        if (this.__wpcIsLogout) {
          this.addEventListener('loadend', () => cleanLocalTraces(), { once: true });
        }
        return originalSend.apply(this, arguments);
      }

      console.info(LOG_PREFIX, 'blocked/faked xhr', this.__wpcMethod, this.__wpcUrl);

      const payload = JSON.stringify(fakePayload(this.__wpcKind));
      const status = fakeStatus(this.__wpcKind);

      try {
        Object.defineProperty(this, 'readyState', { configurable: true, value: 4 });
        Object.defineProperty(this, 'status', { configurable: true, value: status });
        Object.defineProperty(this, 'statusText', {
          configurable: true,
          value: status === 401 ? 'Blocked by Wplace Privacy Cleaner' : 'OK'
        });
        Object.defineProperty(this, 'responseText', { configurable: true, value: payload });
        Object.defineProperty(this, 'response', { configurable: true, value: payload });
      } catch (error) {}

      setTimeout(() => {
        this.dispatchEvent(new Event('readystatechange'));
        this.dispatchEvent(new Event('load'));
        this.dispatchEvent(new Event('loadend'));
      }, 0);
    };
  }

  function clearStorageArea(storage) {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
      keys.forEach(key => storage.removeItem(key));
      return keys.length;
    } catch (error) {
      return 0;
    }
  }

  async function clearCaches() {
    try {
      if (!('caches' in window)) return 0;
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
      return names.length;
    } catch (error) {
      return 0;
    }
  }

  async function clearIndexedDb() {
    try {
      if (!indexedDB.databases) return 0;
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map(db => db.name && new Promise(resolve => {
        const req = indexedDB.deleteDatabase(db.name);
        req.onsuccess = req.onerror = req.onblocked = resolve;
      })));
      return dbs.length;
    } catch (error) {
      return 0;
    }
  }

  function clearVisibleCookies() {
    try {
      const cookies = document.cookie ? document.cookie.split(';') : [];
      for (const cookie of cookies) {
        const name = cookie.split('=')[0].trim();
        if (!name) continue;
        document.cookie = `${name}=; Max-Age=0; path=/`;
        document.cookie = `${name}=; Max-Age=0; path=/; domain=.wplace.live`;
        document.cookie = `${name}=; Max-Age=0; path=/; domain=wplace.live`;
      }
      return cookies.length;
    } catch (error) {
      return 0;
    }
  }

  async function cleanLocalTraces() {
    const localCount = clearStorageArea(localStorage);
    const sessionCount = clearStorageArea(sessionStorage);
    const cookieCount = clearVisibleCookies();
    const cacheCount = await clearCaches();
    const dbCount = await clearIndexedDb();

    console.info(LOG_PREFIX, 'cleaned local traces', {
      localStorage: localCount,
      sessionStorage: sessionCount,
      visibleCookies: cookieCount,
      caches: cacheCount,
      indexedDB: dbCount
    });

    return { localCount, sessionCount, cookieCount, cacheCount, dbCount };
  }

  function cleanBeforeLogin(reason) {
    console.info(LOG_PREFIX, 'pre-login clean:', reason);
    cleanLocalTraces();
  }

  function looksLikeLoginElement(el) {
    try {
      const text = String(el && (el.innerText || el.value || el.getAttribute('aria-label') || '') || '').trim();
      const href = String(el && (el.href || el.getAttribute('href') || '') || '');
      return /(^|\s)(войти|login|sign in|продолжить через google|continue with google)(\s|$)/i.test(`${text} ${href}`);
    } catch (error) {
      return false;
    }
  }

  function looksLikeLoginForm(form) {
    try {
      const text = String(form && form.innerText || '');
      const action = String(form && form.action || '');
      return /войти|login|sign in|продолжить через google|continue with google|oauth/i.test(`${text} ${action}`);
    } catch (error) {
      return false;
    }
  }

  function installLoginCleaners() {
    document.addEventListener('pointerdown', event => {
      const el = event.target && event.target.closest && event.target.closest('a,button,input[type="submit"],[role="button"]');
      if (looksLikeLoginElement(el)) cleanBeforeLogin('login click');
    }, true);

    document.addEventListener('submit', event => {
      if (looksLikeLoginForm(event.target)) cleanBeforeLogin('login form submit');
    }, true);
  }

  async function logoutAndClean() {
    try {
      await fetch('https://backend.wplace.live/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store'
      });
    } catch (error) {
      console.warn(LOG_PREFIX, 'logout request failed', error);
    }

    await cleanLocalTraces();
    location.replace('https://wplace.live/');
  }

  function installMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('Wplace Privacy: clean local traces', () => cleanLocalTraces());
    GM_registerMenuCommand('Wplace Privacy: logout + clean', () => logoutAndClean());
    GM_registerMenuCommand('Wplace Privacy: test /me block', async () => {
      const response = await fetch('https://backend.wplace.live/me', { credentials: 'include' });
      console.info(LOG_PREFIX, '/me test', response.status, await response.text());
    });
  }

  function buildBadge() {
    if (window.top !== window.self) return;
    const run = () => {
      if (!document.body || document.getElementById('wpc-badge')) return;
      const badge = document.createElement('div');
      badge.id = 'wpc-badge';
      badge.style.cssText = [
        'position:fixed',
        'right:10px',
        'bottom:10px',
        'z-index:2147483647',
        'display:flex',
        'gap:6px',
        'align-items:center',
        'padding:6px 8px',
        'border:1px solid rgba(0,0,0,.25)',
        'border-radius:7px',
        'background:#fff',
        'color:#111',
        'font:12px/1.2 system-ui,-apple-system,Segoe UI,Arial,sans-serif',
        'box-shadow:0 3px 14px rgba(0,0,0,.18)'
      ].join(';');
      badge.innerHTML = '<b>Wplace privacy ON</b><button type="button" id="wpc-clean">clean</button><button type="button" id="wpc-logout">logout+clean</button>';
      document.body.appendChild(badge);
      badge.querySelector('#wpc-clean').onclick = () => cleanLocalTraces();
      badge.querySelector('#wpc-logout').onclick = () => logoutAndClean();
    };

    if (document.body) run();
    else document.addEventListener('DOMContentLoaded', run, { once: true });
  }

  function install() {
    patchFetch();
    patchXhr();
    patchResponseReaders();
    installMenu();
    buildBadge();
    installLoginCleaners();
    document.documentElement.setAttribute('data-wplace-privacy-cleaner', VERSION);

    if (AUTO_CLEAN_ON_PAGEHIDE) {
      window.addEventListener('pagehide', () => {
        cleanLocalTraces();
      });
    }

    console.info(LOG_PREFIX, 'installed', VERSION, '/me mode:', ME_MODE);
  }

  install();
})();
