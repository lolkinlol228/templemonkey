// ==UserScript==
// @name         Local Site Audit Logger Robust
// @namespace    local.site.audit
// @version      2.0.2
// @description  Records page, navigation, console, storage, and network activity locally with secret redaction.
// @match        http://*/*
// @match        https://*/*
// @exclude      https://*.hcaptcha.com/*
// @exclude      https://hcaptcha.com/*
// @exclude      https://*.recaptcha.net/*
// @exclude      https://www.google.com/recaptcha/*
// @exclude      https://www.gstatic.com/recaptcha/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT = 'site-audit';
  const VERSION = '2.0.2';
  const KEY_EVENTS = 'site_audit_events_v2';
  const KEY_ACTIVE = 'site_audit_active_v2';
  const MAX_EVENTS = 6000;
  const MAX_TEXT = 4000;
  const MAX_STORAGE_VALUE = 1200;

  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const host = location.hostname;
  if (
    host === 'hcaptcha.com' ||
    host.endsWith('.hcaptcha.com') ||
    host.endsWith('.recaptcha.net') ||
    (host === 'www.google.com' && location.pathname.startsWith('/recaptcha/')) ||
    (host === 'www.gstatic.com' && location.pathname.startsWith('/recaptcha/'))
  ) {
    return;
  }
  const frameLabel = (() => {
    try { return window.top === window.self ? 'top' : 'frame'; }
    catch (error) { return 'frame'; }
  })();

  const SENSITIVE_KEY = /(pass(word)?|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|auth(orization)?|cookie|set-cookie|secret|session|csrf|xsrf|jwt|api[_-]?key|client[_-]?secret|credential|assertion|otp|mfa|2fa|pin|code|saml)/i;
  const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
  const JWT = /\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g;
  const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/ig;

  function isActive() {
    return GM_getValue(KEY_ACTIVE, '1') !== '0';
  }

  function setActive(value) {
    GM_setValue(KEY_ACTIVE, value ? '1' : '0');
    emit('system', value ? 'logger enabled' : 'logger disabled');
    updateBadge();
  }

  function readEvents() {
    try {
      const parsed = JSON.parse(GM_getValue(KEY_EVENTS, '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeEvents(events) {
    GM_setValue(KEY_EVENTS, JSON.stringify(events.slice(-MAX_EVENTS)));
  }

  function emit(type, data) {
    if (!isActive() && type !== 'system') return;

    const event = {
      ts: new Date().toISOString(),
      script: SCRIPT,
      version: VERSION,
      frame: frameLabel,
      type,
      page: safePageInfo(),
      data: sanitize(data)
    };

    const events = readEvents();
    events.push(event);
    writeEvents(events);
    updateBadge(events.length);
  }

  function safePageInfo() {
    return {
      href: sanitizeUrl(location.href),
      origin: location.origin,
      pathname: location.pathname,
      title: safeText(document.title, 300),
      readyState: document.readyState,
      referrer: sanitizeUrl(document.referrer || '')
    };
  }

  function isCaptchaFlowUrl(value) {
    const raw = String(value || '');
    if (!raw) return false;

    try {
      const url = new URL(raw, location.href);
      const host = url.hostname;
      return (
        host === 'hcaptcha.com' ||
        host.endsWith('.hcaptcha.com') ||
        host === 'recaptcha.net' ||
        host.endsWith('.recaptcha.net') ||
        (host === 'www.google.com' && url.pathname.startsWith('/recaptcha/')) ||
        (host === 'www.gstatic.com' && url.pathname.startsWith('/recaptcha/')) ||
        (host === 'backend.wplace.live' && (
          url.pathname.startsWith('/anticheat/captcha/') ||
          url.pathname.startsWith('/anticheat/challenge/')
        ))
      );
    } catch (error) {
      return /hcaptcha|recaptcha|\/anticheat\/captcha\/|\/anticheat\/challenge\//i.test(raw);
    }
  }

  function safeText(value, max = MAX_TEXT) {
    let text = String(value == null ? '' : value);
    text = text.replace(BEARER, 'Bearer [redacted]');
    text = text.replace(JWT, '[jwt]');
    text = text.replace(EMAIL, '[email]');
    if (text.length > max) text = text.slice(0, max) + `...[truncated ${text.length - max} chars]`;
    return text;
  }

  function sanitizeUrl(value) {
    const raw = String(value || '');
    if (!raw) return raw;
    try {
      const url = new URL(raw, location.href);
      url.searchParams.forEach((paramValue, key) => {
        if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[redacted]');
        else url.searchParams.set(key, safeText(paramValue, 500));
      });
      return safeText(url.href, 1600);
    } catch (error) {
      return safeText(raw, 1600);
    }
  }

  function sanitizeHeaders(headers) {
    if (!headers) return {};
    const out = {};
    try {
      if (typeof headers.forEach === 'function') {
        headers.forEach((value, key) => {
          out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : safeText(value, 1200);
        });
        return out;
      }
      for (const [key, value] of Object.entries(headers)) {
        out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(value, key);
      }
      return out;
    } catch (error) {
      return '[unreadable-headers]';
    }
  }

  function sanitize(input, key = '') {
    if (SENSITIVE_KEY.test(String(key))) return '[redacted]';
    if (input == null) return input;

    const type = typeof input;
    if (type === 'string') return safeText(input);
    if (type === 'number' || type === 'boolean') return input;
    if (type === 'bigint') return String(input);
    if (type === 'function') return '[function]';

    try {
      if (input instanceof page.Headers || input instanceof Headers) return sanitizeHeaders(input);
    } catch (error) {}

    try {
      if (input instanceof page.URLSearchParams || input instanceof URLSearchParams) {
        const obj = {};
        input.forEach((value, paramKey) => {
          obj[paramKey] = sanitize(value, paramKey);
        });
        return obj;
      }
    } catch (error) {}

    try {
      if (input instanceof page.FormData || input instanceof FormData) {
        const obj = {};
        input.forEach((value, formKey) => {
          obj[formKey] = isFile(value) ? fileInfo(value) : sanitize(value, formKey);
        });
        return obj;
      }
    } catch (error) {}

    if (isFile(input)) return fileInfo(input);
    if (isBlob(input)) return `[blob type=${input.type || 'unknown'} size=${input.size}]`;
    if (input instanceof ArrayBuffer) return `[arraybuffer bytes=${input.byteLength}]`;
    if (ArrayBuffer.isView(input)) return `[${input.constructor.name} bytes=${input.byteLength}]`;

    if (Array.isArray(input)) {
      return input.slice(0, 80).map(item => sanitize(item));
    }

    if (type === 'object') {
      const out = {};
      for (const [objKey, value] of Object.entries(input).slice(0, 160)) {
        out[objKey] = sanitize(value, objKey);
      }
      return out;
    }

    return safeText(String(input));
  }

  function isBlob(value) {
    return value && typeof value === 'object' && typeof value.size === 'number' && typeof value.type === 'string';
  }

  function isFile(value) {
    return isBlob(value) && typeof value.name === 'string';
  }

  function fileInfo(file) {
    return `[file name=${safeText(file.name, 240)} type=${file.type || 'unknown'} size=${file.size}]`;
  }

  function parseBody(body) {
    if (body == null) return undefined;

    try {
      if (typeof body === 'string') {
        const text = safeText(body);
        try { return sanitize(JSON.parse(text)); } catch (error) {}
        try {
          const params = new URLSearchParams(body);
          if ([...params.keys()].length) return sanitize(params);
        } catch (error) {}
        return text;
      }

      return sanitize(body);
    } catch (error) {
      return '[unreadable-body]';
    }
  }

  function responseHeadersToObject(response) {
    try { return sanitizeHeaders(response.headers); }
    catch (error) { return '[unreadable-response-headers]'; }
  }

  function shouldPreviewResponse(contentType) {
    return /json|text|javascript|xml|html|x-www-form-urlencoded/i.test(contentType || '');
  }

  function previewResponse(response, requestInfo, transport) {
    try {
      const contentType = response.headers && response.headers.get ? response.headers.get('content-type') : '';
      if (!shouldPreviewResponse(contentType)) return;
      const clone = response.clone();
      clone.text().then(text => {
        emit(`${transport}:body`, {
          request: requestInfo,
          contentType,
          body: parseBody(text)
        });
      }).catch(error => {
        emit(`${transport}:body-error`, {
          request: requestInfo,
          error: String(error)
        });
      });
    } catch (error) {
      emit(`${transport}:body-error`, {
        request: requestInfo,
        error: String(error)
      });
    }
  }

  function requestInfoFromFetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const headers = sanitizeHeaders((init && init.headers) || (input && input.headers));
    const body = parseBody(init && init.body);

    return {
      method,
      url: sanitizeUrl(url),
      headers,
      body,
      credentials: init && init.credentials,
      mode: init && init.mode,
      cache: init && init.cache
    };
  }

  function patchFetch() {
    try {
      if (!page.fetch || page.fetch.__siteAuditWrapped) return;
      const originalFetch = page.fetch;
      const wrappedFetch = function (input, init) {
        const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
        if (isCaptchaFlowUrl(rawUrl)) return originalFetch.apply(this, arguments);

        const started = performance.now();
        const request = requestInfoFromFetch(input, init || {});
        emit('fetch:request', request);

        return originalFetch.apply(this, arguments).then(response => {
          emit('fetch:response', {
            request,
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            type: response.type,
            redirected: response.redirected,
            responseUrl: sanitizeUrl(response.url || ''),
            headers: responseHeadersToObject(response),
            durationMs: Math.round(performance.now() - started)
          });
          previewResponse(response, request, 'fetch');
          return response;
        }, error => {
          emit('fetch:error', {
            request,
            durationMs: Math.round(performance.now() - started),
            error: String(error)
          });
          throw error;
        });
      };
      wrappedFetch.__siteAuditWrapped = true;
      wrappedFetch.__siteAuditOriginal = originalFetch;
      page.fetch = wrappedFetch;
      emit('system', 'fetch patched');
    } catch (error) {
      emit('system', `fetch patch failed: ${error}`);
    }
  }

  function patchXhr() {
    try {
      const XHR = page.XMLHttpRequest;
      if (!XHR || !XHR.prototype || XHR.prototype.open.__siteAuditWrapped) return;

      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      const originalSetRequestHeader = XHR.prototype.setRequestHeader;

      XHR.prototype.open = function (method, url) {
        this.__siteAudit = {
          method: String(method || 'GET').toUpperCase(),
          rawUrl: String(url || ''),
          url: sanitizeUrl(url || ''),
          headers: {},
          started: 0
        };
        return originalOpen.apply(this, arguments);
      };
      XHR.prototype.open.__siteAuditWrapped = true;

      XHR.prototype.setRequestHeader = function (key, value) {
        try {
          if (this.__siteAudit) {
            this.__siteAudit.headers[key] = SENSITIVE_KEY.test(String(key)) ? '[redacted]' : safeText(value, 1200);
          }
        } catch (error) {}
        return originalSetRequestHeader.apply(this, arguments);
      };

      XHR.prototype.send = function (body) {
        const meta = this.__siteAudit || { method: 'GET', url: '', headers: {} };
        if (isCaptchaFlowUrl(meta.rawUrl || meta.url)) return originalSend.apply(this, arguments);

        meta.body = parseBody(body);
        meta.started = performance.now();
        emit('xhr:request', meta);

        this.addEventListener('loadend', () => {
          let responseBody = '';
          try {
            if (!this.responseType || this.responseType === 'text' || this.responseType === 'json') {
              responseBody = this.responseType === 'json' ? sanitize(this.response) : parseBody(this.responseText);
            } else {
              responseBody = `[responseType=${this.responseType}]`;
            }
          } catch (error) {
            responseBody = '[unreadable-response]';
          }

          emit('xhr:response', {
            request: meta,
            status: this.status,
            statusText: this.statusText,
            responseUrl: sanitizeUrl(this.responseURL || ''),
            responseHeaders: safeText(this.getAllResponseHeaders ? this.getAllResponseHeaders() : '', 3000),
            durationMs: Math.round(performance.now() - meta.started),
            body: responseBody
          });
        });

        return originalSend.apply(this, arguments);
      };

      emit('system', 'xhr patched');
    } catch (error) {
      emit('system', `xhr patch failed: ${error}`);
    }
  }

  function patchJqueryAjax() {
    try {
      const jq = page.jQuery || page.$;
      if (!jq || typeof jq.ajax !== 'function' || jq.ajax.__siteAuditWrapped) return;

      const originalAjax = jq.ajax;
      const wrappedAjax = function (urlOrOptions, maybeOptions) {
        const options = typeof urlOrOptions === 'string'
          ? { ...(maybeOptions || {}), url: urlOrOptions }
          : { ...(urlOrOptions || {}) };

        const request = {
          method: String(options.type || options.method || 'GET').toUpperCase(),
          url: sanitizeUrl(options.url || ''),
          headers: sanitizeHeaders(options.headers),
          body: parseBody(options.data)
        };
        emit('jquery:request', request);

        const success = options.success;
        const error = options.error;
        options.success = function (data, textStatus, xhr) {
          emit('jquery:response', {
            request,
            status: xhr && xhr.status,
            textStatus,
            body: sanitize(data)
          });
          if (success) return success.apply(this, arguments);
        };
        options.error = function (xhr, textStatus, thrown) {
          emit('jquery:error', {
            request,
            status: xhr && xhr.status,
            textStatus,
            thrown: String(thrown || ''),
            body: parseBody(xhr && xhr.responseText)
          });
          if (error) return error.apply(this, arguments);
        };

        return typeof urlOrOptions === 'string'
          ? originalAjax.call(this, options.url, options)
          : originalAjax.call(this, options);
      };
      wrappedAjax.__siteAuditWrapped = true;
      wrappedAjax.__siteAuditOriginal = originalAjax;
      jq.ajax = wrappedAjax;
      emit('system', 'jquery ajax patched');
    } catch (error) {}
  }

  function patchBeacon() {
    try {
      if (!page.navigator || !page.navigator.sendBeacon || page.navigator.sendBeacon.__siteAuditWrapped) return;
      const originalBeacon = page.navigator.sendBeacon;
      const wrappedBeacon = function (url, data) {
        if (isCaptchaFlowUrl(url)) return originalBeacon.apply(this, arguments);

        emit('beacon', {
          url: sanitizeUrl(url || ''),
          body: parseBody(data)
        });
        return originalBeacon.apply(this, arguments);
      };
      wrappedBeacon.__siteAuditWrapped = true;
      page.navigator.sendBeacon = wrappedBeacon;
      emit('system', 'sendBeacon patched');
    } catch (error) {
      emit('system', `sendBeacon patch failed: ${error}`);
    }
  }

  function patchWebSocket() {
    try {
      if (!page.WebSocket || page.WebSocket.__siteAuditWrapped) return;
      const OriginalWebSocket = page.WebSocket;
      const WrappedWebSocket = function (url, protocols) {
        emit('websocket:connect', {
          url: sanitizeUrl(url || ''),
          protocols: sanitize(protocols)
        });
        const ws = protocols == null ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols);
        const originalSend = ws.send;
        ws.send = function (data) {
          emit('websocket:send', {
            url: sanitizeUrl(url || ''),
            data: parseBody(data)
          });
          return originalSend.apply(this, arguments);
        };
        ws.addEventListener('message', event => {
          emit('websocket:message', {
            url: sanitizeUrl(url || ''),
            data: parseBody(event.data)
          });
        });
        ws.addEventListener('close', event => {
          emit('websocket:close', {
            url: sanitizeUrl(url || ''),
            code: event.code,
            reason: safeText(event.reason, 600),
            wasClean: event.wasClean
          });
        });
        ws.addEventListener('error', () => {
          emit('websocket:error', { url: sanitizeUrl(url || '') });
        });
        return ws;
      };
      WrappedWebSocket.prototype = OriginalWebSocket.prototype;
      WrappedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
      WrappedWebSocket.OPEN = OriginalWebSocket.OPEN;
      WrappedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
      WrappedWebSocket.CLOSED = OriginalWebSocket.CLOSED;
      WrappedWebSocket.__siteAuditWrapped = true;
      page.WebSocket = WrappedWebSocket;
      emit('system', 'websocket patched');
    } catch (error) {
      emit('system', `websocket patch failed: ${error}`);
    }
  }

  function patchConsole() {
    try {
      if (!page.console || page.console.__siteAuditWrapped) return;
      for (const level of ['debug', 'log', 'info', 'warn', 'error']) {
        const original = page.console[level];
        if (typeof original !== 'function') continue;
        page.console[level] = function () {
          emit(`console:${level}`, {
            args: Array.from(arguments).map(arg => sanitize(arg))
          });
          return original.apply(this, arguments);
        };
      }
      page.console.__siteAuditWrapped = true;
      emit('system', 'console patched');
    } catch (error) {
      emit('system', `console patch failed: ${error}`);
    }
  }

  function patchHistory() {
    try {
      if (!page.history || page.history.pushState.__siteAuditWrapped) return;
      const originalPushState = page.history.pushState;
      const originalReplaceState = page.history.replaceState;

      page.history.pushState = function () {
        const result = originalPushState.apply(this, arguments);
        emit('navigation:pushState', { href: sanitizeUrl(location.href), args: sanitize(Array.from(arguments)) });
        setTimeout(captureSnapshot, 250);
        return result;
      };
      page.history.pushState.__siteAuditWrapped = true;

      page.history.replaceState = function () {
        const result = originalReplaceState.apply(this, arguments);
        emit('navigation:replaceState', { href: sanitizeUrl(location.href), args: sanitize(Array.from(arguments)) });
        setTimeout(captureSnapshot, 250);
        return result;
      };

      emit('system', 'history patched');
    } catch (error) {
      emit('system', `history patch failed: ${error}`);
    }
  }

  function elementLabel(el) {
    if (!el || !el.tagName) return '';
    const parts = [el.tagName.toLowerCase()];
    if (el.id) parts.push(`#${el.id}`);
    if (el.name) parts.push(`[name="${safeText(el.name, 80)}"]`);
    if (el.type) parts.push(`[type="${safeText(el.type, 50)}"]`);
    const text = safeText(el.innerText || el.value || el.getAttribute && el.getAttribute('aria-label') || '', 220);
    if (text) parts.push(`"${text}"`);
    return parts.join('');
  }

  function closestTarget(target) {
    try {
      return target && target.closest && target.closest('a,button,input,select,textarea,[role="button"],[onclick]');
    } catch (error) {
      return target;
    }
  }

  function selectedOptionText(el) {
    try {
      if (!el || el.tagName !== 'SELECT') return '';
      const option = el.options[el.selectedIndex];
      return option ? safeText(option.textContent, 220) : '';
    } catch (error) {
      return '';
    }
  }

  function isSensitiveInput(el) {
    if (!el) return false;
    return SENSITIVE_KEY.test(`${el.name || ''} ${el.id || ''} ${el.type || ''} ${el.autocomplete || ''}`);
  }

  function inputValue(el) {
    if (!el || !('value' in el)) return undefined;
    if (isSensitiveInput(el)) return '[redacted]';
    return safeText(el.value, 800);
  }

  function installDomListeners() {
    document.addEventListener('click', event => {
      const el = closestTarget(event.target);
      emit('dom:click', {
        element: elementLabel(el),
        href: el && el.href ? sanitizeUrl(el.href) : undefined
      });
    }, true);

    document.addEventListener('change', event => {
      const el = event.target;
      emit('dom:change', {
        element: elementLabel(el),
        value: inputValue(el),
        optionText: selectedOptionText(el)
      });
      setTimeout(captureSnapshot, 250);
    }, true);

    document.addEventListener('input', event => {
      const el = event.target;
      if (!el || !/input|textarea|select/i.test(el.tagName || '')) return;
      emit('dom:input', {
        element: elementLabel(el),
        value: inputValue(el)
      });
    }, true);

    document.addEventListener('submit', event => {
      const form = event.target;
      let fields = {};
      try { fields = sanitize(new FormData(form)); }
      catch (error) { fields = '[unreadable-form]'; }
      emit('dom:submit', {
        element: elementLabel(form),
        action: sanitizeUrl(form && form.action || ''),
        method: form && form.method,
        fields
      });
    }, true);
  }

  function storageSnapshot(storage, maxValue) {
    try {
      const out = {};
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        out[key] = SENSITIVE_KEY.test(key)
          ? '[redacted]'
          : safeText(storage.getItem(key), maxValue);
      }
      return out;
    } catch (error) {
      return '[blocked]';
    }
  }

  function cookieNames() {
    try {
      return document.cookie
        ? document.cookie.split(';').map(item => item.split('=')[0].trim()).filter(Boolean)
        : [];
    } catch (error) {
      return '[blocked]';
    }
  }

  function resourceSnapshot() {
    try {
      return performance.getEntriesByType('resource').slice(-120).map(entry => ({
        name: sanitizeUrl(entry.name),
        initiatorType: entry.initiatorType,
        duration: Math.round(entry.duration),
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize
      }));
    } catch (error) {
      return [];
    }
  }

  function captureSnapshot() {
    emit('page:snapshot', {
      userAgent: safeText(navigator.userAgent, 600),
      language: navigator.language,
      languages: sanitize(navigator.languages),
      platform: navigator.platform,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: { width: innerWidth, height: innerHeight },
      screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      cookieNames: cookieNames(),
      localStorage: storageSnapshot(localStorage, MAX_STORAGE_VALUE),
      sessionStorage: storageSnapshot(sessionStorage, MAX_STORAGE_VALUE),
      resources: resourceSnapshot()
    });
  }

  function installNavigationListeners() {
    window.addEventListener('load', () => {
      emit('navigation:load', { href: sanitizeUrl(location.href) });
      setTimeout(captureSnapshot, 700);
    });
    window.addEventListener('pageshow', event => emit('navigation:pageshow', { persisted: event.persisted }));
    window.addEventListener('pagehide', event => emit('navigation:pagehide', { persisted: event.persisted }));
    window.addEventListener('beforeunload', () => emit('navigation:beforeunload', { href: sanitizeUrl(location.href) }));
    window.addEventListener('popstate', () => {
      emit('navigation:popstate', { href: sanitizeUrl(location.href) });
      setTimeout(captureSnapshot, 250);
    });
    window.addEventListener('hashchange', () => {
      emit('navigation:hashchange', { href: sanitizeUrl(location.href) });
      setTimeout(captureSnapshot, 250);
    });
    document.addEventListener('visibilitychange', () => emit('page:visibility', { state: document.visibilityState }));
  }

  function exportEvents() {
    const events = readEvents();
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `site-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function clearEvents() {
    GM_deleteValue(KEY_EVENTS);
    emit('system', 'log cleared');
    updateBadge(0);
  }

  function printSummary() {
    const events = readEvents();
    const counts = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {});
    console.info('[site-audit] events:', events.length, counts);
  }

  let badgeRoot = null;
  let badgeCount = null;
  let badgeStatus = null;

  function updateBadge(count) {
    if (!badgeCount) return;
    const total = typeof count === 'number' ? count : readEvents().length;
    badgeCount.textContent = String(total);
    badgeStatus.textContent = isActive() ? 'ON' : 'OFF';
    badgeStatus.style.color = isActive() ? '#0a7' : '#c33';
  }

  function buildBadge() {
    try {
      if (frameLabel !== 'top' || badgeRoot || !document.body) return;
      const host = document.createElement('div');
      host.id = 'site-audit-badge-host';
      host.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483647';
      const shadow = host.attachShadow({ mode: 'closed' });
      const wrap = document.createElement('div');
      wrap.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:6px',
        'padding:6px 8px',
        'border:1px solid rgba(0,0,0,.28)',
        'border-radius:7px',
        'background:#fff',
        'color:#222',
        'box-shadow:0 3px 14px rgba(0,0,0,.18)',
        'font:12px/1.2 system-ui,-apple-system,Segoe UI,Arial,sans-serif'
      ].join(';');
      wrap.innerHTML = `
        <b>Audit</b>
        <span id="sa-status"></span>
        <span id="sa-count" style="min-width:2ch;text-align:right"></span>
        <button id="sa-toggle" title="Enable/disable logging">toggle</button>
        <button id="sa-export" title="Export JSON log">export</button>
        <button id="sa-clear" title="Clear local log">clear</button>
      `;
      shadow.appendChild(wrap);
      document.body.appendChild(host);
      badgeRoot = host;
      badgeCount = wrap.querySelector('#sa-count');
      badgeStatus = wrap.querySelector('#sa-status');
      wrap.querySelector('#sa-toggle').onclick = () => setActive(!isActive());
      wrap.querySelector('#sa-export').onclick = exportEvents;
      wrap.querySelector('#sa-clear').onclick = clearEvents;
      updateBadge();
    } catch (error) {}
  }

  function onReady(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function install() {
    if (page.__siteAuditLoggerInstalled) return;
    page.__siteAuditLoggerInstalled = true;

    emit('system', `installed on ${sanitizeUrl(location.href)} frame=${frameLabel}`);
    patchFetch();
    patchXhr();
    patchBeacon();
    patchWebSocket();
    patchConsole();
    patchHistory();
    installDomListeners();
    installNavigationListeners();
    captureSnapshot();

    const jqueryTimer = setInterval(patchJqueryAjax, 500);
    setTimeout(() => clearInterval(jqueryTimer), 20000);
    onReady(buildBadge);
  }

  GM_registerMenuCommand('Site Audit: export JSON', exportEvents);
  GM_registerMenuCommand('Site Audit: clear log', clearEvents);
  GM_registerMenuCommand('Site Audit: toggle ON/OFF', () => setActive(!isActive()));
  GM_registerMenuCommand('Site Audit: print summary', printSummary);

  install();
})();
