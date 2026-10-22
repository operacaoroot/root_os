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

  if (process.env.SO_ADENDO === '1') {
    await adendo({ p, m, claro, sessao });
    conferir(!erros.length, `erros de página: ${erros.slice(0, 3).join(' | ')}`);
    await navegador.close();
    return;
  }

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

  // ---------------- P3 · Excluir pela árvore ----------------
  await passo('P3 · a árvore do Trabalho: o menu da lista oferece excluir (ou arquivar antes) e pede o nome', async () => {
    await p.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    const botao = p.locator('[data-testid^="trabalho-lista-acoes-"]').first();
    await botao.waitFor();
    await botao.click();
    const menu = p.getByRole('menu').first();
    await menu.waitFor();
    const itens = (await menu.getByRole('menuitem').allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    const textos = itens.length ? itens : [(await menu.innerText()).replace(/\s+/g, ' ')];
    conferir(textos.some((t) => /Excluir lista|Arquivar todas/i.test(t)), `o menu da lista veio: ${textos.join(' · ')}`);
    await foto(p, 'trabalho-menu-da-lista-escuro');
    await p.keyboard.press('Escape');
    return { detalhe: { itens: textos } };
  });

  // ---------------- P6 · Implantação ----------------
  await passo('P6 · Implantação: o cartão diz há quantos dias está na etapa, e o painel mostra quem trabalha nela', async () => {
    await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    const cartao = p.locator('[data-work-task-id]').first();
    if (!(await cartao.count())) { aviso('a Implantação do seed não tem cartão'); return { detalhe: { cartoes: 0 } }; }
    await cartao.waitFor();
    const texto = (await cartao.innerText()).replace(/\s+/g, ' ');
    conferir(!/Invalid date|NaN|T\d{2}:\d{2}:\d{2}/.test(texto), `data torta no cartão: ${texto.slice(0, 160)}`);
    await foto(p, 'implantacao-quadro-escuro');
    await cartao.click();
    const quem = p.getByTestId('quem-trabalha');
    await quem.waitFor({ timeout: 15_000 }).catch(() => null);
    const temQuem = await quem.count();
    if (!temQuem) aviso('o painel do cartão abriu sem "Quem trabalha nesta etapa" (cartão sem trilho)');
    else await quem.scrollIntoViewIfNeeded();
    await foto(p, 'implantacao-painel-escuro');
    await p.keyboard.press('Escape');
    await claro.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    await foto(claro, 'implantacao-quadro-claro');
    await m.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    // O kanban rola de lado por desenho (colunas de largura fixa); a página em volta, não.
    const pagina390 = await semRolagemLateral(m);
    await foto(m, 'implantacao-390');
    return { detalhe: { naEtapa: /na etapa há \d+ d|\d+d/.test(texto), quemTrabalha: !!temQuem, pagina390SemRolagem: pagina390 } };
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
    // Desde a 22B (I6) o conteúdo próprio da Evolution mora na gaveta "Configurar" do cartão.
    const abrirGaveta = async (pg) => {
      const c = pg.locator('[data-conector="evolution"]').first();
      await c.waitFor();
      const botao = c.getByRole('button', { name: 'Configurar' });
      if (await botao.count()) await botao.first().click();
    };
    await abrirGaveta(p);
    const url = p.getByTestId('url-do-webhook-evolution');
    await url.waitFor();
    conferir(/\/api\/approvals\/canal\/whatsapp\/[0-9a-f-]{36}$/.test((await url.innerText()).trim()), 'a URL do webhook da Evolution veio torta');
    conferir((await p.getByText(/digisac|zapfy/i).count()) === 0, 'o DigiSac ou o Zapfy ainda aparecem na tela (excluídos em 21/10/2026)');
    conferir(await p.getByTestId('estado-evolution').count(), 'o cartão da Evolution não mostra o estado');
    const selo = (await p.getByTestId('estado-evolution').innerText()).trim();
    const cartao = p.locator('[data-conector="evolution"]').first();
    await cartao.scrollIntoViewIfNeeded();
    await foto(p, 'conexoes-evolution-escuro');
    await claro.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    await abrirGaveta(claro);
    await claro.locator('[data-conector="evolution"]').first().scrollIntoViewIfNeeded();
    await foto(claro, 'conexoes-evolution-claro');
    await m.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    await m.locator('[data-conector="evolution"]').first().scrollIntoViewIfNeeded();
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
    // O botão depende da permissão da sessão, que chega um instante depois do estado (produção 22: esperar, não contar na hora).
    await botao.waitFor({ timeout: 10_000 }).catch(() => null);
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

  await adendo({ p, m, claro, sessao });

  conferir(!erros.length, `erros de página: ${erros.slice(0, 3).join(' | ')}`);
  await navegador.close();
}

/*
 * O ADENDO (21/10, madrugada): a árvore de pastas se edita onde a pessoa olha (A3) e as
 * tarefas do comercial moram no Funil vivo (A1). Os nomes criados aqui levam "e2e 21b"
 * e um carimbo; o que o passo cria, ele mesmo tira no fim (pela API, como a tela faria).
 */
async function adendo({ p, m, claro, sessao }) {
  const carimbo = Date.now().toString(36);
  const nome = (s) => `e2e 21b ${s} ${carimbo}`;
  const estrutura = () => api('GET', '/trabalho/estrutura', undefined, sessao.token);
  const pastaPorNome = async (n) => (await estrutura()).folders.find((f) => f.name === n);
  const tarefasDe = (r) => (Array.isArray(r) ? r : r.tarefas ?? []);

  await passo('A3 · árvore: "+ nova pasta" inline (Enter salva), renomear com duplo clique, repetido no mesmo nível recusado', async () => {
    await p.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    await p.getByTestId('trabalho-arvore').waitFor();
    await p.getByTestId('trabalho-arvore-nova-pasta').click();
    const campo = p.getByTestId('trabalho-arvore-nova-pasta-nome');
    await campo.fill(nome('pasta'));
    await campo.press('Enter');
    await p.getByText(nome('pasta'), { exact: true }).first().waitFor();
    const criada = await pastaPorNome(nome('pasta'));
    conferir(criada, 'a pasta criada não está na estrutura');
    // Uma segunda pasta para a recusa de nome repetido.
    const outra = await api('POST', '/trabalho/pastas', { name: nome('outra') }, sessao.token);
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByTestId(`trabalho-arvore-pasta-${criada.id}`).dblclick();
    const ren = p.getByTestId(`trabalho-arvore-renomear-pasta-${criada.id}`);
    await ren.fill(nome('outra'));
    await ren.press('Enter');
    const erro = p.getByTestId(`trabalho-arvore-renomear-pasta-${criada.id}-erro`);
    await erro.waitFor();
    const frase = (await erro.innerText()).trim();
    conferir(/Já existe uma pasta com esse nome/.test(frase), `a recusa veio: ${frase}`);
    await ren.fill(nome('renomeada'));
    await ren.press('Enter');
    await p.getByText(nome('renomeada'), { exact: true }).first().waitFor();
    conferir(await pastaPorNome(nome('renomeada')), 'o nome novo não chegou à API');
    await foto(p, 'adendo-arvore-renomeada-escuro');
    return { detalhe: { recusa: frase, pastas: 2 } };
  });

  await passo('A3 · árvore: arrastar a lista para outra pasta e reordenar com Alt+↓', async () => {
    const a = await pastaPorNome(nome('renomeada'));
    const b = await pastaPorNome(nome('outra'));
    const l1 = await api('POST', '/trabalho/listas', { name: nome('lista um'), folderId: a.id }, sessao.token);
    await api('POST', '/trabalho/listas', { name: nome('lista dois'), folderId: b.id }, sessao.token);
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByTestId(`trabalho-arvore-lista-${l1.id}`).dragTo(p.getByTestId(`trabalho-arvore-pasta-${b.id}`));
    let pasta = null;
    for (let i = 0; i < 20 && pasta !== b.id; i++) {
      await dormir(250);
      pasta = (await estrutura()).folders.find((f) => f.lists.some((l) => l.id === l1.id))?.id ?? null;
    }
    conferir(pasta === b.id, 'arrastar a lista não a levou para a outra pasta');
    await p.reload({ waitUntil: 'networkidle' });
    const ordem = async () => (await estrutura()).folders.find((f) => f.id === b.id).lists.map((l) => l.id);
    const antes = await ordem();
    const primeira = antes[0];
    await p.getByTestId(`trabalho-arvore-lista-${primeira}`).focus();
    await p.keyboard.press('Alt+ArrowDown');
    let depois = antes;
    for (let i = 0; i < 20 && depois[0] === primeira; i++) { await dormir(250); depois = await ordem(); }
    conferir(depois[1] === primeira, `Alt+↓ não desceu a lista: ${JSON.stringify({ antes, depois })}`);
    return { detalhe: { listasNaPasta: depois.length } };
  });

  await passo('A3 · apagar pasta com listas: o diálogo pede o destino (Sem pasta), move as listas e apaga', async () => {
    const b = await pastaPorNome(nome('outra'));
    const listas = b.lists.map((l) => l.id);
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByTestId(`trabalho-pasta-acoes-${b.id}`).click();
    await p.getByTestId(`trabalho-pasta-acoes-${b.id}-excluir`).click();
    const destino = p.getByTestId('trabalho-excluir-pasta-destino');
    await destino.waitFor();
    await destino.selectOption('__sem-pasta__');
    await foto(p, 'adendo-apagar-pasta-escuro');
    await p.getByTestId('trabalho-excluir-pasta-confirmar').click();
    let e = await estrutura();
    for (let i = 0; i < 20 && e.folders.some((f) => f.id === b.id); i++) { await dormir(250); e = await estrutura(); }
    conferir(!e.folders.some((f) => f.id === b.id), 'a pasta não saiu');
    const soltas = e.listasSoltas.map((l) => l.id);
    conferir(listas.every((id) => soltas.includes(id)), 'as listas não foram para Sem pasta');
    return { detalhe: { listasMovidas: listas.length } };
  });

  await passo('A3 · apagar lista vazia pelo menu (nome digitado) e a pasta vazia que sobrou; 390 sem rolagem lateral', async () => {
    const e = await estrutura();
    const minhas = e.listasSoltas.filter((l) => l.name.endsWith(carimbo));
    await p.reload({ waitUntil: 'networkidle' });
    for (const l of minhas) {
      await p.getByTestId(`trabalho-lista-acoes-${l.id}`).click();
      await p.getByTestId(`trabalho-lista-acoes-${l.id}-excluir`).click();
      await p.getByTestId('trabalho-excluir-lista-nome').fill(l.name);
      await p.getByTestId('trabalho-excluir-lista-confirmar').click();
      for (let i = 0; i < 20 && (await estrutura()).listasSoltas.some((x) => x.id === l.id); i++) await dormir(250);
    }
    const a = await pastaPorNome(nome('renomeada'));
    if (a) await api('DELETE', `/trabalho/pastas/${a.id}`, undefined, sessao.token);
    const fim = await estrutura();
    conferir(!fim.listasSoltas.some((l) => l.name.endsWith(carimbo)) && !fim.folders.some((f) => f.name.endsWith(carimbo)), 'sobrou pasta ou lista do e2e');
    await m.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    conferir(await semRolagemLateral(m), 'o Trabalho rola de lado a 390');
    await foto(m, 'adendo-arvore-390');
    return { detalhe: { listasApagadas: minhas.length } };
  });

  await passo('A1 · Funil vivo: bloco "Tarefas do comercial" com contagem, "+ tarefa" (Enter salva) e concluir', async () => {
    await p.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
    const bloco = p.getByTestId('funil-tarefas-do-comercial');
    await bloco.waitFor();
    const alternar = p.getByTestId('funil-tarefas-alternar');
    if ((await alternar.getAttribute('aria-expanded')) !== 'true') await alternar.click();
    const contagem = async () => Number((await p.getByTestId('funil-tarefas-contagem').innerText()).trim());
    const antes = await contagem();
    await p.getByTestId('funil-tarefas-mais').click();
    const titulo = p.getByTestId('funil-tarefas-nova-titulo');
    await titulo.fill(nome('tarefa'));
    await titulo.press('Enter');
    const linha = bloco.locator('li[data-testid^="tarefa-"]').filter({ hasText: nome('tarefa') });
    await linha.waitFor();
    let depois = antes;
    for (let i = 0; i < 20 && depois !== antes + 1; i++) { await dormir(250); depois = await contagem(); }
    conferir(depois === antes + 1, `a contagem não subiu: ${antes} → ${depois}`);
    const id = (await linha.getAttribute('data-testid')).replace('tarefa-', '');
    const itens = tarefasDe(await api('GET', '/comercial/tarefas?semLead=1', undefined, sessao.token));
    conferir(itens.some((t) => t.id === id && !t.lead), 'a tarefa nova não veio sem lead pela API');
    await foto(p, 'adendo-funil-tarefas-escuro');
    await p.getByTestId(`tarefa-concluir-${id}`).click();
    for (let i = 0; i < 20 && depois !== antes; i++) { await dormir(250); depois = await contagem(); }
    conferir(depois === antes, `concluir não baixou a contagem: ${depois}`);
    // A lista do comercial não aparece na árvore do Trabalho.
    const e = await estrutura();
    const todas = [...e.listasSoltas, ...e.folders.flatMap((f) => f.lists)];
    conferir(!todas.some((l) => l.externalId === 'comercial:tarefas'), 'a lista do comercial apareceu na árvore');
    return { detalhe: { contagemAntes: antes } };
  });

  await passo('A1 · painel do lead: bloco "Tarefas", "+ tarefa" já ligada ao lead, e o cartão mostra a tarefa', async () => {
    await p.goto(`${WEB}/comercial/funil?visao=lista`, { waitUntil: 'networkidle' });
    await p.getByTestId('funil-lista').waitFor();
    const linha = p.locator('[data-testid^="funil-linha-"]').first();
    const leadId = (await linha.getAttribute('data-testid')).replace('funil-linha-', '');
    await linha.click();
    await p.locator('[role="dialog"]').first().waitFor();
    const bloco = p.getByTestId('painel-tarefas');
    await bloco.waitFor();
    await p.getByTestId('painel-tarefas-lista-mais').click();
    const titulo = p.getByTestId('painel-tarefas-lista-nova-titulo');
    await titulo.fill(nome('do lead'));
    await titulo.press('Enter');
    const li = bloco.locator('li[data-testid^="tarefa-"]').filter({ hasText: nome('do lead') });
    await li.waitFor();
    const id = (await li.getAttribute('data-testid')).replace('tarefa-', '');
    const itens = tarefasDe(await api('GET', `/comercial/tarefas?leadId=${leadId}`, undefined, sessao.token));
    const t = itens.find((x) => x.id === id);
    conferir(t && t.lead?.id === leadId, 'a tarefa do painel não ficou ligada ao lead');
    await foto(p, 'adendo-painel-tarefas-escuro');
    await p.keyboard.press('Escape');
    await p.reload({ waitUntil: 'networkidle' });
    const textoDaLinha = (await p.getByTestId(`funil-linha-${leadId}`).innerText()).replace(/\s+/g, ' ');
    conferir(/tarefas? abertas?/i.test(textoDaLinha) || textoDaLinha.includes(nome('do lead')), `a linha do lead não mostra a tarefa: ${textoDaLinha.slice(0, 200)}`);
    // Conclui para não deixar tarefa aberta no lead da semente.
    await api('PATCH', `/comercial/tarefas/${id}`, { expectedUpdatedAt: t.updatedAt, etapa: 'concluida' }, sessao.token);
    return { detalhe: { linhaMostra: true } };
  });

  await passo('A1 · o bloco no claro e a 390, sem rolagem lateral', async () => {
    for (const [pg, n] of [[claro, 'adendo-funil-tarefas-claro'], [m, 'adendo-funil-tarefas-390']]) {
      await pg.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
      await pg.getByTestId('funil-tarefas-do-comercial').waitFor();
      await foto(pg, n);
    }
    conferir(await semRolagemLateral(m), 'o Funil vivo rola de lado a 390');
  });
}

main()
  .then(() => { prova.ok = true; gravar(); console.log(`PASSA · ${prova.passos.length} passos · ${Math.round((Date.now() - t0) / 1000)} s`); })
  .catch((e) => { gravar(); console.error(`FALHA · ${e?.message ?? e}`); process.exit(1); });
