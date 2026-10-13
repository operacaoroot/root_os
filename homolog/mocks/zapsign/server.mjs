// DUBLÊ DA ZAPSIGN — homologação do cockpit comercial (13/10/2026).
//
// Emula só o que a porta de assinatura usa da API v1 da ZapSign:
//   POST /api/v1/docs/                cria documento (markdown_text ou base64_pdf) com signatários
//   GET  /api/v1/docs/:token/         lê documento e estado dos signatários
// Autenticação: `Authorization: Bearer <token>` (qualquer valor não vazio vale no dublê).
//
// Cada signatário ganha um `sign_url` público nesta página (/assinar/:tokenDoSignatario).
// "Assinar" marca o signatário como `signed` e dispara o webhook para a API,
// como a ZapSign faz:
//   POST $WEBHOOK_URL  com cabeçalho `x-zapsign-token: $WEBHOOK_TOKEN`
//   corpo { event_type: 'doc_signed' | 'signer_signed', token, status, signers: [...], signer_who_signed: {...} }
// `doc_signed` só quando TODOS assinaram; antes disso, `signer_signed`.
// A página raiz lista os documentos com os botões de simular.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PORTA = Number(process.env.PORT ?? 4012);
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? '';
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN ?? 'homolog';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://127.0.0.1:${PORTA}`).replace(/\/$/, '');
const ARQUIVO = process.env.ESTADO ?? '/data/estado.json';

let estado = { docs: [], webhooks: [] };
try {
  if (existsSync(ARQUIVO)) estado = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
} catch {
  /* estado novo */
}
function salvar() {
  try {
    mkdirSync(ARQUIVO.replace(/\/[^/]*$/, ''), { recursive: true });
    writeFileSync(ARQUIVO, JSON.stringify(estado));
  } catch {
    /* sem disco: segue em memória */
  }
}

const novoToken = () => randomUUID();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function json(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}
function html(res, corpo) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(corpo);
}
async function lerCorpo(req) {
  const partes = [];
  for await (const p of req) partes.push(p);
  const bruto = Buffer.concat(partes).toString('utf8');
  if (!bruto) return {};
  try {
    return JSON.parse(bruto);
  } catch {
    return {};
  }
}

function publico(doc) {
  const { conteudo, ...resto } = doc;
  return resto;
}

async function dispararWebhook(doc, signatario) {
  const todos = doc.signers.every((s) => s.status === 'signed');
  const corpo = {
    event_type: todos ? 'doc_signed' : 'signer_signed',
    token: doc.token,
    name: doc.name,
    status: doc.status,
    external_id: doc.external_id,
    signed_file: doc.signed_file,
    signers: doc.signers,
    signer_who_signed: signatario,
  };
  const registro = { em: new Date().toISOString(), evento: corpo.event_type, doc: doc.token, signatario: signatario.name, status: null, erro: null };
  if (!WEBHOOK_URL) registro.erro = 'WEBHOOK_URL vazio';
  else {
    try {
      const r = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zapsign-token': WEBHOOK_TOKEN },
        body: JSON.stringify(corpo),
      });
      registro.status = r.status;
      if (!r.ok) registro.erro = (await r.text()).slice(0, 300);
    } catch (e) {
      registro.erro = String(e?.message ?? e);
    }
  }
  estado.webhooks.unshift(registro);
  estado.webhooks = estado.webhooks.slice(0, 50);
  salvar();
  return registro;
}

async function assinar(tokenDoSignatario) {
  for (const doc of estado.docs) {
    const s = doc.signers.find((x) => x.token === tokenDoSignatario);
    if (!s) continue;
    if (s.status === 'signed') return { doc, s, novo: false };
    s.status = 'signed';
    s.signed_at = new Date().toISOString();
    if (doc.signers.every((x) => x.status === 'signed')) {
      doc.status = 'signed';
      doc.signed_file = `${PUBLIC_URL}/documento/${doc.token}`;
    }
    salvar();
    await dispararWebhook(doc, s);
    return { doc, s, novo: true };
  }
  return null;
}

