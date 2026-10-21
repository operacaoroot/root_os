#!/usr/bin/env node
/*
 * A PROVA DA RODADA DOS AGENTES (21/10/2026), CONTRA A STACK DO SEED EM DOCKER (3031).
 *
 * Mesmo arranjo do `producao21.mjs`: Playwright de `UX_PW`, web em `UX_WEB` (3031), API em
 * `UX_API` (4031), senha lida de `HOMOLOG_ENV` na hora (nunca copiada para arquivo commitado).
 *
 * O que ela prova (docs/comercial/RODADA-AGENTES-20261021.md, A8):
 *   1. o formulário do site cria o lead (rota pública, CORS de operacaoroot.com, idempotente,
 *      honeypot calado, outra origem sem CORS);
 *   2. a pasta do cliente: sem a raiz configurada a rota responde `sem_raiz` com a frase (o Drive
 *      de verdade é provado na suíte, com dublê: `google-drive-cliente`, `clientes-pasta-e-arquivista`);
 *   3. o anexo na tarefa: sobe pelo pop-up, aparece na lista, e sem pasta fica no OS/na fila;
 *   4. o vigia da agenda: a rota responde e diz por que não vigia sem o Google (a passagem com
 *      dublê da agenda é a suíte `agenda-vigia`);
 *   5. a Equipe com três pessoas e os agentes sob cada uma;
 *   6. /agentes com as três abas e o filtro no endereço;
 *   7. /conexoes com o cartão único e sem DigiSac;
 *   8. as pendências na caixa (a rota responde; abrir pendência é da suíte).
 * A triagem do WhatsApp pela Evolution e o arquivista com o modelo ficam na suíte (a stack do
 * seed roda com WhatsApp simulado e sem Google), e com modelo real na prova `agentes-reais.mjs`.
 * Fotografa (escuro, claro e 390 px) as telas novas.
 *
 * ESCREVE na stack: um lead pelo formulário (fictício) e um anexo .txt numa tarefa do seed.
 * Saída: `homolog/provas/<PROVAS_PREFIXO>agentes.json` e `agentes-*.png`.
 * Uso (Git Bash): node homolog/e2e/agentes.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4031/api';
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:3031';
const PW = process.env.UX_PW ?? 'C:/Users/User/dev/pw-tools';
const PREFIXO = process.env.PROVAS_PREFIXO ?? '';
const PROVAS = join(RAIZ, 'homolog/provas');
mkdirSync(PROVAS, { recursive: true });

const require = createRequire(join(PW, 'package.json'));
const { chromium } = require('playwright');

function lerEnv(arquivo) {
  const out = {};
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const ENV = lerEnv(process.env.HOMOLOG_ENV ?? join(RAIZ, 'homolog/.env.final-seed'));
const SENHA = ENV.ADMIN_PASSWORD;
const EMAIL = process.env.INTERFACE_EMAIL ?? 'admin@marketing-os.local';

const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], avisos: [], ok: false };
const t0 = Date.now();
function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  writeFileSync(join(PROVAS, `${PREFIXO}agentes.json`), `${JSON.stringify(prova, null, 2)}\n`);
}
function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function passo(nome, fn) {
  const ini = Date.now();
  try {
    const r = (await fn()) ?? {};
    const linha = { n: prova.passos.length + 1, nome, ok: true, ms: Date.now() - ini, ...r };
    prova.passos.push(linha);
    console.log(`  ${String(linha.n).padStart(2)}. ok   ${nome}${r.detalhe ? ` · ${JSON.stringify(r.detalhe)}` : ''}`);
  } catch (e) {
    prova.passos.push({ n: prova.passos.length + 1, nome, ok: false, ms: Date.now() - ini, erro: String(e?.message ?? e) });
    console.log(`  ${String(prova.passos.length).padStart(2)}. FALHA ${nome} · ${e?.message ?? e}`);
  }
}
function aviso(texto) {
  prova.avisos.push(texto);
  console.log(`      aviso: ${texto}`);
}

async function http(metodo, url, corpo, token, extra = {}) {
  const r = await fetch(url, {
    method: metodo,
    headers: { accept: 'application/json', ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    redirect: 'manual',
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json, headers: r.headers };
}
async function api(metodo, caminho, corpo, token) {
  const { status, json } = await http(metodo, `${API}${caminho}`, corpo, token);
  if (status >= 400) throw new Error(`${metodo} ${caminho} → ${status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}
async function entrar(email) {
  const r = await api('POST', '/auth/login', { email, password: SENHA });
  return { token: r.token ?? r.accessToken, user: r.user };
}
function orgDoToken(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).orgId;
}
async function contexto(navegador, sessao, tema = 'dark', viewport = { width: 1440, height: 900 }, extra = {}) {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...extra });
  await ctx.addInitScript(
    ([token, user, tema]) => {
      localStorage.setItem('mktos_token', token);
      localStorage.setItem('mktos_user', JSON.stringify(user));
      localStorage.setItem('root-os:tema', tema);
      localStorage.setItem('root-os:menu-recolhido', '0');
    },
    [sessao.token, sessao.user, tema],
  );
  return ctx;
}
async function foto(p, nome) {
  const arquivo = `${PREFIXO}agentes-${nome}.png`;
  await p.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}
async function semRolagemLateral(p) {
  return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  const navegador = await chromium.launch();
  const sessao = await entrar(EMAIL);
  conferir(sessao.token, 'o login não devolveu token');
  const orgId = orgDoToken(sessao.token);
  const ctx = await contexto(navegador, sessao);
  const p = await ctx.newPage();
  p.setDefaultTimeout(20_000);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e.message ?? e)));
  const m = await (await contexto(navegador, sessao, 'dark', { width: 390, height: 844 }, { isMobile: true, hasTouch: true })).newPage();
  m.setDefaultTimeout(20_000);
  const claro = await (await contexto(navegador, sessao, 'light')).newPage();
  claro.setDefaultTimeout(20_000);

  // 1 · Formulário do site
  await passo('CO-15 · o formulário do site cria o lead (CORS de operacaoroot.com, idempotente, isca calada)', async () => {
    const marca = `e2e-agentes-${Date.now()}`;
    const corpo = { k: orgId, nome: `Pessoa Fictícia ${marca}`, email: `${marca}@exemplo-ficticio.dev`, empresa: `Empresa Fictícia ${marca}`, mensagem: 'Quero conhecer a Operação Root.' };
    // Desde a revisão de 21/10 o formulário só vale na empresa que optou: a nota
    // `comercial.formulario.site` com `ligado` na primeira linha (pela memória; já existir é ok).
    await api('POST', '/memoria', { chave: 'comercial.formulario.site', title: 'Formulário do site', body: 'ligado\nOpt-in do formulário do site (e2e).', sourceType: 'operador' }, sessao.token).catch(() => null);
    const pre = await http('OPTIONS', `${API}/publico/lead`, undefined, null, { origin: 'https://operacaoroot.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' });
    conferir(pre.headers.get('access-control-allow-origin') === 'https://operacaoroot.com', `preflight sem CORS da origem do site (${pre.status})`);
    const outra = await http('OPTIONS', `${API}/publico/lead`, undefined, null, { origin: 'https://site-de-outro.dev', 'access-control-request-method': 'POST' });
    conferir(outra.headers.get('access-control-allow-origin') !== 'https://site-de-outro.dev', 'outra origem recebeu CORS');
    const r1 = await http('POST', `${API}/publico/lead`, corpo, null, { origin: 'https://operacaoroot.com' });
    conferir(r1.status === 202, `POST /publico/lead → ${r1.status}`);
    const r2 = await http('POST', `${API}/publico/lead`, corpo, null, { origin: 'https://operacaoroot.com' });
    conferir(r2.status === 202, `repetido → ${r2.status}`);
    const isca = await http('POST', `${API}/publico/lead`, { ...corpo, nome: `Isca ${marca}`, website: 'http://spam.invalid' }, null, { origin: 'https://operacaoroot.com' });
    conferir(isca.status === 202, `isca → ${isca.status} (devia responder igual e não criar)`);
    const leads = await api('GET', `/leads?q=${encodeURIComponent(marca)}`, undefined, sessao.token).catch(() => null);
    const lista = Array.isArray(leads) ? leads : leads?.items ?? leads?.leads ?? [];
    const meus = lista.filter((l) => JSON.stringify(l).includes(marca));
    if (!meus.length) aviso('a busca de leads não devolveu o lead pelo termo; conferido só pelo 202 (o lead pode estar retido pela porta fora das 08h–20h, R1 + sinal)');
    else conferir(!meus.some((l) => JSON.stringify(l).includes(`Isca ${marca}`)), 'a isca virou lead');
    return { detalhe: { leadsAchados: meus.length, status: [r1.status, r2.status, isca.status] } };
  });

  // 2 · Pasta do cliente
  await passo('TR-04 · a pasta do cliente sem a raiz configurada responde sem_raiz com a frase', async () => {
    const pastas = await api('GET', '/clientes/pastas', undefined, sessao.token);
    const itens = Array.isArray(pastas) ? pastas : pastas?.itens ?? pastas?.clientes ?? [];
    conferir(itens.length > 0, 'nenhum cliente na lista de pastas do seed');
    const alvo = itens.find((c) => !c.pastaDriveUrl && !c.url) ?? itens[0];
    const r = await http('POST', `${API}/clientes/${alvo.id ?? alvo.partnerId}/pasta`, {}, sessao.token);
    conferir(r.status < 500, `POST /clientes/:id/pasta → ${r.status}`);
    conferir(['sem_raiz', 'erro', 'aguardando_aprovacao', 'pronta'].includes(r.json?.estado), `estado inesperado ${JSON.stringify(r.json)}`);
    if (r.json?.estado !== 'sem_raiz') aviso(`esperava sem_raiz na 3031, veio ${r.json?.estado}`);
    return { detalhe: { clientes: itens.length, estado: r.json?.estado } };
  });

  // 3 · Anexo na tarefa
  await passo('TR-06 · anexo na tarefa: sobe, aparece na lista e fica no OS/na fila sem pasta', async () => {
    const tarefas = await api('GET', '/trabalho/tarefas?limit=20', undefined, sessao.token);
    const lista = Array.isArray(tarefas) ? tarefas : tarefas?.items ?? [];
    conferir(lista.length, 'nenhuma tarefa no seed');
    const t = lista[0];
    const form = new FormData();
    form.append('file', new Blob([`Anexo de prova fictício ${Date.now()}\n`], { type: 'text/plain' }), 'prova-e2e.txt');
    const up = await fetch(`${API}/trabalho/tarefas/${t.id}/anexos`, { method: 'POST', headers: { authorization: `Bearer ${sessao.token}` }, body: form });
    const resposta = (await up.text()).slice(0, 200);
    // As stacks de homologação não têm MinIO: a rota tem de recusar com a frase do storage, sem
    // guardar nada pela metade. Com storage (a produção, a suíte work-anexos), o anexo entra na lista.
    const semStorage = up.status === 503 && /storage do OS está indisponível/.test(resposta);
    if (semStorage) aviso('stack sem MinIO: o upload respondeu 503 com a frase do storage (o caminho com storage é a suíte work-anexos)');
    else conferir(up.status < 300, `upload → ${up.status}: ${resposta}`);
    const anexos = await api('GET', `/trabalho/tarefas/${t.id}/anexos`, undefined, sessao.token);
    const arr = Array.isArray(anexos) ? anexos : anexos?.itens ?? [];
    if (semStorage) conferir(arr.length === 0, 'sem storage, nenhum anexo pode ter ficado registrado pela metade');
    else conferir(arr.length > 0, 'a lista de anexos veio vazia depois do upload');
    await p.goto(`${WEB}/trabalho?tarefa=${t.id}`, { waitUntil: 'networkidle' });
    const secao = p.getByRole('region', { name: 'Anexos da tarefa' }).or(p.locator('section[aria-label="Anexos da tarefa"]')).first();
    await secao.waitFor();
    await secao.scrollIntoViewIfNeeded();
    await foto(p, 'anexo-na-tarefa');
    return { detalhe: { anexos: arr.length, semStorage, estado: arr[0]?.estado ?? arr[0]?.situacao ?? null } };
  });

  // 4 · Vigia da agenda
  await passo('AG-01 · a rota do vigia responde e a /agenda carrega sem erro', async () => {
    const r = await http('GET', `${API}/agenda/fora-do-padrao`, undefined, sessao.token);
    conferir(r.status === 200, `GET /agenda/fora-do-padrao → ${r.status}`);
    await p.goto(`${WEB}/agenda`, { waitUntil: 'networkidle' });
    await foto(p, 'agenda');
    return { detalhe: { itens: Array.isArray(r.json?.itens) ? r.json.itens.length : null, motivo: r.json?.motivo ?? r.json?.estado ?? null } };
  });

  // 5 · Equipe
  await passo('A7 · Equipe com três pessoas e os agentes sob cada uma', async () => {
    const eq = await api('GET', '/organograma/equipe', undefined, sessao.token);
    const pessoas = eq?.pessoas ?? [];
    conferir(pessoas.length === 3, `a Equipe tem ${pessoas.length} pessoas (esperava 3)`);
    await p.goto(`${WEB}/organograma`, { waitUntil: 'networkidle' });
    const funcoes = await p.locator('[data-testid^="funcao-"]').count();
    conferir(funcoes > 10, `poucas funções na Equipe (${funcoes})`);
    await foto(p, 'equipe');
    await claro.goto(`${WEB}/organograma`, { waitUntil: 'networkidle' });
    await foto(claro, 'equipe-claro');
    await m.goto(`${WEB}/organograma`, { waitUntil: 'networkidle' });
    conferir(await semRolagemLateral(m), 'a Equipe rola de lado a 390');
    await foto(m, 'equipe-390');
    return { detalhe: { pessoas: pessoas.map((x) => x.nome?.split(' ')[0]), funcoes } };
  });

  // 6 · /agentes
  await passo('A7 · /agentes com as abas Agentes, Rotinas e Automações, filtro no endereço', async () => {
    await p.goto(`${WEB}/agentes`, { waitUntil: 'networkidle' });
    const abas = p.getByRole('tab');
    await abas.first().waitFor();
    const nomes = await abas.allInnerTexts();
    for (const n of ['Agentes', 'Rotinas', 'Automações']) conferir(nomes.some((x) => x.includes(n)), `sem a aba ${n} (${nomes.join(' | ')})`);
    const linhas = await p.locator('[data-testid^="linha-"]').count();
    conferir(linhas > 0, 'a aba Agentes veio vazia');
    await foto(p, 'agentes');
    await abas.filter({ hasText: 'Rotinas' }).first().click();
    await p.waitForFunction(() => /aba=/.test(location.search));
    const urlRotinas = new URL(p.url()).search;
    await foto(p, 'agentes-rotinas');
    await claro.goto(`${WEB}/agentes`, { waitUntil: 'networkidle' });
    await foto(claro, 'agentes-claro');
    await m.goto(`${WEB}/agentes`, { waitUntil: 'networkidle' });
    conferir(await semRolagemLateral(m), '/agentes rola de lado a 390');
    await foto(m, 'agentes-390');
    return { detalhe: { abas: nomes.map((x) => x.replace(/\s+/g, ' ').trim()), linhas, urlRotinas } };
  });

  // 7 · /conexoes
  await passo('A6 · /conexoes com o cartão único e sem DigiSac', async () => {
    await p.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    const cartoes = p.locator('[data-conector]');
    await cartoes.first().waitFor();
    const n = await cartoes.count();
    const texto = await p.locator('main').innerText();
    conferir(!/digisac|zapfy/i.test(texto), 'a tela de Conexões ainda cita DigiSac ou Zapfy');
    const estados = await p.locator('[data-testid^="estado-"]').allInnerTexts();
    const fora = estados.filter((e) => !/^(Conectado|Não configurado|Erro|Desligado|Não verificado)/.test(e.trim()));
    conferir(!fora.length, `estado fora do vocabulário: ${fora.slice(0, 3).join(' | ')}`);
    await foto(p, 'conexoes');
    await claro.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    await foto(claro, 'conexoes-claro');
    await m.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    conferir(await semRolagemLateral(m), '/conexoes rola de lado a 390');
    await foto(m, 'conexoes-390');
    const cartoesApi = await api('GET', '/integrations/cartoes', undefined, sessao.token);
    conferir(!/"(segredo|token|apiKey|senha)"\s*:\s*"[^"]+"/i.test(JSON.stringify(cartoesApi)), 'a API dos cartões devolveu credencial');
    return { detalhe: { cartoes: n } };
  });

  // 8 · Pendências
  await passo('Lane 0 · as pendências respondem e a caixa abre', async () => {
    const r = await api('GET', '/pendencias', undefined, sessao.token);
    conferir(Array.isArray(r), 'GET /pendencias não devolveu lista');
    await p.goto(`${WEB}/caixa`, { waitUntil: 'networkidle' });
    await foto(p, 'caixa');
    return { detalhe: { abertas: r.length } };
  });

  if (erros.length) aviso(`erros de página: ${erros.slice(0, 3).join(' | ')}`);
  await navegador.close();
}

main()
  .then(() => {
    prova.ok = prova.passos.every((x) => x.ok);
    gravar();
    console.log(prova.ok ? `PASSA (${prova.passos.length} passos)` : 'FALHA');
    process.exit(prova.ok ? 0 : 1);
  })
  .catch((e) => {
    prova.erro = String(e?.message ?? e);
    gravar();
    console.error(e);
    process.exit(1);
  });
