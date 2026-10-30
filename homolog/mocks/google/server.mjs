// DUBLÊ DO GOOGLE (CALENDAR) — homologação da agenda v2 (29/10/2026).
//
// Emula só o que o conector do Google usa da agenda, com `GOOGLE_API_DUBLE_URL`
// apontando para cá (o conector troca a origem de www.googleapis.com e de
// oauth2.googleapis.com pela deste servidor; ver apps/api/src/google/dubles-do-google.ts):
//
//   POST   /token                                       troca o refresh token por um access token (qualquer valor vale)
//   GET    /oauth2/v2/userinfo                          a conta (a sonda de saúde do conector)
//   GET    /calendar/v3/calendars/primary/events        list: com syncToken só o que mudou (token velho ou marcado = 410);
//                                                       sem ele, timeMin/timeMax; showDeleted; maxResults + pageToken
//   POST   /calendar/v3/calendars/primary/events        insert (id do cliente aceito; repetido = 409; conferenceDataVersion=1
//                                                       com createRequest cria o Meet; sendUpdates guardado)
//   GET    /calendar/v3/calendars/primary/events/:id    get
//   PATCH  /calendar/v3/calendars/primary/events/:id    patch (mescla)
//   PUT    /calendar/v3/calendars/primary/events/:id    update (troca o corpo)
//   DELETE /calendar/v3/calendars/primary/events/:id    marca cancelled (o evento fica, como no Google com showDeleted)
//   POST   /calendar/v3/freeBusy                        livre/ocupado das agendas pessoais configuradas
//
// A PORTA DE CONTROLE (`/_duble/...`) é do e2e, nunca do OS:
//   GET  /_duble/saude                     { ok: true }
//   POST /_duble/zerar                     apaga eventos, pedidos, livre/ocupado e tokens
//   POST /_duble/semear                    { eventos: [...], limpar?: true } — cada evento como o Google o devolve
//   POST /_duble/mexer/:id                 { ...campos } — "pelo celular": muda o evento sem passar pela API
//   POST /_duble/cancelar/:id              "apagado pelo celular": status cancelled
//   POST /_duble/sumir/:id                 o evento some de vez (nem cancelled volta: só a janela completa percebe)
//   POST /_duble/invalidar-sync            todo syncToken emitido até agora passa a responder 410
//   POST /_duble/livre-ocupado             { "<email>": [{start, end}] | "naoCompartilhada" } (mescla; null tira)
//   GET  /_duble/eventos                   o estado do calendário
//   GET  /_duble/pedidos                   tudo o que a API mandou: { metodo, caminho, query, corpo, sendUpdates, em }
//   DELETE /_duble/pedidos                 zera a lista de pedidos
//
// Autenticação: `Authorization: Bearer <qualquer coisa>` nas rotas do Google (sem ela, 401).
// Estado em memória: reiniciar o container zera tudo. Nenhum dado real: e-mails
// de exemplo com domínio `.invalid`.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORTA = Number(process.env.PORT ?? 4021);
const CONTA = process.env.CONTA ?? 'operacao.root@exemplo.invalid';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://127.0.0.1:${PORTA}`).replace(/\/$/, '');

let estado;
function zerar() {
  estado = {
    seq: 1,
    eventos: new Map(), // id → { ...evento, _seq }
    sumidos: new Set(),
    invalidadoAte: 0,
    livreOcupado: {},
    pedidos: [],
  };
}
zerar();

const agora = () => new Date().toISOString();
const proximo = () => ++estado.seq;

function json(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

function erroGoogle(res, code, message, reason = 'invalid') {
  json(res, code, { error: { code, message, errors: [{ domain: 'global', reason, message }] } });
}

function lerCorpo(req) {
  return new Promise((ok) => {
    const partes = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => {
      const t = Buffer.concat(partes).toString('utf8');
      if (!t) return ok(null);
      try {
        ok(JSON.parse(t));
      } catch {
        ok(t);
      }
    });
  });
}

/** O evento como o Google o devolve (sem o carimbo interno). */
function publico({ _seq, ...e }) {
  void _seq;
  return e;
}

function instante(p) {
  if (!p) return NaN;
  if (p.dateTime) return Date.parse(p.dateTime);
  if (p.date) return Date.parse(`${p.date}T00:00:00-03:00`);
  return NaN;
}