function pagina() {
  const linhas = estado.docs
    .slice()
    .reverse()
    .map((d) => {
      const sigs = d.signers
        .map(
          (s) =>
            `${esc(s.name)} (${esc(s.status)}) ${s.status === 'signed' ? '' : `<form style="display:inline" method="post" action="/simular/assinar/${esc(s.token)}"><button>Assinar</button></form>`} <a href="${esc(s.sign_url)}">link</a>`,
        )
        .join('<br>');
      return `<tr><td><code>${esc(d.token)}</code></td><td>${esc(d.name)}</td><td>${esc(d.external_id ?? '')}</td><td>${esc(d.status)}</td><td>${sigs}</td><td><a href="/documento/${esc(d.token)}">ver</a></td></tr>`;
    })
    .join('');
  const hooks = estado.webhooks
    .map((w) => `<li>${esc(w.em)} · ${esc(w.evento)} · ${esc(w.signatario)} · ${w.status ?? '-'} ${w.erro ? `· ${esc(w.erro)}` : ''}</li>`)
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dublê da ZapSign · homologação</title>
<style>body{font-family:system-ui,Arial,sans-serif;margin:24px;background:#111;color:#eee}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #333;padding:6px 8px;text-align:left;font-size:14px;vertical-align:top}a{color:#9cf}button{padding:4px 10px;cursor:pointer}
.aviso{color:#f5c26b}h1{font-size:20px}</style></head><body>
<h1>Dublê da ZapSign · homologação do cockpit comercial</h1>
<p class="aviso">Ambiente de teste. A assinatura daqui não tem validade jurídica. "Assinar" dispara o webhook para a API.</p>
<table><thead><tr><th>documento</th><th>nome</th><th>referência</th><th>estado</th><th>signatários</th><th></th></tr></thead>
<tbody>${linhas || '<tr><td colspan="6">Nenhum documento ainda.</td></tr>'}</tbody></table>
<h2>Webhooks disparados</h2><ul>${hooks || '<li>nenhum</li>'}</ul></body></html>`;
}

function paginaDeAssinar(doc, s) {
  const assinado = s.status === 'signed';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assinar · dublê</title><style>body{font-family:system-ui,Arial,sans-serif;margin:24px;max-width:720px}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px;font-size:13px;max-height:50vh;overflow:auto}button{padding:10px 18px;font-size:16px}</style></head><body>
<h1>${esc(doc.name)}</h1><p>Signatário: ${esc(s.name)} · ${esc(s.email ?? '')}</p>
<pre>${esc(doc.conteudo ?? '(PDF enviado em base64)')}</pre>
${assinado ? '<p><strong>Assinado.</strong></p>' : `<form method="post" action="/simular/assinar/${esc(s.token)}?voltar=assinar"><button>Simular assinatura</button></form>`}
<p><small>Ambiente de homologação. Sem validade jurídica.</small></p></body></html>`;
}

const autenticado = (req) => /^Bearer\s+\S+/.test(req.headers.authorization ?? '');

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const caminho = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'GET' && caminho === '/') return html(res, pagina());
    if (req.method === 'GET' && caminho === '/health') return json(res, 200, { ok: true });

    let m = caminho.match(/^\/assinar\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      for (const d of estado.docs) {
        const s = d.signers.find((x) => x.token === m[1]);
        if (s) return html(res, paginaDeAssinar(d, s));
      }
      return json(res, 404, { detail: 'não encontrado' });
    }
    m = caminho.match(/^\/documento\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      const d = estado.docs.find((x) => x.token === m[1]);
      if (!d) return json(res, 404, { detail: 'não encontrado' });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(d.conteudo ?? '');
    }
    m = caminho.match(/^\/simular\/assinar\/([\w-]+)$/);
    if (req.method === 'POST' && m) {
      const r = await assinar(m[1]);
      if (!r) return json(res, 404, { erro: 'signatário não encontrado' });
      if ((req.headers.accept ?? '').includes('application/json')) return json(res, 200, publico(r.doc));
      res.writeHead(303, { location: url.searchParams.get('voltar') === 'assinar' ? `/assinar/${m[1]}` : '/' });
      return res.end();
    }

    if (!caminho.startsWith('/api/v1/')) return json(res, 404, { detail: 'rota desconhecida no dublê' });
    if (!autenticado(req)) return json(res, 401, { detail: 'Authorization Bearer ausente' });

    if (req.method === 'POST' && caminho === '/api/v1/docs') {
      const b = await lerCorpo(req);
      if (!b.name || !Array.isArray(b.signers) || b.signers.length === 0) {
        return json(res, 400, { detail: 'name e signers obrigatórios' });
      }
      if (!b.markdown_text && !b.base64_pdf && !b.url_pdf) return json(res, 400, { detail: 'conteúdo obrigatório (markdown_text, base64_pdf ou url_pdf)' });
      const token = novoToken();
      const doc = {
        open_id: estado.docs.length + 1,
        token,
        name: b.name,
        status: 'pending',
        external_id: b.external_id ?? null,
        created_at: new Date().toISOString(),
        original_file: `${PUBLIC_URL}/documento/${token}`,
        signed_file: null,
        conteudo: b.markdown_text ?? null,
        signers: b.signers.map((s) => {
          const t = novoToken();
          return {
            token: t,
            name: s.name,
            email: s.email ?? null,
            phone_number: s.phone_number ?? null,
            external_id: s.external_id ?? null,
            status: 'new',
            sign_url: `${PUBLIC_URL}/assinar/${t}`,
            signed_at: null,
          };
        }),
      };
      estado.docs.push(doc);
      salvar();
      return json(res, 200, publico(doc));
    }
    // Lista (a sonda de saúde do conector pergunta por aqui). Acréscimo da lane D.
    if (req.method === 'GET' && caminho === '/api/v1/docs') {
      return json(res, 200, { count: estado.docs.length, next: null, previous: null, results: estado.docs.map(publico) });
    }
    m = caminho.match(/^\/api\/v1\/docs\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      const d = estado.docs.find((x) => x.token === m[1]);
      return d ? json(res, 200, publico(d)) : json(res, 404, { detail: 'não encontrado' });
    }

    return json(res, 404, { detail: `rota não emulada: ${req.method} ${caminho}` });
  } catch (e) {
    return json(res, 500, { detail: String(e?.message ?? e) });
  }
});

servidor.listen(PORTA, '0.0.0.0', () => console.log(`dublê da ZapSign em :${PORTA} (webhook → ${WEBHOOK_URL || 'nenhum'})`));
