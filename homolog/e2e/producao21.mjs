#!/usr/bin/env node
/*
 * A PROVA DA RODADA DE PRODUÇÃO 1 (21/10/2026), CONTRA A STACK DO SEED EM DOCKER.
 *
 * Mesmo arranjo do `interface.mjs`: Playwright (Chromium) de `UX_PW` (padrão
 * `C:/Users/User/dev/pw-tools`), o web em `UX_WEB` (padrão 3031), a API em `UX_API`
 * (padrão 4031), a senha lida de `HOMOLOG_ENV` em tempo de execução (nunca copiada para
 * arquivo commitado).
 *
 * O que ela prova (docs/comercial/RODADA-PRODUCAO-20261021.md, P10):
 *   P1 Visão geral sem rolagem lateral e o balão dentro da caixa (1440 e 390, toque);
 *   P2 Agenda por semana (grade no desktop, lista a 390 px) e a troca no endereço;
 *   P4 Todas com "Ocultar status vazios", a contagem, o endereço e a vista salva;
 *   P7 Atas: duas colunas, rolagem só na lista, busca por palavra e por data no endereço,
 *      as fontes com o estado de cada uma (Drive e Granola por dublê ficam na suíte da API);
 *   P8 Integrações com o cartão da Evolution e sem o DigiSac;
 *   P9 aba Sala com o estado e o "Copiar link da sala".
 * E fotografa (escuro, claro e 390 px) cada tela tocada.
 *
 * ESCREVE na stack: uma vista salva do Trabalho, uma ata colada e um "copiar link"
 * (auditoria `sala.link.copiado`).
 *
 * Saída: `homolog/provas/<PROVAS_PREFIXO>producao21.json` e `producao21-*.png`.
 * Uso (Git Bash): node homolog/e2e/producao21.mjs
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

let leadComSala = null;
const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], avisos: [], ok: false };
const t0 = Date.now();

function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  writeFileSync(join(PROVAS, `${PREFIXO}producao21.json`), `${JSON.stringify(prova, null, 2)}\n`);
}
function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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
    throw e;
  }
}
function aviso(texto) {
  prova.avisos.push(texto);
  console.log(`      aviso: ${texto}`);
}

async function http(metodo, url, corpo, token) {
  const r = await fetch(url, {
    method: metodo,
    headers: { accept: 'application/json', ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    redirect: 'manual',
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json };
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
  const arquivo = `${PREFIXO}producao21-${nome}.png`;
  await p.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}
async function semRolagemLateral(p) {
  return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

/* O gráfico (P1): nenhuma caixa rola de lado, e o balão da primeira e da última barra cabe na caixa. */
async function conferirGraficos(p, { toque = false } = {}) {
  const medidas = [];
  for (const titulo of ['Carga por prazo', 'Tarefas por lista']) {
    const quadro = p.locator('section').filter({ has: p.getByText(titulo, { exact: true }) }).first();
    await quadro.waitFor();
    await quadro.scrollIntoViewIfNeeded();
    const caixa = quadro.locator('[data-grafico-caixa]').first();
    await caixa.waitFor();
    const rola = await quadro.evaluate((q) => {
      const els = [q, ...q.querySelectorAll('*')];
      return els.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').length;
    });
    conferir(rola === 0, `"${titulo}" tem ${rola} elemento(s) com rolagem lateral`);
    const barras = caixa.locator('button[aria-label]');
    const n = await barras.count();
    conferir(n > 0, `"${titulo}" sem barras`);
    const fora = [];
    for (const i of [0, n - 1]) {
      const b = barras.nth(i);
      if (toque) await b.tap({ force: true }); else await b.hover({ force: true });
      const balao = caixa.locator('[data-balao]');
      await balao.waitFor({ state: 'visible' });
      const [rc, rb] = await Promise.all([caixa.boundingBox(), balao.boundingBox()]);
      const dentro = rb.x >= rc.x - 1 && rb.y >= rc.y - 1 && rb.x + rb.width <= rc.x + rc.width + 1 && rb.y + rb.height <= rc.y + rc.height + 1;
      if (!dentro) fora.push({ barra: i, caixa: rc, balao: rb });
      if (toque) {
        await p.mouse.click(2, 2);
        await balao.waitFor({ state: 'hidden' }).catch(() => balao.waitFor({ state: 'detached' }));
      } else {
        await p.mouse.move(2, 2);
      }
    }
    conferir(!fora.length, `"${titulo}": balão fora da caixa ${JSON.stringify(fora)}`);
    medidas.push({ titulo, barras: n, orientacao: await caixa.getAttribute('data-orientacao') });
  }
  return medidas;
}

