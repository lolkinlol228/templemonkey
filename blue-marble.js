// ==UserScript==
// @name            Blue Marble
// @name:en         Blue Marble
// @namespace       https://github.com/SwingTheVine/
// @version         0.92.0
// @description     A userscript to enhance the user experience on Wplace.live. This includes, but is not limited to: uploading images to display locally on a canvas, adding a button to move the Wplace color palette menu, and other QoL features.
// @description:en  A userscript to enhance the user experience on Wplace.live. This includes, but is not limited to: uploading images to display locally on a canvas, adding a button to move the Wplace color palette menu, and other QoL features.
// @author          SwingTheVine
// @license         MPL-2.0
// @supportURL      https://discord.gg/tpeBPy46hf
// @homepageURL     https://bluemarble.lol/
// @icon            https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/2cd51bf91944ae2acb253ea5bbd76f79b7a2edd3/dist/assets/Favicon.png
// @updateURL       https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/BlueMarble.user.js
// @downloadURL     https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/BlueMarble.user.js
// @match           https://wplace.live/*
// @grant           GM_getResourceText
// @grant           GM_addStyle
// @grant           GM.setValue
// @grant           GM_getValue
// @grant           GM_deleteValue
// @grant           GM_xmlhttpRequest
// @grant           GM.download
// @grant           unsafeWindow
// @connect         backend.wplace.live
// @connect         telemetry.thebluecorner.net
// @resource        CSS-BM-File https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/2cd51bf91944ae2acb253ea5bbd76f79b7a2edd3/dist/BlueMarble.user.css
// @antifeature     tracking Anonymous opt-in telemetry data
// @noframes
// ==/UserScript==

// Wplace  --> https://wplace.live
// License --> https://www.mozilla.org/en-US/MPL/2.0/
// Donate  --> https://ko-fi.com/swingthevine

/*!
  This script is not affiliated with Wplace.live in any way, use at your own risk.
  This script is not affiliated with any userscript manager.
  The author of this userscript is not responsible for any damages, issues, loss of data, or punishment that may occur as a result of using this script.
  This script is provided "as is" under the MPL-2.0 license.
  The "Blue Marble" icon is licensed under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication.
  The "Blue Marble" image is owned by NASA.
*/