/** Grava o evento com carimbo novo (é isso que o syncToken enxerga). */
function gravar(e) {
  const seq = proximo();
  const salvo = {
    kind: 'calendar#event',
    status: 'confirmed',
    organizer: { email: CONTA, self: true },
    creator: { email: CONTA, self: true },
    htmlLink: `${PUBLIC_URL}/_duble/ver/${encodeURIComponent(e.id)}`,
    ...e,
    updated: new Date(Date.now() + seq).toISOString(),
    _seq: seq,
  };
  estado.eventos.set(salvo.id, salvo);
  estado.sumidos.delete(salvo.id);
  return salvo;
}

function comMeet(e, conferenceDataVersion) {
  const pedido = e.conferenceData?.createRequest;
  if (!pedido || conferenceDataVersion !== '1') {
    const { conferenceData, ...resto } = e;
    return pedido ? resto : e;
  }
  const codigo = randomUUID().replace(/-/g, '').slice(0, 10);
  const uri = `https://meet.exemplo.invalid/${codigo.slice(0, 3)}-${codigo.slice(3, 7)}-${codigo.slice(7)}`;
  return {
    ...e,
    hangoutLink: uri,
    conferenceData: {
      createRequest: { ...pedido, status: { statusCode: 'success' } },
      entryPoints: [{ entryPointType: 'video', uri, label: uri.replace('https://', '') }],
      conferenceSolution: { key: { type: 'hangoutsMeet' }, name: 'Google Meet' },
      conferenceId: codigo,
    },
  };
}

function convidadosComResposta(lista) {
  if (!Array.isArray(lista)) return lista;
  return lista.map((a) => ({ responseStatus: 'needsAction', ...a, email: String(a.email ?? '').toLowerCase() }));
}

const TOKEN = /^sync-(\d+)$/;

function listar(q, res) {
  const showDeleted = q.get('showDeleted') === 'true';
  const syncToken = q.get('syncToken');
  const maxResults = Math.min(Math.max(Number(q.get('maxResults') ?? 250) || 250, 1), 2500);
  let lista = [...estado.eventos.values()];
  if (syncToken) {
    if (q.get('timeMin') || q.get('timeMax') || q.get('orderBy')) {
      return erroGoogle(res, 400, 'syncToken não combina com timeMin, timeMax nem orderBy.', 'invalidParameter');
    }
    const m = TOKEN.exec(syncToken);
    if (!m || Number(m[1]) <= estado.invalidadoAte) {
      return erroGoogle(res, 410, 'Sync token is no longer valid, a full sync is required.', 'fullSyncRequired');
    }
    const desde = Number(m[1]);
    // No incremental o cancelado sempre vem (só id e status), com ou sem showDeleted.
    lista = lista.filter((e) => e._seq > desde).map((e) => (e.status === 'cancelled' ? { id: e.id, status: 'cancelled', _seq: e._seq } : e));
  } else {
    const de = q.get('timeMin') ? Date.parse(q.get('timeMin')) : -Infinity;
    const ate = q.get('timeMax') ? Date.parse(q.get('timeMax')) : Infinity;
    lista = lista.filter((e) => {
      if (!showDeleted && e.status === 'cancelled') return false;
      const ini = instante(e.start);
      const fim = instante(e.end);
      return ini < ate && (Number.isNaN(fim) ? ini : fim) > de;
    });
  }
  if (q.get('orderBy') === 'startTime') lista.sort((a, b) => instante(a.start) - instante(b.start));
  else lista.sort((a, b) => a._seq - b._seq);
  const offset = Number(q.get('pageToken') ?? 0) || 0;
  const pagina = lista.slice(offset, offset + maxResults).map(publico);
  const mais = offset + maxResults < lista.length;
  json(res, 200, {
    kind: 'calendar#events',
    summary: CONTA,
    timeZone: 'America/Sao_Paulo',
    items: pagina,
    ...(mais ? { nextPageToken: String(offset + maxResults) } : { nextSyncToken: `sync-${estado.seq}` }),
  });
}