async function main() {
  const navegador = await chromium.launch();
  const sessao = await entrar(EMAIL);
  conferir(sessao.token, 'o login não devolveu token');
  const ctx = await contexto(navegador, sessao, 'dark', { width: 1440, height: 900 }, { permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.setDefaultTimeout(20_000);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e.message ?? e)));
  const c390 = await contexto(navegador, sessao, 'dark', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  const m = await c390.newPage();
  m.setDefaultTimeout(20_000);
  const cClaro = await contexto(navegador, sessao, 'light');
  const claro = await cClaro.newPage();
  claro.setDefaultTimeout(20_000);

  // ---------------- P1 · Visão geral ----------------
  await passo('P1 · Visão geral a 1440: os gráficos cabem e o balão da primeira e da última coluna fica dentro', async () => {
    await p.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    const medidas = await conferirGraficos(p);
    conferir(await semRolagemLateral(p), 'a página rola de lado a 1440');
    await p.locator('section').filter({ has: p.getByText('Carga por prazo', { exact: true }) }).first().locator('button[aria-label]').last().hover();
    await foto(p, 'visao-geral-balao-escuro');
    await p.mouse.move(2, 2);
    return { detalhe: medidas };
  });

  await passo('P1 · Visão geral a 390 (toque): sem rolagem lateral, balão dentro, tocar fora fecha', async () => {
    await m.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    const medidas = await conferirGraficos(m, { toque: true });
    conferir(await semRolagemLateral(m), 'a página rola de lado a 390');
    await foto(m, 'visao-geral-390');
    await claro.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    await foto(claro, 'visao-geral-claro');
    return { detalhe: medidas };
  });

  // ---------------- P2 · Agenda ----------------
  await passo('P2 · Agenda: Semana no endereço, grade de horas no desktop, volta ao Mês', async () => {
    await p.goto(`${WEB}/agenda`, { waitUntil: 'networkidle' });
    const grupo = p.getByRole('group', { name: 'Visão da agenda' }).or(p.locator('[aria-label="Visão da agenda"]')).first();
    await grupo.waitFor();
    await grupo.getByRole('button', { name: /Semana/ }).click();
    await p.waitForURL((u) => new URL(u).searchParams.get('visao') === 'semana');
    const dia = new URL(p.url()).searchParams.get('dia');
    conferir(/^\d{4}-\d{2}-\d{2}$/.test(dia ?? ''), `o dia no endereço veio ${dia}`);
    conferir(await grupo.getByRole('button', { name: /Semana/ }).getAttribute('aria-pressed') === 'true', 'Semana não ficou marcada');
    await p.getByTitle('Próxima').click();
    await p.waitForURL((u) => new URL(u).searchParams.get('dia') !== dia);
    await p.getByRole('button', { name: 'Hoje' }).click();
    await dormir(300);
    conferir(await semRolagemLateral(p), 'a agenda semanal rola de lado');
    await foto(p, 'agenda-semana-escuro');
    await claro.goto(`${WEB}/agenda?visao=semana`, { waitUntil: 'networkidle' });
    await foto(claro, 'agenda-semana-claro');
    await grupo.getByRole('button', { name: /Mês/ }).click();
    await p.waitForURL((u) => (new URL(u).searchParams.get('visao') ?? 'mes') === 'mes');
    return { detalhe: { dia } };
  });

  await passo('P2 · Agenda a 390: a semana vira lista por dia, sem rolagem lateral', async () => {
    await m.goto(`${WEB}/agenda?visao=semana`, { waitUntil: 'networkidle' });
    await m.locator('[aria-label="Semana em lista"]').waitFor();
    conferir(await semRolagemLateral(m), 'a agenda semanal rola de lado a 390');
    await foto(m, 'agenda-semana-390');
  });

  // ---------------- P4 · Ocultar status vazios ----------------
  await passo('P4 · Todas: "Ocultar status vazios" alterna, conta, vai ao endereço e some com as colunas vazias', async () => {
    await p.goto(`${WEB}/trabalho?pasta=todas&visao=board`, { waitUntil: 'networkidle' });
    await p.locator('[data-work-task-id]').first().waitFor({ timeout: 20_000 });
    await dormir(400);
    const quadro = p.getByTestId('trabalho-quadro');
    const contar = () => quadro.locator('[data-coluna]').evaluateAll((cs) => cs.map((c) => c.querySelectorAll('[data-work-task-id]').length));
    const antes = await contar();
    const vaziasAntes = antes.filter((n) => !n).length;
    await p.getByTestId('trabalho-vazios').click();
    await p.waitForURL((u) => new URL(u).searchParams.get('vazios') === 'ocultar');
    await dormir(300);
    const depois = await contar();
    conferir(depois.every((n) => n > 0), 'ainda há coluna vazia com o modo ligado');
    conferir(depois.length === antes.length - vaziasAntes, `colunas ${antes.length} → ${depois.length}, vazias ${vaziasAntes}`);
    if (vaziasAntes) {
      const texto = (await p.getByTestId('trabalho-vazios-contagem').innerText()).replace(/^[\s·]+/, '').trim();
      conferir(texto.startsWith(String(vaziasAntes)), `a contagem diz "${texto}" e eram ${vaziasAntes}`);
    } else aviso('nenhuma coluna vazia no quadro do seed: a contagem não tem o que mostrar');
    await foto(p, 'todas-vazios-ocultos-escuro');
    return { detalhe: { colunasAntes: antes.length, vazias: vaziasAntes, colunasDepois: depois.length } };
  });

  await passo('P4 · a vista salva leva "Ocultar status vazios"', async () => {
    const nome = `Produção 21 ${Date.now().toString().slice(-6)}`;
    p.once('dialog', (d) => d.accept(nome));
    await p.getByTestId('trabalho-vista-salvar').click();
    await p.getByTestId('trabalho-vistas').getByText(`Vista "${nome}" salva.`).waitFor();
    const vistas = await api('GET', '/trabalho/vistas?tela=quadro', undefined, sessao.token);
    const lidas = Array.isArray(vistas) ? vistas : vistas?.vistas ?? vistas?.itens ?? [];
    const v = lidas.find((x) => x.nome === nome);
    conferir(v, 'a vista salva não voltou da API');
    conferir(JSON.stringify(v).includes('"vazios":"ocultar"'), `a vista não guardou vazios: ${JSON.stringify(v.filtros ?? v)}`);
    await claro.goto(`${WEB}/trabalho?pasta=todas&visao=board&vazios=ocultar`, { waitUntil: 'networkidle' });
    await foto(claro, 'todas-vazios-ocultos-claro');
    await m.goto(`${WEB}/trabalho?pasta=todas&visao=board&vazios=ocultar`, { waitUntil: 'networkidle' });
    conferir(await semRolagemLateral(m), 'o Trabalho rola de lado a 390');
    await foto(m, 'todas-vazios-390');
    return { detalhe: { nome } };
  });

  // ---------------- P7 · Atas ----------------
  await passo('P7 · Atas: duas colunas, a página não rola e a lista rola sozinha', async () => {
    await p.goto(`${WEB}/trabalho/atas`, { waitUntil: 'networkidle' });
    await p.getByTestId('atas-tela').waitFor();
    // uma ata colada, para a lista e a busca terem o que mostrar
    const titulo = `Ata da prova da produção 21 ${Date.now().toString().slice(-6)}`;
    await p.getByTestId('ata-colar').click();
    await p.getByTestId('ata-colar-titulo').fill(titulo);
    await p.getByTestId('ata-colar-texto').fill(readFileSync(join(RAIZ, 'homolog/fixtures/ata-trabalho-exemplo.md'), 'utf8'));
    await p.getByTestId('ata-colar-salvar').click();
    let ata = null;
    for (let i = 0; i < 30 && !ata; i++) {
      const r = await api('GET', '/trabalho/atas', undefined, sessao.token);
      ata = (r.atas ?? r.itens ?? []).find((a) => a.titulo === titulo) ?? null;
      if (!ata) await dormir(400);
    }
    conferir(ata, 'a ata colada não entrou no banco de atas');
    await p.goto(`${WEB}/trabalho/atas`, { waitUntil: 'networkidle' });
    const lista = p.getByTestId('atas-coluna-lista');
    await lista.waitFor();
    const medida = await p.evaluate(() => {
      const el = document.querySelector('[data-testid="atas-coluna-lista"]');
      const rolaveis = [el, ...el.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY));
      const r = el.getBoundingClientRect();
      const se = document.scrollingElement;
      return { rolavel: rolaveis.length > 0, baixo: Math.round(r.bottom), janela: window.innerHeight, pagina: se.scrollHeight, cabe: se.scrollHeight <= window.innerHeight + 1 };
    });
    conferir(medida.rolavel, 'a lista de atas não tem rolagem própria');
    conferir(medida.baixo <= medida.janela + 1, `a lista passa da janela (${medida.baixo} > ${medida.janela})`);
    conferir(medida.cabe, `a página rola (${medida.pagina} > ${medida.janela})`);
    await p.getByTestId(`ata-${ata.id}`).click();
    await p.getByTestId('atas-coluna-detalhe').getByText(titulo).first().waitFor();
    await foto(p, 'atas-escuro');
    const fontes = (await p.getByTestId('atas-fontes').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!/Drive/i.test(fontes) || !/Granola/i.test(fontes)) aviso(`o quadro das fontes não cita Drive e Granola: "${fontes.slice(0, 160)}"`);
    aviso('Drive e Granola com dublê estão provados na suíte da API (trabalho-atas-fontes, trabalho-atas-granola); a stack do seed não tem conta Google nem o cofre de pé');
    return { detalhe: { ata: ata.id, ...medida, fontes: fontes.slice(0, 160) } };
  });

  await passo('P7 · Atas: busca por palavra e por data vão ao endereço e filtram', async () => {
    await p.getByTestId('atas-busca').fill('prova da produção 21');
    await p.waitForURL((u) => (new URL(u).searchParams.get('q') ?? '').includes('produção 21'), { timeout: 10_000 });
    await dormir(800);
    const comPalavra = await p.locator('[data-testid="atas-lista"] button[data-testid^="ata-"]').count();
    conferir(comPalavra >= 1, 'a busca pela palavra não achou a ata colada');
    // A data da ata é a da reunião escrita nela (a linha "Data:" da fixture), não a do dia em que foi colada.
    const hoje = /^Data:\s*(\d{4}-\d{2}-\d{2})/m.exec(readFileSync(join(RAIZ, 'homolog/fixtures/ata-trabalho-exemplo.md'), 'utf8'))?.[1];
    conferir(hoje, 'a fixture da ata não tem a linha Data:');
    await p.getByTestId('atas-de').fill('2001-01-01');
    await p.getByTestId('atas-ate').fill('2001-01-02');
    await p.waitForURL((u) => new URL(u).searchParams.get('ate') === '2001-01-02', { timeout: 10_000 });
    await dormir(800);
    const noPassado = await p.locator('[data-testid="atas-lista"] button[data-testid^="ata-"]').count();
    conferir(noPassado === 0, `o intervalo de 2001 ainda mostra ${noPassado} ata(s)`);
    await p.getByTestId('atas-ate').fill(hoje);
    await p.getByTestId('atas-de').fill(hoje);
    await p.waitForURL((u) => new URL(u).searchParams.get('de') === hoje, { timeout: 10_000 });
    await dormir(800);
    const hojeN = await p.locator('[data-testid="atas-lista"] button[data-testid^="ata-"]').count();
    conferir(hojeN >= 1, `o intervalo do dia da reunião (${hoje}) não mostra a ata colada`);
    await foto(p, 'atas-busca-escuro');
    await claro.goto(p.url(), { waitUntil: 'networkidle' });
    await foto(claro, 'atas-busca-claro');
    await m.goto(`${WEB}/trabalho/atas`, { waitUntil: 'networkidle' });
    conferir(await semRolagemLateral(m), 'Atas rola de lado a 390');
    await foto(m, 'atas-390');
    const primeira = m.locator('[data-testid="atas-lista"] button[data-testid^="ata-"]').first();
    if (await primeira.count()) {
      await primeira.click();
      await m.getByTestId('atas-voltar').waitFor();
      await foto(m, 'atas-detalhe-390');
      await m.getByTestId('atas-voltar').click();
      await m.getByTestId('atas-coluna-lista').waitFor();
    }
    return { detalhe: { comPalavra, noPassado, hoje: hojeN, endereco: new URL(p.url()).search.replace(/q=[^&]*/, 'q=<palavra>') } };
  });

  // ---------------- P8 · Evolution ----------------
  await passo('P8 · Integrações: o cartão WhatsApp (Evolution) com estado e webhook, sem chave na tela e sem o DigiSac', async () => {
    await p.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    const url = p.getByTestId('url-do-webhook-evolution');
    await url.waitFor();
    conferir(/\/api\/approvals\/canal\/whatsapp\/[0-9a-f-]{36}$/.test((await url.innerText()).trim()), 'a URL do webhook da Evolution veio torta');
    conferir((await p.getByTestId('url-do-webhook-digisac').count()) === 0, 'o cartão do DigiSac ainda está na tela');
    conferir(await p.getByTestId('selo-evolution').count(), 'o cartão da Evolution não mostra o estado');
    const selo = (await p.getByTestId('selo-evolution').innerText()).trim();
    const cartao = p.locator('[aria-label="WhatsApp (Evolution)"]').first();
    await cartao.scrollIntoViewIfNeeded();
    await foto(p, 'conexoes-evolution-escuro');
    await claro.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    await claro.locator('[aria-label="WhatsApp (Evolution)"]').first().scrollIntoViewIfNeeded();
    await foto(claro, 'conexoes-evolution-claro');
    await m.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    await m.locator('[aria-label="WhatsApp (Evolution)"]').first().scrollIntoViewIfNeeded();
    conferir(await semRolagemLateral(m), 'Integrações rola de lado a 390');
    await foto(m, 'conexoes-evolution-390');
    return { detalhe: { selo } };
  });

  // ---------------- P9 · Sala ----------------
  await passo('P9 · aba Sala: o estado da sala deste lead, a ajuda e o "Copiar link da sala"', async () => {
    await p.goto(`${WEB}/comercial/funil?visao=lista`, { waitUntil: 'networkidle' });
    await p.getByTestId('funil-lista').waitFor();
    const linhas = p.locator('[data-testid^="funil-linha-"]');
    conferir(await linhas.count(), 'a lista do funil está vazia');
    // Um lead com sala e link (a rota de estado diz; ela nunca devolve o link em claro).
    const ids = (await linhas.evaluateAll((ls) => ls.map((l) => l.getAttribute('data-testid')))).map((t) => t.replace('funil-linha-', ''));
    let escolhido = null;
    for (const id of ids) {
      const r = await http('GET', `${API}/comercial/lead/${id}/sala/estado`, undefined, sessao.token);
      if (r.status === 200 && r.json?.linkDisponivel) { escolhido = id; break; }
    }
    conferir(escolhido, 'nenhum lead do funil tem sala com link');
    leadComSala = escolhido;
    await p.getByTestId(`funil-linha-${escolhido}`).click();
    const painel = p.locator('[role="dialog"]').first();
    await painel.waitFor();
    await painel.getByRole('tab', { name: /Sala/ }).click();
    await p.getByTestId('sala-estado').waitFor();
    const ajuda = (await p.getByTestId('sala-ajuda').innerText()).replace(/\s+/g, ' ');
    conferir(/A sala nasce quando o lead entra/.test(ajuda) && /Aprovações/.test(ajuda), `a ajuda veio: ${ajuda}`);
    const estado = (await p.getByTestId('sala-estado').innerText()).replace(/\s+/g, ' ').trim();
    conferir(estado.length > 0 && !/Invalid date|NaN/i.test(estado), `o estado da sala veio: ${estado.slice(0, 200)}`);
    const botao = p.getByTestId('sala-copiar-link');
    conferir(await botao.count(), 'o botão "Copiar link da sala" não apareceu para o admin');
    await botao.click();
    await dormir(800);
    const copiado = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    const linkOk = /\/s\/[A-Za-z0-9_-]{16,}/.test(copiado);
    if (!linkOk) aviso('o link não chegou à área de transferência do navegador sem janela; a rota e a auditoria estão na suíte comercial-sala-estado');
    await foto(p, 'sala-estado-escuro');
    const naoEntregue = /não entregue: WhatsApp simulado/.test(estado);
    return { detalhe: { linkNaAreaDeTransferencia: linkOk, naoEntregueSimulado: naoEntregue, marcos: await p.locator('[data-testid^="sala-marco-"]').count() } };
  });

  await passo('P9 · aba Sala no claro e a 390', async () => {
    for (const [pg, nome] of [[claro, 'sala-estado-claro'], [m, 'sala-estado-390']]) {
      await pg.goto(`${WEB}/comercial/funil?visao=lista`, { waitUntil: 'networkidle' });
      await pg.getByTestId('funil-lista').waitFor();
      await pg.getByTestId(`funil-linha-${leadComSala}`).click();
      const painel = pg.locator('[role="dialog"]').first();
      await painel.waitFor();
      await painel.getByRole('tab', { name: /Sala/ }).click();
      await pg.getByTestId('sala-estado').waitFor();
      await foto(pg, nome);
    }
    conferir(await semRolagemLateral(m), 'a aba Sala rola de lado a 390');
  });

  conferir(!erros.length, `erros de página: ${erros.slice(0, 3).join(' | ')}`);
  await navegador.close();
}

main()
  .then(() => { prova.ok = true; gravar(); console.log(`PASSA · ${prova.passos.length} passos · ${Math.round((Date.now() - t0) / 1000)} s`); })
  .catch((e) => { gravar(); console.error(`FALHA · ${e?.message ?? e}`); process.exit(1); });
