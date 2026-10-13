// DUBLÊ DO ASAAS — homologação do cockpit comercial (13/10/2026).
//
// Emula só o que a porta de cobrança usa da API v3 do Asaas:
//   POST /v3/customers                      cria cliente
//   GET  /v3/customers?cpfCnpj=             acha cliente pelo documento
//   POST /v3/payments                       cria cobrança (à vista ou parcelada: installmentCount + installmentValue)
//   GET  /v3/payments/:id                   lê cobrança
//   POST /v3/payments/:id                   atualiza a cobrança aberta (valor, vencimento)
//   GET  /v3/payments?installment=|externalReference=   lista cobranças
//   GET  /v3/payments/:id/pixQrCode         Pix copia e cola (fictício)
//   GET  /v3/finance/balance                saldo (para a sonda de saúde)
// Autenticação: cabeçalho `access_token` (qualquer valor não vazio vale no dublê).
//
// A página de SIMULAR (GET /) lista as cobranças e tem o botão "Pagar" que muda
// o estado para RECEIVED e dispara o webhook para a API, como o Asaas faria:
//   POST $WEBHOOK_URL  com cabeçalho `asaas-access-token: $WEBHOOK_TOKEN`
//   corpo { id, event: 'PAYMENT_RECEIVED', dateCreated, payment: {...} }
// O estado vive em memória e num arquivo JSON (/data/estado.json), para um
// reinício do container não apagar o que a API já gravou.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const PORTA = Number(process.env.PORT ?? 4011);
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? '';
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN ?? 'homolog';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://127.0.0.1:${PORTA}`).replace(/\/$/, '');
const ARQUIVO = process.env.ESTADO ?? '/data/estado.json';

let estado = { clientes: [], cobrancas: [], webhooks: [] };
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

const hoje = () => new Date().toISOString().slice(0, 10);
const id = (p) => `${p}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

function somarMeses(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

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
  if ((req.headers['content-type'] ?? '').includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(bruto));
  }
  try {
    return JSON.parse(bruto);
  } catch {
    return {};
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function dispararWebhook(evento, cobranca) {
  const corpo = { id: id('evt'), event: evento, dateCreated: new Date().toISOString(), payment: cobranca };
  const registro = { em: new Date().toISOString(), evento, cobranca: cobranca.id, status: null, erro: null };
  if (!WEBHOOK_URL) {
    registro.erro = 'WEBHOOK_URL vazio';
  } else {
    try {
      const r = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'asaas-access-token': WEBHOOK_TOKEN },
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

function pagar(cob) {
  if (cob.status === 'RECEIVED' || cob.status === 'CONFIRMED') return false;
  cob.status = 'RECEIVED';
  cob.paymentDate = hoje();
  cob.clientPaymentDate = hoje();
  cob.confirmedDate = hoje();
  salvar();
  return true;
}

function pagina() {
  const linhas = estado.cobrancas
    .slice()
    .reverse()
    .map((c) => {
      const cli = estado.clientes.find((x) => x.id === c.customer);
      const pago = c.status === 'RECEIVED' || c.status === 'CONFIRMED';
      return `<tr><td><code>${esc(c.id)}</code></td><td>${esc(cli?.name ?? c.customer)}</td><td>${esc(c.externalReference ?? '')}</td>
<td>${c.installmentNumber ? `${c.installmentNumber}/${esc(c.installmentCount)}` : 'única'}</td><td>R$ ${Number(c.value).toFixed(2).replace('.', ',')}</td>
<td>${esc(c.billingType)}</td><td>${esc(c.dueDate)}</td><td>${esc(c.status)}</td>
<td>${pago ? '' : `<form method="post" action="/simular/pagar/${esc(c.id)}"><button>Pagar</button></form>`}</td></tr>`;
    })
    .join('');
  const hooks = estado.webhooks
    .map((w) => `<li>${esc(w.em)} · ${esc(w.evento)} · ${esc(w.cobranca)} · ${w.status ?? '-'} ${w.erro ? `· ${esc(w.erro)}` : ''}</li>`)
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dublê do Asaas · homologação</title>
<style>body{font-family:system-ui,Arial,sans-serif;margin:24px;background:#111;color:#eee}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #333;padding:6px 8px;text-align:left;font-size:14px}button{padding:6px 12px;cursor:pointer}
code{font-size:12px}h1{font-size:20px}.aviso{color:#f5c26b}</style></head><body>
<h1>Dublê do Asaas · homologação do cockpit comercial</h1>
<p class="aviso">Ambiente de teste. Nenhum dinheiro real passa por aqui. "Pagar" simula o Pix e dispara o webhook para a API.</p>
<table><thead><tr><th>cobrança</th><th>cliente</th><th>referência</th><th>parcela</th><th>valor</th><th>forma</th><th>vence</th><th>estado</th><th></th></tr></thead>
<tbody>${linhas || '<tr><td colspan="9">Nenhuma cobrança ainda.</td></tr>'}</tbody></table>
<h2>Webhooks disparados</h2><ul>${hooks || '<li>nenhum</li>'}</ul></body></html>`;
}

