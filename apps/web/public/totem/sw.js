/*
 * SERVICE WORKER DO QUIOSQUE (escopo /totem/).
 *
 * Guarda a casca do quiosque e os arquivos de /_next/static para o totem abrir
 * sem internet. Os dados (catálogo, fila de eventos) ficam no IndexedDB, pela
 * página; aqui só passam arquivos.
 *
 *   · /_next/static/** e arquivos de /totem/: cache primeiro (o nome muda a
 *     cada build, então nunca ficam velhos);
 *   · páginas de /totem/: rede primeiro, com a cópia guardada se a rede falhar;
 *   · /api/** (catálogo, eventos, /api/totem-gestao, /api/auth) e qualquer
 *     pedido com credencial: nunca passam por aqui.
 *
 * Mudou este arquivo? Suba VERSAO junto com TOTEM_VERSAO_DO_QUIOSQUE
 * (components/totem/quiosque/sincronia.ts).
 */

const VERSAO = 'totem-v1';
const ESTATICO = `${VERSAO}-estatico`;
const PAGINAS = `${VERSAO}-paginas`;
const CASCA = '/totem/quiosque';
const PAGINAS_GUARDADAS = [CASCA, '/totem/privacidade'];
const ARQUIVOS_GUARDADOS = [
  '/totem/manifest.webmanifest',
  '/totem/selo-sr-agranel-150.jpg',
  '/totem/icone-192.png',
  '/totem/icone-512.png',
];
const MAXIMO_DE_ESTATICOS = 300;
const PRAZO_DA_REDE_MS = 4000;
const PEDACOS = /["'](\/_next\/static\/[^"'\s\\]+)/g;

function pedacosDoHtml(html) {
  const urls = new Set();
  for (const m of html.matchAll(PEDACOS)) urls.add(m[1]);
  return [...urls];
}

async function guardarPagina(caminho) {
  const res = await fetch(caminho, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok || res.redirected) return [];
  const html = await res.clone().text();
  await (await caches.open(PAGINAS)).put(caminho, res);
  return pedacosDoHtml(html);
}

async function guardarEstaticos(urls) {
  const cache = await caches.open(ESTATICO);
  await Promise.all(
    urls.map(async (u) => {
      try {
        if (await cache.match(u)) return;
        const res = await fetch(u, { credentials: 'omit' });
        if (res.ok) await cache.put(u, res);
      } catch {
        /* um pedaço que falhar volta na próxima abertura com rede */
      }
    }),
  );
}

async function aparar() {
  const cache = await caches.open(ESTATICO);
  const chaves = await cache.keys();
  const sobra = chaves.length - MAXIMO_DE_ESTATICOS;
  for (let i = 0; i < sobra; i++) await cache.delete(chaves[i]);
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const pedacos = [];
      for (const pagina of PAGINAS_GUARDADAS) {
        try {
          pedacos.push(...(await guardarPagina(pagina)));
        } catch {
          /* sem rede na instalação: a página guarda o que carregou depois */
        }
      }
      await guardarEstaticos([...new Set(pedacos), ...ARQUIVOS_GUARDADOS]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes.filter((n) => n.startsWith('totem-') && !n.startsWith(`${VERSAO}-`)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

function deFora(pedido, url) {
  return (
    pedido.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/api' ||
    pedido.headers.has('authorization') ||
    pedido.headers.has('x-totem-token') ||
    pedido.headers.has('x-totem-etiqueta') ||
    pedido.headers.has('rsc') ||
    url.searchParams.has('_rsc')
  );
}

async function cacheAntes(pedido) {
  const cache = await caches.open(ESTATICO);
  const guardado = await cache.match(pedido, { ignoreVary: true });
  if (guardado) return guardado;
  const res = await fetch(pedido);
  if (res.ok && res.type === 'basic') await cache.put(pedido, res.clone());
  return res;
}

function semPagina() {
  return new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font:22px system-ui,sans-serif;background:#F5F3EC;color:#16200F;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px">' +
      '<p>Esta página abre quando o totem estiver com internet.</p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

async function redeAntes(pedido, url) {
  const cache = await caches.open(PAGINAS);
  const caminho = url.pathname.replace(/\/+$/, '') || '/';
  try {
    const rede = fetch(pedido);
    rede.catch(() => undefined);
    const res = await Promise.race([
      rede,
      new Promise((_, falhar) => setTimeout(() => falhar(new Error('prazo')), PRAZO_DA_REDE_MS)),
    ]);
    if (res.ok && !res.redirected && res.type === 'basic') await cache.put(caminho, res.clone());
    return res;
  } catch {
    const guardada = await cache.match(caminho, { ignoreVary: true });
    if (guardada) return guardada;
    // Só o próprio quiosque cai na casca; uma página de dentro dele (a
    // política, aberta no iframe) não pode virar outro quiosque.
    if (pedido.destination === 'document') {
      const casca = await cache.match(CASCA, { ignoreVary: true });
      if (casca) return casca;
    }
    return semPagina();
  }
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  const url = new URL(pedido.url);
  if (deFora(pedido, url)) return;

  if (url.pathname.startsWith('/_next/static/')) {
    evento.respondWith(cacheAntes(pedido));
    return;
  }
  if (!url.pathname.startsWith('/totem/')) return;
  if (pedido.mode === 'navigate') {
    evento.respondWith(redeAntes(pedido, url));
    return;
  }
  if (url.pathname.endsWith('/sw.js')) return;
  evento.respondWith(cacheAntes(pedido));
});

self.addEventListener('message', (evento) => {
  const dados = evento.data;
  if (!dados || dados.tipo !== 'guardar' || !Array.isArray(dados.urls)) return;
  const urls = dados.urls.filter((u) => {
    try {
      const url = new URL(u);
      return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');
    } catch {
      return false;
    }
  });
  evento.waitUntil(guardarEstaticos(urls.slice(0, MAXIMO_DE_ESTATICOS)).then(aparar));
});