function livreOcupado(corpo, res) {
  const calendars = {};
  const de = Date.parse(corpo?.timeMin ?? '');
  const ate = Date.parse(corpo?.timeMax ?? '');
  if (Number.isNaN(de) || Number.isNaN(ate) || ate <= de) return erroGoogle(res, 400, 'timeMin/timeMax inválidos.', 'timeRangeEmpty');
  for (const { id } of corpo?.items ?? []) {
    const v = estado.livreOcupado[String(id).toLowerCase()];
    if (!v || v === 'naoCompartilhada') {
      calendars[id] = { busy: [], errors: [{ domain: 'global', reason: 'notFound' }] };
      continue;
    }
    calendars[id] = {
      busy: v.filter((b) => Date.parse(b.start) < ate && Date.parse(b.end) > de),
    };
  }
  json(res, 200, { kind: 'calendar#freeBusy', timeMin: corpo.timeMin, timeMax: corpo.timeMax, calendars });
}

const ID_DO_CLIENTE = /^[a-v0-9]{5,1024}$/;

async function rotaDoGoogle(req, res, url, corpo) {
  const caminho = url.pathname;
  const q = url.searchParams;

  if (req.method === 'POST' && caminho === '/token') {
    return json(res, 200, { access_token: `duble-${randomUUID()}`, expires_in: 3599, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/calendar' });
  }

  const auth = String(req.headers.authorization ?? '');
  if (!/^Bearer\s+\S+/.test(auth)) return erroGoogle(res, 401, 'Request is missing required authentication credential.', 'authError');

  if (req.method === 'GET' && caminho === '/oauth2/v2/userinfo') {
    return json(res, 200, { id: '100000000000000000001', email: CONTA, verified_email: true });
  }
  if (req.method === 'POST' && caminho === '/calendar/v3/freeBusy') return livreOcupado(corpo, res);

  const base = '/calendar/v3/calendars/primary/events';
  if (caminho === base) {
    if (req.method === 'GET') return listar(q, res);
    if (req.method === 'POST') {
      const e = corpo && typeof corpo === 'object' ? { ...corpo } : {};
      if (e.id !== undefined && !ID_DO_CLIENTE.test(String(e.id))) return erroGoogle(res, 400, 'Invalid resource id value.', 'invalid');
      e.id = e.id ?? randomUUID().replace(/-/g, '').replace(/[w-z]/g, 'a');
      if (estado.eventos.has(e.id)) return erroGoogle(res, 409, 'The requested identifier already exists.', 'duplicate');
      if (!e.start || !e.end) return erroGoogle(res, 400, 'Missing end time.', 'required');
      const salvo = gravar({ ...comMeet(e, q.get('conferenceDataVersion')), attendees: convidadosComResposta(e.attendees) });
      return json(res, 200, publico(salvo));
    }
  }
  if (caminho.startsWith(`${base}/`)) {
    const id = decodeURIComponent(caminho.slice(base.length + 1));
    const atual = estado.eventos.get(id);
    if (!atual) return erroGoogle(res, 404, 'Not Found', 'notFound');
    if (req.method === 'GET') return json(res, 200, publico(atual));
    if (req.method === 'DELETE') {
      if (atual.status === 'cancelled') return erroGoogle(res, 410, 'Resource has been deleted', 'deleted');
      gravar({ ...publico(atual), status: 'cancelled' });
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'PATCH' || req.method === 'PUT') {
      const mudanca = corpo && typeof corpo === 'object' ? corpo : {};
      const novo = req.method === 'PATCH'
        ? { ...publico(atual), ...mudanca }
        : { ...mudanca, organizer: atual.organizer, creator: atual.creator, htmlLink: atual.htmlLink };
      if (req.method === 'PATCH' && mudanca.extendedProperties) {
        novo.extendedProperties = {
          private: { ...(atual.extendedProperties?.private ?? {}), ...(mudanca.extendedProperties.private ?? {}) },
          shared: { ...(atual.extendedProperties?.shared ?? {}), ...(mudanca.extendedProperties.shared ?? {}) },
        };
      }
      novo.id = id;
      const salvo = gravar({ ...comMeet(novo, q.get('conferenceDataVersion')), attendees: convidadosComResposta(novo.attendees) });
      return json(res, 200, publico(salvo));
    }
  }
  return erroGoogle(res, 404, `O dublê não conhece ${req.method} ${caminho}.`, 'notFound');
}

async function rotaDeControle(req, res, url, corpo) {
  const c = url.pathname.slice('/_duble'.length);
  if (req.method === 'GET' && c === '/saude') return json(res, 200, { ok: true, eventos: estado.eventos.size });
  if (req.method === 'POST' && c === '/zerar') {
    zerar();
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && c === '/semear') {
    if (corpo?.limpar) estado.eventos.clear();
    const gravados = [];
    for (const e of corpo?.eventos ?? []) {
      if (!e?.id || !e.start || !e.end) return json(res, 400, { erro: 'cada evento precisa de id, start e end' });
      gravados.push(publico(gravar({ ...e, attendees: convidadosComResposta(e.attendees) })));
    }
    return json(res, 200, { ok: true, eventos: gravados });
  }
  let m = /^\/mexer\/(.+)$/.exec(c);
  if (req.method === 'POST' && m) {
    const atual = estado.eventos.get(decodeURIComponent(m[1]));
    if (!atual) return json(res, 404, { erro: 'evento não existe' });
    return json(res, 200, publico(gravar({ ...publico(atual), ...(corpo ?? {}), id: atual.id })));
  }
  m = /^\/cancelar\/(.+)$/.exec(c);
  if (req.method === 'POST' && m) {
    const atual = estado.eventos.get(decodeURIComponent(m[1]));
    if (!atual) return json(res, 404, { erro: 'evento não existe' });
    return json(res, 200, publico(gravar({ ...publico(atual), status: 'cancelled' })));
  }
  m = /^\/sumir\/(.+)$/.exec(c);
  if (req.method === 'POST' && m) {
    const id = decodeURIComponent(m[1]);
    const existia = estado.eventos.delete(id);
    if (existia) estado.sumidos.add(id);
    return json(res, existia ? 200 : 404, { ok: existia });
  }
  if (req.method === 'POST' && c === '/invalidar-sync') {
    estado.invalidadoAte = estado.seq;
    proximo();
    return json(res, 200, { ok: true, invalidadoAte: estado.invalidadoAte });
  }
  if (req.method === 'POST' && c === '/livre-ocupado') {
    for (const [email, v] of Object.entries(corpo ?? {})) {
      const k = email.toLowerCase();
      if (v === null) delete estado.livreOcupado[k];
      else estado.livreOcupado[k] = v;
    }
    return json(res, 200, { ok: true, agendas: Object.keys(estado.livreOcupado) });
  }
  if (req.method === 'GET' && c === '/eventos') return json(res, 200, { eventos: [...estado.eventos.values()].map(publico) });
  if (req.method === 'GET' && c === '/pedidos') return json(res, 200, { pedidos: estado.pedidos });
  if (req.method === 'DELETE' && c === '/pedidos') {
    estado.pedidos = [];
    return json(res, 200, { ok: true });
  }
  m = /^\/ver\/(.+)$/.exec(c);
  if (req.method === 'GET' && m) {
    const e = estado.eventos.get(decodeURIComponent(m[1]));
    return e ? json(res, 200, publico(e)) : json(res, 404, { erro: 'evento não existe' });
  }
  return json(res, 404, { erro: `controle desconhecido: ${req.method} ${c}` });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://duble');
    const corpo = ['POST', 'PATCH', 'PUT'].includes(req.method ?? '') ? await lerCorpo(req) : null;
    if (url.pathname.startsWith('/_duble/')) return await rotaDeControle(req, res, url, corpo);
    estado.pedidos.push({
      metodo: req.method,
      caminho: url.pathname,
      query: Object.fromEntries(url.searchParams),
      // O corpo do /token leva o refresh token: guardado só o tipo da troca.
      corpo: url.pathname === '/token' ? { grant_type: new URLSearchParams(String(corpo ?? '')).get('grant_type') } : corpo,
      sendUpdates: url.searchParams.get('sendUpdates'),
      em: agora(),
    });
    return await rotaDoGoogle(req, res, url, corpo);
  } catch (e) {
    erroGoogle(res, 500, `dublê: ${e?.message ?? e}`, 'backendError');
  }
}).listen(PORTA, () => {
  console.log(`dublê do Google em ${PUBLIC_URL} (porta ${PORTA})`);
});