/*
  Blue Marble Auto Painter

  Reads enabled Blue Marble templates from storage and paints missing pixels by
  using Wplace's normal paint request when the page security module is available,
  with the Wplace UI kept as a fallback.
*/
(()=>{
  "use strict";

  const BM_AUTO = {
    panelId: "bm-auto-painter-panel",
    statusId: "bm-auto-status",
    statsId: "bm-auto-stats",
    etaId: "bm-auto-eta",
    backend: "https://backend.wplace.live",
    season: 0,
    tileSize: 1000,
    worldZoom: 11,
    maxBatchPixels: 1000,
    recentPaintedSkipMs: 90000,
    minMapZoom: 15,
    paletteTimeoutMs: 3000,
    selectTimeoutMs: 2200,
    clickPauseMs: 90,
    afterPaintPauseMs: 250,
    waitPaddingMs: 600,
    cursorKey: "bmAutoPainterCursor",
    resumeKey: "bmAutoPainterResume",
    pendingTargetKey: "bmAutoPainterPendingTarget",
    apiChunkKey: "bmAutoPainterWplaceApiChunk",
    batchSizeKey: "bmAutoPainterBatchSize",
    dominantKey: "bmAutoPainterDominant",
    colorKey: "bmAutoPainterColor",
    accountsKey: "bmAutoPainterAccounts",
    allowReloadKey: "bmAutoPainterAllowReload",
    waitFullChargesKey: "bmAutoPainterWaitFullCharges",
    activeKey: "bmAutoPainterActive",
    positionKey: "bmAutoPainterPos",
    recentCorrectSkipMs: 90000
  };

  const BM_COLORS = [
    {id:1,premium:false,name:"Black",rgb:[0,0,0]},
    {id:2,premium:false,name:"Dark Gray",rgb:[60,60,60]},
    {id:3,premium:false,name:"Gray",rgb:[120,120,120]},
    {id:4,premium:false,name:"Light Gray",rgb:[210,210,210]},
    {id:5,premium:false,name:"White",rgb:[255,255,255]},
    {id:6,premium:false,name:"Deep Red",rgb:[96,0,24]},
    {id:7,premium:false,name:"Red",rgb:[237,28,36]},
    {id:8,premium:false,name:"Orange",rgb:[255,127,39]},
    {id:9,premium:false,name:"Gold",rgb:[246,170,9]},
    {id:10,premium:false,name:"Yellow",rgb:[249,221,59]},
    {id:11,premium:false,name:"Light Yellow",rgb:[255,250,188]},
    {id:12,premium:false,name:"Dark Green",rgb:[14,185,104]},
    {id:13,premium:false,name:"Green",rgb:[19,230,123]},
    {id:14,premium:false,name:"Light Green",rgb:[135,255,94]},
    {id:15,premium:false,name:"Dark Teal",rgb:[12,129,110]},
    {id:16,premium:false,name:"Teal",rgb:[16,174,166]},
    {id:17,premium:false,name:"Light Teal",rgb:[19,225,190]},
    {id:18,premium:false,name:"Dark Blue",rgb:[40,80,158]},
    {id:19,premium:false,name:"Blue",rgb:[64,147,228]},
    {id:20,premium:false,name:"Cyan",rgb:[96,247,242]},
    {id:21,premium:false,name:"Indigo",rgb:[107,80,246]},
    {id:22,premium:false,name:"Light Indigo",rgb:[153,177,251]},
    {id:23,premium:false,name:"Dark Purple",rgb:[120,12,153]},
    {id:24,premium:false,name:"Purple",rgb:[170,56,185]},
    {id:25,premium:false,name:"Light Purple",rgb:[224,159,249]},
    {id:26,premium:false,name:"Dark Pink",rgb:[203,0,122]},
    {id:27,premium:false,name:"Pink",rgb:[236,31,128]},
    {id:28,premium:false,name:"Light Pink",rgb:[243,141,169]},
    {id:29,premium:false,name:"Dark Brown",rgb:[104,70,52]},
    {id:30,premium:false,name:"Brown",rgb:[149,104,42]},
    {id:31,premium:false,name:"Beige",rgb:[248,178,119]},
    {id:32,premium:true,name:"Medium Gray",rgb:[170,170,170]},
    {id:33,premium:true,name:"Dark Red",rgb:[165,14,30]},
    {id:34,premium:true,name:"Light Red",rgb:[250,128,114]},
    {id:35,premium:true,name:"Dark Orange",rgb:[228,92,26]},
    {id:36,premium:true,name:"Light Tan",rgb:[214,181,148]},
    {id:37,premium:true,name:"Dark Goldenrod",rgb:[156,132,49]},
    {id:38,premium:true,name:"Goldenrod",rgb:[197,173,49]},
    {id:39,premium:true,name:"Light Goldenrod",rgb:[232,212,95]},
    {id:40,premium:true,name:"Dark Olive",rgb:[74,107,58]},
    {id:41,premium:true,name:"Olive",rgb:[90,148,74]},
    {id:42,premium:true,name:"Light Olive",rgb:[132,197,115]},
    {id:43,premium:true,name:"Dark Cyan",rgb:[15,121,159]},
    {id:44,premium:true,name:"Light Cyan",rgb:[187,250,242]},
    {id:45,premium:true,name:"Light Blue",rgb:[125,199,255]},
    {id:46,premium:true,name:"Dark Indigo",rgb:[77,49,184]},
    {id:47,premium:true,name:"Dark Slate Blue",rgb:[74,66,132]},
    {id:48,premium:true,name:"Slate Blue",rgb:[122,113,196]},
    {id:49,premium:true,name:"Light Slate Blue",rgb:[181,174,241]},
    {id:50,premium:true,name:"Light Brown",rgb:[219,164,99]},
    {id:51,premium:true,name:"Dark Beige",rgb:[209,128,81]},
    {id:52,premium:true,name:"Light Beige",rgb:[255,197,165]},
    {id:53,premium:true,name:"Dark Peach",rgb:[155,82,73]},
    {id:54,premium:true,name:"Peach",rgb:[209,128,120]},
    {id:55,premium:true,name:"Light Peach",rgb:[250,182,164]},
    {id:56,premium:true,name:"Dark Tan",rgb:[123,99,82]},
    {id:57,premium:true,name:"Tan",rgb:[156,132,107]},
    {id:58,premium:true,name:"Dark Slate",rgb:[51,57,65]},
    {id:59,premium:true,name:"Slate",rgb:[109,117,141]},
    {id:60,premium:true,name:"Light Slate",rgb:[179,185,209]},
    {id:61,premium:true,name:"Dark Stone",rgb:[109,100,63]},
    {id:62,premium:true,name:"Stone",rgb:[148,140,107]},
    {id:63,premium:true,name:"Light Stone",rgb:[205,197,158]}
  ];

  const paintTextPattern = /(\u0420\u0438\u0441\u043e\u0432\u0430\u0442\u044c|paint|draw)/i;
  const state = {
    running: false,
    stop: false,
    map: null,
    wplaceModule: null,
    wplaceModulePromise: null,
    directPaintDisabled: false,
    noApiWarned: false,
    moduleRetryAt: 0,
    captured: null,
    bridgePromise: null,
    bridgeState: null,
    pixels: null,
    colorCounts: new Map(),
    recentlyPainted: new Map(),
    recentlyCorrect: new Map(),
    remaining: 0,
    cooldownMs: 0,
    tileCache: new Map(),
    stats: {total: 0, painted: 0, alreadyCorrect: 0, unavailableColor: 0, attempts: 0, errors: 0}
  };

  function readManualBatch() {
    const input = document.getElementById("bm-auto-batch");
    const value = Number(input && input.value);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(BM_AUTO.maxBatchPixels, Math.floor(value));
  }

  // Returns "most", "fewest", or a numeric color id chosen manually.
  function readColorStrategy() {
    const select = document.getElementById("bm-auto-color");
    const value = select ? select.value : "most";
    if (value === "most" || value === "fewest") return value;
    const match = /^c(\d+)$/.exec(value || "");
    return match ? Number(match[1]) : "most";
  }

  function readAccounts() {
    const input = document.getElementById("bm-auto-accounts");
    const value = Number(input && input.value);
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
  }

  function readWaitFullCharges() {
    const input = document.getElementById("bm-auto-waitfull");
    if (input) return Boolean(input.checked);
    const saved = getPersistedValue(BM_AUTO.waitFullChargesKey);
    return saved === null ? true : saved !== "0";
  }

  function formatDuration(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d) return d + "d " + h + "h " + m + "m";
    if (h) return h + "h " + m + "m";
    if (m) return m + "m " + s + "s";
    return s + "s";
  }

  function updateEta() {
    const el = document.getElementById(BM_AUTO.etaId);
    if (!el) return;
    const cooldownSec = Math.max(1, (state.cooldownMs || 30000) / 1000);
    const accounts = readAccounts();
    const remaining = Math.max(0, state.remaining || 0);
    const ratePerMin = (accounts * 60) / cooldownSec;
    const etaSec = remaining * cooldownSec / accounts;
    el.textContent =
      "left \u2248 " + remaining +
      " \u00b7 " + ratePerMin.toFixed(1) + " px/min (" + accounts + " acc)" +
      " \u00b7 ETA \u2248 " + formatDuration(etaSec) +
      " \u00b7 1px/" + Math.round(cooldownSec) + "s";
  }

  function populateColorSelect() {
    const select = document.getElementById("bm-auto-color");
    if (!select) return;
    const previous = getPersistedValue(BM_AUTO.colorKey) || select.value || "most";
    let html =
      '<option value="most">Auto: most pixels first</option>' +
      '<option value="fewest">Auto: fewest pixels first</option>';
    if (state.colorCounts && state.colorCounts.size) {
      const entries = Array.from(state.colorCounts.entries()).sort((a, b) => b[1] - a[1]);
      for (const [colorId, count] of entries) {
        const color = BM_COLORS.find((c) => c.id === colorId);
        const name = color ? color.name : ("Color " + colorId);
        html += '<option value="c' + colorId + '">' + name + " (" + count + ")</option>";
      }
    }
    select.innerHTML = html;
    if (Array.from(select.options).some((option) => option.value === previous)) {
      select.value = previous;
    } else {
      select.value = "most";
    }
  }

  function readAllowReload() {
    const input = document.getElementById("bm-auto-allowreload");
    if (input) return Boolean(input.checked);
    const saved = getPersistedValue(BM_AUTO.allowReloadKey);
    return saved === null ? true : saved === "1";
  }

  function rememberMap(candidate) {
    if (!isMapLike(candidate)) return false;
    state.map = candidate;
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    try {
      page.__bmAutoWplaceMap = candidate;
    } catch (error) {}
    return true;
  }

  function isMapLike(candidate) {
    return Boolean(candidate) &&
      typeof candidate === "object" &&
      typeof candidate.getCanvas === "function" &&
      typeof candidate.project === "function" &&
      (typeof candidate.flyTo === "function" || typeof candidate.jumpTo === "function") &&
      typeof candidate.getCenter === "function";
  }

  function installMapEventCapture() {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    if (page.__bmAutoMapEventCaptureInstalled) return;
    page.__bmAutoMapEventCaptureInstalled = true;

    const capture = event => {
      if (rememberMap(event?.target)) {
        window.removeEventListener("style.load", capture, true);
        window.removeEventListener("styledata", capture, true);
        window.removeEventListener("load", capture, true);
        window.removeEventListener("render", capture, true);
        window.removeEventListener("moveend", capture, true);
        window.removeEventListener("click", capture, true);
      }
    };

    for (const type of ["style.load", "styledata", "load", "render", "moveend", "click"]) {
      window.addEventListener(type, capture, true);
    }
  }

  installMapEventCapture();

  // Passively capture the site's real paint request (endpoint, headers, body) so
  // we can learn its exact shape / token requirements without importing internal
  // modules. Property assignment on unsafeWindow needs no eval, so CSP is fine.
  function installPaintCapture() {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    if (page.__bmPaintCaptureInstalled) return;
    const isPaintUrl = (url) => typeof url === "string" && /\/(s\d+\/)?pixel\//.test(url);

    try {
      const origFetch = page.fetch;
      if (typeof origFetch === "function") {
        page.fetch = function (input, init) {
          try {
            const url = typeof input === "string" ? input : (input && input.url);
            const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
            if (isPaintUrl(url) && method === "POST") {
              let headers = {};
              try {
                const h = (init && init.headers) || (input && input.headers);
                if (h && typeof h.forEach === "function") h.forEach((v, k) => { headers[k] = v; });
                else if (h) headers = Object.assign({}, h);
              } catch (error) {}
              state.captured = {via: "fetch", url, method, headers, body: init && init.body, at: Date.now()};
              console.log("BM Auto Painter: captured paint fetch", state.captured);
            }
          } catch (error) {}
          return origFetch.apply(this, arguments);
        };
        page.fetch.__bmWrapped = true;
      }
    } catch (error) {}

    try {
      const XHR = page.XMLHttpRequest;
      if (XHR && XHR.prototype) {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;
        const origSet = XHR.prototype.setRequestHeader;
        XHR.prototype.open = function (method, url) {
          this.__bmUrl = url;
          this.__bmMethod = (method || "GET").toUpperCase();
          this.__bmHeaders = {};
          return origOpen.apply(this, arguments);
        };
        XHR.prototype.setRequestHeader = function (key, value) {
          try { if (isPaintUrl(this.__bmUrl)) this.__bmHeaders[key] = value; } catch (error) {}
          return origSet.apply(this, arguments);
        };
        XHR.prototype.send = function (body) {
          try {
            if (isPaintUrl(this.__bmUrl) && this.__bmMethod === "POST") {
              state.captured = {via: "xhr", url: this.__bmUrl, method: this.__bmMethod, headers: this.__bmHeaders || {}, body, at: Date.now()};
              console.log("BM Auto Painter: captured paint XHR", state.captured);
            }
          } catch (error) {}
          return origSend.apply(this, arguments);
        };
      }
    } catch (error) {}

    page.__bmPaintCaptureInstalled = true;
  }

  installPaintCapture();

  function setStatus(message) {
    const el = document.getElementById(BM_AUTO.statusId);
    if (el) el.textContent = message;
    console.info("BM Auto Painter:", message);
  }

  function updateStats() {
    const el = document.getElementById(BM_AUTO.statsId);
    if (!el) return;
    el.textContent = [
      "pixels " + state.stats.total,
      "painted " + state.stats.painted,
      "ok " + state.stats.alreadyCorrect,
      "locked " + state.stats.unavailableColor,
      "tries " + state.stats.attempts,
      "errors " + state.stats.errors
    ].join(" | ");
  }

  function addStyle(css) {
    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createPanel() {
    if (document.getElementById(BM_AUTO.panelId)) return;
    addStyle(`
      #${BM_AUTO.panelId} {
        position: fixed;
        top: 76px;
        right: 14px;
        z-index: 99999;
        width: min(360px, calc(100vw - 28px));
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 8px;
        background: rgba(20,22,28,.92);
        color: #f4f6fb;
        box-shadow: 0 10px 26px rgba(0,0,0,.36);
        padding: 10px;
        font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${BM_AUTO.panelId} .bm-auto-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-weight: 700;
        cursor: move;
        touch-action: none;
        user-select: none;
      }
      #${BM_AUTO.panelId} .bm-auto-title::before {
        content: "⠿";
        margin-right: 4px;
        opacity: .5;
      }
      #${BM_AUTO.panelId} .bm-auto-actions {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
        margin-bottom: 8px;
      }
      #${BM_AUTO.panelId} .bm-auto-settings {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }
      #${BM_AUTO.panelId} .bm-auto-settings label {
        display: flex;
        align-items: center;
        gap: 5px;
        color: rgba(244,246,251,.85);
      }
      #${BM_AUTO.panelId} .bm-auto-settings input[type="number"] {
        width: 64px;
        padding: 3px 5px;
        border-radius: 5px;
        border: 1px solid rgba(255,255,255,.18);
        background: rgba(255,255,255,.06);
        color: #f4f6fb;
        font: inherit;
      }
      #${BM_AUTO.panelId} .bm-auto-settings input[type="checkbox"] {
        width: 14px;
        height: 14px;
        accent-color: #2d6cdf;
      }
      #${BM_AUTO.panelId} .bm-auto-color-row {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-bottom: 8px;
        color: rgba(244,246,251,.85);
      }
      #${BM_AUTO.panelId} .bm-auto-color-row select {
        flex: 1;
        min-width: 0;
        padding: 3px 5px;
        border-radius: 5px;
        border: 1px solid rgba(255,255,255,.18);
        background: rgba(255,255,255,.06);
        color: #f4f6fb;
        font: inherit;
      }
      #${BM_AUTO.panelId} .bm-auto-color-row option {
        background: #1b1d24;
        color: #f4f6fb;
      }
      #${BM_AUTO.panelId} button {
        min-height: 30px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 6px;
        background: #2d6cdf;
        color: white;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }
      #${BM_AUTO.panelId} button:disabled {
        opacity: .55;
        cursor: default;
      }
      #${BM_AUTO.panelId} #bm-auto-stop { background: #9f3131; }
      #${BM_AUTO.panelId} #bm-auto-reload { background: #3b4457; }
      #${BM_AUTO.statusId} {
        min-height: 34px;
        margin-bottom: 6px;
        color: #d9e4ff;
      }
      #${BM_AUTO.statsId} {
        color: rgba(244,246,251,.72);
        overflow-wrap: anywhere;
      }
      #${BM_AUTO.etaId} {
        margin-top: 4px;
        color: #ffd79a;
        overflow-wrap: anywhere;
      }
    `);

    const panel = document.createElement("div");
    panel.id = BM_AUTO.panelId;
    panel.innerHTML = `
      <div class="bm-auto-title">
        <span>BM Auto Painter</span>
        <span id="bm-auto-run-state">idle</span>
      </div>
      <div class="bm-auto-actions">
        <button id="bm-auto-start" type="button">Start</button>
        <button id="bm-auto-stop" type="button" disabled>Stop</button>
        <button id="bm-auto-reload" type="button">Reload Tpl</button>
        <button id="bm-auto-diag" type="button">Diag</button>
      </div>
      <div class="bm-auto-settings">
        <label title="How many pixels to paint per batch. Leave empty = auto (use all available charges).">
          Pixels/batch
          <input id="bm-auto-batch" type="number" min="1" max="${BM_AUTO.maxBatchPixels}" placeholder="auto" />
        </label>
        <label title="How many accounts you run in parallel. Only used to estimate the finish time (ETA).">
          Accounts
          <input id="bm-auto-accounts" type="number" min="1" value="1" />
        </label>
        <label title="Last-resort fallback: if no fast paint API and no map are found, reload the page to paint (the old slow behavior).">
          <input id="bm-auto-allowreload" type="checkbox" />
          Allow reload
        </label>
        <label title="Checked by default: wait until your current maximum charges are full before painting. Uncheck to paint as soon as 1 charge is ready.">
          <input id="bm-auto-waitfull" type="checkbox" />
          Full charge
        </label>
      </div>
      <div class="bm-auto-color-row" title="Which color to paint. Pick a specific color to paint it first; when it is done it continues with the remaining colors, fewest pixels first.">
        Color
        <select id="bm-auto-color">
          <option value="most">Auto: most pixels first</option>
          <option value="fewest">Auto: fewest pixels first</option>
        </select>
      </div>
      <div id="${BM_AUTO.statusId}">Ready. Enable a Blue Marble template, then press Start.</div>
      <div id="${BM_AUTO.statsId}"></div>
      <div id="${BM_AUTO.etaId}"></div>
    `;
    document.body.appendChild(panel);
    restorePanelPosition(panel);
    makePanelDraggable(panel, panel.querySelector(".bm-auto-title"));

    const batchInput = document.getElementById("bm-auto-batch");
    if (batchInput) {
      const savedBatch = getPersistedValue(BM_AUTO.batchSizeKey);
      if (savedBatch) batchInput.value = savedBatch;
      batchInput.addEventListener("change", () => {
        const value = readManualBatch();
        if (value > 0) setPersistedValue(BM_AUTO.batchSizeKey, String(value));
        else removePersistedValue(BM_AUTO.batchSizeKey);
      });
    }
    const accountsInput = document.getElementById("bm-auto-accounts");
    if (accountsInput) {
      const savedAccounts = getPersistedValue(BM_AUTO.accountsKey);
      if (savedAccounts) accountsInput.value = savedAccounts;
      accountsInput.addEventListener("change", () => {
        setPersistedValue(BM_AUTO.accountsKey, String(readAccounts()));
        updateEta();
      });
    }
    const colorSelect = document.getElementById("bm-auto-color");
    if (colorSelect) {
      populateColorSelect();
      const savedColor = getPersistedValue(BM_AUTO.colorKey);
      if (savedColor && Array.from(colorSelect.options).some((o) => o.value === savedColor)) {
        colorSelect.value = savedColor;
      }
      colorSelect.addEventListener("change", () => {
        setPersistedValue(BM_AUTO.colorKey, colorSelect.value);
      });
    }
    const allowReloadInput = document.getElementById("bm-auto-allowreload");
    if (allowReloadInput) {
      const savedAllowReload = getPersistedValue(BM_AUTO.allowReloadKey);
      allowReloadInput.checked = savedAllowReload === null ? true : savedAllowReload === "1";
      allowReloadInput.addEventListener("change", () => {
        setPersistedValue(BM_AUTO.allowReloadKey, allowReloadInput.checked ? "1" : "0");
      });
    }
    const waitFullInput = document.getElementById("bm-auto-waitfull");
    if (waitFullInput) {
      const savedWaitFull = getPersistedValue(BM_AUTO.waitFullChargesKey);
      waitFullInput.checked = savedWaitFull === null ? true : savedWaitFull !== "0";
      waitFullInput.addEventListener("change", () => {
        setPersistedValue(BM_AUTO.waitFullChargesKey, waitFullInput.checked ? "1" : "0");
      });
    }

    document.getElementById("bm-auto-diag")?.addEventListener("click", () => { void diagnose(); });
    document.getElementById("bm-auto-start")?.addEventListener("click", start);
    document.getElementById("bm-auto-stop")?.addEventListener("click", stop);
    document.getElementById("bm-auto-reload")?.addEventListener("click", async () => {
      state.pixels = null;
      state.directPaintDisabled = false;
      state.tileCache.clear();
      localStorage.removeItem(BM_AUTO.cursorKey);
      await clearPendingTarget();
      setStatus("Reloading templates...");
      try {
        await loadPixels(true);
        setStatus("Templates reloaded.");
      } catch (error) {
        state.stats.errors++;
        setStatus(error.message || String(error));
      }
      updateStats();
    });
    updateStats();
    // Continue pending reload paints, or restart automatically if the painter
    // was running before a normal page refresh.
    scheduleResumeAfterReload();
  }

  function clampPanel(panel) {
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
    const rect = panel.getBoundingClientRect();
    panel.style.right = "auto";
    panel.style.left = Math.max(0, Math.min(maxLeft, rect.left)) + "px";
    panel.style.top = Math.max(0, Math.min(maxTop, rect.top)) + "px";
  }

  function savePanelPosition(panel) {
    setPersistedValue(BM_AUTO.positionKey, JSON.stringify({left: panel.style.left, top: panel.style.top}));
  }

  function restorePanelPosition(panel) {
    try {
      const raw = getPersistedValue(BM_AUTO.positionKey);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (pos && pos.left && pos.top) {
        panel.style.right = "auto";
        panel.style.left = pos.left;
        panel.style.top = pos.top;
        requestAnimationFrame(() => clampPanel(panel));
      }
    } catch (error) {}
  }

  function makePanelDraggable(panel, handle) {
    if (!panel || !handle) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      panel.style.right = "auto";
      panel.style.left = rect.left + "px";
      panel.style.top = rect.top + "px";
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      dragging = true;
      try { handle.setPointerCapture(event.pointerId); } catch (error) {}
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      const left = Math.max(0, Math.min(maxLeft, startLeft + (event.clientX - startX)));
      const top = Math.max(0, Math.min(maxTop, startTop + (event.clientY - startY)));
      panel.style.left = left + "px";
      panel.style.top = top + "px";
    });

    const endDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(event.pointerId); } catch (error) {}
      savePanelPosition(panel);
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", () => clampPanel(panel));
  }

  function setRunningUi(running) {
    const startButton = document.getElementById("bm-auto-start");
    const stopButton = document.getElementById("bm-auto-stop");
    const runState = document.getElementById("bm-auto-run-state");
    if (startButton) startButton.disabled = running;
    if (stopButton) stopButton.disabled = !running;
    if (runState) runState.textContent = running ? "running" : "idle";
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function interruptibleSleep(ms) {
    const end = Date.now() + ms;
    while (!state.stop && Date.now() < end) {
      await sleep(Math.min(1000, end - Date.now()));
    }
  }

  function ensureNotStopped() {
    if (state.stop) throw new Error("Stopped");
  }

  function parseStoredTemplates() {
    let raw = "{}";
    try {
      raw = GM_getValue("bmTemplates", "{}");
    } catch (error) {
      throw new Error("Cannot read Blue Marble templates from userscript storage.");
    }
    try {
      return JSON.parse(raw || "{}");
    } catch (error) {
      throw new Error("Blue Marble template storage is not valid JSON.");
    }
  }

  async function loadPixels(force) {
    if (state.pixels && !force) return state.pixels;
    const stored = parseStoredTemplates();
    const templateEntries = Object.entries(stored.templates || {})
      .filter(([, template]) => template && template.enabled !== false && template.tiles)
      .sort(([a], [b]) => {
        const left = Number(a.split(" ")[0]);
        const right = Number(b.split(" ")[0]);
        return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
      });

    if (!templateEntries.length) throw new Error("No enabled Blue Marble templates found.");

    const deduped = new Map();
    let decodedTiles = 0;
    for (const [templateId, template] of templateEntries) {
      const tileEntries = Object.entries(template.tiles || {});
      for (const [tileKey, base64Png] of tileEntries) {
        ensureNotStopped();
        const parsed = parseTemplateTileKey(tileKey);
        if (!parsed) continue;
        decodedTiles++;
        setStatus("Reading template " + (template.name || templateId) + " tile " + decodedTiles + "...");
        const pixels = await decodeTemplateTile(parsed, base64Png, template.name || templateId);
        for (const pixel of pixels) {
          const key = pixelKey(pixel);
          if (deduped.has(key)) deduped.delete(key);
          deduped.set(key, pixel);
        }
        await sleep(0);
      }
    }

    state.colorCounts = new Map();
    for (const pixel of deduped.values()) {
      state.colorCounts.set(pixel.color.id, (state.colorCounts.get(pixel.color.id) || 0) + 1);
    }
    state.pixels = Array.from(deduped.values()).sort((left, right) => {
      const countDiff = (state.colorCounts.get(right.color.id) || 0) - (state.colorCounts.get(left.color.id) || 0);
      if (countDiff) return countDiff;
      if (left.color.id !== right.color.id) return left.color.id - right.color.id;
      if (left.tx !== right.tx) return left.tx - right.tx;
      if (left.ty !== right.ty) return left.ty - right.ty;
      if (left.py !== right.py) return left.py - right.py;
      return left.px - right.px;
    });
    state.stats.total = state.pixels.length;
    state.stats.alreadyCorrect = 0;
    state.stats.unavailableColor = 0;
    state.recentlyCorrect.clear();
    state.remaining = state.pixels.length;
    state.tileCache.clear();
    updateStats();
    populateColorSelect();
    updateEta();
    if (!state.pixels.length) throw new Error("Enabled templates contain no paintable pixels.");
    return state.pixels;
  }

  function parseTemplateTileKey(tileKey) {
    const parts = String(tileKey).split(",").map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null;
    return {tx: parts[0], ty: parts[1], px: parts[2], py: parts[3]};
  }

  async function decodeTemplateTile(tile, base64Png, templateName) {
    const bitmap = await base64PngToBitmap(base64Png);
    const {canvas, context} = makeCanvas(bitmap.width, bitmap.height);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const width = Math.floor(bitmap.width / 3);
    const height = Math.floor(bitmap.height / 3);
    const pixels = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = x * 3 + 1;
        const sy = y * 3 + 1;
        const index = (sy * bitmap.width + sx) * 4;
        const alpha = imageData[index + 3];
        if (alpha < 64) continue;
        const rgb = [imageData[index], imageData[index + 1], imageData[index + 2]];
        const color = nearestColor(rgb);
        if (!color || color.id <= 0) continue;
        pixels.push({tx: tile.tx, ty: tile.ty, px: tile.px + x, py: tile.py + y, rgb, color, templateName});
      }
    }
    if (bitmap.close) bitmap.close();
    if (canvas.remove) canvas.remove();
    return pixels;
  }

  async function base64PngToBitmap(base64Png) {
    const bytes = Uint8Array.from(atob(base64Png), char => char.charCodeAt(0));
    const blob = new Blob([bytes], {type: "image/png"});
    return createImageBitmap(blob);
  }

  function makeCanvas(width, height) {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", {willReadFrequently: true});
      return {canvas, context};
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", {willReadFrequently: true});
    return {canvas, context};
  }

  function nearestColor(rgb) {
    let best = null;
    let bestDistance = Infinity;
    for (const color of BM_COLORS) {
      const distance = colorDistance(rgb, color.rgb);
      if (distance < bestDistance) {
        best = color;
        bestDistance = distance;
      }
    }
    return best;
  }

  function colorDistance(left, right) {
    const dr = left[0] - right[0];
    const dg = left[1] - right[1];
    const db = left[2] - right[2];
    return dr * dr + dg * dg + db * db;
  }

  function pixelKey(pixel) {
    return pixel.tx + "," + pixel.ty + "," + pixel.px + "," + pixel.py;
  }

  function getPersistedValue(key) {
    try {
      const local = localStorage.getItem(key);
      if (local !== null) return local;
    } catch (error) {}
    try {
      const session = sessionStorage.getItem(key);
      if (session !== null) return session;
    } catch (error) {}
    try {
      if (typeof GM_getValue === "function") return GM_getValue(key, null);
    } catch (error) {}
    return null;
  }

  async function setPersistedValue(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {}
    try {
      sessionStorage.setItem(key, value);
    } catch (error) {}
    try {
      if (typeof GM !== "undefined" && typeof GM.setValue === "function") {
        await GM.setValue(key, value);
      }
    } catch (error) {}
  }

  async function removePersistedValue(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {}
    try {
      sessionStorage.removeItem(key);
    } catch (error) {}
    try {
      if (typeof GM_deleteValue === "function") GM_deleteValue(key);
    } catch (error) {}
  }

  function gmRequest(url, responseType) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest is not available."));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType,
        anonymous: false,
        withCredentials: true,
        timeout: 20000,
        onload: response => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.response);
          } else {
            reject(new Error("Backend request failed: " + response.status));
          }
        },
        onerror: () => reject(new Error("Backend request failed.")),
        ontimeout: () => reject(new Error("Backend request timed out."))
      });
    });
  }

  async function fetchJson(path) {
    const url = BM_AUTO.backend + path;
    try {
      const response = await fetch(url, {credentials: "include", cache: "no-store"});
      if (!response.ok) throw new Error("Backend request failed: " + response.status);
      return response.json();
    } catch (fetchError) {
      const response = await gmRequest(url, "json");
      return typeof response === "string" ? JSON.parse(response) : response;
    }
  }

  async function fetchBlob(path) {
    const url = BM_AUTO.backend + path;
    try {
      const response = await fetch(url, {credentials: "include", cache: "reload"});
      if (!response.ok) throw new Error("Tile request failed: " + response.status);
      return response.blob();
    } catch (fetchError) {
      return gmRequest(url, "blob");
    }
  }

  function importModule(url) {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const pageImport = typeof page.Function === "function"
      ? page.Function("url", "return import(url)")
      : null;
    return pageImport ? pageImport(url) : import(url);
  }

  function rememberMapFromModule(mod) {
    try {
      if (!mod) return;
      if (mod.j && mod.j.map && rememberMap(mod.j.map)) return;
      for (const key of Object.keys(mod)) {
        let value;
        try { value = mod[key]; } catch (error) { continue; }
        if (!value || typeof value !== "object") continue;
        if (isMapLike(value) && rememberMap(value)) return;
        if (value.map && isMapLike(value.map) && rememberMap(value.map)) return;
      }
    } catch (error) {}
  }

  async function tryImportPaintModule(url) {
    try {
      const mod = await importModule(url);
      rememberMapFromModule(mod);
      if (findPaintApi(mod)) return mod;
    } catch (error) {}
    return null;
  }

  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let index = 0;
    async function worker() {
      while (index < items.length) {
        const current = index++;
        out[current] = await fn(items[current], current);
      }
    }
    await Promise.all(Array.from({length: Math.max(1, Math.min(limit, items.length))}, worker));
    return out;
  }

  async function loadWplaceModule() {
    if (state.wplaceModule) return state.wplaceModule;
    if (state.wplaceModulePromise) return state.wplaceModulePromise;
    if (state.moduleRetryAt && Date.now() < state.moduleRetryAt) return null;
    state.wplaceModulePromise = (async () => {
      // 1) Previously found chunk.
      const cached = getPersistedValue(BM_AUTO.apiChunkKey);
      if (cached) {
        const mod = await tryImportPaintModule(cached);
        if (mod) return mod;
        await removePersistedValue(BM_AUTO.apiChunkKey);
      }
      const urls = collectWplaceChunkUrls();
      // 2) Chunks whose source text looks like the paint module.
      for (const url of urls) {
        if (await looksLikeWplaceApiModule(url)) {
          const mod = await tryImportPaintModule(url);
          if (mod) {
            await setPersistedValue(BM_AUTO.apiChunkKey, url);
            return mod;
          }
        }
      }
      // 3) Last resort: import every already-loaded chunk and look for any export
      //    exposing a .paint() method. Already-evaluated ES modules return their
      //    cached instance, so this does not re-run module side effects.
      const results = await mapLimit(urls, 6, async (url) => {
        const mod = await tryImportPaintModule(url);
        return mod ? {url, mod} : null;
      });
      const hit = results.find(Boolean);
      if (hit) {
        await setPersistedValue(BM_AUTO.apiChunkKey, hit.url);
        return hit.mod;
      }
      return null;
    })();
    try {
      const mod = await state.wplaceModulePromise;
      if (mod) {
        state.wplaceModule = mod;
        rememberMapFromModule(mod);
      } else {
        // If discovery failed, back off so we do not rescan every paint loop.
        state.moduleRetryAt = Date.now() + 8000;
      }
      return mod;
    } finally {
      state.wplaceModulePromise = null;
    }
  }

  function findPaintApi(mod) {
    if (!mod) return null;
    const hasPaint = (v) => {
      if (!v || typeof v.paint !== "function") return null;
      try {
        const source = Function.prototype.toString.call(v.paint);
        if (!/(\/paint|getHeaders|colorIdx|tiles)/.test(source)) return null;
      } catch (error) {
        return null;
      }
      return v;
    };
    if (hasPaint(mod.a)) return mod.a;
    for (const key of Object.keys(mod)) {
      let value;
      try { value = mod[key]; } catch (error) { continue; }
      if (hasPaint(value)) return value;
      // Some builds wrap the api one level deeper or expose it as default.
      if (value && typeof value === "object") {
        for (const inner of Object.keys(value)) {
          let nested;
          try { nested = value[inner]; } catch (error) { continue; }
          if (hasPaint(nested)) return nested;
        }
      }
    }
    return null;
  }

  function collectWplaceChunkUrls() {
    const urls = new Set();
    // Resources already fetched by the page. This catches the paint chunk even
    // when SvelteKit lazy-loads it (it never appears as a <link>/<script> tag),
    // e.g. after the user opens the paint menu once.
    try {
      for (const entry of performance.getEntriesByType("resource")) {
        const name = entry && entry.name;
        if (name && /\/_app\/immutable\/.+\.js(\?|$)/.test(name)) urls.add(name);
      }
    } catch (error) {}
    for (const element of document.querySelectorAll('link[href*="/_app/immutable/"], script[src*="/_app/immutable/"]')) {
      const value = element.href || element.src;
      if (!value) continue;
      try {
        urls.add(new URL(value, location.href).href);
      } catch (error) {}
    }
    // Probe the paint-bearing chunks first; they live under chunks/.
    return Array.from(urls).sort(
      (a, b) => (b.includes("/chunks/") ? 1 : 0) - (a.includes("/chunks/") ? 1 : 0)
    );
  }

  async function looksLikeWplaceApiModule(url) {
    try {
      const response = await fetch(url, {cache: "force-cache"});
      if (!response.ok) return false;
      const text = await response.text();
      const hasPaint = text.includes("/paint");
      const hasHeaders = text.includes("getHeaders") || /pawtect/i.test(text);
      return hasPaint && hasHeaders;
    } catch (error) {
      return false;
    }
  }

  function chargesWaitMs(user) {
    const charges = user && user.charges;
    if (!charges) return 0;
    const count = Number(charges.count || 0);
    const target = chargeTarget(user);
    if (count >= target) return 0;
    const cooldown = Math.max(1000, Number(charges.cooldownMs || 30000));
    return Math.ceil(Math.max(0, target - count) * cooldown + BM_AUTO.waitPaddingMs);
  }

  function chargeTarget(user) {
    const charges = user && user.charges;
    if (!charges) return 1;
    const max = Math.floor(Number(charges.max || 0));
    if (readWaitFullCharges() && Number.isFinite(max) && max > 1) return max;
    return 1;
  }

  function chargeStatus(user, waitMs) {
    const charges = user?.charges || {};
    const target = chargeTarget(user);
    const count = Number(charges.count || 0);
    const max = Number(charges.max || target);
    const label = readWaitFullCharges() && target > 1 ? "Charging to full" : "No charges";
    return label + ". Waiting " + formatDuration(waitMs / 1000) + " (" + count.toFixed(2) + "/" + max + ").";
  }

  function userCanUseColor(user, colorId) {
    if (colorId < 32) return true;
    const bitmap = Number(user && user.extraColorsBitmap || 0);
    return Boolean(bitmap & (1 << (colorId - 32)));
  }

  function availableCharges(user) {
    const count = Number(user?.charges?.count || 0);
    if (!Number.isFinite(count)) return 0;
    return Math.max(0, Math.floor(count));
  }

  function pruneRecentlyPainted() {
    const now = Date.now();
    for (const [key, until] of state.recentlyPainted) {
      if (until <= now) state.recentlyPainted.delete(key);
    }
    for (const [key, until] of state.recentlyCorrect) {
      if (until <= now) state.recentlyCorrect.delete(key);
    }
  }

  function markRecentlyPainted(targets) {
    const until = Date.now() + BM_AUTO.recentPaintedSkipMs;
    const touchedTiles = new Set();
    for (const target of targets) {
      const key = pixelKey(target);
      state.recentlyPainted.set(key, until);
      state.recentlyCorrect.delete(key);
      touchedTiles.add(target.tx + "," + target.ty);
    }
    for (const tileKey of touchedTiles) state.tileCache.delete(tileKey);
  }

  function markRecentlyCorrect(pixel) {
    state.recentlyCorrect.set(pixelKey(pixel), Date.now() + BM_AUTO.recentCorrectSkipMs);
  }

  async function findNextBatch(user, limit) {
    const pixels = await loadPixels(false);
    const batchLimit = Math.max(1, Math.min(BM_AUTO.maxBatchPixels, limit || 1));
    let cursor = Number(localStorage.getItem(BM_AUTO.cursorKey) || 0);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
    cursor %= pixels.length;

    pruneRecentlyPainted();
    const batch = [];
    let batchColorId = null;
    for (let scanned = 0; scanned < pixels.length && batch.length < batchLimit; scanned++) {
      ensureNotStopped();
      const index = (cursor + scanned) % pixels.length;
      const pixel = pixels[index];
      localStorage.setItem(BM_AUTO.cursorKey, String((index + 1) % pixels.length));

      if (state.recentlyPainted.has(pixelKey(pixel))) continue;
      if (batchColorId !== null && pixel.color.id !== batchColorId) break;
      if (!userCanUseColor(user, pixel.color.id)) {
        state.stats.unavailableColor++;
        updateStats();
        continue;
      }
      if (await tilePixelMatches(pixel)) {
        state.stats.alreadyCorrect++;
        updateStats();
        continue;
      }
      if (batchColorId === null) batchColorId = pixel.color.id;
      batch.push(pixel);
    }
    return batch;
  }

  async function findNextTarget(user) {
    return (await findNextBatch(user, 1))[0] || null;
  }

  // Pick a batch of up to `limit` pixels of a single color, choosing the color by
  // the current strategy: "most" pixels first, "fewest" first, or a specific
  // color id (paint it first, then continue with the rest fewest-first).
  // Also refreshes state.remaining (approx pixels left) for the ETA display.
  async function pickColorBatch(user, limit) {
    const pixels = await loadPixels(false);
    const batchLimit = Math.max(1, Math.min(BM_AUTO.maxBatchPixels, limit || 1));
    pruneRecentlyPainted();

    const candidatesByColor = new Map();
    for (const pixel of pixels) {
      const key = pixelKey(pixel);
      if (state.recentlyPainted.has(key)) continue;
      if (state.recentlyCorrect.has(key)) continue;
      if (!userCanUseColor(user, pixel.color.id)) continue;
      let bucket = candidatesByColor.get(pixel.color.id);
      if (!bucket) {
        bucket = [];
        candidatesByColor.set(pixel.color.id, bucket);
      }
      bucket.push(pixel);
    }

    let remaining = 0;
    for (const bucket of candidatesByColor.values()) remaining += bucket.length;
    state.remaining = remaining;
    updateEta();
    if (!candidatesByColor.size) return [];

    const strategy = readColorStrategy();
    const entries = Array.from(candidatesByColor.entries()); // [colorId, pixels[]]
    let ordered;
    if (typeof strategy === "number") {
      const chosen = entries.filter(([colorId]) => colorId === strategy);
      const rest = entries.filter(([colorId]) => colorId !== strategy).sort((a, b) => a[1].length - b[1].length);
      ordered = chosen.concat(rest);
    } else if (strategy === "fewest") {
      ordered = entries.sort((a, b) => a[1].length - b[1].length);
    } else {
      ordered = entries.sort((a, b) => b[1].length - a[1].length);
    }

    for (const [, candidates] of ordered) {
      ensureNotStopped();
      const batch = [];
      for (const pixel of candidates) {
        if (batch.length >= batchLimit) break;
        ensureNotStopped();
        if (await tilePixelMatches(pixel)) {
          markRecentlyCorrect(pixel);
          state.stats.alreadyCorrect++;
          updateStats();
          continue;
        }
        batch.push(pixel);
      }
      // This color still has work -> paint it. Otherwise try the next color.
      if (batch.length) return batch;
    }
    return [];
  }

  async function tilePixelMatches(pixel) {
    try {
      const tile = await loadMapTile(pixel.tx, pixel.ty);
      if (pixel.px < 0 || pixel.py < 0 || pixel.px >= tile.width || pixel.py >= tile.height) return false;
      const index = (pixel.py * tile.width + pixel.px) * 4;
      const alpha = tile.data[index + 3];
      if (alpha < 64) return false;
      const currentRgb = [tile.data[index], tile.data[index + 1], tile.data[index + 2]];
      return nearestColor(currentRgb)?.id === pixel.color.id;
    } catch (error) {
      state.stats.errors++;
      setStatus("Could not check tile " + pixel.tx + "," + pixel.ty + ": " + (error.message || error));
      updateStats();
      return false;
    }
  }

  async function loadMapTile(tx, ty) {
    const key = tx + "," + ty;
    const cached = state.tileCache.get(key);
    if (cached) return cached;
    const blob = await fetchBlob("/files/s" + BM_AUTO.season + "/tiles/" + tx + "/" + ty + ".png?bmAuto=" + Date.now());
    const bitmap = await createImageBitmap(blob);
    const {canvas, context} = makeCanvas(bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const result = {width: bitmap.width, height: bitmap.height, data: imageData.data};
    state.tileCache.set(key, result);
    if (bitmap.close) bitmap.close();
    if (canvas.remove) canvas.remove();
    return result;
  }

  async function start() {
    if (state.running) return;
    await setPersistedValue(BM_AUTO.activeKey, "1");
    await clearPendingTarget();
    state.directPaintDisabled = false;
    localStorage.removeItem(BM_AUTO.cursorKey);
    state.running = true;
    state.stop = false;
    setRunningUi(true);
    try {
      await run();
    } catch (error) {
      if ((error.message || "") !== "Stopped") {
        const message = error.message || String(error);
        if (/No enabled Blue Marble templates|contain no paintable pixels|template storage/i.test(message)) {
          void setPersistedValue(BM_AUTO.activeKey, "0");
        }
        state.stats.errors++;
        setStatus(message);
      }
    } finally {
      state.running = false;
      state.stop = false;
      setRunningUi(false);
      updateStats();
    }
  }

  function stop() {
    state.stop = true;
    void setPersistedValue(BM_AUTO.activeKey, "0");
    void clearPendingTarget();
    setStatus("Stopping after the current step...");
  }

  function previewBody(body) {
    try {
      if (body == null) return null;
      if (typeof body === "string") return body.slice(0, 400);
      if (body instanceof ArrayBuffer) return "ArrayBuffer(" + body.byteLength + ")";
      if (typeof Blob !== "undefined" && body instanceof Blob) return "Blob(" + body.size + ")";
      return String(body).slice(0, 400);
    } catch (error) {
      return "<unreadable>";
    }
  }

  async function diagnose() {
    setStatus("Diagnosing… (open DevTools console with F12)");
    const info = {textMatches: [], importTests: []};
    let urls = [];
    try {
      urls = collectWplaceChunkUrls();
      info.chunksFound = urls.length;
    } catch (error) {
      info.chunksError = String((error && error.message) || error);
    }

    // 1) Which chunks contain the paint signature in their source text?
    for (const url of urls) {
      try {
        const res = await fetch(url, {cache: "force-cache"});
        if (!res.ok) continue;
        const text = await res.text();
        if (text.includes("/paint") && (text.includes("getHeaders") || /pawtect/i.test(text))) {
          info.textMatches.push(url);
        }
      } catch (error) {}
    }

    // 2) Try importing the most promising chunks; report success/failure + shapes.
    const probe = (info.textMatches.length ? info.textMatches : urls).slice(0, 6);
    for (const url of probe) {
      const rec = {chunk: url.split("/").pop()};
      try {
        const mod = await importModule(url);
        rec.imported = true;
        rec.exports = Object.keys(mod);
        rec.shapes = Object.keys(mod).map((key) => {
          try {
            const value = mod[key];
            let note = "";
            if (value && typeof value.paint === "function") note = " <paint>";
            else if (value && value.prototype && typeof value.prototype.paint === "function") note = " <proto.paint>";
            else if (value && value.map) note = " <.map>";
            return key + ":" + typeof value + note;
          } catch (error) {
            return key + ":<err>";
          }
        });
        rec.paintApi = Boolean(findPaintApi(mod));
      } catch (error) {
        rec.imported = false;
        rec.error = String((error && error.message) || error);
      }
      info.importTests.push(rec);
    }

    try {
      state.moduleRetryAt = 0;
      info.bridgeState = await ensurePageBridge();
      const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      info.bridgePaintFn = typeof page.__bmPaint === "function";
    } catch (error) {
      info.bridgeState = "diag-error:" + String((error && error.message) || error);
    }
    info.mapFound = Boolean(getKnownWplaceMap());
    info.canFunctionEval = (() => {
      try {
        const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
        return page.Function("return 1")() === 1;
      } catch (error) {
        return String((error && error.message) || error);
      }
    })();
    info.hasUnsafeWindow = typeof unsafeWindow !== "undefined";
    try {
      const nonced = document.querySelector("script[nonce]");
      info.scriptNonce = nonced ? (nonced.nonce || nonced.getAttribute("nonce") || "present-but-hidden") : null;
    } catch (error) {
      info.scriptNonce = null;
    }
    info.capturedPaint = state.captured
      ? {
          via: state.captured.via,
          url: state.captured.url,
          headerKeys: Object.keys(state.captured.headers || {}),
          bodyType: typeof state.captured.body,
          bodyPreview: previewBody(state.captured.body)
        }
      : null;

    try {
      const user = await fetchJson("/me");
      info.charges = user && user.charges;
      info.extraColorsBitmap = user && user.extraColorsBitmap;
    } catch (error) {
      info.meError = String((error && error.message) || error);
    }
    try {
      const pixels = await loadPixels(false);
      info.templatePixels = pixels.length;
    } catch (error) {
      info.pixelsError = String((error && error.message) || error);
    }

    console.log("=== BM Auto Painter DIAGNOSTICS ===", info);
    const firstImport = info.importTests[0];
    const importMsg = firstImport
      ? (firstImport.imported ? ("import ok, paintApi:" + firstImport.paintApi) : ("import FAIL: " + firstImport.error))
      : "no chunk to import";
    setStatus(
      "Diag → textMatch:" + info.textMatches.length +
      " | bridge:" + (info.bridgeState || "?") +
      " | paintFn:" + (info.bridgePaintFn ? "yes" : "no") +
      " | map:" + (info.mapFound ? "yes" : "no") +
      " | captured:" + (info.capturedPaint ? "yes" : "no") +
      " — full report in console"
    );
    return info;
  }

  function scheduleResumeAfterReload() {
    for (const delay of [250, 1500, 4000]) {
      setTimeout(() => {
        if (state.running) return;
        if (hasPendingResume()) void resumeAfterReload();
        else if (shouldAutoStartAfterLoad()) void autoStartAfterLoad();
      }, delay);
    }
  }

  function hasPendingResume() {
    return getPersistedValue(BM_AUTO.resumeKey) === "1" || new URL(location.href).searchParams.get("bmAutoResume") === "1";
  }

  function shouldAutoStartAfterLoad() {
    return getPersistedValue(BM_AUTO.activeKey) === "1";
  }

  async function autoStartAfterLoad() {
    if (state.running || hasPendingResume() || !shouldAutoStartAfterLoad()) return;
    setStatus("Auto-starting after page load...");
    await start();
  }

  async function resumeAfterReload() {
    if (!hasPendingResume()) return;
    const target = restorePendingTarget();
    if (!target) {
      await clearPendingTarget();
      return;
    }
    if (state.running) return;
    state.running = true;
    state.stop = false;
    setRunningUi(true);
    try {
      setStatus("Resuming at " + pixelKey(target) + " after Wplace reload...");
      await waitForAvailableCharge();
      if (await tilePixelMatches(target)) {
        setStatus("Pending pixel is already correct.");
      } else if (await paintBatchDirect([target])) {
        state.stats.attempts++;
        state.stats.painted++;
        setStatus("Painted pending pixel through Wplace API: " + pixelKey(target) + ".");
      } else {
        await waitForSelectedPixelPanel(target);
        await openPaintPalette();
        await selectPaletteColor(target.color.id);
        await confirmPaint();
        state.stats.attempts++;
        markRecentlyPainted([target]);
        await interruptibleSleep(BM_AUTO.afterPaintPauseMs);
        if (await tilePixelMatches(target)) {
          state.stats.painted++;
          setStatus("Painted " + pixelKey(target) + ".");
        } else {
          setStatus("Click sent for " + pixelKey(target) + "; tile is not updated yet.");
        }
      }
      await clearPendingTarget();
      updateStats();
      await run();
    } catch (error) {
      if ((error.message || "") !== "Stopped") {
        state.stats.errors++;
        setStatus(error.message || String(error));
      }
    } finally {
      state.running = false;
      state.stop = false;
      setRunningUi(false);
      updateStats();
    }
  }

  async function waitForAvailableCharge() {
    while (!state.stop) {
      const user = await fetchJson("/me");
      const waitMs = chargesWaitMs(user);
      if (waitMs <= 0) return user;
      setStatus(chargeStatus(user, waitMs));
      await interruptibleSleep(waitMs);
    }
    throw new Error("Stopped");
  }

  function compactTarget(target) {
    return {
      tx: target.tx,
      ty: target.ty,
      px: target.px,
      py: target.py,
      color: {
        id: target.color.id,
        name: target.color.name,
        rgb: target.color.rgb,
        premium: target.color.premium
      }
    };
  }

  function restorePendingTarget() {
    try {
      const raw = getPersistedValue(BM_AUTO.pendingTargetKey);
      if (raw) {
        const target = normalizePendingTarget(JSON.parse(raw));
        if (target) return target;
      }
    } catch (error) {
      // Fall through to the URL backup below.
    }
    return targetFromResumeUrl();
  }

  function normalizePendingTarget(target) {
    const tx = Number(target?.tx);
    const ty = Number(target?.ty);
    const px = Number(target?.px);
    const py = Number(target?.py);
    const colorId = Number(target?.color?.id ?? target?.colorId);
    if (![tx, ty, px, py, colorId].every(Number.isFinite)) return null;
    if (tx < 0 || ty < 0 || px < 0 || py < 0 || px >= BM_AUTO.tileSize || py >= BM_AUTO.tileSize) return null;
    const paletteColor = BM_COLORS.find((color) => color.id === colorId);
    const storedColor = target?.color;
    const color = paletteColor || {
      id: colorId,
      premium: Boolean(storedColor?.premium),
      name: storedColor?.name || ("Color " + colorId),
      rgb: Array.isArray(storedColor?.rgb) ? storedColor.rgb.map(Number) : [0, 0, 0]
    };
    if (!Array.isArray(color.rgb) || color.rgb.length < 3 || !color.rgb.every(Number.isFinite)) return null;
    return {tx, ty, px, py, color};
  }

  function targetFromResumeUrl() {
    const params = new URL(location.href).searchParams;
    if (params.get("bmAutoResume") !== "1") return null;
    return normalizePendingTarget({
      tx: params.get("bmTx"),
      ty: params.get("bmTy"),
      px: params.get("bmPx"),
      py: params.get("bmPy"),
      colorId: params.get("bmColor")
    });
  }

  function addResumeUrlParams(url, target) {
    url.searchParams.set("bmAutoResume", "1");
    url.searchParams.set("bmTx", String(target.tx));
    url.searchParams.set("bmTy", String(target.ty));
    url.searchParams.set("bmPx", String(target.px));
    url.searchParams.set("bmPy", String(target.py));
    url.searchParams.set("bmColor", String(target.color.id));
  }

  function clearResumeUrlParams() {
    const url = new URL(location.href);
    let changed = false;
    for (const key of ["bmAutoResume", "bmTx", "bmTy", "bmPx", "bmPy", "bmColor"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      try {
        history.replaceState(history.state, "", url.toString());
      } catch (error) {}
    }
  }

  async function storePendingTarget(target) {
    const compact = JSON.stringify(compactTarget(target));
    await setPersistedValue(BM_AUTO.pendingTargetKey, compact);
    await setPersistedValue(BM_AUTO.resumeKey, "1");
  }

  async function clearPendingTarget() {
    await removePersistedValue(BM_AUTO.pendingTargetKey);
    await removePersistedValue(BM_AUTO.resumeKey);
    clearResumeUrlParams();
  }

  function getCspNonce() {
    try {
      const candidates = document.querySelectorAll("script[nonce], style[nonce]");
      for (const node of candidates) {
        const value = node.nonce || node.getAttribute("nonce");
        if (value) return value;
      }
    } catch (error) {}
    return "";
  }

  async function findPaintChunkUrl() {
    const cached = getPersistedValue(BM_AUTO.apiChunkKey);
    if (cached) {
      if (await looksLikeWplaceApiModule(cached)) return cached;
      await removePersistedValue(BM_AUTO.apiChunkKey);
    }
    for (const url of collectWplaceChunkUrls()) {
      if (await looksLikeWplaceApiModule(url)) {
        await setPersistedValue(BM_AUTO.apiChunkKey, url);
        return url;
      }
    }
    return null;
  }

  // CSP blocks eval()/Function(), so we cannot import the paint module from the
  // userscript sandbox. Instead inject a page-context <script type="module"> that
  // imports it (plain dynamic import is allowed by script-src 'self'), find the
  // paint api, and expose it as window.__bmPaint(jsonPayload) -> jsonResult.
  async function ensurePageBridge() {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    if (typeof page.__bmPaint === "function") return "ready";
    if (state.bridgePromise) return state.bridgePromise;
    if (state.moduleRetryAt && Date.now() < state.moduleRetryAt) return state.bridgeState;

    state.bridgePromise = (async () => {
      const chunkUrl = await findPaintChunkUrl();
      if (!chunkUrl) return "no-chunk";
      const nonce = getCspNonce();
      const code =
        "(async()=>{try{" +
        "const mod=await import(" + JSON.stringify(chunkUrl) + ");" +
        "const ok=(v)=>{try{if(!v||typeof v.paint!=='function')return false;const s=Function.prototype.toString.call(v.paint);return /(\\/paint|getHeaders|colorIdx|tiles)/.test(s);}catch(_){return false;}};" +
        "let api=ok(mod.a)?mod.a:null;" +
        "if(!api){for(const k in mod){try{const v=mod[k];" +
        "if(ok(v)){api=v;break;}" +
        "if(v&&typeof v==='object'){for(const j in v){try{if(ok(v[j])){api=v[j];break;}}catch(_){}}if(api)break;}" +
        "}catch(_){}}}" +
        "window.__bmWplaceMod=mod;window.__bmWplaceApi=api;" +
        "try{if(mod.j&&mod.j.map)window.__bmWplaceMap=mod.j.map;}catch(_){}" +
        "try{if(mod.j)mod.j.automatedClicks=true;}catch(_){}" +
        "window.__bmPaint=(json)=>new Promise((resolve)=>{let d=false;const fin=(o)=>{if(!d){d=true;resolve(JSON.stringify(o));}};" +
        "try{if(!window.__bmWplaceApi||typeof window.__bmWplaceApi.paint!=='function')return fin({ok:false,error:'no-api'});" +
        "Promise.resolve(window.__bmWplaceApi.paint(JSON.parse(json))).then(()=>fin({ok:true}),(e)=>fin({ok:false,error:String((e&&e.message)||e)}));" +
        "}catch(e){fin({ok:false,error:String((e&&e.message)||e)});}});" +
        "window.__bmBridgeState=api?'ready':'no-api';" +
        "}catch(e){window.__bmBridgeState='error:'+String((e&&e.message)||e);}})();";

      page.__bmBridgeState = "";
      try {
        const script = document.createElement("script");
        script.type = "module";
        if (nonce) script.nonce = nonce;
        script.textContent = code;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
      } catch (error) {
        return "inject-failed:" + String((error && error.message) || error);
      }

      const start = Date.now();
      while (Date.now() - start < 6000) {
        if (page.__bmBridgeState) break;
        await sleep(100);
      }
      const result = page.__bmBridgeState || "blocked";
      // A stale cached chunk url (after a site deploy) fails to import; forget it.
      if (typeof result === "string" && result.startsWith("error:")) {
        await removePersistedValue(BM_AUTO.apiChunkKey);
      }
      return result;
    })();

    try {
      state.bridgeState = await state.bridgePromise;
      if (typeof page.__bmPaint !== "function") {
        state.moduleRetryAt = Date.now() + 8000;
      }
      return state.bridgeState;
    } finally {
      state.bridgePromise = null;
    }
  }

  async function paintBatchDirect(targets) {
    if (!targets.length) return false;
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    await ensurePageBridge();
    if (typeof page.__bmPaint !== "function") return false;
    rememberMap(page.__bmWplaceMap);

    const payload = targets.map((target) => ({
      season: BM_AUTO.season,
      tile: [target.tx, target.ty],
      pixel: [target.px, target.py],
      colorIdx: target.color.id
    }));
    const json = JSON.stringify(payload);

    let result = await callBridgePaint(page, json);
    if (result.ok) {
      markRecentlyPainted(targets);
      return true;
    }
    const message = result.error || "";
    if (/security|pawtect|module|loaded|token|turnstile|charg/i.test(message)) {
      setStatus("Wplace security/token still loading; retrying direct paint…");
      await interruptibleSleep(2000);
      result = await callBridgePaint(page, json);
      if (result.ok) {
        markRecentlyPainted(targets);
        return true;
      }
    }
    if (message) setStatus("Direct paint failed: " + message);
    return false;
  }

  async function callBridgePaint(page, json) {
    try {
      const raw = await page.__bmPaint(json);
      return JSON.parse(raw);
    } catch (error) {
      return {ok: false, error: String((error && error.message) || error)};
    }
  }

  async function run() {
    await loadPixels(false);
    setStatus("Auto painter started.");
    updateStats();

    while (!state.stop) {
      const user = await fetchJson("/me");
      state.cooldownMs = Math.max(1000, Number((user && user.charges && user.charges.cooldownMs) || state.cooldownMs || 30000));
      const waitMs = chargesWaitMs(user);
      if (waitMs > 0) {
        updateEta();
        setStatus(chargeStatus(user, waitMs));
        await interruptibleSleep(waitMs);
        continue;
      }

      const chargeCount = availableCharges(user);
      const manual = readManualBatch();
      // Batch size = how many pixels you can paint right now (charges), capped by
      // the manual "pixels/batch" value when set. Empty manual = auto (all charges).
      let limit = manual > 0 ? Math.min(manual, chargeCount) : chargeCount;
      limit = Math.max(1, Math.min(BM_AUTO.maxBatchPixels, limit));

      const batch = await pickColorBatch(user, limit);
      if (!batch.length) {
        setStatus("Done: every available template pixel looks correct.");
        await setPersistedValue(BM_AUTO.activeKey, "0");
        updateEta();
        break;
      }

      const colorName = batch[0].color.name;
      let paintedDirect = false;
      try {
        paintedDirect = await paintBatchDirect(batch);
      } catch (error) {
        if ((error.message || "") === "Stopped") throw error;
        state.stats.errors++;
        setStatus("Direct paint error: " + (error.message || error) + ". Retrying…");
        updateStats();
        await interruptibleSleep(1500);
        continue;
      }
      if (paintedDirect) {
        state.noApiWarned = false;
        state.stats.attempts += batch.length;
        state.stats.painted += batch.length;
        setStatus("Painted " + batch.length + " " + colorName + " px in one request (charges " + chargeCount + ").");
        updateStats();
        await interruptibleSleep(BM_AUTO.clickPauseMs);
        continue;
      }

      // Direct paint API not available. Fall back to a single-pixel UI paint.
      // This works WITHOUT a reload when the map object is known. If neither the
      // API nor the map is available, only reload when the user opted in.
      const target = batch[0];
      const haveMap = Boolean(getKnownWplaceMap());
      if (!haveMap && !readAllowReload()) {
        if (!state.noApiWarned) {
          state.noApiWarned = true;
          setStatus("No fast paint API and no map yet. Open the site's paint menu once (click a pixel → Paint), or tick 'Allow reload'. Press Diag for details.");
        }
        await interruptibleSleep(2500);
        continue;
      }
      setStatus("Painting " + pixelKey(target) + " via UI" + (haveMap ? "" : " (reload)") + "…");
      try {
        await paintPixel(target);
        state.stats.attempts++;
        markRecentlyPainted([target]);
        await interruptibleSleep(BM_AUTO.afterPaintPauseMs);
        if (await tilePixelMatches(target)) {
          state.stats.painted++;
          setStatus("Painted " + pixelKey(target) + ".");
        } else {
          setStatus("Click sent for " + pixelKey(target) + "; tile not updated yet.");
        }
      } catch (error) {
        if ((error.message || "") === "Stopped") throw error;
        state.stats.errors++;
        setStatus("UI paint failed: " + (error.message || error) + ". Press Diag for details.");
        await interruptibleSleep(2500);
      }
      updateStats();
    }
  }

  async function paintPixel(target) {
    ensureNotStopped();
    closeOpenMenus();
    await selectMapPixel(target);
    ensureNotStopped();
    await openPaintPalette();
    ensureNotStopped();
    await selectPaletteColor(target.color.id);
    ensureNotStopped();
    await confirmPaint();
  }

  function closeOpenMenus() {
    document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", code: "Escape", bubbles: true}));
    document.dispatchEvent(new KeyboardEvent("keyup", {key: "Escape", code: "Escape", bubbles: true}));
  }

  async function selectMapPixel(target) {
    if (selectedCoordsMatch(target)) return;
    const map = await getWplaceMap();
    if (!map) return selectMapPixelViaReload(target);
    const lngLat = pixelToLngLat(target.tx * BM_AUTO.tileSize + target.px + 0.5, target.ty * BM_AUTO.tileSize + target.py + 0.5);
    const currentZoom = typeof map.getZoom === "function" ? map.getZoom() : BM_AUTO.minMapZoom;
    if (typeof map.jumpTo === "function") {
      map.jumpTo({center: [lngLat.lng, lngLat.lat], zoom: Math.max(currentZoom || 0, BM_AUTO.minMapZoom)});
    }
    await sleep(150);

    const canvas = typeof map.getCanvas === "function" ? map.getCanvas() : document.querySelector("canvas.maplibregl-canvas, canvas.mapboxgl-canvas");
    if (!canvas) throw new Error("Cannot find Wplace map canvas.");
    const point = typeof map.project === "function" ? map.project([lngLat.lng, lngLat.lat]) : {x: canvas.clientWidth / 2, y: canvas.clientHeight / 2};
    clickAt(canvas, point.x, point.y);
    try {
      await waitFor(() => selectedCoordsMatch(target), BM_AUTO.selectTimeoutMs, 60);
    } catch (error) {
      if ((error.message || "") === "Timed out waiting for page UI.") return selectMapPixelViaReload(target);
      throw error;
    }
  }

  async function selectMapPixelViaReload(target) {
    if (!readAllowReload()) {
      throw new Error("Could not select the pixel and 'Allow reload' is off.");
    }
    await storePendingTarget(target);
    const lngLat = pixelToLngLat(target.tx * BM_AUTO.tileSize + target.px + 0.5, target.ty * BM_AUTO.tileSize + target.py + 0.5);
    const url = new URL(location.href);
    url.searchParams.set("lat", String(lngLat.lat));
    url.searchParams.set("lng", String(lngLat.lng));
    url.searchParams.set("zoom", String(BM_AUTO.minMapZoom));
    url.searchParams.set("select", "1");
    addResumeUrlParams(url, target);
    setStatus("Map object is hidden by Wplace. Reloading at " + pixelKey(target) + "...");
    location.href = url.toString();
    return new Promise(() => {});
  }

  async function waitForSelectedPixelPanel(target) {
    try {
      await waitFor(() => {
        const selected = readSelectedCoords();
        if (selected) return selectedCoordsMatch(target);
        return findSelectedPaintButton();
      }, 30000, 150);
    } catch (error) {
      throw new Error("Wplace did not open the selected pixel panel after reload.");
    }
  }

  async function getWplaceMap() {
    const knownMap = getKnownWplaceMap();
    if (knownMap) return knownMap;
    const mod = await loadWplaceModule();
    if (rememberMap(mod?.j?.map)) return state.map;
    return getKnownWplaceMap();
  }

  function getKnownWplaceMap() {
    const page = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    if (isMapLike(state.map)) return state.map;
    if (isMapLike(page.__bmWplaceMap)) return page.__bmWplaceMap;
    if (isMapLike(page.__bmAutoWplaceMap)) return page.__bmAutoWplaceMap;
    if (page.Ba && page.Ba.map) return page.Ba.map;
    if (page.__wplaceMap) return page.__wplaceMap;
    try {
      for (const key of Object.keys(page)) {
        const value = page[key];
        if (value && typeof value === "object" && typeof value.jumpTo === "function" && typeof value.project === "function" && typeof value.getCanvas === "function") {
          return value;
        }
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function pixelToLngLat(pixelX, pixelY) {
    const originShift = 20037508.342789244;
    const initialResolution = 2 * originShift / BM_AUTO.tileSize;
    const resolution = initialResolution / Math.pow(2, BM_AUTO.worldZoom);
    const meterX = pixelX * resolution - originShift;
    const meterY = originShift - pixelY * resolution;
    const lng = meterX / originShift * 180;
    let lat = meterY / originShift * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return {lng, lat};
  }

  function clickAt(element, x, y) {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + x;
    const clientY = rect.top + y;
    for (const type of ["pointermove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const EventClass = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
      element.dispatchEvent(new EventClass(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type.endsWith("down") ? 1 : 0,
        clientX,
        clientY
      }));
    }
  }

  function selectedCoordsMatch(target) {
    const selected = readSelectedCoords();
    return selected && selected.tx === target.tx && selected.ty === target.ty && selected.px === target.px && selected.py === target.py;
  }

  function readSelectedCoords() {
    const ids = {tx: "bm-Y", ty: "bm-Z", px: "bm-U", py: "bm-V"};
    const values = {};
    for (const [name, id] of Object.entries(ids)) {
      const text = document.getElementById(id)?.textContent || "";
      const match = text.match(/-?\d+/);
      if (!match) return null;
      values[name] = Number(match[0]);
    }
    return values;
  }

  async function openPaintPalette() {
    if (isVisible(document.querySelector("#color-1"))) return;
    const button = findSelectedPaintButton() || findAnyPaintButton();
    if (!button) throw new Error("Cannot find the first Paint button for the selected pixel.");
    clickElement(button);
    await waitFor(() => isVisible(document.querySelector("#color-1")), BM_AUTO.paletteTimeoutMs, 50);
    await sleep(BM_AUTO.clickPauseMs);
  }

  async function selectPaletteColor(colorId) {
    const colorButton = await waitFor(() => {
      const button = document.getElementById("color-" + colorId);
      return isVisible(button) ? button : null;
    }, BM_AUTO.paletteTimeoutMs, 50);
    clickElement(colorButton);
    await sleep(BM_AUTO.clickPauseMs);
  }

  async function confirmPaint() {
    const button = await waitFor(() => findConfirmPaintButton(), BM_AUTO.paletteTimeoutMs, 50);
    clickElement(button);
    await sleep(BM_AUTO.clickPauseMs);
  }

  function findSelectedPaintButton() {
    return visibleButtons().find(button =>
      button.classList.contains("btn-primary") &&
      button.classList.contains("w-full") &&
      paintTextPattern.test(button.textContent || "")
    ) || null;
  }

  function findConfirmPaintButton() {
    const buttons = visibleButtons();
    return buttons.find(button =>
      button.classList.contains("btn-primary") &&
      !button.classList.contains("w-full") &&
      paintTextPattern.test(button.textContent || "") &&
      (button.querySelector("canvas") || /\bbtn-(lg|xl)\b/.test(button.className))
    ) || buttons.find(button =>
      button.classList.contains("btn-primary") &&
      !button.classList.contains("w-full") &&
      paintTextPattern.test(button.textContent || "")
    ) || null;
  }

  function findAnyPaintButton() {
    return visibleButtons().find(button =>
      button.classList.contains("btn-primary") &&
      paintTextPattern.test(button.textContent || "")
    ) || null;
  }

  function visibleButtons() {
    return Array.from(document.querySelectorAll("button")).filter(isVisible);
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && !element.disabled;
  }

  function clickElement(element) {
    element.scrollIntoView({block: "center", inline: "center"});
    const rect = element.getBoundingClientRect();
    clickAt(element, rect.width / 2, rect.height / 2);
  }

  async function waitFor(predicate, timeoutMs, intervalMs) {
    const start = Date.now();
    let lastError = null;
    while (!state.stop && Date.now() - start < timeoutMs) {
      try {
        const value = predicate();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(intervalMs);
    }
    if (state.stop) throw new Error("Stopped");
    if (lastError) throw lastError;
    throw new Error("Timed out waiting for page UI.");
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, {once: true});
    } else {
      fn();
    }
  }

  ready(createPanel);
})();

(()=>{var t=t=>{throw TypeError(t)},e=(e,i,n)=>i.has(e)?t("Cannot add the same private member more than once"):i instanceof WeakSet?i.add(e):i.set(e,n),i=(e,i,n)=>(((e,i)=>{i.has(e)||t("Cannot access private method")})(e,i),n);function n(t){return new Promise(e=>setTimeout(e,t))}function s(t){return(new Intl.NumberFormat).format(t)}function o(t){return new Intl.NumberFormat(void 0,{style:"percent",t:2,i:2}).format(t)}function a(t){return t.toLocaleString(void 0,{o:"long",l:"numeric",h:"2-digit",m:"2-digit",u:"2-digit"})}function r(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function l(...t){(0,console.log)(...t)}function h(...t){(0,console.error)(...t)}function c(...t){(0,console.warn)(...t)}function m(t,e){if(0===t)return e[0];let i="";const n=e.length;for(;t>0;)i=e[t%n]+i,t=Math.floor(t/n);return i}function d(t,e){let i=0;const n=e.length;for(const s of t){const t=e.indexOf(s);-1==t&&h(`Invalid character '${s}' encountered whilst decoding! Is the decode alphabet/base incorrect?`),i=i*n+t}return i}function u(t){let e="";for(let i=0;i<t.length;i++)e+=String.fromCharCode(t[i]);return btoa(e)}function b(t){const e=atob(t),i=new Uint8Array(e.length);for(let t=0;t<e.length;t++)i[t]=e.charCodeAt(t);return i}function p(t){const e=t.map(t=>(t/=255)<=.03928?t/12.92:Math.pow((t+.055)/1.055,2.4));return.2126*e[0]+.7152*e[1]+.0722*e[2]}function f(t,e,i){return Array.isArray(t)&&([t,e,i]=t),(1<<24|t<<16|e<<8|i).toString(16).slice(1)}var g,w,x,y,v,C=[{id:0,premium:!1,name:"Transparent",rgb:[0,0,0]},{id:1,premium:!1,name:"Black",rgb:[0,0,0]},{id:2,premium:!1,name:"Dark Gray",rgb:[60,60,60]},{id:3,premium:!1,name:"Gray",rgb:[120,120,120]},{id:4,premium:!1,name:"Light Gray",rgb:[210,210,210]},{id:5,premium:!1,name:"White",rgb:[255,255,255]},{id:6,premium:!1,name:"Deep Red",rgb:[96,0,24]},{id:7,premium:!1,name:"Red",rgb:[237,28,36]},{id:8,premium:!1,name:"Orange",rgb:[255,127,39]},{id:9,premium:!1,name:"Gold",rgb:[246,170,9]},{id:10,premium:!1,name:"Yellow",rgb:[249,221,59]},{id:11,premium:!1,name:"Light Yellow",rgb:[255,250,188]},{id:12,premium:!1,name:"Dark Green",rgb:[14,185,104]},{id:13,premium:!1,name:"Green",rgb:[19,230,123]},{id:14,premium:!1,name:"Light Green",rgb:[135,255,94]},{id:15,premium:!1,name:"Dark Teal",rgb:[12,129,110]},{id:16,premium:!1,name:"Teal",rgb:[16,174,166]},{id:17,premium:!1,name:"Light Teal",rgb:[19,225,190]},{id:18,premium:!1,name:"Dark Blue",rgb:[40,80,158]},{id:19,premium:!1,name:"Blue",rgb:[64,147,228]},{id:20,premium:!1,name:"Cyan",rgb:[96,247,242]},{id:21,premium:!1,name:"Indigo",rgb:[107,80,246]},{id:22,premium:!1,name:"Light Indigo",rgb:[153,177,251]},{id:23,premium:!1,name:"Dark Purple",rgb:[120,12,153]},{id:24,premium:!1,name:"Purple",rgb:[170,56,185]},{id:25,premium:!1,name:"Light Purple",rgb:[224,159,249]},{id:26,premium:!1,name:"Dark Pink",rgb:[203,0,122]},{id:27,premium:!1,name:"Pink",rgb:[236,31,128]},{id:28,premium:!1,name:"Light Pink",rgb:[243,141,169]},{id:29,premium:!1,name:"Dark Brown",rgb:[104,70,52]},{id:30,premium:!1,name:"Brown",rgb:[149,104,42]},{id:31,premium:!1,name:"Beige",rgb:[248,178,119]},{id:32,premium:!0,name:"Medium Gray",rgb:[170,170,170]},{id:33,premium:!0,name:"Dark Red",rgb:[165,14,30]},{id:34,premium:!0,name:"Light Red",rgb:[250,128,114]},{id:35,premium:!0,name:"Dark Orange",rgb:[228,92,26]},{id:36,premium:!0,name:"Light Tan",rgb:[214,181,148]},{id:37,premium:!0,name:"Dark Goldenrod",rgb:[156,132,49]},{id:38,premium:!0,name:"Goldenrod",rgb:[197,173,49]},{id:39,premium:!0,name:"Light Goldenrod",rgb:[232,212,95]},{id:40,premium:!0,name:"Dark Olive",rgb:[74,107,58]},{id:41,premium:!0,name:"Olive",rgb:[90,148,74]},{id:42,premium:!0,name:"Light Olive",rgb:[132,197,115]},{id:43,premium:!0,name:"Dark Cyan",rgb:[15,121,159]},{id:44,premium:!0,name:"Light Cyan",rgb:[187,250,242]},{id:45,premium:!0,name:"Light Blue",rgb:[125,199,255]},{id:46,premium:!0,name:"Dark Indigo",rgb:[77,49,184]},{id:47,premium:!0,name:"Dark Slate Blue",rgb:[74,66,132]},{id:48,premium:!0,name:"Slate Blue",rgb:[122,113,196]},{id:49,premium:!0,name:"Light Slate Blue",rgb:[181,174,241]},{id:50,premium:!0,name:"Light Brown",rgb:[219,164,99]},{id:51,premium:!0,name:"Dark Beige",rgb:[209,128,81]},{id:52,premium:!0,name:"Light Beige",rgb:[255,197,165]},{id:53,premium:!0,name:"Dark Peach",rgb:[155,82,73]},{id:54,premium:!0,name:"Peach",rgb:[209,128,120]},{id:55,premium:!0,name:"Light Peach",rgb:[250,182,164]},{id:56,premium:!0,name:"Dark Tan",rgb:[123,99,82]},{id:57,premium:!0,name:"Tan",rgb:[156,132,107]},{id:58,premium:!0,name:"Dark Slate",rgb:[51,57,65]},{id:59,premium:!0,name:"Slate",rgb:[109,117,141]},{id:60,premium:!0,name:"Light Slate",rgb:[179,185,209]},{id:61,premium:!0,name:"Dark Stone",rgb:[109,100,63]},{id:62,premium:!0,name:"Stone",rgb:[148,140,107]},{id:63,premium:!0,name:"Light Stone",rgb:[205,197,158]}],M=class{constructor(t,i){e(this,g),this.name=t,this.version=i,this.p=null,this.v=null,this.C="bm-r",this.M=null,this.T=null,this.$=[]}S(t){this.p=t}k(t){this.v=t}D(){return this.$.length>0&&(this.T=this.$.pop()),this}L(t){t?.appendChild(this.M),this.M=null,this.T=null,this.$=[]}H(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"div",{},t)),this}N(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"p",{},t)),this}O(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"small",{},t)),this}B(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"span",{},t)),this}I(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"details",{},t)),this}P(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"summary",{},t)),this}A(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"img",{},t)),this}W(t,e={},n=()=>{}){return n(this,i(this,g,w).call(this,"h"+t,{},e)),this}V(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"hr",{},t)),this}_(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"br",{},t)),this}F(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"form",{},t)),this}U(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"fieldset",{},t)),this}G(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"legend",{},t)),this}R(t={},e=()=>{}){const n={};t.textContent?(n.textContent=t.textContent,delete t.textContent):t.innerHTML&&(n.innerHTML=t.innerHTML,delete t.textContent);const s=i(this,g,w).call(this,"label",n),o=i(this,g,w).call(this,"input",{type:"checkbox"},t);return s.insertBefore(o,s.firstChild),this.D(),e(this,s,o),this}j(t={},e=()=>{}){const n=i(this,g,w).call(this,"label",{textContent:t.textContent??"",for:t.id??""});return delete t.textContent,this.D(),e(this,n,i(this,g,w).call(this,"select",{},t)),this}Y(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"option",{},t)),this}X(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"ol",{},t)),this}J(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"ul",{},t)),this}q(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"menu",{},t)),this}Z(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"li",{},t)),this}K(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"table",{},t)),this}tt(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"caption",{},t)),this}et(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"thead",{},t)),this}it(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"tbody",{},t)),this}nt(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"tfoot",{},t)),this}st(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"tr",{},t)),this}ot(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"th",{},t)),this}rt(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"td",{},t)),this}lt(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"button",{},t)),this}ht(t={},e=()=>{}){const n=t.title??t.textContent??"Help: No info";delete t.textContent,t.title=`Help: ${n}`;const s={textContent:"?",className:"bm-10",onclick:()=>{this.ct(this.C,n)}};return e(this,i(this,g,w).call(this,"button",s,t)),this}dt(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"input",{},t)),this}ut(t={},e=()=>{}){const n=t.textContent??"";delete t.textContent;const s=i(this,g,w).call(this,"div"),o=i(this,g,w).call(this,"input",{type:"file",tabindex:"-1","aria-hidden":"true"},t);this.D();const a=i(this,g,w).call(this,"button",{textContent:n});return this.D(),this.D(),a.addEventListener("click",()=>{o.click()}),o.addEventListener("change",()=>{a.style.maxWidth=`${a.offsetWidth}px`,o.files.length>0?a.textContent=o.files[0].name:a.textContent=n}),e(this,s,o,a),this}bt(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"textarea",{},t)),this}ft(t={},e=()=>{}){return e(this,i(this,g,w).call(this,"div",{class:"bm-S"},t)),this}gt(t=Date.now(),e=500,n={},s=()=>{}){const o="bm--",a=n?.id||o+"-"+crypto.randomUUID().slice(0,8),r={class:o},l=i(this,g,w).call(this,"time",r,n);return l.id=a,l.dataset.endDate=t,setInterval(()=>{if(!l.isConnected)return;const t=Math.max(l.dataset.endDate-Date.now(),0),e=Math.floor(t/1e3),i=Math.floor(e/3600),n=Math.floor(e%60),s=Math.floor(e%3600/60);l.setAttribute("datetime",`PT${i}H${s}M${n}S`),l.textContent=String(i).padStart(2,"0")+":"+String(s).padStart(2,"0")+":"+String(n).padStart(2,"0")},e),s(this,l),this}ct(t,e,i=!1){const n=document.getElementById(t.replace(/^#/,""));n&&(n instanceof HTMLInputElement?n.value=e:i?n.textContent=e:n.innerHTML=e)}wt(t){if(t.disabled)return;t.disabled=!0,t.style.textDecoration="none";const e=t.closest(".bm-W"),i=t.closest(".bm-S"),n=e.querySelector("h1"),s=e.querySelector(".bm-m");if(e.parentElement.append(e),"expanded"==t.dataset.buttonStatus){s.style.height=s.scrollHeight+"px",e.style.width=e.scrollWidth+"px",s.style.height="0",s.addEventListener("transitionend",function e(){s.style.display="none",t.disabled=!1,t.style.textDecoration="",s.removeEventListener("transitionend",e)});const i=n.cloneNode(!0),o=i.textContent;t.nextElementSibling.appendChild(i),t.textContent="▶",t.dataset.buttonStatus="collapsed",t.ariaLabel=`Unminimize window "${o}"`}else{const n=i.querySelector("h1"),o=n.textContent;n.remove(),s.style.display="",s.style.height="0",e.style.width="",s.style.height=s.scrollHeight+"px",s.addEventListener("transitionend",function e(){s.style.height="",t.disabled=!1,t.style.textDecoration="",s.removeEventListener("transitionend",e)}),t.textContent="▼",t.dataset.buttonStatus="expanded",t.ariaLabel=`Minimize window "${o}"`}}xt(t,e){const i=document.querySelector(t),n=document.querySelector(e);if(!i||!n)return void this.yt(`Can not drag! ${i?"":"moveMe"} ${i||n?"":"and "}${n?"":"iMoveThings "}was not found!`);let s,o=!1,a=0,r=null,l=0,h=0,c=0,m=0,d=null;const u=()=>{if(o){const t=Math.abs(l-c),e=Math.abs(h-m);(t>.5||e>.5)&&(l=c,h=m,i.style.transform=`translate(${l}px, ${h}px)`,i.style.left="0px",i.style.top="0px",i.style.right=""),r=requestAnimationFrame(u)}},b=(t,e)=>{o=!0,d=i.getBoundingClientRect(),s=t-d.left,a=e-d.top;const b=window.getComputedStyle(i).transform;if(b&&"none"!==b){const t=new DOMMatrix(b);l=t.m41,h=t.m42}else l=d.left,h=d.top;c=l,m=h,document.body.style.userSelect="none",n.classList.add("bm-M"),document.addEventListener("mousemove",f),document.addEventListener("touchmove",g,{passive:!1}),document.addEventListener("mouseup",p),document.addEventListener("touchend",p),document.addEventListener("touchcancel",p),r&&cancelAnimationFrame(r),u()},p=()=>{o=!1,r&&(cancelAnimationFrame(r),r=null),document.body.style.userSelect="",n.classList.remove("bm-M"),document.removeEventListener("mousemove",f),document.removeEventListener("touchmove",g),document.removeEventListener("mouseup",p),document.removeEventListener("touchend",p),document.removeEventListener("touchcancel",p)},f=t=>{o&&d&&(c=t.clientX-s,m=t.clientY-a)},g=t=>{if(o&&d){const e=t.touches[0];if(!e)return;c=e.clientX-s,m=e.clientY-a,t.preventDefault()}};n.addEventListener("mousedown",function(t){t.preventDefault(),b(t.clientX,t.clientY)}),n.addEventListener("touchstart",function(t){const e=t?.touches?.[0];e&&(b(e.clientX,e.clientY),t.preventDefault())},{passive:!1})}vt(t){(0,console.info)(`${this.name}: ${t}`),this.ct(this.C,"Status: "+t,!0)}yt(t){(0,console.error)(`${this.name}: ${t}`),this.ct(this.C,"Error: "+t,!0)}};g=new WeakSet,w=function(t,e={},n={}){const s=document.createElement(t);this.M?(this.T?.appendChild(s),this.$.push(this.T),this.T=s):(this.M=s,this.T=s);for(const[t,n]of Object.entries(e))i(this,g,x).call(this,s,t,n);for(const[t,e]of Object.entries(n))i(this,g,x).call(this,s,t,e);return s},x=function(t,e,i){"class"==e?t.classList.add(...i.split(/\s+/)):"for"==e?t.htmlFor=i:"tabindex"==e?t.tabIndex=Number(i):"readonly"==e?t.readOnly="true"==i||"1"==i:"maxlength"==e?t.maxLength=Number(i):e.startsWith("data")?t.dataset[e.slice(5).split("-").map((t,e)=>0==e?t:t[0].toUpperCase()+t.slice(1)).join("")]=i:e.startsWith("aria")?t.setAttribute(e,i):t[e]=i};var T,$,S,k,D,L=class extends M{constructor(t,i){super(t,i),e(this,y),this.window=null,this.Ct="bm-l",this.Mt=document.body}Tt(){document.querySelector(`#${this.Ct}`)?document.querySelector(`#${this.Ct}`).remove():(this.window=this.H({id:this.Ct,class:"bm-W"}).ft().lt({class:"bm-s",textContent:"▼","aria-label":'Minimize window "Color Filter"',"data-button-status":"expanded"},(t,e)=>{e.onclick=()=>t.wt(e),e.ontouchend=()=>{e.click()}}).D().H().D().H({class:"bm-D"}).lt({class:"bm-s",textContent:"✖","aria-label":'Close window "Color Filter"'},(t,e)=>{e.onclick=()=>{document.querySelector(`#${this.Ct}`)?.remove()},e.ontouchend=()=>{e.click()}}).D().D().D().H({class:"bm-m"}).H({class:"bm-L bm-h"}).W(1,{textContent:"Settings"}).D().D().V().D().N({textContent:"Settings take 5 seconds to save."}).D().H({class:"bm-L bm-H"},(t,e)=>{this.$t(),this.St()}).D().D().D().L(this.Mt),this.xt(`#${this.Ct}.bm-W`,`#${this.Ct} .bm-S`))}$t(){i(this,y,v).call(this,"Pixel Highlight")}St(){i(this,y,v).call(this,"Template")}};y=new WeakSet,v=function(t){this.window=this.H({class:"bm-L"}).W(2,{textContent:t}).D().V().D().N({innerHTML:`An error occured loading the ${t} category. <code>SettingsManager</code> failed to override the ${t} function inside <code>WindowSettings</code>.`}).D().D()},T=new WeakSet,$=function(t,e){t.disabled=!0;const i=t.dataset.status,n=this.kt?.highlight??[[1,0,1],[2,0,0],[1,-1,0],[1,1,0],[1,0,-1]];let s=[2,0,0];const o=n;switch(i){case"Disabled":t.dataset.status="Incorrect",t.ariaLabel="Sub-pixel incorrect",s=[1,...e];break;case"Incorrect":t.dataset.status="Template",t.ariaLabel="Sub-pixel template",s=[2,...e];break;case"Template":t.dataset.status="Disabled",t.ariaLabel="Sub-pixel disabled",s=[0,...e]}const a=n.findIndex(([,t,e])=>t==s[1]&&e==s[2]);0!=s[0]?-1!=a?o[a]=s:o.push(s):-1!=a&&o.splice(a,1),this.kt.highlight=o,t.disabled=!1},S=async function(t){const e=document.querySelectorAll(".bm-3 button");for(const t of e)t.disabled=!0;let i=[0,0,0,0,2,0,0,0,0];switch(t){case"Cross":i=[0,1,0,1,2,1,0,1,0];break;case"X":i=[1,0,1,0,2,0,1,0,1];break;case"Full":i=[2,2,2,2,2,2,2,2,2]}const s=document.querySelector(".bm-n")?.childNodes??[];for(let t=0;t<s.length;t++){const e=s[t];let o=e.dataset.status;o="Disabled"!=o?"Incorrect"!=o?2:1:0;let a=i[t]-o;if(0!=a&&(a+=a<0?3:0,e.click(),2==a)){for(let t=0;t<200&&e.disabled;t+=10)await n(10);e.click()}}for(const t of e)t.disabled=!1};var H=class{constructor({displayName:t="My template",Dt:i=0,Lt:n="",url:s="",file:o=null,coords:a=null,Ht:r=null,Nt:l={},Ot:h=1e3}={}){e(this,k),this.displayName=t,this.Dt=i,this.Lt=n,this.url=s,this.file=o,this.coords=a,this.Ht=r,this.Nt=l,this.Ot=h,this.Bt={total:0,colors:new Map},this.It=!0,this.Pt=!1}async At(t,e,n,s){this.It=n,this.Pt=s;const o=await createImageBitmap(this.file),a=o.width,r=o.height;this.Ot=t;const l={},h={},c=new OffscreenCanvas(this.Ot,this.Ot),m=c.getContext("2d",{willReadFrequently:!0}),d=new OffscreenCanvas(this.Ot,this.Ot),b=d.getContext("2d",{willReadFrequently:!0});b.globalCompositeOperation="destination-over",c.width=a,c.height=r,m.imageSmoothingEnabled=!1,m.drawImage(o,0,0);let p=Date.now();const f=i(this,k,D).call(this,m.getImageData(0,0,a,r),e);let g=0;for(const[t,e]of f)0!=t&&(g+=e);this.Bt={total:g,colors:f},p=Date.now();const w=new OffscreenCanvas(3,3),x=w.getContext("2d");x.clearRect(0,0,3,3),x.fillStyle="white",x.fillRect(1,1,1,1);for(let t=this.coords[3];t<r+this.coords[3];){const e=Math.min(this.Ot-t%this.Ot,r-(t-this.coords[3]));for(let i=this.coords[2];i<a+this.coords[2];){const s=Math.min(this.Ot-i%this.Ot,a-(i-this.coords[2]));if(n&&!this.Wt({Vt:o,_t:[i-this.coords[2],t-this.coords[3],s,e],zt:d,Ft:b})){i+=s;continue}const r=3*s,p=3*e;c.width=r,c.height=p,m.imageSmoothingEnabled=!1,m.clearRect(0,0,r,p),m.drawImage(o,i-this.coords[2],t-this.coords[3],s,e,0,0,3*s,3*e),m.save(),m.globalCompositeOperation="destination-in",m.fillStyle=m.createPattern(w,"repeat"),m.fillRect(0,0,r,p),m.restore();const f=m.getImageData(0,0,r,p),g=`${(this.coords[0]+Math.floor(i/1e3)).toString().padStart(4,"0")},${(this.coords[1]+Math.floor(t/1e3)).toString().padStart(4,"0")},${(i%1e3).toString().padStart(3,"0")},${(t%1e3).toString().padStart(3,"0")}`;this.Nt[g]=new Uint32Array(f.data.buffer),l[g]=await createImageBitmap(c);const x=await c.convertToBlob(),y=await x.arrayBuffer(),v=Array.from(new Uint8Array(y));h[g]=u(v),i+=s}t+=e}return{Ut:l,Gt:h}}Wt({Vt:t,_t:e,zt:i,Ft:n}){Date.now();const s=[[0,1],[1,0],[0,-2],[-2,0],[0,4],[4,0],[0,-8],[-8,0],[0,16],[16,0],[0,-32],[-32,0]],o=e[2],a=e[3];if(i.width=o,i.height=a,n.clearRect(0,0,o,a),this.Pt)n.drawImage(t,...e,0,0,10,10);else{n.drawImage(t,...e,0,0,o,a);for(const[t,e]of s)n.drawImage(i,0,0,o,a,t,e,o,a);n.drawImage(i,0,0,o,a,0,0,10,10)}const r=n.getImageData(0,0,10,10),l=new Uint32Array(r.data.buffer);for(const t of l)if(t)return!0;return!1}Rt(){let t=[1/0,1/0,1/0,1/0];Object.keys(this.Ht).sort().forEach((e,i)=>{const[n,s,o,a]=e.split(",").map(Number);(s<t[1]||s==t[1]&&n<t[0])&&(t=[n,s,o,a])}),this.coords=t}};k=new WeakSet,D=function(t,e){const i=new Uint32Array(t.data.buffer),{palette:n,jt:s}=e,o=new Map;for(let t=0;t<i.length;t++){const e=i[t];let n=-2;n=e>>>24==0?0:s.get(e)??-2;const a=o.get(n);o.set(n,a?a+1:1)}return o};var N=class{constructor(){this.Et=Math.ceil(80/1300*window.innerWidth),this.Yt=C.slice(1)}Xt(t){const e=document.createElement("div");for(let t=0;t<this.Et;t++){const t=document.createElement("confetti-piece");t.style.setProperty("--x",100*Math.random()+"vw"),t.style.setProperty("--delay",2*Math.random()+"s"),t.style.setProperty("--duration",3+3*Math.random()+"s"),t.style.setProperty("--rot",360*Math.random()+"deg"),t.style.setProperty("--size",6+6*Math.random()+"px"),t.style.backgroundColor=`rgb(${this.Yt[Math.floor(Math.random()*this.Yt.length)].rgb.join(",")})`,t.onanimationend=()=>{t.parentNode.childElementCount<=1?t.parentNode.remove():t.remove()},e.appendChild(t)}t.appendChild(e)}},O=class extends HTMLElement{};customElements.define("confetti-piece",O);var B,I,P,A,W,V,_,z,F,U=class extends M{constructor(t,e){super(t,e),this.window=null,this.Ct="bm-o",this.Mt=document.body}Tt(){document.querySelector(`#${this.Ct}`)?document.querySelector(`#${this.Ct}`).remove():(this.window=this.H({id:this.Ct,class:"bm-W"},(t,e)=>{}).ft().lt({class:"bm-s",textContent:"▼","aria-label":'Minimize window "Credits"',"data-button-status":"expanded"},(t,e)=>{e.onclick=()=>t.wt(e),e.ontouchend=()=>{e.click()}}).D().H().D().lt({class:"bm-s",textContent:"✖","aria-label":'Close window "Credits"'},(t,e)=>{e.onclick=()=>{document.querySelector(`#${this.Ct}`)?.remove()},e.ontouchend=()=>{e.click()}}).D().D().H({class:"bm-m"}).H({class:"bm-L bm-h"}).W(1,{textContent:"Credits"}).D().D().V().D().H({class:"bm-L bm-H"}).B({role:"img","aria-label":this.name}).B({innerHTML:"\n██████╗ ██╗     ██╗   ██╗███████╗\n██╔══██╗██║     ██║   ██║██╔════╝\n██████╔╝██║     ██║   ██║█████╗  \n██╔══██╗██║     ██║   ██║██╔══╝  \n██████╔╝███████╗╚██████╔╝███████╗\n╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝\n\n███╗   ███╗ █████╗ ██████╗ ██████╗ ██╗     ███████╗\n████╗ ████║██╔══██╗██╔══██╗██╔══██╗██║     ██╔════╝\n██╔████╔██║███████║██████╔╝██████╔╝██║     █████╗  \n██║╚██╔╝██║██╔══██║██╔══██╗██╔══██╗██║     ██╔══╝  \n██║ ╚═╝ ██║██║  ██║██║  ██║██████╔╝███████╗███████╗\n╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝\n",class:"bm-_","aria-hidden":"true"}).D().D()._().D().V().D()._().D().B({textContent:'"Blue Marble" userscript is made by SwingTheVine.'}).D()._().D().B({innerHTML:'The <a href="https://bluemarble.lol/" target="_blank" rel="noopener noreferrer">Blue Marble Website</a> is made by <a href="https://github.com/crqch" target="_blank" rel="noopener noreferrer">crqch</a>.'}).D()._().D().B({textContent:`The Blue Marble Website used until ${a(new Date(175606932e4))} was made by Camille Daguin.`}).D()._().D().B({textContent:'The favicon "Blue Marble" is owned by NASA. (The image of the Earth is owned by NASA)'}).D()._().D().B({textContent:"Special Thanks:"}).D().J().Z({textContent:"Espresso, Meqa, and Robot for moderating SwingTheVine's community."}).D().Z({innerHTML:'nof, <a href="https://github.com/TouchedByDarkness" target="_blank" rel="noopener noreferrer">darkness</a> for creating similar userscripts!'}).D().Z({innerHTML:'<a href="https://wondapon.net/" target="_blank" rel="noopener noreferrer">Wonda</a> for the Blue Marble banner image!'}).D().Z({innerHTML:'<a href="https://github.com/BullStein" target="_blank" rel="noopener noreferrer">BullStein</a>, <a href="https://github.com/allanf181" target="_blank" rel="noopener noreferrer">allanf181</a> for being early beta testers!'}).D().Z({innerHTML:'guidu_ and <a href="https://github.com/Nick-machado" target="_blank" rel="noopener noreferrer">Nick-machado</a> for the original "Minimize" Button code!'}).D().Z({innerHTML:'Nomad and <a href="https://www.youtube.com/@gustav_vv" target="_blank" rel="noopener noreferrer">Gustav</a> for the tutorials!'}).D().Z({innerHTML:'<a href="https://github.com/cfpwastaken" target="_blank" rel="noopener noreferrer">cfp</a> for creating the template overlay that Blue Marble was based on!'}).D().Z({innerHTML:'<a href="https://forcenetwork.cloud/" target="_blank" rel="noopener noreferrer">Force Network</a> for hosting the <a href="https://github.com/SwingTheVine/Wplace-TelemetryServer" target="_blank" rel="noopener noreferrer">telemetry server</a>!'}).D().Z({innerHTML:'<a href="https://thebluecorner.net" target="_blank" rel="noopener noreferrer">TheBlueCorner</a> for getting me interested in online pixel canvases!'}).D().D()._().D().B({innerHTML:'<a href="https://ko-fi.com/swingthevine" target="_blank" rel="noopener noreferrer">Donators</a>:'}).D().J().Z({textContent:"Soultree"}).D().Z({textContent:"Espresso"}).D().Z({textContent:"BEST FAN"}).D().Z({textContent:"FuchsDresden"}).D().Z({textContent:"Jack"}).D().Z({textContent:"raiken_au"}).D().Z({textContent:"Jacob"}).D().Z({textContent:"StupidOne"}).D().Z({textContent:"2 Anonymous Supporters"}).D().D().D().D().D().L(this.Mt),this.xt(`#${this.Ct}.bm-W`,`#${this.Ct} .bm-S`))}},G=class extends M{constructor(t){super(t.name,t.version),e(this,B),this.window=null,this.Ct="bm-t",this.Jt="bm-E",this.Mt=document.body,this.qt=t.p?.qt,this.Zt='<svg viewBox="0 .5 6 3"><path d="M0,2Q3-1 6,2Q3,5 0,2H2A1,1 0 1 0 3,1Q3,2 2,2"/></svg>',this.Qt='<svg viewBox="0 1 12 6"><mask id="a"><path d="M0,0H12V8L0,2" fill="#fff"/></mask><path d="M0,4Q6-2 12,4Q6,10 0,4H4A2,2 0 1 0 6,2Q6,4 4,4ZM1,2L10,6.5L9.5,7L.5,2.5" mask="url(#a)"/></svg>';const{palette:i,jt:n}=this.qt.Kt;this.palette=i,this.te=0,this.ee=0,this.ie=new Map,this.ne=new Map,this.se=0,this.oe=0,this.timeRemaining=0,this.ae="",this.sortPrimary="id",this.sortSecondary="ascending",this.showUnused=!1}Tt(){if(document.querySelector(`#${this.Ct}`))return void document.querySelector(`#${this.Ct}`).remove();this.window=this.H({id:this.Ct,class:"bm-W"},(t,e)=>{}).ft().lt({class:"bm-s",textContent:"▼","aria-label":'Minimize window "Color Filter"',"data-button-status":"expanded"},(t,e)=>{e.onclick=()=>t.wt(e),e.ontouchend=()=>{e.click()}}).D().H().D().H({class:"bm-D"}).lt({class:"bm-s",textContent:"🗗","aria-label":'Switch to windowed mode for "Color Filter"'},(t,e)=>{e.onclick=()=>{document.querySelector(`#${this.Ct}`)?.remove(),this.re()},e.ontouchend=()=>{e.click()}}).D().lt({class:"bm-s",textContent:"✖","aria-label":'Close window "Color Filter"'},(t,e)=>{e.onclick=()=>{document.querySelector(`#${this.Ct}`)?.remove()},e.ontouchend=()=>{e.click()}}).D().D().D().H({class:"bm-m"}).H({class:"bm-L bm-h"}).W(1,{textContent:"Color Filter"}).D().D().V().D().H({class:"bm-L bm-x bm-h",style:"gap: 1.5ch;"}).lt({textContent:"Hide All Colors"},(t,e)=>{e.onclick=()=>i(this,B,A).call(this,!1)}).D().lt({textContent:"Refresh Data"},(t,e)=>{e.onclick=()=>{e.disabled=!0,this.le(),e.disabled=!1}}).D().lt({textContent:"Show All Colors"},(t,e)=>{e.onclick=()=>i(this,B,A).call(this,!0)}).D().D().H({class:"bm-L bm-H"}).H({class:"bm-L",style:"margin-left: 2.5ch; margin-right: 2.5ch;"}).H({class:"bm-L"}).B({id:"bm-i",innerHTML:"<b>Tiles Loaded:</b> 0 / ???"}).D()._().D().B({id:"bm-d",innerHTML:"<b>Correct Pixels:</b> ???"}).D()._().D().B({id:"bm-j",innerHTML:"<b>Total Pixels:</b> ???"}).D()._().D().B({id:"bm-7",innerHTML:"<b>Complete:</b> ??? (???)"}).D()._().D().B({id:"bm-8",innerHTML:"??? ???"}).D().D().H({class:"bm-L"}).N({innerHTML:`Press the 🗗 button to make this window smaller. Colors with the icon ${this.Zt.replace("<svg",'<svg aria-label="Eye Open"')} will be shown on the canvas. Colors with the icon ${this.Qt.replace("<svg",'<svg aria-label="Eye Closed"')} will not be shown on the canvas. The "Hide All Colors" and "Show All Colors" buttons only apply to colors that display in the list below. The amount of correct pixels is dependent on how many tiles of the template you have loaded since you last opened Wplace.live. If all tiles have been loaded, then the "correct pixel" count is accurate.`}).D().D().V().D().F({class:"bm-L"}).U().G({textContent:"Sort Options:",style:"font-weight: 700;"}).D().H({class:"bm-L"}).j({id:"bm-c",name:"sortPrimary",textContent:"I want to view "}).Y({value:"id",textContent:"color IDs"}).D().Y({value:"name",textContent:"color names"}).D().Y({value:"premium",textContent:"premium colors"}).D().Y({value:"percent",textContent:"percentage"}).D().Y({value:"correct",textContent:"correct pixels"}).D().Y({value:"incorrect",textContent:"incorrect pixels"}).D().Y({value:"total",textContent:"total pixels"}).D().D().j({id:"bm-5",name:"sortSecondary",textContent:" in "}).Y({value:"ascending",textContent:"ascending"}).D().Y({value:"descending",textContent:"descending"}).D().D().B({textContent:" order."}).D().D().H({class:"bm-L"}).R({id:"bm-e",name:"showUnused",textContent:"Show unused colors"}).D().D().D().H({class:"bm-L"}).lt({textContent:"Sort Colors",type:"submit"},(t,e)=>{e.onclick=t=>{t.preventDefault();const e=new FormData(document.querySelector(`#${this.Ct} form`)),n={};for(const[t,i]of e)n[t]=i;i(this,B,P).call(this,n.sortPrimary,n.sortSecondary,"on"==n.showUnused)}}).D().D().D().D().D().D().D().L(this.Mt),this.xt(`#${this.Ct}.bm-W`,`#${this.Ct} .bm-S`);const t=document.querySelector(`#${this.Ct} .bm-L.bm-H`);i(this,B,I).call(this,t),i(this,B,P).call(this,this.sortPrimary,this.sortSecondary,this.showUnused),this.ct("#bm-i",`<b>Tiles Loaded:</b> ${s(this.te)} / ${s(this.ee)}`),this.ct("#bm-d",`<b>Correct Pixels:</b> ${s(this.se)}`),this.ct("#bm-j",`<b>Total Pixels:</b> ${s(this.oe)}`),this.ct("#bm-7",`<b>Remaining:</b> ${s((this.oe||0)-(this.se||0))} (${o(((this.oe||0)-(this.se||0))/(this.oe||1))})`),this.ct("#bm-8",`<b>Completed at:</b> <time datetime="${this.timeRemaining.toISOString().replace(/\.\d{3}Z$/,"Z")}">${this.ae}</time>`)}re(){if(document.querySelector(`#${this.Ct}`))return void document.querySelector(`#${this.Ct}`).remove();this.window=this.H({id:this.Ct,class:"bm-W bm-N"}).ft().lt({class:"bm-s",textContent:"▼","aria-label":'Minimize window "Color Filter"',"data-button-status":"expanded"},(t,e)=>{e.onclick=()=>{const i=document.querySelector("#bm-2");i&&(i.style.display="expanded"==e.dataset.buttonStatus?"none":""),t.wt(e)},e.ontouchend=()=>{e.click()}}).D().H().B({id:"bm-2",class:"bm-y",style:"font-weight: 700;"}).D().D().H({class:"bm-D"}).lt({class:"bm-s",textContent:"🗖","aria-label":'Switch to fullscreen mode for "Color Filter"'},(t,e)=>{e.onclick=()=>{document.querySelector(`#${this.Ct}`)?.remove(),this.Tt()},e.ontouchend=()=>{e.click()}}).D().lt({class:"bm-s",textContent:"✖","aria-label":'Close window "Color Filter"'},(t,e)=>{e.onclick=()=>{document.querySelector(`#${this.Ct}`)?.remove()},e.ontouchend=()=>{e.click()}}).D().D().D().H({class:"bm-m"}).H({class:"bm-L bm-h"}).W(1,{textContent:"Color Filter"}).D().D().V().D().H({class:"bm-L bm-x bm-h",style:"gap: 1.5ch;"}).lt({textContent:"None"},(t,e)=>{e.onclick=()=>i(this,B,A).call(this,!1)}).D().lt({textContent:"Refresh"},(t,e)=>{e.onclick=()=>{e.disabled=!0,this.le(),e.disabled=!1}}).D().lt({textContent:"All"},(t,e)=>{e.onclick=()=>i(this,B,A).call(this,!0)}).D().D().H({class:"bm-L bm-H"}).D().D().D().L(this.Mt),this.xt(`#${this.Ct}.bm-W`,`#${this.Ct} .bm-S`);const t=document.querySelector(`#${this.Ct} .bm-L.bm-H`);i(this,B,I).call(this,t),i(this,B,P).call(this,this.sortPrimary,this.sortSecondary,this.showUnused)}le(){i(this,B,W).call(this);const t=document.querySelector(`#${this.Jt}`),e={};for(const t of this.palette){const i=this.ie.get(t.id)??0,n=s(i);let a=0,r="0",l=o(1);0!=i&&(a=this.ne.get(t.id)??"???","number"!=typeof a&&this.te==this.ee&&t.id&&(a=0),r="string"==typeof a?a:s(a),l=isNaN(a/i)?"???":o(a/i));const h=parseInt(i)-parseInt(a);e[t.id]={he:i,ce:n,me:a,de:r,ue:l,be:h}}if(document.querySelector("#bm-2")){const t=this.se.toString().length>7?this.se.toString().slice(0,2)+"…"+this.se.toString().slice(-3):this.se.toString(),e=this.oe.toString().length>7?this.oe.toString().slice(0,2)+"…"+this.oe.toString().slice(-3):this.oe.toString();this.ct("#bm-2",`${t}/${e}`,!0)}if(!t)return e;const n=Array.from(t.children);for(const t of n){const i=parseInt(t.dataset.id),{me:n,de:s,ue:o,he:a,ce:r,be:l}=e[i];t.dataset.correct=Number.isNaN(parseInt(n))?"0":n,t.dataset.total=a,t.dataset.percent="%"==o.slice(-1)?o.slice(0,-1):"0",t.dataset.incorrect=l||0;const h=document.querySelector(`#${this.Ct} .bm-z[data-id="${i}"] .bm-9`);h&&(h.textContent=`${s} / ${r}`);const c=document.querySelector(`#${this.Ct} .bm-z[data-id="${i}"] .bm-6`);c&&(c.textContent=`${"number"!=typeof l||isNaN(l)?"???":l} incorrect pixel${1==l?"":"s"}. Completed: ${o}`)}i(this,B,P).call(this,this.sortPrimary,this.sortSecondary,this.showUnused)}};B=new WeakSet,I=function(t){const e=t.closest(`#${this.Ct}`)?.classList.contains("bm-N"),i=new M(this.name,this.version);i.H({id:this.Jt});const n=this.le();for(const t of this.palette){const s="#"+f(t.rgb).toUpperCase(),o=p(t.rgb);let a=1.05/(o+.05)>(o+.05)/.05?"white":"black";t.id||(a="transparent");const r="white"==a?"bm-f":"bm-g",{me:l,de:h,ue:c,he:m,ce:d,be:u}=n[t.id],b=!!this.qt.pe.get(t.id);if(e){const e=`background-size: auto 100%; background-repeat: repeat-x; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='M50,5L79,91L2,39L98,39L21,91' fill='${a}' fill-opacity='.1'/></svg>");`;i.H({class:"bm-L bm-z bm-x","data-id":t.id,"data-name":t.name,"data-premium":+t.premium,"data-correct":Number.isNaN(parseInt(l))?"0":l,"data-total":m,"data-percent":"%"==c.slice(-1)?c.slice(0,-1):"0","data-incorrect":u||0}).H({class:"bm-a",style:`background-color: rgb(${t.rgb?.map(t=>Number(t)||0).join(",")});${t.premium?e:""}`}).lt({class:"bm-A "+r,"data-state":b?"hidden":"shown","aria-label":b?`Show the color ${t.name||""} on templates.`:`Hide the color ${t.name||""} on templates.`,innerHTML:b?this.Qt.replace("<svg",`<svg fill="${a}"`):this.Zt.replace("<svg",`<svg fill="${a}"`)},(e,i)=>{i.onclick=()=>{i.style.textDecoration="none",i.disabled=!0,"shown"==i.dataset.state?(i.innerHTML=this.Qt.replace("<svg",`<svg fill="${a}"`),i.dataset.state="hidden",i.ariaLabel=`Show the color ${t.name||""} on templates.`,this.qt.pe.set(t.id,!0)):(i.innerHTML=this.Zt.replace("<svg",`<svg fill="${a}"`),i.dataset.state="shown",i.ariaLabel=`Hide the color ${t.name||""} on templates.`,this.qt.pe.delete(t.id)),i.disabled=!1,i.style.textDecoration=""},t.id||(i.disabled=!0)}).D().O({textContent:`#${t.id.toString().padStart(2,0)}`,style:`color: ${-1==t.id||0==t.id?"white":a}`}).D().W(2,{textContent:t.name,style:`color: ${-1==t.id||0==t.id?"white":a}`}).D().O({class:"bm-9",textContent:`${h} / ${d}`,style:`color: ${-1==t.id||0==t.id?"white":a}; flex: 1 1 auto; text-align: right;`}).D().D().D()}else i.H({class:"bm-L bm-z bm-x","data-id":t.id,"data-name":t.name,"data-premium":+t.premium,"data-correct":Number.isNaN(parseInt(l))?"0":l,"data-total":m,"data-percent":"%"==c.slice(-1)?c.slice(0,-1):"0","data-incorrect":u||0}).H({class:"bm-D",style:"flex-direction: column;"}).H({class:"bm-a",style:`background-color: rgb(${t.rgb?.map(t=>Number(t)||0).join(",")});`}).lt({class:"bm-A "+r,"data-state":b?"hidden":"shown","aria-label":b?`Show the color ${t.name||""} on templates.`:`Hide the color ${t.name||""} on templates.`,innerHTML:b?this.Qt.replace("<svg",`<svg fill="${a}"`):this.Zt.replace("<svg",`<svg fill="${a}"`)},(e,i)=>{i.onclick=()=>{i.style.textDecoration="none",i.disabled=!0,"shown"==i.dataset.state?(i.innerHTML=this.Qt.replace("<svg",`<svg fill="${a}"`),i.dataset.state="hidden",i.ariaLabel=`Show the color ${t.name||""} on templates.`,this.qt.pe.set(t.id,!0)):(i.innerHTML=this.Zt.replace("<svg",`<svg fill="${a}"`),i.dataset.state="shown",i.ariaLabel=`Hide the color ${t.name||""} on templates.`,this.qt.pe.delete(t.id)),i.disabled=!1,i.style.textDecoration=""},t.id||(i.disabled=!0)}).D().D().O({textContent:-2==t.id?"???????":s}).D().D().H({class:"bm-x"}).W(2,{textContent:(t.premium?"★ ":"")+t.name}).D().H({class:"bm-x",style:"gap: 1.5ch;"}).O({textContent:`#${t.id.toString().padStart(2,0)}`}).D().O({class:"bm-9",textContent:`${h} / ${d}`}).D().D().N({class:"bm-6",textContent:`${"number"!=typeof u||isNaN(u)?"???":u} incorrect pixel${1==u?"":"s"}. Completed: ${c}`}).D().D().D()}i.L(t)},P=function(t,e,i){this.sortPrimary=t,this.sortSecondary=e,this.showUnused=i;const n=document.querySelector(`#${this.Jt}`),s=Array.from(n.children);s.sort((n,s)=>{const o=n.getAttribute("data-"+t),a=s.getAttribute("data-"+t),r=parseFloat(o),l=parseFloat(a),h=!isNaN(r),c=!isNaN(l);if(i?n.classList.remove("bm-I"):Number(n.getAttribute("data-total"))||n.classList.add("bm-I"),h&&c)return"ascending"===e?r-l:l-r;{const t=o.toLowerCase(),i=a.toLowerCase();return t<i?"ascending"===e?-1:1:t>i?"ascending"===e?1:-1:0}}),s.forEach(t=>n.appendChild(t))},A=function(t){const e=document.querySelector(`#${this.Jt}`),i=Array.from(e.children);for(const e of i){if(e.classList?.contains("bm-I"))continue;const i=e.querySelector(".bm-a button");("hidden"!=i.dataset.state||t)&&("shown"==i.dataset.state&&t||i.click())}},W=function(){this.oe=0,this.se=0,this.ne=new Map,this.ie=new Map;for(const t of this.qt.fe){const e=t.Bt?.total??0;this.oe+=e??0;const i=t.Bt?.colors??new Map;for(const[t,e]of i){const i=Number(e)||0,n=this.ie.get(t)??0;this.ie.set(t,n+i)}const n=t.Bt?.correct??{};this.te+=Object.keys(n).length,this.ee+=Object.keys(t.Ht).length;for(const t of Object.values(n))for(const[e,i]of t){const t=Number(i)||0;this.se+=t;const n=this.ne.get(e)??0;this.ne.set(e,n+t)}}this.se>=this.oe&&this.oe&&this.te==this.ee&&(new N).Xt(document.querySelector(`#${this.Ct}`)),this.timeRemaining=new Date(30*(this.oe-this.se)*1e3+Date.now()),this.ae=a(this.timeRemaining)};var R=class extends M{constructor(t,i,n,s=void 0){super(t,i),e(this,V),this.window=null,this.Ct="bm-u",this.Mt=document.body,this.ge=JSON.parse(GM_getValue("bmTemplates","{}")),this.scriptVersion=this.ge?.scriptVersion,this.schemaVersion=this.ge?.schemaVersion,this.we=void 0,this.xe=n,this.qt=s}Tt(){if(document.querySelector(`#${this.Ct}`))return void document.querySelector(`#${this.Ct}`).remove();let t="";document.querySelector("#bm-F")||(t=t.concat("z-index: 9001;").trim()),this.window=this.H({id:this.Ct,class:"bm-W",style:t},(t,e)=>{}).ft().lt({class:"bm-s",textContent:"▼","aria-label":'Minimize window "Template Wizard"',"data-button-status":"expanded"},(t,e)=>{e.onclick=()=>t.wt(e),e.ontouchend=()=>{e.click()}}).D().H().D().lt({class:"bm-s",textContent:"✖","aria-label":'Close window "Template Wizard"'},(t,e)=>{e.onclick=()=>{document.querySelector(`#${this.Ct}`)?.remove()},e.ontouchend=()=>{e.click()}}).D().D().H({class:"bm-m"}).H({class:"bm-L bm-h"}).W(1,{textContent:"Template Wizard"}).D().D().V().D().H({class:"bm-L"}).W(2,{textContent:"Status"}).D().N({id:"bm-v",textContent:"Loading template storage status..."}).D().D().H({class:"bm-L bm-H"}).W(2,{textContent:"Detected templates:"}).D().D().D().D().L(this.Mt),this.xt(`#${this.Ct}.bm-W`,`#${this.Ct} .bm-S`),i(this,V,_).call(this),i(this,V,z).call(this)}};V=new WeakSet,_=function(){const t=this.schemaVersion.split(/[-\.\+]/),e=this.xe.split(/[-\.\+]/);let n="";t[0]==e[0]?t[1]==e[1]?(n='Template storage health: <b style="color:#0f0;">Healthy!</b><br>No futher action required. (Reason: Semantic version matches)',this.we="Good"):(n='Template storage health: <b style="color:#ff0;">Poor!</b><br>You can still use your template, but some features may not work. It is recommended that you update Blue Marble\'s template storage. (Reason: MINOR version mismatch)',this.we="Poor"):t[0]<e[0]?(n='Template storage health: <b style="color:#f00;">Bad!</b><br>It is guaranteed that some features are broken. You <em>might</em> still be able to use the template. It is HIGHLY recommended that you download all templates and update Blue Marble\'s template storage before continuing. (Reason: MAJOR version mismatch)',this.we="Bad"):(n='Template storage health: <b style="color:#f00">Dead!</b><br>Blue Marble can not load the template storage. (Reason: MAJOR version unknown)',this.we="Dead");const s=`<hr style="margin:.5ch">If you want to continue using your current templates, then make sure the template storage (schema) is up-to-date.<br>If you don't want to update the template storage, then downgrade Blue Marble to version <b>${r(this.scriptVersion)}</b> to continue using your templates.<br>Alternatively, if you don't care about corrupting the templates listed below, you can fix any issues with the template storage by uploading a new template.`,o=function(){const t=[...document.querySelectorAll("body > div > .hidden")].filter(t=>/version:/i.test(t.textContent));if(t[0]){const e=t[0].textContent?.match(/\d+/);return e?new Date(Number(e[0])):void 0}}();let l=o?a(o):"???";this.ct("#bm-v",`${n}<br>Your templates were created during Blue Marble version <b>${r(this.scriptVersion)}</b> with schema version <b>${r(this.schemaVersion)}</b>.<br>The current Blue Marble version is <b>${r(this.version)}</b> and requires schema version <b>${r(this.xe)}</b>.<br>Wplace was last updated on <b>${l}</b>.${"Good"!=this.we?s:""}`);const h=new M(this.name,this.version);"Dead"!=this.we&&(h.H({class:"bm-L bm-D bm-h",style:"gap: 1.5ch;"}),h.lt({textContent:"Download all templates"},(t,e)=>{e.onclick=()=>{e.disabled=!0,this.qt.ye().then(()=>{e.disabled=!1})}}).D()),"Poor"!=this.we&&"Bad"!=this.we||h.lt({textContent:`Update template storage to ${this.xe}`},(t,e)=>{e.onclick=()=>{e.disabled=!0,i(this,V,F).call(this,!0)}}).D(),h.D().L(document.querySelector("#bm-v").parentNode)},z=function(){const t=this.ge?.templates;if(Object.keys(t).length>0){const e=document.querySelector(`#${this.Ct} .bm-H`),i=new M(this.name,this.version);i.H({id:"bm-B",class:"bm-L"});for(const e in t){const n=e,o=t[e];if(t.hasOwnProperty(e)){const t=n.split(" "),e=Number(t?.[0]),a=d(t?.[1]||"0",this.qt.ve),r=o.name||`Template ${e||""}`,l=o?.coords?.split(",").map(Number),h=o.pixels?.total??void 0,c=void 0,m="number"==typeof e?s(e):"???",u="number"==typeof a?s(a):"???",b="number"==typeof h?s(h):"???";i.H({class:"bm-L bm-D"}).H({class:"bm-D",style:"flex-direction: column; gap: 0;"}).H({class:"bm-1",textContent:c||"🖼️"}).D().O({textContent:`#${m}`}).D().D().H({class:"bm-D bm-0"}).W(3,{textContent:r}).D().B({textContent:`Uploaded by user #${u}`}).D().B({textContent:`Coordinates: ${l.join(", ")}`}).D().B({textContent:`Total Pixels: ${b}`}).D().D().D()}}i.D().L(e)}},F=async function(t){if(t){const t=document.querySelector(`#${this.Ct} .bm-m`);t.innerHTML="",new M(this.name,this.version).H({class:"bm-L"}).H({class:"bm-L bm-h"}).W(1,{textContent:"Template Wizard"}).D().D().V().D().H({class:"bm-L"}).W(2,{textContent:"Status"}).D().N({textContent:"Updating template storage. Please wait..."}).D().D().D().L(t)}GM_deleteValue("bmCoords");const e=this.ge?.templates;if(Object.keys(e).length>0)for(const[t,i]of Object.entries(e))if(e.hasOwnProperty(t)){const t=new H({displayName:i.name,Ht:i.tiles});t.Rt();const e=await this.qt.Ce(t);await this.qt.Me(e,t.displayName,t.coords)}t&&(document.querySelector(`#${this.Ct}`).remove(),new R(this.name,this.version,this.xe,this.qt).Tt())};var j,E,Y,X,J,q,Z,Q,K,tt=R;j=new WeakSet,E=function(){new G(this).Tt()},Y=async function(t,e,i){i.preventDefault();const n=await async function(t){let e="";return t&&(e=t.clipboardData.getData("text/plain")),0!=e.length||(await navigator.clipboard.readText().then(t=>{e=t}).catch(t=>{l("Failed to retrieve clipboard data using navigator! Using fallback methods...")}),0!=e.length||(e=window.clipboardData?.getData("Text"))),e}(i),s=n.split(/[^a-zA-Z0-9]+/).filter(t=>t).map(Number).filter(t=>!isNaN(t));2==s.length&&"bm-O"==e.id?(t.ct("bm-O",s?.[0]||""),t.ct("bm-P",s?.[1]||"")):1==s.length?t.ct(e.id,s?.[0]||""):(t.ct("bm-Q",s?.[0]||""),t.ct("bm-R",s?.[1]||""),t.ct("bm-O",s?.[2]||""),t.ct("bm-P",s?.[3]||""))},X=new WeakSet,J=async function(){GM.setValue("bmTemplates",JSON.stringify(this.Te))},q=async function(t){const e=t.templates,i=t?.schemaVersion,n=i.split(/[-\.\+]/),s=this.schemaVersion.split(/[-\.\+]/),o=t?.scriptVersion;n[0]==s[0]?(n[1]!=s[1]&&new tt(this.name,this.version,this.schemaVersion,this).Tt(),this.fe=await async function({Ot:t,$e:i,fe:n}){if(Object.keys(e).length>0)for(const s in e){const o=s,a=e[s];if(e.hasOwnProperty(s)){const e=o.split(" "),s=Number(e?.[0]),r=e?.[1]||"0",l=a.name||`Template ${s||""}`,h={total:a.pixels?.total,colors:new Map(Object.entries(a.pixels?.colors||{}).map(([t,e])=>[Number(t),e]))},c=a.tiles,m={},d={},u=t*i;for(const t in c)if(c.hasOwnProperty(t)){const e=b(c[t]),i=new Blob([e],{type:"image/png"}),n=await createImageBitmap(i);m[t]=n;const s=new OffscreenCanvas(u,u).getContext("2d");s.drawImage(n,0,0);const o=s.getImageData(0,0,n.width,n.height);d[t]=new Uint32Array(o.data.buffer)}const p=new H({displayName:l,Dt:s||this.fe?.length||0,Lt:r||""});p.Bt=h,p.Ht=m,p.Nt=d,n.push(p)}}return n}({Ot:this.Ot,$e:this.$e,fe:this.fe})):n[0]<s[0]?new tt(this.name,this.version,this.schemaVersion,this).Tt():this.Se.yt(`Template version ${i} is unsupported.\nUse Blue Marble version ${o} or load a new template.`)},Z=function({ke:t,De:e,Le:i,He:n,Ne:s}){const o=this.$e,a=this.Ot*o,r=i[0],l=i[1],h=i[2],c=i[3],m=this.Oe,d=!this.v?.kt?.flags?.includes("hl-noTrans"),{palette:u,jt:b}=this.Kt,p=new Map;for(let i=1;i<c;i+=o)for(let c=1;c<h;c+=o){const u=l+i+-1,f=r+c+0,g=t[u*a+f],w=e[i*h+c],x=w>>>24&255,y=g>>>24&255,v=b.get(w)??-2,C=b.get(g)??-2;if(this.pe.get(v)&&(e[i*h+c]=g),-1==v){const t=536870912;this.pe.get(v)?e[i*h+c]=0:(u/o&1)==(f/o&1)?(e[i*h+c]=t,e[(i-1)*h+(c-1)]=t,e[(i-1)*h+(c+1)]=t,e[(i+1)*h+(c-1)]=t,e[(i+1)*h+(c+1)]=t):(e[i*h+c]=0,e[(i-1)*h+c]=t,e[(i+1)*h+c]=t,e[i*h+(c-1)]=t,e[i*h+(c+1)]=t)}if(!s&&x>m&&C!=v&&(d||y>m)){const t=e[i*h+c];for(const s of n){const[n,o,a]=s,r=0!=n?1!=n?t:4278190335:0;e[(i+a)*h+(c+o)]=r}}if(-1==v&&g<=m){const t=p.get(v);p.set(v,t?t+1:1);continue}if(x<=m||y<=m)continue;if(C!=v)continue;const M=p.get(v);p.set(v,M?M+1:1)}return{Be:p,Ie:e}},Q=new WeakSet,K=function(t){const e=JSON.parse(GM_getValue("bmUserSettings","{}"));e.telemetry=t,GM.setValue("bmUserSettings",JSON.stringify(e))};var et=GM_info.script.name.toString(),it=GM_info.script.version.toString();!function(t){const e=document.createElement("script");e.setAttribute("bm-11",et),e.setAttribute("bm-X","color: cornflowerblue;"),e.textContent=`(${t})();`,document.documentElement?.appendChild(e),e.remove()}(()=>{const t=document.currentScript,e=t?.getAttribute("bm-11")||"Blue Marble",i=t?.getAttribute("bm-X")||"",n=new Map;window.addEventListener("message",t=>{const{source:s,endpoint:o,blobID:a,blobData:r,blink:l}=t.data;if(Date.now(),"blue-marble"==s&&a&&r&&!o){const t=n.get(a);"function"==typeof t?t(r):c(`%c${e}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`,i,"",a),n.delete(a)}});const s=window.fetch;window.fetch=async function(...t){const e=await s.apply(this,t),i=e.clone(),o=(t[0]instanceof Request?t[0]?.url:t[0])||"ignore",a=i.headers.get("content-type")||"";if(a.includes("application/json"))i.json().then(t=>{window.postMessage({source:"blue-marble",endpoint:o,jsonData:t},"*")}).catch(t=>{});else if(a.includes("image/")&&!o.includes("openfreemap")&&!o.includes("maps")){const t=Date.now(),e=await i.blob();return new Promise(s=>{const a=crypto.randomUUID();n.set(a,t=>{s(new Response(t,{headers:i.headers,status:i.status,statusText:i.statusText}))}),window.postMessage({source:"blue-marble",endpoint:o,blobID:a,blobData:e,blink:t})}).catch(t=>{Date.now()})}return e}});var nt=GM_getResourceText("CSS-BM-File");GM_addStyle(nt);var st,ot="robotoMonoInjectionPoint";ot.indexOf("@font-face")+1?GM_addStyle(ot):((st=document.createElement("link")).href="https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap",st.rel="preload",st.as="style",st.onload=function(){this.onload=null,this.rel="stylesheet"},document.head?.appendChild(st));var at=JSON.parse(GM_getValue("bmUserSettings","{}")),rt=(new class{constructor(){this.Pe=null,this.Ae=null,this.We="#bm-p"}Ve(t){return this.Ae=t,this.Pe=new MutationObserver(t=>{for(const e of t)for(const t of e.addedNodes)t instanceof HTMLElement&&t.matches?.(this.We)}),this}_e(){return this.Pe}observe(t,e=!1,i=!1){t.observe(this.Ae,{childList:e,subtree:i})}},new class extends M{constructor(t,i){super(t,i),e(this,j),this.window=null,this.Ct="bm-F",this.Mt=document.body}Tt(){document.querySelector(`#${this.Ct}`)?this.yt("Main window already exists!"):(this.window=this.H({id:this.Ct,class:"bm-W bm-N",style:"top: 10px; left: unset; right: 75px;"},(t,e)=>{}).ft().lt({class:"bm-s",textContent:"▼","aria-label":'Minimize window "Blue Marble"',"data-button-status":"expanded"},(t,e)=>{e.onclick=()=>t.wt(e),e.ontouchend=()=>{e.click()}}).D().H().D().D().H({class:"bm-m"}).H({class:"bm-L"}).A({class:"bm-T",src:"https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/assets/Favicon.png"},(t,e)=>{const i=new Date;204==Math.floor((i.getTime()-new Date(i.getFullYear(),0,1))/864e5)+1&&(e.parentNode.style.position="relative",e.parentNode.innerHTML=e.parentNode.innerHTML+'<svg viewBox="0 0 9 7" width="2em" height="2em" style="position: absolute; top: -.75em; left: 3.25ch;"><path d="M0,3L9,0L2,7" fill="#0af"/><path d="M0,3A.4,.4 0 1 1 1,5" fill="#a00"/><path d="M1.5,6A1,1 0 0 1 3,6L2,7" fill="#a0f"/><path d="M4,5A.6,.6 0 1 1 5,4" fill="#0a0"/><path d="M6,3A.8,.8 0 1 1 7,2" fill="#fa0"/><path d="M4.5,1.5A1,1 0 0 1 3,2" fill="#aa0"/></svg>',e.onload=()=>{(new N).Xt(document.querySelector(`#${this.Ct}`))})}).D().W(1,{textContent:this.name}).D().D().V().D().H({class:"bm-L"}).B({id:"bm-w",textContent:"Droplets:"}).D()._().D().B({id:"bm-q",textContent:"Next level in..."}).D()._().D().B({textContent:"Charges: "}).gt(Date.now(),1e3,{style:"font-weight: 700;"},(t,e)=>{t.p.ze=e.id}).D().D().D().V().D().H({class:"bm-L"}).H({class:"bm-L"}).lt({class:"bm-s bm-J",style:"margin-top: 0;",innerHTML:'<svg viewBox="0 0 4 6"><path d="M.5,3.4A2,2 0 1 1 3.5,3.4L2,6"/><circle cx="2" cy="2" r=".7" fill="#fff"/></svg>'},(t,e)=>{e.onclick=()=>{const e=t.p?.Fe;e?.[0]?(t.ct("bm-Q",e?.[0]||""),t.ct("bm-R",e?.[1]||""),t.ct("bm-O",e?.[2]||""),t.ct("bm-P",e?.[3]||"")):t.yt("Coordinates are malformed! Did you try clicking on the canvas first?")}}).D().dt({type:"number",id:"bm-Q",class:"bm-C",placeholder:"Tl X",min:0,max:2047,step:1,required:!0},(t,e)=>{e.addEventListener("paste",n=>i(this,j,Y).call(this,t,e,n))}).D().dt({type:"number",id:"bm-R",class:"bm-C",placeholder:"Tl Y",min:0,max:2047,step:1,required:!0},(t,e)=>{e.addEventListener("paste",n=>i(this,j,Y).call(this,t,e,n))}).D().dt({type:"number",id:"bm-O",class:"bm-C",placeholder:"Px X",min:0,max:2047,step:1,required:!0},(t,e)=>{e.addEventListener("paste",n=>i(this,j,Y).call(this,t,e,n))}).D().dt({type:"number",id:"bm-P",class:"bm-C",placeholder:"Px Y",min:0,max:2047,step:1,required:!0},(t,e)=>{e.addEventListener("paste",n=>i(this,j,Y).call(this,t,e,n))}).D().D().H({class:"bm-L"}).ut({class:"bm-K",textContent:"Upload Template",accept:"image/png, image/jpeg, image/webp, image/bmp, image/gif"}).D().D().H({class:"bm-L bm-x"}).lt({textContent:"Disable","data-button-status":"shown"},(t,e)=>{e.onclick=()=>{e.disabled=!0,"shown"==e.dataset.buttonStatus?(t.p?.qt?.Ue(!1),e.dataset.buttonStatus="hidden",e.textContent="Enable",t.vt("Disabled templates!")):(t.p?.qt?.Ue(!0),e.dataset.buttonStatus="shown",e.textContent="Disable",t.vt("Enabled templates!")),e.disabled=!1}}).D().lt({textContent:"Create"},(t,e)=>{e.onclick=()=>{const e=document.querySelector(`#${this.Ct} .bm-K`),i=document.querySelector("#bm-Q");if(!i.checkValidity())return i.reportValidity(),void t.yt("Coordinates are malformed! Did you try clicking on the canvas first?");const n=document.querySelector("#bm-R");if(!n.checkValidity())return n.reportValidity(),void t.yt("Coordinates are malformed! Did you try clicking on the canvas first?");const s=document.querySelector("#bm-O");if(!s.checkValidity())return s.reportValidity(),void t.yt("Coordinates are malformed! Did you try clicking on the canvas first?");const o=document.querySelector("#bm-P");if(!o.checkValidity())return o.reportValidity(),void t.yt("Coordinates are malformed! Did you try clicking on the canvas first?");e?.files[0]?(t?.p?.qt.Me(e.files[0],e.files[0]?.name.replace(/\.[^/.]+$/,""),[Number(i.value),Number(n.value),Number(s.value),Number(o.value)]),t.vt("Drew to canvas!")):t.yt("No file selected!")}}).D().lt({textContent:"Filter"},(t,e)=>{e.onclick=()=>i(this,j,E).call(this)}).D().D().H({class:"bm-L"}).bt({id:this.C,placeholder:`Status: Sleeping...\nVersion: ${this.version}`,readOnly:!0}).D().D().H({class:"bm-L bm-x",style:"margin-bottom: 0; flex-direction: column;"}).H({class:"bm-x"}).lt({class:"bm-s",innerHTML:"⚙️",title:"Settings"},(t,e)=>{e.onclick=()=>{t.v.Tt()}}).D().lt({class:"bm-s",innerHTML:"🧙",title:"Template Wizard"},(t,e)=>{e.onclick=()=>{const e=t.p?.qt;new tt(this.name,this.version,e?.schemaVersion,e).Tt()}}).D().lt({class:"bm-s",innerHTML:"🎨",title:"Template Color Converter"},(t,e)=>{e.onclick=()=>{window.open("https://pepoafonso.github.io/color_converter_wplace/","_blank","noopener noreferrer")}}).D().lt({class:"bm-s",innerHTML:"🌐",title:"Official Blue Marble Website"},(t,e)=>{e.onclick=()=>{window.open("https://bluemarble.lol/","_blank","noopener noreferrer")}}).D().lt({class:"bm-s",title:"Donate to SwingTheVine",innerHTML:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="#fff" style="width:80%; margin:auto;"><path d="M249.8 75c89.8 0 113 1.1 146.3 4.4 78.1 7.8 123.6 56 123.6 125.2l0 8.9c0 64.3-47.1 116.9-110.8 122.4-5 16.6-12.8 33.2-23.3 49.9-24.4 37.7-73.1 85.3-162.9 85.3l-17.7 0c-73.1 0-129.7-31.6-163.5-89.2-29.9-50.4-33.8-106.4-33.8-181.2 0-73.7 44.4-113.6 96.4-120.2 39.3-5 88.1-5.5 145.7-5.5zm0 41.6c-60.4 0-103.6 .5-136.3 5.5-46 6.7-64.3 32.7-64.3 79.2l.2 25.7c1.2 57.3 7.1 97.1 27.5 134.5 26.6 49.3 74.8 68.2 129.7 68.2l17.2 0c72 0 107-34.9 126.3-65.4 9.4-15.5 17.7-32.7 22.2-54.3l3.3-13.8 19.9 0c44.3 0 82.6-36 82.6-82l0-8.3c0-51.5-32.2-78.7-88.1-85.3-31.6-2.8-50.4-3.9-140.2-3.9zM267 169.2c38.2 0 64.8 31.6 64.8 67 0 32.7-18.3 61-42.1 83.1-15 15-39.3 30.5-55.9 40.5-4.4 2.8-10 4.4-16.7 4.4-5.5 0-10.5-1.7-15.5-4.4-16.6-10-41-25.5-56.5-40.5-21.8-20.8-39.2-46.9-41.3-77l-.2-6.1c0-35.5 25.5-67 64.3-67 22.7 0 38.8 11.6 49.3 27.7 11.6-16.1 27.2-27.7 49.9-27.7zm122.5-3.9c28.3 0 43.8 16.6 43.8 43.2s-15.5 42.7-43.8 42.7c-8.9 0-13.8-5-13.8-11.7l0-62.6c0-6.7 5-11.6 13.8-11.6z"/></svg>'},(t,e)=>{e.onclick=()=>{window.open("https://ko-fi.com/swingthevine","_blank","noopener noreferrer")}}).D().lt({class:"bm-s",innerHTML:"🤝",title:"Credits"},(t,e)=>{e.onclick=()=>{new U(this.name,this.version).Tt()}}).D().D().O({textContent:"Made by SwingTheVine",style:"margin-top: auto;"}).D().D().D().D().D().L(this.Mt),this.xt(`#${this.Ct}.bm-W`,`#${this.Ct} .bm-S`))}}(et,it)),lt=new class{constructor(t,i){e(this,X),this.name=t,this.version=i,this.Se=null,this.v=null,this.schemaVersion="2.0.0",this.Ge=null,this.ve="!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~",this.Ot=1e3,this.$e=3,this.Oe=3,this.Kt=function(t){const e=C;e.unshift({id:-1,premium:!1,name:"Erased",rgb:[222,250,206]}),e.unshift({id:-2,premium:!1,name:"Other",rgb:[0,0,0]});const i=new Map;for(const n of e){if(0==n.id||-2==n.id)continue;const e=n.rgb[0],s=n.rgb[1],o=n.rgb[2];for(let a=-t;a<=t;a++)for(let r=-t;r<=t;r++)for(let l=-t;l<=t;l++){const t=e+a,h=s+r,c=o+l;if(t<0||t>255||h<0||h>255||c<0||c>255)continue;const m=(255<<24|c<<16|h<<8|t)>>>0;i.has(m)||i.set(m,n.id)}}return{palette:e,jt:i}}(this.Oe),this.De=null,this.Re="",this.fe=[],this.Te=null,this.je=!0,this.Ee=null,this.pe=new Map}Ye(t){this.Se=t}k(t){this.v=t}async Xe(){return{whoami:this.name.replace(" ",""),scriptVersion:this.version,schemaVersion:this.schemaVersion,templates:{}}}async Me(t,e,n){this.Te||(this.Te=await this.Xe()),this.Se.vt(`Creating template at ${n.join(", ")}...`);const s=new H({displayName:e,Dt:0,Lt:m(this.Ge||0,this.ve),file:t,coords:n}),o=!this.v?.kt?.flags?.includes("hl-noSkip"),a=this.v?.kt?.flags?.includes("hl-agSkip"),{Ut:r,Gt:l}=await s.At(this.Ot,this.Kt,o,a);s.Ht=r;const h={total:s.Bt.total,colors:Object.fromEntries(s.Bt.colors)};this.Te.templates[`${s.Dt} ${s.Lt}`]={name:s.displayName,coords:n.join(", "),enabled:!0,pixels:h,tiles:l},this.fe=[],this.fe.push(s),this.Se.vt(`Template created at ${n.join(", ")}!`),await i(this,X,J).call(this)}Je(){}async qe(){this.Te||(this.Te=await this.Xe())}async Ze(){l("Downloading all templates...");for(const t of this.fe)await this.Qe(t),await n(500)}async ye(){const t=JSON.parse(GM_getValue("bmTemplates","{}"))?.templates;if(Object.keys(t).length>0)for(const[e,i]of Object.entries(t))t.hasOwnProperty(e)&&(await this.Qe(new H({displayName:i.name,Dt:e.split(" ")?.[0],Lt:e.split(" ")?.[1],Ht:i.tiles})),await n(500))}async Qe(t){t.Rt();const e=`${t.coords.join("-")}_${t.displayName.replaceAll(" ","-")}`,i=await this.Ce(t);await GM.download({url:URL.createObjectURL(i),name:e+".png",Ke:"uniquify",onload:()=>{l(`Download of template '${e}' complete!`)},onerror:(t,i)=>{h(`Download of template '${e}' failed because ${t}! Details: ${i}`)},ontimeout:()=>{c(`Download of template '${e}' has timed out!`)}})}async Ce(t){const e=t.Ht,i=Object.keys(e).sort(),n=await Promise.all(i.map(t=>{return i=e[t],new Promise((t,e)=>{const n=new Image;n.onload=()=>t(n),n.onerror=e,n.src="data:image/png;base64,"+i});var i}));let s=1/0,o=1/0,a=0,r=0;i.forEach((t,e)=>{const[i,l,h,c]=t.split(",").map(Number),m=n[e],d=i*this.Ot+h,u=l*this.Ot+c;s=Math.min(s,d),o=Math.min(o,u),a=Math.max(a,d+m.width/this.$e),r=Math.max(r,u+m.height/this.$e)});const l=a-s,h=r-o,c=l*this.$e,m=h*this.$e,d=new OffscreenCanvas(c,m),u=d.getContext("2d");i.forEach((t,e)=>{const[i,a,r,l]=t.split(",").map(Number),h=n[e],c=i*this.Ot+r,m=a*this.Ot+l;u.drawImage(h,(c-s)*this.$e,(m-o)*this.$e,h.width,h.height)}),u.globalCompositeOperation="destination-over",u.drawImage(d,0,-1),u.drawImage(d,0,1),u.drawImage(d,-1,0),u.drawImage(d,1,0);const b=new OffscreenCanvas(l,h),p=b.getContext("2d");return p.imageSmoothingEnabled=!1,p.drawImage(d,0,0,l*this.$e,h*this.$e,0,0,l,h),b.convertToBlob({type:"image/png"})}async ti(t,e){if(!this.je)return t;const n=this.Ot*this.$e;e=e[0].toString().padStart(4,"0")+","+e[1].toString().padStart(4,"0");const o=this.fe;o.sort((t,e)=>t.Dt-e.Dt);const a=o.map(t=>{const i=Object.keys(t.Ht).filter(t=>t.startsWith(e));if(0===i.length)return null;const n=i.map(e=>{const i=e.split(",");return{ei:t,Vt:t.Ht[e],Nt:t.Nt?.[e],ii:[i[0],i[1]],ni:[i[2],i[3]]}});return n?.[0]}).filter(Boolean),r=a?.length||0;if(!(r>0))return this.Se.vt(`Sleeping\nVersion: ${this.version}`),t;{const t=s(o.filter(t=>Object.keys(t.Ht).filter(t=>t.startsWith(e)).length>0).reduce((t,e)=>t+(e.Bt.total||0),0));this.Se.vt(`Displaying ${r} template${1==r?"":"s"}.\nTotal pixels: ${t}`)}const l=await createImageBitmap(t),h=new OffscreenCanvas(n,n),c=h.getContext("2d");c.imageSmoothingEnabled=!1,c.beginPath(),c.rect(0,0,n,n),c.clip(),c.clearRect(0,0,n,n),c.drawImage(l,0,0,n,n);const m=c.getImageData(0,0,n,n),d=new Uint32Array(m.data.buffer),u=this.v?.kt?.highlight||[[2,0,0]],b=u?.[0],p=1==u?.length&&2==b?.[0]&&0==b?.[1]&&0==b?.[2];for(const t of a){const n=!!t.ei.Bt?.colors?.get(-1);let s=t.Nt.slice();const o=Number(t.ni[0])*this.$e,a=Number(t.ni[1])*this.$e;if(0!=this.pe.size||n||c.drawImage(t.Vt,o,a),!s){const e=c.getImageData(o,a,t.Vt.width,t.Vt.height);s=new Uint32Array(e.data.buffer)}Date.now();const{Be:r,Ie:l}=i(this,X,Z).call(this,{ke:d,De:s,Le:[o,a,t.Vt.width,t.Vt.height],He:u,Ne:p});let h=0;const m=0;for(const[t,e]of r)t!=m&&(h+=e);0==this.pe.size&&!n&&p||c.drawImage(await createImageBitmap(new ImageData(new Uint8ClampedArray(l.buffer),t.Vt.width,t.Vt.height)),o,a),void 0===t.ei.Bt.correct&&(t.ei.Bt.correct={}),t.ei.Bt.correct[e]=r}return await h.convertToBlob({type:"image/png"})}si(t){"BlueMarble"==t?.whoami&&i(this,X,q).call(this,t)}Ue(t){this.je=t}}(et,it),ht=new class{constructor(t){this.qt=t,this.oi=!1,this.ze="",this.Fe=[],this.ai=[]}ri(t){window.addEventListener("message",async e=>{const i=e.data,n=i.jsonData;if(!i||"blue-marble"!==i.source)return;if(!i.endpoint)return;const o=i.endpoint?.split("?")[0].split("/").filter(t=>t&&isNaN(Number(t))).filter(t=>t&&!t.includes(".")).pop();switch(o){case"me":if(n.status&&"2"!=n.status?.toString()[0])return void t.yt("You are not logged in or Wplace is offline!\nCould not fetch userdata.");const e=Math.ceil(Math.pow(Math.floor(n.level)*Math.pow(30,.65),1/.65)-n.pixelsPainted);if(n.id||n.id,this.qt.Ge=n.id,0!=this.ze.length){const t=document.querySelector("#"+this.ze);if(t){const e=n.charges;t.dataset.endDate=Date.now()+(e.max-e.count)*e.cooldownMs}}t.ct("bm-w",`Droplets: <b>${s(n.droplets)}</b>`),t.ct("bm-q",`Next level in <b>${s(e)}</b> pixel${1==e?"":"s"}`);break;case"pixel":const o=i.endpoint.split("?")[0].split("/").filter(t=>t&&!isNaN(Number(t))),l=new URLSearchParams(i.endpoint.split("?")[1]),h=[l.get("x"),l.get("y")];if(this.Fe.length&&(!o.length||!h.length))return void t.yt("Coordinates are malformed!\nDid you try clicking the canvas first?");this.Fe=[...o,...h];const c=(a=o,r=h,[parseInt(a[0])%4*1e3+parseInt(r[0]),parseInt(a[1])%4*1e3+parseInt(r[1])]),m=document.querySelectorAll("span");for(const t of m){const e=t.textContent.trim();if(e.includes(c[0])&&e.includes(c[1])){let e=document.querySelector("#bm-p");o[0],o[1],h[0],h[1];const i=["Tl X:","Tl Y:","Px X:","Px Y:"],n=["bm-Y","bm-Z","bm-U","bm-V"],s=[...o,...h];if(e)for(const[t,e]of n.entries())document.getElementById(e).textContent=`${i[t]??"??:"} ${s[t]}`;else{e=document.createElement("span"),e.id="bm-p",e.style="display: flex; flex-wrap: wrap; gap: 0 1ch; font-size: small;";for(const[t,o]of s.entries()){const a=document.createElement("span");a.id=n[s.indexOf(o)??""],a.textContent=`${i[t]??"??:"} ${o}`,e.appendChild(a)}t.parentNode.parentNode.parentNode.insertAdjacentElement("afterend",e)}}}break;case"tile":case"tiles":let d=i.endpoint.split("/");d=[parseInt(d[d.length-2]),parseInt(d[d.length-1].replace(".png",""))];const u=i.blobID,b=i.blobData,p=(Date.now(),await this.qt.ti(b,d));window.postMessage({source:"blue-marble",blobID:u,blobData:p,blink:i.blink});break;case"robots":this.oi="false"==n.userscript?.toString().toLowerCase()}var a,r})}async li(t){let e=GM_getValue("bmUserSettings","{}");if(e=JSON.parse(e),!e||!e.telemetry||!e.uuid)return;const i=navigator.userAgent;let n=await this.hi(i),s=this.ci(i);GM_xmlhttpRequest({method:"POST",url:"https://telemetry.thebluecorner.net/heartbeat",headers:{"Content-Type":"application/json"},data:JSON.stringify({uuid:e.uuid,version:t,browser:n,os:s}),onload:t=>{200!==t.status&&h("Failed to send heartbeat:",t.statusText)},onerror:t=>{h("Error sending heartbeat:",t)}})}async hi(t=navigator.userAgent){return(t=t||"").includes("OPR/")||t.includes("Opera")?"Opera":t.includes("Edg/")?"Edge":t.includes("Vivaldi")?"Vivaldi":t.includes("YaBrowser")?"Yandex":t.includes("Kiwi")?"Kiwi":t.includes("Brave")?"Brave":t.includes("Firefox/")?"Firefox":t.includes("Chrome/")?"Chrome":t.includes("Safari/")?"Safari":navigator.brave&&"function"==typeof navigator.brave.isBrave&&await navigator.brave.isBrave()?"Brave":"Unknown"}ci(t=navigator.userAgent){return/Windows NT 11/i.test(t=t||"")?"Windows 11":/Windows NT 10/i.test(t)?"Windows 10":/Windows NT 6\.3/i.test(t)?"Windows 8.1":/Windows NT 6\.2/i.test(t)?"Windows 8":/Windows NT 6\.1/i.test(t)?"Windows 7":/Windows NT 6\.0/i.test(t)?"Windows Vista":/Windows NT 5\.1|Windows XP/i.test(t)?"Windows XP":/Mac OS X 10[_\.]15/i.test(t)?"macOS Catalina":/Mac OS X 10[_\.]14/i.test(t)?"macOS Mojave":/Mac OS X 10[_\.]13/i.test(t)?"macOS High Sierra":/Mac OS X 10[_\.]12/i.test(t)?"macOS Sierra":/Mac OS X 10[_\.]11/i.test(t)?"OS X El Capitan":/Mac OS X 10[_\.]10/i.test(t)?"OS X Yosemite":/Mac OS X 10[_\.]/i.test(t)?"macOS":/Android/i.test(t)?"Android":/iPhone|iPad|iPod/i.test(t)?"iOS":/Linux/i.test(t)?"Linux":"Unknown"}}(lt),ct=new class extends L{constructor(t,i,n){var s;super(t,i),e(this,T),this.kt=n,(s=this.kt).flags??(s.flags=[]),this.mi=structuredClone(this.kt),this.di="bmUserSettings",this.ui=5e3,this.bi=0,setInterval(this.pi.bind(this),this.ui)}async pi(){const t=JSON.stringify(this.kt);t!=JSON.stringify(this.mi)&&Date.now()-this.bi>this.ui&&(await GM.setValue(this.di,t),this.mi=structuredClone(this.kt),this.bi=Date.now())}fi(t,e=void 0){const i=this.kt?.flags?.indexOf(t)??-1;-1!=i&&!0!==e?this.kt?.flags?.splice(i,1):-1==i&&!1!==e&&this.kt?.flags?.push(t)}$t(){const t='<svg viewBox="0 0 3 3"><path d="M0,0H3V3H0ZM0,1H3M0,2H3M1,0V3M2,0V3" fill="#fff"/><path d="M1,1H2V2H1Z" fill="#2f4f4f"/></svg>',e='<svg viewBox="0 0 3 3"><path d="M0,0H3V3H0Z" fill="#fff"/><path d="M1,0H2V1H3V2H2V3H1V2H0V1H1Z" fill="brown"/><path d="M1,1H2V2H1Z" fill="#2f4f4f"/></svg>',n=this.kt?.highlight??[[1,0,1],[2,0,0],[1,-1,0],[1,1,0],[1,0,-1]];this.window=this.H({class:"bm-L"}).W(2,{textContent:"Pixel Highlight"}).D().V().D().H({class:"bm-L",style:"margin-left: 1.5ch;"}).R({textContent:"Highlight transparent pixels"},(t,e,i)=>{i.checked=!this.kt?.flags?.includes("hl-noTrans"),i.onchange=t=>this.fi("hl-noTrans",!t.target.checked)}).D().N({id:"bm-4",textContent:"Choose a preset:",style:"font-weight: 700;"}).D().H({class:"bm-D",role:"group","aria-labelledby":"bm-4"}).H({class:"bm-3"}).B({textContent:"None"}).D().lt({innerHTML:t,"aria-label":'Preset "None"'},(t,e)=>{e.onclick=()=>i(this,T,S).call(this,"None")}).D().D().H({class:"bm-3"}).B({textContent:"Cross"}).D().lt({innerHTML:e,"aria-label":'Preset "Cross Shape"'},(t,e)=>{e.onclick=()=>i(this,T,S).call(this,"Cross")}).D().D().H({class:"bm-3"}).B({textContent:"X"}).D().lt({innerHTML:e.replace('d="M1,0H2V1H3V2H2V3H1V2H0V1H1Z"','d="M0,0V1H3V0H2V3H3V2H0V3H1V0Z"'),"aria-label":'Preset "X Shape"'},(t,e)=>{e.onclick=()=>i(this,T,S).call(this,"X")}).D().D().H({class:"bm-3"}).B({textContent:"Full"}).D().lt({innerHTML:t.replace("#fff","#2f4f4f"),"aria-label":'Preset "Full Template"'},(t,e)=>{e.onclick=()=>i(this,T,S).call(this,"Full")}).D().D().D().N({id:"bm-b",textContent:"Create a custom pattern:",style:"font-weight: 700;"}).D().H({class:"bm-n",role:"group","aria-labelledby":"bm-b"});for(let t=-1;t<=1;t++)for(let e=-1;e<=1;e++){const s=n[n.findIndex(([,i,n])=>i==e&&n==t)]?.[0]??0;let o="Disabled";1==s?o="Incorrect":2==s&&(o="Template"),this.window=this.lt({"data-status":o,"aria-label":`Sub-pixel ${o.toLowerCase()}`},(n,s)=>{s.onclick=()=>i(this,T,$).call(this,s,[e,t])}).D()}this.window=this.D().D().D()}St(){this.window=this.H({class:"bm-L"}).W(2,{textContent:"Pixel Highlight"}).D().V().D().H({class:"bm-L",style:"margin-left: 1.5ch;"}).R({textContent:"Template creation should skip transparent tiles"},(t,e,i)=>{i.checked=!this.kt?.flags?.includes("hl-noSkip"),i.onchange=t=>this.fi("hl-noSkip",!t.target.checked)}).D().R({innerHTML:"Experimental: Template creation should <em>aggressively</em> skip transparent tiles"},(t,e,i)=>{i.checked=this.kt?.flags?.includes("hl-agSkip"),i.onchange=t=>this.fi("hl-agSkip",t.target.checked)}).D().D().D()}}(et,it,at);rt.k(ct),rt.S(ht),lt.Ye(rt),lt.k(ct);var mt=JSON.parse(GM_getValue("bmTemplates","{}"));if(lt.si(mt),0==Object.keys(at).length){const t=crypto.randomUUID();GM.setValue("bmUserSettings",JSON.stringify({uuid:t}))}setInterval(()=>ht.li(it),18e5);var dt=at?.telemetry;if(null==dt||dt>1){const t=new class extends M{constructor(t,i,n,s){super(t,i),e(this,Q),this.window=null,this.Ct="bm-k",this.Mt=document.body,this.gi=n,this.uuid=s}async Tt(){if(document.querySelector(`#${this.Ct}`))return void this.yt("Telemetry window already exists!");const t=await this.p.hi(navigator.userAgent),e=this.p.ci(navigator.userAgent);this.window=this.H({id:this.Ct,class:"bm-W",style:"height: 80vh; z-index: 9998;"}).H({class:"bm-m"}).H({class:"bm-L bm-h"}).W(1,{textContent:`${this.name} Telemetry`}).D().D().V().D().H({class:"bm-L bm-D",style:"gap: 1.5ch; flex-wrap: wrap;"}).lt({textContent:"Enable Telemetry"},(t,e)=>{e.onclick=()=>{i(this,Q,K).call(this,this.gi);const t=document.getElementById(this.Ct);t?.remove()}}).D().lt({textContent:"Disable Telemetry"},(t,e)=>{e.onclick=()=>{i(this,Q,K).call(this,0);const t=document.getElementById(this.Ct);t?.remove()}}).D().lt({textContent:"More Information"},(t,e)=>{e.onclick=()=>{window.open("https://github.com/SwingTheVine/Wplace-TelemetryServer#telemetry-data","_blank","noopener noreferrer")}}).D().D().H({class:"bm-L bm-H"}).H({class:"bm-L"}).W(2,{textContent:"Legal"}).D().N({textContent:`We collect anonymous telemetry data such as your browser, OS, and script version to make the experience better for everyone. The data is never shared personally. The data is never sold. You can turn this off by pressing the "Disable" button, but keeping it on helps us improve features and reliability faster. Thank you for supporting ${this.name}!`}).D().D().V().D().H({class:"bm-L"}).W(2,{textContent:"Non-Legal Summary"}).D().N({innerHTML:'You can disable telemetry by pressing the "Disable" button. If you would like to read more about what information we collect, press the "More Information" button.<br>This is the data <em>stored</em> on our servers:'}).D().J().Z({innerHTML:`A unique identifier (UUIDv4) generated by Blue Marble. This enables our telemetry to function without tracking your actual user ID.<br>Your UUID is: <b>${r(this.uuid)}</b>`}).D().Z({innerHTML:`The version of Blue Marble you are using.<br>Your version is: <b>${r(this.version)}</b>`}).D().Z({innerHTML:`Your browser type, which is used to determine Blue Marble outages and browser popularity.<br>Your browser type is: <b>${r(t)}</b>`}).D().Z({innerHTML:`Your OS type, which is used to determine Blue Marble outages and OS popularity.<br>Your OS type is: <b>${r(e)}</b>`}).D().Z({innerHTML:"The date and time that Blue Marble sent the telemetry information."}).D().D().N({innerHTML:'All of the data mentioned above is <b>aggregated every hour</b>. This means every hour, anything that could even remotly be considered "personal data" is deleted from our server. Here, "aggregated" data means things like "42 people used Blue Marble on Google Chrome this hour", which can\'t be used to identify anyone in particular.'}).D().D().D().D().D().L(this.Mt)}}(et,it,1,at?.uuid);t.S(ht),t.Tt()}rt.Tt(),ht.ri(rt),new MutationObserver((t,e)=>{const i=document.querySelector("#color-1");if(!i)return;let n=document.querySelector("#bm-G");if(!n){n=document.createElement("button"),n.id="bm-G",n.textContent="Move ↑",n.className="btn btn-soft",n.onclick=function(){const t=this.parentNode.parentNode.parentNode.parentNode,e="Move ↑"==this.textContent;t.parentNode.className=t.parentNode.className.replace(e?"bottom":"top",e?"top":"bottom"),t.style.borderTopLeftRadius=e?"0px":"var(--radius-box)",t.style.borderTopRightRadius=e?"0px":"var(--radius-box)",t.style.borderBottomLeftRadius=e?"var(--radius-box)":"0px",t.style.borderBottomRightRadius=e?"var(--radius-box)":"0px",this.textContent=e?"Move ↓":"Move ↑"};const t=i.parentNode.parentNode.parentNode.parentNode.querySelector("h2");t.parentNode?.appendChild(n)}}).observe(document.body,{childList:!0,subtree:!0}),l(`%c${et}%c (${it}) userscript has loaded!`,"color: cornflowerblue;","")})();
