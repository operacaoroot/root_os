/*!
 * Marketing OS — pixel.js (SDK de rastreamento leve, sem dependências)
 * Produto do projeto `root`. Stack ISOLADO do escritório.
 *
 * Instalação (na página de vendas):
 *   <script async src="https://SEU-HOST/pixel.js" data-endpoint="https://SEU-HOST/api/events/track"></script>
 * Se data-endpoint for omitido, usa a MESMA origem de onde o pixel foi servido.
 *
 * API pública (window.mktos):
 *   mktos.page()                         → dispara um page_view
 *   mktos.track('purchase', { value })   → evento custom (value entra em receita)
 *   mktos.identify('user-123')           → associa um user_id aos próximos eventos
 * Antes do script carregar, chamadas podem ser enfileiradas em window.mktos.q = [].
 */
(function () {
  'use strict';
  if (window.mktos && window.mktos.__loaded) return;

  var scriptEl = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  function scriptOrigin() {
    try { return new URL(scriptEl.src).origin; } catch (e) { return window.location.origin; }
  }

  var ENDPOINT =
    (scriptEl && scriptEl.getAttribute('data-endpoint')) ||
    window.MKTOS_ENDPOINT ||
    scriptOrigin() + '/api/events/track';

  // --- ids -----------------------------------------------------------------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function store(kind, key, factory) {
    var s = kind === 'local' ? 'localStorage' : 'sessionStorage';
    try {
      var v = window[s].getItem(key);
      if (!v) { v = factory(); window[s].setItem(key, v); }
      return v;
    } catch (e) {
      // modo privado / cookies bloqueados → id efêmero em memória
      return factory();
    }
  }

  var SESSION_TTL = 30 * 60 * 1000; // 30 min de inatividade encerram a sessão
  function sessionId() {
    var now = Date.now();
    try {
      var sid = window.sessionStorage.getItem('mktos_sid');
      var last = parseInt(window.sessionStorage.getItem('mktos_sid_ts') || '0', 10);
      if (!sid || (now - last) > SESSION_TTL) sid = uuid();
      window.sessionStorage.setItem('mktos_sid', sid);
      window.sessionStorage.setItem('mktos_sid_ts', String(now));
      return sid;
    } catch (e) {
      return uuid();
    }
  }

  var anonymousId = store('local', 'mktos_aid', uuid);
  var userId = null;

  // --- utms & device -------------------------------------------------------
  function utms() {
    var out = {};
    try {
      var p = new URLSearchParams(window.location.search);
      ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
        var v = p.get('utm_' + k);
        if (v) out['utm_' + k] = v;
      });
    } catch (e) {}
    return out;
  }

  function device() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  }

  // --- envio ---------------------------------------------------------------
  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
    } catch (e) {}
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'omit',
      }).catch(function () {});
    } catch (e) {}
  }

  function track(eventName, props) {
    props = props || {};
    var payload = {
      event_name: eventName,
      event_id: uuid(),
      session_id: sessionId(),
      anonymous_id: anonymousId,
      url: window.location.href,
      referrer: document.referrer || undefined,
      device: device(),
      ts: Date.now(),
    };
    if (userId) payload.user_id = userId;
    if (typeof props.value === 'number') payload.value = props.value;
    var u = utms();
    for (var k in u) payload[k] = u[k];
    // demais props viram metadata
    var meta = {};
    for (var p in props) if (p !== 'value') meta[p] = props[p];
    if (Object.keys(meta).length) payload.metadata = meta;
    send(payload);
  }

  function page() { track('page_view'); }
  function identify(id) { userId = id ? String(id) : null; }

  // --- API pública + fila pré-carregamento --------------------------------
  var queued = (window.mktos && window.mktos.q) || [];
  var api = { __loaded: true, track: track, page: page, identify: identify, endpoint: ENDPOINT };
  window.mktos = api;

  // processa chamadas enfileiradas antes do load: ['track','name',{...}]
  queued.forEach(function (args) {
    try {
      var fn = api[args[0]];
      if (typeof fn === 'function') fn.apply(null, args.slice(1));
    } catch (e) {}
  });

  // page_view automático (inclui SPAs via History API)
  page();
  try {
    var wrap = function (type) {
      var orig = history[type];
      return function () {
        var r = orig.apply(this, arguments);
        setTimeout(page, 0);
        return r;
      };
    };
    history.pushState = wrap('pushState');
    history.replaceState = wrap('replaceState');
    window.addEventListener('popstate', function () { setTimeout(page, 0); });
  } catch (e) {}
})();