function paginaDaFatura(c) {
  const cli = estado.clientes.find((x) => x.id === c.customer);
  const pago = c.status === 'RECEIVED' || c.status === 'CONFIRMED';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fatura ${esc(c.id)} · dublê</title><style>body{font-family:system-ui,Arial,sans-serif;margin:24px;max-width:520px}button{padding:10px 18px;font-size:16px}</style></head><body>
<h1>Fatura de teste</h1><p>${esc(cli?.name ?? '')}</p><p>${esc(c.description ?? '')}</p>
<p>Valor: R$ ${Number(c.value).toFixed(2).replace('.', ',')} · vence ${esc(c.dueDate)} · ${esc(c.billingType)}</p>
<p>Estado: <strong>${esc(c.status)}</strong></p>
${pago ? '<p>Pago.</p>' : `<form method="post" action="/simular/pagar/${esc(c.id)}?voltar=fatura"><button>Simular pagamento</button></form>`}
<p><small>Ambiente de homologação. Nenhum dinheiro real.</small></p></body></html>`;
}

const autenticado = (req) => Boolean(req.headers['access_token']);

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const caminho = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'GET' && caminho === '/') return html(res, pagina());
    if (req.method === 'GET' && caminho === '/health') return json(res, 200, { ok: true });

    let m = caminho.match(/^\/fatura\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      const c = estado.cobrancas.find((x) => x.id === m[1]);
      return c ? html(res, paginaDaFatura(c)) : json(res, 404, { errors: [{ description: 'não encontrada' }] });
    }

    m = caminho.match(/^\/simular\/pagar\/([\w-]+)$/);
    if (req.method === 'POST' && m) {
      const c = estado.cobrancas.find((x) => x.id === m[1]);
      if (!c) return json(res, 404, { erro: 'cobrança não encontrada' });
      if (pagar(c)) await dispararWebhook('PAYMENT_RECEIVED', c);
      const destino = url.searchParams.get('voltar') === 'fatura' ? `/fatura/${c.id}` : '/';
      if ((req.headers.accept ?? '').includes('application/json')) return json(res, 200, c);
      res.writeHead(303, { location: destino });
      return res.end();
    }

    if (!caminho.startsWith('/v3/')) return json(res, 404, { errors: [{ description: 'rota desconhecida no dublê' }] });
    if (!autenticado(req)) return json(res, 401, { errors: [{ code: 'invalid_access_token', description: 'access_token ausente' }] });

    if (req.method === 'GET' && caminho === '/v3/finance/balance') return json(res, 200, { balance: 0 });

    if (req.method === 'GET' && caminho === '/v3/customers') {
      const doc = url.searchParams.get('cpfCnpj');
      const data = estado.clientes.filter((c) => !doc || c.cpfCnpj === doc);
      return json(res, 200, { object: 'list', hasMore: false, totalCount: data.length, limit: 100, offset: 0, data });
    }
    if (req.method === 'POST' && caminho === '/v3/customers') {
      const b = await lerCorpo(req);
      if (!b.name || !b.cpfCnpj) return json(res, 400, { errors: [{ code: 'invalid_customer', description: 'name e cpfCnpj obrigatórios' }] });
      const existente = estado.clientes.find((c) => c.cpfCnpj === String(b.cpfCnpj));
      if (existente) return json(res, 200, existente);
      const cli = { object: 'customer', id: id('cus'), dateCreated: hoje(), name: b.name, cpfCnpj: String(b.cpfCnpj), email: b.email ?? null, externalReference: b.externalReference ?? null };
      estado.clientes.push(cli);
      salvar();
      return json(res, 200, cli);
    }

    if (req.method === 'GET' && caminho === '/v3/payments') {
      const inst = url.searchParams.get('installment');
      const ref = url.searchParams.get('externalReference');
      const data = estado.cobrancas.filter((c) => (!inst || c.installment === inst) && (!ref || c.externalReference === ref));
      return json(res, 200, { object: 'list', hasMore: false, totalCount: data.length, limit: 100, offset: 0, data });
    }
    if (req.method === 'POST' && caminho === '/v3/payments') {
      const b = await lerCorpo(req);
      if (!b.customer || !estado.clientes.some((c) => c.id === b.customer)) {
        return json(res, 400, { errors: [{ code: 'invalid_customer', description: 'cliente inexistente' }] });
      }
      if (!['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED'].includes(b.billingType)) {
        return json(res, 400, { errors: [{ code: 'invalid_billingType', description: 'billingType inválido' }] });
      }
      const n = Number(b.installmentCount ?? 1);
      const valorParcela = Number(b.installmentValue ?? b.value);
      if (!(n >= 1) || !(valorParcela > 0) || !b.dueDate) {
        return json(res, 400, { errors: [{ code: 'invalid_value', description: 'valor, parcelas e vencimento obrigatórios' }] });
      }
      const installment = n > 1 ? id('ins') : null;
      const criadas = [];
      for (let i = 0; i < n; i++) {
        const cobId = id('pay');
        const c = {
          object: 'payment',
          id: cobId,
          dateCreated: hoje(),
          customer: b.customer,
          installment,
          installmentNumber: n > 1 ? i + 1 : null,
          installmentCount: n > 1 ? n : null,
          value: valorParcela,
          netValue: valorParcela,
          billingType: b.billingType,
          status: 'PENDING',
          dueDate: somarMeses(b.dueDate, i),
          description: b.description ?? null,
          externalReference: b.externalReference ?? null,
          invoiceUrl: `${PUBLIC_URL}/fatura/${cobId}`,
          bankSlipUrl: b.billingType === 'BOLETO' ? `${PUBLIC_URL}/fatura/${cobId}` : null,
          paymentDate: null,
        };
        estado.cobrancas.push(c);
        criadas.push(c);
      }
      salvar();
      return json(res, 200, criadas[0]);
    }

    m = caminho.match(/^\/v3\/payments\/([\w-]+)\/pixQrCode$/);
    if (req.method === 'GET' && m) {
      const c = estado.cobrancas.find((x) => x.id === m[1]);
      if (!c) return json(res, 404, { errors: [{ description: 'não encontrada' }] });
      const payload = `00020126HOMOLOGACAO-DUBLE-ASAAS-${c.id}-${Number(c.value).toFixed(2)}5204000053039865802BR6304TEST`;
      return json(res, 200, { encodedImage: '', payload, expirationDate: `${c.dueDate} 23:59:59` });
    }
    m = caminho.match(/^\/v3\/payments\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      const c = estado.cobrancas.find((x) => x.id === m[1]);
      return c ? json(res, 200, c) : json(res, 404, { errors: [{ description: 'não encontrada' }] });
    }
    // Atualiza a cobrança ainda aberta (D-11: a última parcela que absorve a diferença do total).
    if (req.method === 'POST' && m) {
      const c = estado.cobrancas.find((x) => x.id === m[1]);
      if (!c) return json(res, 404, { errors: [{ description: 'não encontrada' }] });
      if (!['PENDING', 'OVERDUE'].includes(c.status)) return json(res, 400, { errors: [{ code: 'invalid_action', description: 'só cobrança aberta pode mudar' }] });
      const b = await lerCorpo(req);
      if (b.value !== undefined) {
        const v = Number(b.value);
        if (!(v > 0)) return json(res, 400, { errors: [{ code: 'invalid_value', description: 'valor inválido' }] });
        c.value = v;
        c.netValue = v;
      }
      if (b.dueDate) c.dueDate = b.dueDate;
      salvar();
      return json(res, 200, c);
    }

    return json(res, 404, { errors: [{ description: `rota não emulada: ${req.method} ${caminho}` }] });
  } catch (e) {
    return json(res, 500, { errors: [{ description: String(e?.message ?? e) }] });
  }
});

servidor.listen(PORTA, '0.0.0.0', () => console.log(`dublê do Asaas em :${PORTA} (webhook → ${WEBHOOK_URL || 'nenhum'})`));
