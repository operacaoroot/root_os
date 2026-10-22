#!/usr/bin/env node
/*
 * A PROVA DA RODADA DE PRODUÇÃO 3 (22B, 22/10/2026, interface e tarefas), CONTRA A
 * STACK DO SEED EM DOCKER.
 *
 * Mesmo arranjo do `producao22.mjs`: Playwright (Chromium) de `UX_PW` (padrão
 * `C:/Users/User/dev/pw-tools`), o web em `UX_WEB` (padrão 3031), a API em `UX_API`
 * (padrão 4031), a senha lida de `HOMOLOG_ENV` em tempo de execução (nunca copiada).
 *
 * O que ela prova (docs/comercial/RODADA-PRODUCAO-20261022-INTERFACE.md, I7):
 *   01 botão de recolher à frente da logo; 02 acordeão que fecha; 03 engrenagem com
 *   Lixeira; 04 "⋯" da árvore só no hover e o menu dentro da janela (1440, 768, 390);
 *   05 ícone e cor numa lista; 06 excluir e restaurar uma tarefa pela Lixeira;
 *   07 a árvore sem a pasta Clientes e a Implantação com os cards; 08 botão direito
 *   com as 8 ações (renomear, duplicar, mesclar; Shift+F10); 09 modo centralizado;
 *   10 Funil vivo em lista; 11 Propostas pelo lead; 12 avatar e nascimento no perfil;
 *   13 Equipe com o que cada um conduz (vault-dublê); 14 Integrações no padrão.
 * E fotografa (escuro, claro e 390 px) cada tela tocada.
 *
 * Um passo que falha NÃO derruba os seguintes: ele fica marcado com a frase do que se
 * viu, e o resultado final é FALHA se qualquer passo falhou.
 *
 * ESCREVE na stack (só dado fictício): uma lista e tarefas "e2e 22b …" (com comentário,
 * cópia e mesclagem), ícone e cor (postos e tirados), larguras e colunas do funil no
 * navegador do próprio e2e, a foto e a data de nascimento do admin do seed, o "Nome no
 * vault" de três pessoas do seed (Alice, Bruno, Clara do vault-dublê), um vínculo de
 * proposta sem lead (quando o seed tem uma) e, se o vault-dublê do volume da stack do
 * seed ainda não tiver `.git`, um repositório git local com os mesmos arquivos (a
 * reindexação exige saber o que o git rastreia). Nunca toca a 3030.
 *
 * Saída: `homolog/provas/<PROVAS_PREFIXO>producao22b.json` e `producao22b-*.png`.
 * Uso (Git Bash): node homolog/e2e/producao22b.mjs      (SO=04,08 roda só esses passos)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4031/api';
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:3031';
const PW = process.env.UX_PW ?? 'C:/Users/User/dev/pw-tools';
const PREFIXO = process.env.PROVAS_PREFIXO ?? '';
const CONTAINER_DA_API = process.env.UX_CONTAINER_API ?? 'rootos_final_seed_api';
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

const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], avisos: [], defeitos: [], ok: false };
const t0 = Date.now();

function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  writeFileSync(join(PROVAS, `${PREFIXO}producao22b.json`), `${JSON.stringify(prova, null, 2)}\n`);
}
function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** `SO=04,08` roda só os passos com esses prefixos (depuração); a prova vale com todos. */
const SO = (process.env.SO ?? '').split(',').map((x) => x.trim()).filter(Boolean);
/** Um passo que falha fica marcado e a prova segue para o próximo. */
async function passo(nome, fn) {
  if (SO.length && !SO.some((s) => nome.startsWith(s))) { console.log(`      pulado: ${nome}`); prova.pulados = (prova.pulados ?? 0) + 1; return; }
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
      if (!sessionStorage.getItem('e2e22b:menu')) {
        // Só na primeira carga da aba: depois disso o menu fica como o e2e deixou.
        localStorage.setItem('root-os:menu-recolhido', '0');
        sessionStorage.setItem('e2e22b:menu', '1');
      }
    },
    [sessao.token, sessao.user, tema],
  );
  return ctx;
}
async function foto(p, nome) {
  const arquivo = `${PREFIXO}producao22b-${nome}.png`;
  await p.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}
async function semRolagemLateral(p) {
  return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
async function esperar(fn, ms = 6000) {
  const fim = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < fim) { await dormir(250); v = await fn(); }
  return v;
}
/** O retângulo cabe inteiro na janela (margem de meio pixel para arredondamento). */
async function dentroDaJanela(p, loc) {
  const r = await loc.boundingBox();
  const j = p.viewportSize();
  return { r, cabe: !!r && r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= j.width + 0.5 && r.y + r.height <= j.height + 0.5 };
}
async function opacidade(loc) {
  return loc.evaluate((el) => Number(getComputedStyle(el).opacity));
}
/** Três fotos da mesma tela: escuro (p), claro e 390 px; e a conferência da rolagem lateral. */
async function tresFotos(telas, caminho, nome, antes) {
  const { p, claro, m } = telas;
  if (p) { if (caminho) await p.goto(`${WEB}${caminho}`, { waitUntil: 'networkidle' }); if (antes) await antes(p); await foto(p, `${nome}-escuro`); }
  await claro.goto(`${WEB}${caminho}`, { waitUntil: 'networkidle' });
  if (antes) await antes(claro).catch(() => undefined);
  await foto(claro, `${nome}-claro`);
  await m.goto(`${WEB}${caminho}`, { waitUntil: 'networkidle' });
  if (antes) await antes(m).catch(() => undefined);
  await foto(m, `${nome}-390`);
  const ok = await semRolagemLateral(m);
  if (!ok) throw new Error(`${caminho} rola de lado a 390 px`);
  return ok;
}

/** Um PNG de verdade, 64×64, RGBA, um degradê fictício (sem metadado nenhum). */
function pngDeProva(lado = 64) {
  const crcTabela = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTabela[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([len, t, dados, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const cru = Buffer.alloc(lado * (lado * 4 + 1));
  for (let y = 0; y < lado; y++) {
    cru[y * (lado * 4 + 1)] = 0;
    for (let x = 0; x < lado; x++) {
      const i = y * (lado * 4 + 1) + 1 + x * 4;
      cru[i] = 0x20 + x * 2; cru[i + 1] = 0x40 + y * 2; cru[i + 2] = 0xa0; cru[i + 3] = 0xff;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), bloco('IDAT', deflateSync(cru)), bloco('IEND', Buffer.alloc(0))]);
}

/**
 * O vault-dublê da stack do seed como repositório git. A reindexação recusa uma vault
 * sem `.git` ("rastreamento não verificável"); na produção a vault é um clone. Só age
 * no container do seed, só sobre um vault marcado `dublê: true`, e só se faltar o `.git`.
 */
function prepararVaultDoDuble() {
  const sh = (cmd) => execFileSync('docker', ['exec', CONTAINER_DA_API, 'sh', '-c', cmd], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (!/dublê: true/.test(sh('head -3 /vault/LEIA-ME.md 2>/dev/null || true'))) return 'o /vault do seed não é o dublê: nada feito';
  if (sh('test -d /vault/.git && echo sim || echo nao').trim() === 'sim') return 'o vault-dublê já tinha .git';
  const dir = mkdtempSync(join(tmpdir(), 'e2e22b-vault-'));
  const env = { ...process.env, MSYS_NO_PATHCONV: '1' };
  execFileSync('docker', ['cp', `${CONTAINER_DA_API}:/vault/.`, dir], { env });
  const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=e2e 22b', '-c', 'user.email=e2e@exemplo.invalid', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  git('add', '-A');
  git('commit', '-qm', 'vault-dublê (e2e 22b)');
  execFileSync('docker', ['cp', join(dir, '.git'), `${CONTAINER_DA_API}:/vault/.git`], { env });
  return 'o vault-dublê ganhou um .git local (os mesmos arquivos, um commit)';
}

async function main() {
  const navegador = await chromium.launch();
  const sessao = await entrar(EMAIL);
  conferir(sessao.token, 'o login não devolveu token');
  const tok = sessao.token;
  const ctx = await contexto(navegador, sessao);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
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
  const telas = { p, claro, m };
  const carimbo = Date.now().toString(36);
  const nome = (s) => `e2e 22b ${s} ${carimbo}`;
  const estrutura = () => api('GET', '/trabalho/estrutura', undefined, tok);
  const tarefa = (id) => api('GET', `/trabalho/tarefas/${id}`, undefined, tok);

  // A lista do e2e: tarefas para o menu, o ícone, a Lixeira e o botão direito.
  const lista = await api('POST', '/trabalho/listas', { name: nome('lista') }, tok);
  const statusDe = async () => (await estrutura()).listasSoltas.find((l) => l.id === lista.id)?.statuses ?? [];
  const criarTarefa = (titulo, extra = {}) => api('POST', '/trabalho/tarefas', { listId: lista.id, title: titulo, clienteId: 'interno', ...extra }, tok);
  const ativa = await criarTarefa(nome('ativa'));
  // `visao=board` no endereço: a vista padrão salva de outra prova (com filtro de prazo) não se aplica.
  const urlDaLista = `/trabalho?lista=${encodeURIComponent(lista.id)}&visao=board`;
  prova.lista = lista.id.slice(0, 8);

  // ---------------- 01 · recolher à frente da logo ----------------
  await passo('01 · botão de recolher à frente da logo: recolhe e volta; recolhido, o R e o botão lado a lado', async () => {
    await p.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    const botao = p.getByTestId('menu-recolher');
    const logo = p.locator('[data-logo-do-menu]');
    const menu = p.locator('#root-os-nav');
    const medir = async () => {
      const [b, l, a] = [await botao.boundingBox(), await logo.boundingBox(), await menu.boundingBox()];
      return { b, l, a, ladoALado: !!b && !!l && b.x >= l.x + l.width - 1 && Math.abs((b.y + b.height / 2) - (l.y + l.height / 2)) <= 8 && b.x + b.width <= a.x + a.width + 1 };
    };
    const aberto = await medir();
    conferir(aberto.ladoALado, `aberto, o botão não está à frente da logo: ${JSON.stringify({ b: aberto.b, l: aberto.l })}`);
    conferir((await botao.getAttribute('aria-pressed')) === 'false', 'o botão nasceu pressionado');
    await foto(p, 'menu-aberto-escuro');
    await botao.click();
    await esperar(async () => (await botao.getAttribute('aria-pressed')) === 'true');
    await dormir(350);
    const recolhido = await medir();
    conferir(recolhido.a.width <= 72, `recolhido, o menu tem ${recolhido.a.width}px`);
    conferir(recolhido.ladoALado, `recolhido, o R e o botão não estão lado a lado: ${JSON.stringify({ b: recolhido.b, l: recolhido.l, a: recolhido.a })}`);
    await foto(p, 'menu-recolhido-escuro');
    await botao.click();
    await esperar(async () => (await botao.getAttribute('aria-pressed')) === 'false');
    await dormir(350);
    const voltou = await medir();
    conferir(voltou.a.width >= 240, `de volta, o menu tem ${voltou.a.width}px`);
    await claro.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    await foto(claro, 'menu-aberto-claro');
    await m.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    await foto(m, 'menu-390');
    conferir(await semRolagemLateral(m), 'o Trabalho rola de lado a 390');
    return { detalhe: { larguraAberto: Math.round(aberto.a.width), larguraRecolhido: Math.round(recolhido.a.width) } };
  });

  // ---------------- 02 · acordeão ----------------
  await passo('02 · acordeão: clicar de novo na área aberta fecha; outra área abre a dela e fecha a anterior', async () => {
    await p.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    const trabalho = p.locator('a[data-area="trabalho"]');
    await trabalho.waitFor();
    conferir((await trabalho.getAttribute('aria-expanded')) === 'true', 'a área Trabalho não está aberta na tela dela');
    const urlAntes = p.url();
    await trabalho.click();
    conferir(await esperar(async () => (await trabalho.getAttribute('aria-expanded')) === 'false'), 'clicar de novo não fechou as subseções');
    conferir(!(await p.locator('#root-os-area-trabalho').count()), 'a lista de subseções continua na tela');
    conferir(p.url() === urlAntes, `fechar navegou para ${p.url()}`);
    conferir((await trabalho.getAttribute('aria-current')) === 'true', 'a área da tela atual perdeu a marca');
    await foto(p, 'acordeao-fechado-escuro');
    await trabalho.click();
    conferir(await esperar(async () => (await trabalho.getAttribute('aria-expanded')) === 'true'), 'clicar de novo não reabriu');
    // Outra área com subseções: abre a dela (navega) e fecha a anterior.
    const outra = p.locator('a[data-area][aria-expanded="false"]').first();
    const chave = await outra.getAttribute('data-area');
    await outra.click();
    await p.waitForLoadState('networkidle');
    const daOutra = p.locator(`a[data-area="${chave}"]`);
    conferir(await esperar(async () => (await daOutra.getAttribute('aria-expanded')) === 'true'), `a área ${chave} não abriu`);
    conferir((await trabalho.getAttribute('aria-expanded')) === 'false', 'a área Trabalho continuou aberta');
    conferir(await p.locator(`#root-os-area-${chave} a[aria-current="page"]`).count() <= 1, 'mais de uma subseção marcada');
    await foto(p, 'acordeao-outra-escuro');
    await claro.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    await claro.locator('a[data-area="trabalho"]').click();
    await foto(claro, 'acordeao-fechado-claro');
    return { detalhe: { outra: chave, url: new URL(p.url()).pathname } };
  });

  // ---------------- 03 · engrenagem ----------------
  await passo('03 · engrenagem com Perfil, Lixeira, Registro de ações e Configurações; a Lixeira abre /lixeira', async () => {
    await p.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    const eng = p.getByTestId('engrenagem');
    await eng.click();
    const itens = {};
    for (const k of ['perfil', 'lixeira', 'rastro', 'configuracoes']) {
      const it = p.getByTestId(`engrenagem-${k}`);
      conferir(await it.isVisible().catch(() => false), `a engrenagem não mostra "${k}"`);
      itens[k] = (await it.innerText()).trim();
    }
    conferir(itens.perfil === 'Perfil' && itens.lixeira === 'Lixeira' && /Registro de ações/.test(itens.rastro) && /Configurações/.test(itens.configuracoes), `rótulos: ${JSON.stringify(itens)}`);
    const menu = p.locator('[role="menu"]').filter({ has: p.getByTestId('engrenagem-lixeira') });
    conferir((await dentroDaJanela(p, menu)).cabe, 'o menu da engrenagem sai da janela');
    await foto(p, 'engrenagem-escuro');
    await p.getByTestId('engrenagem-lixeira').click();
    await p.waitForURL(/\/lixeira/, { timeout: 15_000 });
    await p.getByTestId('lixeira').waitFor();
    await foto(p, 'lixeira-escuro');
    await claro.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    await claro.getByTestId('engrenagem').click();
    await foto(claro, 'engrenagem-claro');
    await m.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    const eng390 = m.getByTestId('engrenagem');
    if (await eng390.isVisible().catch(() => false)) {
      await eng390.click();
      await foto(m, 'engrenagem-390');
      conferir((await dentroDaJanela(m, m.locator('[role="menu"]').filter({ has: m.getByTestId('engrenagem-lixeira') }))).cabe, 'a 390 px o menu da engrenagem sai da janela');
    } else aviso('a 390 px a engrenagem não está visível no topo');
    await tresFotos({ claro, m }, '/lixeira', 'lixeira');
    return { detalhe: itens };
  });

  // ---------------- 04 · "⋯" da árvore ----------------
  await passo('04 · árvore: "⋯" da lista só no hover/foco; o menu cabe na janela em 1440, 768 e 390; diz por que não exclui', async () => {
    const gatilhoId = `trabalho-lista-acoes-${lista.id}`;
    const medidas = {};
    const conferirMenu = (pg, largura) => conferirMenuEm(pg, largura).catch((e) => { throw new Error(`a ${largura} px: ${String(e?.message ?? e).split(/\r?\n/)[0]}`); });
    const conferirMenuEm = async (pg, largura) => {
      const gatilho = pg.getByTestId(gatilhoId);
      await gatilho.scrollIntoViewIfNeeded();
      // No celular é toque: o clique de mouse emulado rola a janela depois de abrir, e o menu fecha ao rolar (de propósito).
      if (largura === 390) await gatilho.tap(); else await gatilho.click();
      const menu = pg.getByTestId(`${gatilhoId}-menu`);
      await menu.waitFor();
      await esperar(async () => (await opacidade(menu)) === 1, 3000);
      const { r, cabe } = await dentroDaJanela(pg, menu);
      conferir(cabe, `a ${largura} px o menu sai da janela: ${JSON.stringify(r)}`);
      const cortados = await menu.locator('[role="menuitem"]').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
      conferir(cortados === 0, `a ${largura} px ${cortados} item(ns) do menu cortado(s)`);
      const dica = (await pg.getByTestId(`${gatilhoId}-excluir`).innerText()).replace(/\s+/g, ' ');
      conferir(/Tem 1 tarefa ativa/.test(dica), `o menu não diz por que não exclui: ${dica}`);
      conferir(await pg.getByTestId(`${gatilhoId}-arquivar`).count(), 'o menu não oferece arquivar a tarefa');
      medidas[largura] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), lado: await menu.getAttribute('data-lado') };
      return dica;
    };
    await p.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    const gatilho = p.getByTestId(gatilhoId);
    await gatilho.waitFor({ state: 'attached' });
    await p.mouse.move(1400, 880);
    await dormir(300);
    const semHover = await opacidade(gatilho);
    conferir(semHover === 0, `sem hover o "⋯" tem opacidade ${semHover}`);
    await p.getByTestId(`trabalho-arvore-lista-${lista.id}`).hover();
    await dormir(300);
    const comHover = await opacidade(gatilho);
    conferir(comHover === 1, `com hover o "⋯" tem opacidade ${comHover}`);
    await foto(p, 'arvore-hover-escuro');
    await p.mouse.move(1400, 880);
    await gatilho.focus();
    await dormir(300);
    const comFoco = await opacidade(gatilho);
    conferir(comFoco === 1, `com foco o "⋯" tem opacidade ${comFoco}`);
    await gatilho.evaluate((el) => el.blur());
    const dica = await conferirMenu(p, 1440);
    await foto(p, 'arvore-menu-1440-escuro');
    await p.keyboard.press('Escape');
    // 768 px.
    const c768 = await contexto(navegador, sessao, 'dark', { width: 768, height: 900 });
    const t768 = await c768.newPage();
    await t768.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    await conferirMenu(t768, 768);
    await foto(t768, 'arvore-menu-768-escuro');
    await c768.close();
    // 390 px (toque: sem hover, o "⋯" fica sempre visível).
    await m.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    const g390 = m.getByTestId(gatilhoId);
    if (!(await g390.isVisible().catch(() => false))) {
      // A árvore pode morar atrás de um botão no celular.
      const abrir = m.getByRole('button', { name: /listas|pastas|árvore/i }).first();
      if (await abrir.count()) await abrir.click();
    }
    await g390.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
    if (await g390.isVisible().catch(() => false)) {
      const toque = await opacidade(g390);
      conferir(toque === 1, `no toque o "⋯" tem opacidade ${toque}`);
      await conferirMenu(m, 390);
      await foto(m, 'arvore-menu-390');
      await m.keyboard.press('Escape').catch(() => undefined);
    } else throw new Error('a 390 px o "⋯" da lista não aparece');
    await claro.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    await claro.getByTestId(gatilhoId).click();
    await foto(claro, 'arvore-menu-claro');
    return { detalhe: { opacidade: { semHover, comHover, comFoco }, medidas, dica: dica.slice(0, 120) } };
  });

  // ---------------- 05 · ícone e cor ----------------
  await passo('05 · ícone e cor na lista: grava, aparece na árvore e no título, apaga', async () => {
    const emoji = '🚀';
    await p.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    const gatilhoId = `trabalho-lista-acoes-${lista.id}`;
    const abrirDialogo = async () => {
      await p.getByTestId(`trabalho-arvore-lista-${lista.id}`).hover();
      await p.getByTestId(gatilhoId).click();
      await p.getByTestId(`${gatilhoId}-aparencia`).click();
      await p.getByTestId('dialogo-de-icone').waitFor();
    };
    await abrirDialogo();
    await p.getByTestId(`icone-emoji-${emoji}`).click();
    await p.getByTestId('cor-good').click();
    await foto(p, 'icone-dialogo-escuro');
    await p.getByTestId('icone-salvar').click();
    await p.getByTestId('dialogo-de-icone').waitFor({ state: 'detached' });
    const naApi = await esperar(async () => {
      const l = (await estrutura()).listasSoltas.find((x) => x.id === lista.id);
      return l?.icone === emoji && l?.cor === 'good' ? l : null;
    });
    conferir(naApi, 'o ícone e a cor não ficaram gravados');
    const naArvore = p.getByTestId(`trabalho-arvore-lista-${lista.id}`).getByTestId('icone-da-lista');
    conferir(await esperar(async () => (await naArvore.count()) && (await naArvore.getAttribute('data-icone')) === emoji), 'o ícone não aparece na árvore');
    const noTitulo = p.locator('h1').getByTestId('icone-da-lista');
    conferir(await esperar(async () => (await noTitulo.count()) && (await noTitulo.getAttribute('data-icone')) === emoji), 'o ícone não aparece no título da lista');
    const corDoTitulo = await noTitulo.evaluate((el) => el.className);
    await foto(p, 'icone-gravado-escuro');
    await claro.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    await foto(claro, 'icone-gravado-claro');
    await m.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    await foto(m, 'icone-gravado-390');
    // Apaga.
    await abrirDialogo();
    await p.getByTestId('icone-sem').click();
    await p.getByTestId('cor-sem').click();
    await p.getByTestId('icone-salvar').click();
    await p.getByTestId('dialogo-de-icone').waitFor({ state: 'detached' });
    const limpo = await esperar(async () => {
      const l = (await estrutura()).listasSoltas.find((x) => x.id === lista.id);
      return l && !l.icone && !l.cor;
    });
    conferir(limpo, 'apagar o ícone não limpou a lista');
    conferir(await esperar(async () => (await naArvore.count()) === 0), 'o ícone continua na árvore depois de apagado');
    return { detalhe: { icone: emoji, cor: 'good', classeNoTitulo: corDoTitulo.slice(0, 60) } };
  });

  // ---------------- 06 · excluir e restaurar ----------------
  await passo('06 · excluir pelo botão direito → some do quadro → Lixeira → Restaurar → volta à lista e ao status', async () => {
    const statuses = await statusDe();
    const segunda = statuses[1] ?? statuses[0];
    const alvo = await criarTarefa(nome('excluir'), { statusId: segunda.id });
    await p.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    const cartao = p.locator(`[data-work-task-id="${alvo.id}"]`).first();
    await cartao.waitFor();
    await cartao.click({ button: 'right' });
    await p.getByTestId('menu-da-tarefa').waitFor();
    await p.getByTestId('menu-da-tarefa-excluir').click();
    await p.getByTestId('menu-da-tarefa-confirmar-excluir').waitFor();
    await foto(p, 'excluir-confirmar-escuro');
    await p.getByTestId('menu-da-tarefa-excluir-confirmar').click();
    await p.getByTestId('menu-da-tarefa-feito').waitFor();
    conferir(await esperar(async () => (await p.locator(`[data-work-task-id="${alvo.id}"]`).count()) === 0, 8000), 'a tarefa excluída continua no quadro');
    const excluida = await tarefa(alvo.id);
    conferir(excluida.excluidaEm, 'a API não marcou a tarefa como excluída');
    await p.goto(`${WEB}/lixeira`, { waitUntil: 'networkidle' });
    const linha = p.getByTestId(`lixeira-tarefa-${alvo.id}`);
    await linha.waitFor();
    const texto = (await linha.innerText()).replace(/\s+/g, ' ');
    await foto(p, 'lixeira-com-tarefa-escuro');
    await claro.goto(`${WEB}/lixeira`, { waitUntil: 'networkidle' });
    await foto(claro, 'lixeira-com-tarefa-claro');
    await m.goto(`${WEB}/lixeira`, { waitUntil: 'networkidle' });
    await foto(m, 'lixeira-com-tarefa-390');
    conferir(await semRolagemLateral(m), 'a Lixeira rola de lado a 390');
    await p.getByTestId(`lixeira-restaurar-${alvo.id}`).click();
    conferir(await esperar(async () => (await p.getByTestId(`lixeira-tarefa-${alvo.id}`).count()) === 0, 10_000), 'a tarefa não saiu da Lixeira');
    const avisoRestaurar = (await p.getByTestId('lixeira-aviso').innerText().catch(() => '')).trim();
    const volta = await tarefa(alvo.id);
    conferir(!volta.excluidaEm && !volta.archived, 'a tarefa restaurada continua excluída ou arquivada');
    conferir(volta.listId === lista.id && volta.statusId === segunda.id, `voltou a ${volta.listId?.slice(0, 8)}/${volta.statusName}, saiu de ${lista.id.slice(0, 8)}/${segunda.name}`);
    await p.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    await p.locator(`[data-work-task-id="${alvo.id}"]`).first().waitFor();
    await foto(p, 'restaurada-no-quadro-escuro');
    return { detalhe: { linha: texto.slice(0, 120), status: volta.statusName, aviso: avisoRestaurar.slice(0, 100) } };
  });

  // ---------------- 07 · árvore sem Clientes; Implantação com cards ----------------
  await passo('07 · árvore sem a pasta Clientes e sem Esteira, Onboarding de cliente, Execução; Implantação com cards', async () => {
    const fora = ['Clientes', 'Esteira de clientes', 'Onboarding de cliente', 'Execução'];
    const est = await estrutura();
    const naApi = [...est.folders.map((f) => f.name), ...est.folders.flatMap((f) => f.lists.map((l) => l.name)), ...est.listasSoltas.map((l) => l.name)];
    const vazou = fora.filter((n) => naApi.includes(n));
    conferir(!vazou.length, `a estrutura do Trabalho ainda traz: ${vazou.join(', ')}`);
    await p.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    const arvore = p.getByTestId('trabalho-arvore');
    await arvore.waitFor();
    const nomes = await arvore.locator('[data-testid^="trabalho-arvore-pasta-"], [data-testid^="trabalho-arvore-lista-"]').evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').replace(/\d+$/, '').trim()));
    const naTela = fora.filter((n) => nomes.includes(n));
    conferir(!naTela.length, `a árvore mostra: ${naTela.join(', ')}`);
    await foto(p, 'arvore-sem-clientes-escuro');
    await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    const cartoes = p.locator('[data-work-task-id]');
    await cartoes.first().waitFor({ timeout: 15_000 });
    const n = await cartoes.count();
    conferir(n > 0, 'a Implantação ficou sem cards');
    await foto(p, 'implantacao-escuro');
    await tresFotos({ claro, m }, '/trabalho/implantacao', 'implantacao');
    const doComercial = (est.pastasDoComercial ?? []).map((f) => `${f.name}: ${f.lists.map((l) => l.name).join(', ')}`);
    return { detalhe: { cardsNaImplantacao: n, pastasDoComercial: doComercial } };
  });

  // ---------------- 08 · botão direito ----------------
  let origem = null;
  let destino = null;
  await passo('08 · botão direito: as 8 ações; Renomear, Duplicar e Mesclar; Shift+F10 abre o mesmo menu', async () => {
    origem = await criarTarefa(nome('origem'));
    destino = await criarTarefa(nome('destino'));
    const comentario = `comentário da origem ${carimbo}`;
    await api('POST', `/trabalho/tarefas/${origem.id}/comentarios`, { text: comentario }, tok);
    await p.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    const abrirMenu = async (id) => {
      await p.locator(`[data-work-task-id="${id}"]`).first().click({ button: 'right' });
      const menu = p.getByTestId('menu-da-tarefa');
      await menu.waitFor();
      // Espera a tarefa ser lida (as ações que pedem a versão saem do "Lendo a tarefa…").
      await esperar(async () => !(await menu.innerText()).includes('Lendo a tarefa'), 8000);
      return menu;
    };
    const menu = await abrirMenu(origem.id);
    const rotulos = await menu.locator('[role="menuitem"]').evaluateAll((els) => els.map((e) => e.querySelector('span')?.textContent?.trim()));
    const esperados = ['Renomear', 'Copiar ID', 'Mover para…', 'Mesclar com outra…', 'Duplicar', 'Arquivar', 'Excluir', 'Compartilhar (copiar link)'];
    conferir(JSON.stringify(rotulos) === JSON.stringify(esperados), `ações do menu: ${JSON.stringify(rotulos)}`);
    for (const a of ['renomear', 'copiar-id', 'mover', 'mesclar', 'duplicar', 'arquivar', 'excluir', 'compartilhar']) conferir(await p.getByTestId(`menu-da-tarefa-${a}`).isVisible(), `"${a}" não está visível`);
    const desabilitadas = await menu.locator('[role="menuitem"][aria-disabled="true"]').count();
    conferir(desabilitadas === 0, `${desabilitadas} ação(ões) desabilitada(s) para o admin numa tarefa comum`);
    conferir((await dentroDaJanela(p, menu)).cabe, 'o menu da tarefa sai da janela');
    await foto(p, 'menu-da-tarefa-escuro');
    // Copiar ID.
    await p.getByTestId('menu-da-tarefa-copiar-id').click();
    await p.getByTestId('menu-da-tarefa-feito').waitFor();
    const copiado = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (copiado !== origem.id) aviso(`Copiar ID: a área de transferência tem ${copiado ? copiado.slice(0, 8) : 'nada'} (esperado ${origem.id.slice(0, 8)})`);
    await p.getByTestId('menu-da-tarefa').waitFor({ state: 'detached' });
    // Renomear.
    await abrirMenu(origem.id);
    await p.getByTestId('menu-da-tarefa-renomear').click();
    const novoTitulo = nome('origem renomeada');
    await p.locator('#menu-da-tarefa-titulo').fill(novoTitulo);
    await p.getByTestId('menu-da-tarefa-renomear-form').locator('button[type="submit"]').click();
    await p.getByTestId('menu-da-tarefa-feito').waitFor();
    conferir(await esperar(async () => (await tarefa(origem.id)).title === novoTitulo), 'renomear não gravou');
    conferir(await esperar(async () => (await p.locator(`[data-work-task-id="${origem.id}"]`).first().innerText()).includes(novoTitulo)), 'o cartão não mostra o nome novo');
    await p.getByTestId('menu-da-tarefa').waitFor({ state: 'detached' });
    // Duplicar.
    await abrirMenu(origem.id);
    await p.getByTestId('menu-da-tarefa-duplicar').click();
    const feitoDup = (await p.getByTestId('menu-da-tarefa-feito').innerText()).trim();
    const copias = await esperar(async () => {
      const r = await api('GET', `/trabalho/tarefas?listId=${lista.id}&limit=100`, undefined, tok);
      const c = r.items.filter((t) => t.id !== origem.id && t.title.includes(novoTitulo));
      return c.length ? c : null;
    });
    conferir(copias, `duplicar não criou a cópia (${feitoDup})`);
    const copia = await tarefa(copias[0].id);
    conferir(/c[óo]pia/i.test(copia.title), `a cópia se chama ${copia.title}`);
    conferir(!copia.comentarios.length, 'a cópia levou comentários');
    conferir(copia.statusId === origem.statusId, 'a cópia nasceu em outro status');
    await p.getByTestId('menu-da-tarefa').waitFor({ state: 'detached' });
    // Mesclar a origem no destino.
    await abrirMenu(origem.id);
    await p.getByTestId('menu-da-tarefa-mesclar').click();
    await p.getByTestId('menu-da-tarefa-mesclar-form').locator('input').fill(nome('destino'));
    await p.getByTestId(`menu-da-tarefa-mesclar-com-${destino.id}`).click();
    await foto(p, 'menu-mesclar-escuro');
    await p.getByTestId('menu-da-tarefa-mesclar-confirmar').click();
    const feitoMes = (await p.getByTestId('menu-da-tarefa-feito').innerText()).trim();
    const o = await esperar(async () => { const t = await tarefa(origem.id); return t.archived ? t : null; }, 10_000);
    conferir(o, 'a origem mesclada não ficou arquivada');
    const nota = o.comentarios.map((c) => c.text ?? c.texto ?? '').find((t) => /mesclada em/i.test(t));
    conferir(nota, `a origem não tem o comentário "mesclada em": ${JSON.stringify(o.comentarios.map((c) => (c.text ?? '').slice(0, 60)))}`);
    const d = await tarefa(destino.id);
    conferir(d.comentarios.some((c) => (c.text ?? c.texto ?? '').includes(comentario)), 'o comentário da origem não chegou ao destino');
    await p.getByTestId('menu-da-tarefa').waitFor({ state: 'detached' });
    await p.reload({ waitUntil: 'networkidle' });
    conferir(!(await p.locator(`[data-work-task-id="${origem.id}"]`).count()), 'a origem arquivada continua no quadro');
    // Shift+F10 com o foco no cartão.
    const cartao = p.locator(`[data-work-task-id="${destino.id}"]`).first();
    // O foco no botão do título (o que o Tab alcança); a tecla sobe até o cartão.
    await cartao.locator('button').first().focus();
    await p.keyboard.press('Shift+F10');
    const menuTeclado = p.getByTestId('menu-da-tarefa');
    conferir(await esperar(async () => (await menuTeclado.count()) > 0, 4000), 'Shift+F10 não abriu o menu');
    const rot2 = await menuTeclado.locator('[role="menuitem"]').count();
    conferir(rot2 === 8, `Shift+F10 abriu um menu com ${rot2} ações`);
    await foto(p, 'menu-shift-f10-escuro');
    await p.keyboard.press('Escape');
    // Claro e 390 (o "⋯" do cartão abre o mesmo menu no toque).
    await claro.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    await claro.locator(`[data-work-task-id="${destino.id}"]`).first().click({ button: 'right' });
    await claro.getByTestId('menu-da-tarefa').waitFor();
    await esperar(async () => !(await claro.getByTestId('menu-da-tarefa').innerText()).includes('Lendo a tarefa'), 8000);
    await foto(claro, 'menu-da-tarefa-claro');
    await m.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    const botao390 = m.getByTestId(`menu-da-tarefa-botao-${destino.id}`).first();
    await botao390.scrollIntoViewIfNeeded();
    await botao390.click();
    const menu390 = m.getByTestId('menu-da-tarefa');
    await menu390.waitFor();
    await esperar(async () => !(await menu390.innerText()).includes('Lendo a tarefa'), 8000);
    conferir((await dentroDaJanela(m, menu390)).cabe, 'a 390 px o menu da tarefa sai da janela');
    await foto(m, 'menu-da-tarefa-390');
    conferir(await semRolagemLateral(m), 'o quadro rola de lado a 390');
    return { detalhe: { duplicar: feitoDup.slice(0, 80), mesclar: feitoMes.slice(0, 160), notaNaOrigem: nota.slice(0, 120) } };
  });

  // ---------------- 09 · modo centralizado ----------------
  await passo('09 · modo centralizado: "Abrir no centro" em duas colunas, Esc fecha, a preferência fica, "Voltar para o lado"; 390 tela cheia', async () => {
    const alvo = destino ?? ativa;
    await p.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    await p.evaluate(() => localStorage.setItem('rootos.tarefa.modo', 'lado'));
    const abrir = async () => {
      await p.locator(`[data-work-task-id="${alvo.id}"]`).first().click();
      const pop = p.getByTestId('tarefa-popup');
      await pop.waitFor();
      return pop;
    };
    let pop = await abrir();
    conferir((await pop.getAttribute('data-modo')) === 'lado', 'a tarefa não abriu ao lado');
    await p.getByTestId('tarefa-modo-centro').click();
    conferir(await esperar(async () => (await pop.getAttribute('data-modo')) === 'centro'), 'não foi para o centro');
    await dormir(300);
    const esq = await p.getByTestId('tarefa-coluna-esquerda').boundingBox();
    const dir = await p.getByTestId('tarefa-coluna-direita').boundingBox();
    conferir(esq && dir && dir.x >= esq.x + esq.width - 2 && Math.abs(dir.y - esq.y) < 40, `as colunas não estão lado a lado: ${JSON.stringify({ esq, dir })}`);
    const textoDir = (await p.getByTestId('tarefa-coluna-direita').innerText()).replace(/\s+/g, ' ');
    conferir(/coment/i.test(textoDir), 'a coluna da direita não tem os comentários');
    const box = await pop.boundingBox();
    const j = p.viewportSize();
    conferir(Math.abs(box.x + box.width / 2 - j.width / 2) < 4, 'o modal não está centralizado');
    const url = p.url();
    await foto(p, 'tarefa-centro-escuro');
    await p.keyboard.press('Escape');
    conferir(await esperar(async () => (await p.getByTestId('tarefa-popup').count()) === 0), 'Esc não fechou');
    pop = await abrir();
    conferir((await pop.getAttribute('data-modo')) === 'centro', 'reabrir não lembrou o centro');
    conferir(new URL(p.url()).searchParams.get('tarefa') === new URL(url).searchParams.get('tarefa'), 'o endereço mudou entre os modos');
    await p.getByTestId('tarefa-modo-lado').click();
    conferir(await esperar(async () => (await pop.getAttribute('data-modo')) === 'lado'), '"Voltar para o lado" não voltou');
    await foto(p, 'tarefa-lado-escuro');
    await p.keyboard.press('Escape');
    // Claro, no centro.
    await claro.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    await claro.evaluate(() => localStorage.setItem('rootos.tarefa.modo', 'centro'));
    await claro.locator(`[data-work-task-id="${alvo.id}"]`).first().click();
    await claro.getByTestId('tarefa-popup').waitFor();
    await foto(claro, 'tarefa-centro-claro');
    // 390: tela cheia, colunas empilhadas.
    await m.goto(`${WEB}${urlDaLista}`, { waitUntil: 'networkidle' });
    await m.evaluate(() => localStorage.setItem('rootos.tarefa.modo', 'centro'));
    await m.locator(`[data-work-task-id="${alvo.id}"]`).first().click();
    const pm = m.getByTestId('tarefa-popup');
    await pm.waitFor();
    conferir((await pm.getAttribute('data-modo')) === 'centro', 'a 390 não abriu no centro');
    const bm = await pm.boundingBox();
    const jm = m.viewportSize();
    conferir(bm.x <= 0.5 && bm.y <= 0.5 && bm.width >= jm.width - 1 && bm.height >= jm.height - 2, `a 390 o centralizado não é tela cheia: ${JSON.stringify(bm)}`);
    const e390 = await m.getByTestId('tarefa-coluna-esquerda').boundingBox();
    await m.getByTestId('tarefa-coluna-direita').scrollIntoViewIfNeeded();
    const esq390 = await m.getByTestId('tarefa-coluna-esquerda').boundingBox();
    const dir390 = await m.getByTestId('tarefa-coluna-direita').boundingBox();
    conferir(dir390.y >= esq390.y + esq390.height - 2, 'a 390 as colunas não estão empilhadas');
    await m.getByTestId('tarefa-coluna-esquerda').scrollIntoViewIfNeeded();
    await foto(m, 'tarefa-centro-390');
    await m.evaluate(() => localStorage.setItem('rootos.tarefa.modo', 'lado'));
    return { detalhe: { centro: { x: Math.round(box.x), w: Math.round(box.width) }, colunas390: { esq: Math.round(e390?.width ?? 0), dir: Math.round(dir390.width) } } };
  });

  // ---------------- 10 · Funil vivo em lista ----------------
  await passo('10 · Funil vivo em lista: larguras mínimas, arrastar a borda (persiste), ordenar (aria-sort), esconder coluna; 390 em cartões', async () => {
    await p.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
    await p.getByTestId('funil-visao-lista').click();
    const tabela = p.getByTestId('funil-lista');
    await tabela.waitFor();
    const minimos = { empresa: 160, contato: 120, etapa: 130, responsavel: 96, produto: 110, valor: 100, dias: 96, proxima: 200, pendencias: 160 };
    const larguras = {};
    for (const [k, min] of Object.entries(minimos)) {
      const th = p.getByTestId(`funil-lista-cabecalho-${k}`);
      if (!(await th.count())) continue;
      const w = (await th.boundingBox()).width;
      larguras[k] = Math.round(w);
      conferir(w >= min - 1, `a coluna ${k} tem ${Math.round(w)}px, mínimo ${min}`);
    }
    await foto(p, 'funil-lista-escuro');
    // Arrastar a borda do "Contato" 80 px para a direita.
    const borda = p.getByTestId('funil-lista-borda-contato');
    const b = await borda.boundingBox();
    const antes = (await p.getByTestId('funil-lista-cabecalho-contato').boundingBox()).width;
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down();
    for (let i = 1; i <= 8; i++) await p.mouse.move(b.x + b.width / 2 + i * 10, b.y + b.height / 2);
    await p.mouse.up();
    const depois = (await p.getByTestId('funil-lista-cabecalho-contato').boundingBox()).width;
    conferir(depois >= antes + 60, `arrastar a borda foi de ${Math.round(antes)} para ${Math.round(depois)}px`);
    await p.reload({ waitUntil: 'networkidle' });
    if (!(await p.getByTestId('funil-lista').isVisible().catch(() => false))) await p.getByTestId('funil-visao-lista').click();
    await p.getByTestId('funil-lista').waitFor();
    const recarregada = (await p.getByTestId('funil-lista-cabecalho-contato').boundingBox()).width;
    conferir(Math.abs(recarregada - depois) <= 2, `depois de recarregar a coluna tem ${Math.round(recarregada)}px (era ${Math.round(depois)})`);
    // Ordenar.
    const cab = p.getByTestId('funil-lista-cabecalho-empresa');
    const sort0 = await cab.getAttribute('aria-sort');
    await cab.locator('button').click();
    const sort1 = await esperar(async () => { const s = await cab.getAttribute('aria-sort'); return s !== sort0 ? s : null; });
    await cab.locator('button').click();
    const sort2 = await esperar(async () => { const s = await cab.getAttribute('aria-sort'); return s !== sort1 ? s : null; });
    conferir(sort1 === 'ascending' && sort2 === 'descending', `aria-sort foi ${sort0} → ${sort1} → ${sort2}`);
    const empresas = await p.locator('tr[data-testid^="funil-linha-"]').evaluateAll((trs) => trs.map((tr) => tr.querySelector('td')?.textContent?.trim() ?? ''));
    const cmp = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true }).compare;
    const foraDeOrdem = empresas.findIndex((e, i) => i > 0 && cmp(empresas[i - 1], e) < 0);
    conferir(foraDeOrdem < 0, `a lista decrescente sai de ordem na linha ${foraDeOrdem}: "${empresas[foraDeOrdem - 1]}" antes de "${empresas[foraDeOrdem]}"`);
    await foto(p, 'funil-lista-ordenada-escuro');
    // Esconder "Produto" pelo painel de Filtros.
    await p.getByTestId('funil-filtros-botao').click();
    await p.getByTestId('funil-colunas').waitFor();
    const caixa = p.getByTestId('funil-colunas-produto');
    if (!(await caixa.isChecked())) await caixa.check();
    await caixa.uncheck();
    conferir(await esperar(async () => (await p.getByTestId('funil-lista-cabecalho-produto').count()) === 0), 'a coluna Produto não sumiu');
    await foto(p, 'funil-lista-colunas-escuro');
    // Volta ao padrão (colunas e larguras), para não deixar a vista do e2e para trás.
    if (await p.getByTestId('funil-colunas-padrao').count()) await p.getByTestId('funil-colunas-padrao').click();
    await p.keyboard.press('Escape');
    await cab.locator('button').click();
    await p.getByTestId('funil-lista-borda-contato').dblclick();
    await claro.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
    await claro.getByTestId('funil-visao-lista').click();
    await claro.getByTestId('funil-lista').waitFor();
    await foto(claro, 'funil-lista-claro');
    await m.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
    await m.getByTestId('funil-visao-lista').click();
    const cartoes = m.getByTestId('funil-lista-cartoes');
    await cartoes.waitFor();
    conferir(!(await m.getByTestId('funil-lista').isVisible()), 'a 390 a tabela continua visível');
    await foto(m, 'funil-lista-390');
    conferir(await semRolagemLateral(m), 'o Funil em lista rola de lado a 390');
    await m.getByTestId('funil-visao-quadro').click();
    await p.getByTestId('funil-visao-quadro').click().catch(() => undefined);
    return { detalhe: { larguras, contato: { antes: Math.round(antes), depois: Math.round(depois), recarregada: Math.round(recarregada) }, sort: [sort0, sort1, sort2] } };
  });

  // ---------------- 11 · Propostas ----------------
  await passo('11 · Propostas: a primeira coluna é o lead, sem origem, "Aparelhos" antes da lista; linha abre o lead; sem lead → Vincular', async () => {
    await p.goto(`${WEB}/propostas`, { waitUntil: 'networkidle' });
    const tabela = p.getByTestId('propostas-lista');
    await tabela.waitFor({ timeout: 20_000 });
    const cabecalhos = await tabela.locator('thead th').evaluateAll((ths) => ths.map((t) => t.textContent.trim()));
    conferir(cabecalhos[0] === 'Lead', `a primeira coluna é "${cabecalhos[0]}"`);
    conferir(!cabecalhos.some((c) => /origem/i.test(c)), `há coluna origem: ${cabecalhos.join(' | ')}`);
    const aparelhos = p.getByTestId('propostas-aparelhos');
    let ordemAparelhos = null;
    if (await aparelhos.count()) {
      ordemAparelhos = await p.evaluate(() => {
        const a = document.querySelector('[data-testid="propostas-aparelhos"]');
        const l = document.querySelector('[data-testid="propostas-lista"]');
        const antesDaLista = !!(a.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
        const temPainelAntes = !!a.previousElementSibling;
        return { antesDaLista, temPainelAntes, yA: a.getBoundingClientRect().y, yL: l.getBoundingClientRect().y };
      });
      conferir(ordemAparelhos.antesDaLista && ordemAparelhos.temPainelAntes && ordemAparelhos.yA < ordemAparelhos.yL, `"Aparelhos da equipe" fora do lugar: ${JSON.stringify(ordemAparelhos)}`);
    } else aviso('"Aparelhos da equipe" não aparece (o serviço de propostas não respondeu nesta stack)');
    const comLead = await tabela.locator('[data-testid^="proposta-lead-"]').count();
    const semLead = await tabela.locator('[data-testid^="proposta-sem-lead-"]').count();
    await foto(p, 'propostas-escuro');
    await tresFotos({ claro, m }, '/propostas', 'propostas');
    let abriu = null;
    if (comLead) {
      const link = tabela.locator('[data-testid^="proposta-lead-"]').first();
      const href = await link.getAttribute('href');
      const linha = link.locator('xpath=ancestor::tr[1]');
      await linha.locator('td').nth(1).click();
      await p.waitForURL(/\/comercial\/lead\//, { timeout: 15_000 });
      abriu = new URL(p.url()).pathname;
      conferir(abriu === href, `a linha abriu ${abriu}, o lead é ${href}`);
      await p.waitForLoadState('networkidle');
      await foto(p, 'propostas-lead-aberto-escuro');
    } else aviso('nenhuma proposta com lead nesta stack: clicar na linha não foi exercitado');
    let vinculo = null;
    if (semLead) {
      await p.goto(`${WEB}/propostas`, { waitUntil: 'networkidle' });
      const botao = p.locator('[data-testid^="proposta-vincular-"]').filter({ hasText: 'Vincular a um lead' }).first();
      if (await botao.count()) {
        const chave = (await botao.getAttribute('data-testid')).replace('proposta-vincular-', '');
        await botao.click();
        const busca = p.getByTestId(`proposta-busca-${chave}`);
        await busca.waitFor();
        await busca.fill('a');
        const escolha = p.locator('[data-testid^="proposta-escolher-"]').first();
        conferir(await esperar(async () => (await escolha.count()) > 0), 'a busca de lead não achou nenhum');
        await foto(p, 'propostas-vincular-escuro');
        const leadId = (await escolha.getAttribute('data-testid')).replace('proposta-escolher-', '');
        await escolha.click();
        const status = p.locator('[role="status"]').filter({ hasText: /lead|ligad/i }).first();
        await status.waitFor({ timeout: 15_000 });
        vinculo = { chave: chave.slice(0, 12), lead: leadId.slice(0, 8), aviso: (await status.innerText()).trim().slice(0, 100) };
        conferir(await esperar(async () => (await p.getByTestId(`proposta-lead-${chave}`).count()) > 0, 10_000), 'a linha não passou a mostrar o lead');
        await foto(p, 'propostas-vinculada-escuro');
      } else aviso('as propostas sem lead desta stack não oferecem "Vincular" (institucionais ou sem permissão)');
    } else aviso('a stack não tem proposta sem lead: Vincular/Criar lead não foi exercitado na tela');
    return { detalhe: { cabecalhos, comLead, semLead, aparelhos: ordemAparelhos, abriu, vinculo } };
  });

  // ---------------- 12 · avatar e nascimento ----------------
  await passo('12 · perfil: enviar a foto (PNG 64×64), ela aparece no perfil e na Equipe; a data de nascimento grava', async () => {
    // Envia a foto e grava a data pela tela do perfil (o próprio, ou o de outra pessoa como admin).
    const fotoENascimento = async (caminho, nascimento, idDaApi) => {
      await p.goto(`${WEB}${caminho}`, { waitUntil: 'networkidle' });
      const secao = p.locator('section[aria-label="Foto"]');
      await secao.waitFor();
      if (idDaApi) await esperar(async () => (await api('GET', `/perfil/${idDaApi}`, undefined, tok)).nome && (await secao.locator('h2').innerText()) === (await api('GET', `/perfil/${idDaApi}`, undefined, tok)).nome);
      await secao.locator('input[type="file"]').setInputFiles({ name: 'avatar-e2e-22b.png', mimeType: 'image/png', buffer: pngDeProva(64) });
      const avatar = secao.getByTestId('avatar-da-pessoa');
      conferir(await esperar(async () => (await avatar.getAttribute('data-com-foto')) === 'sim', 15_000), `a foto não apareceu no perfil (${caminho})`);
      const lido = await api('GET', idDaApi ? `/perfil/${idDaApi}` : '/perfil', undefined, tok);
      conferir(lido.foto?.url, 'a API não tem a foto');
      await p.getByLabel('Data de nascimento').fill(nascimento);
      await p.locator('form[aria-label="Cadastro"] button[type="submit"]').click();
      await p.locator('[role="status"]').filter({ hasText: /Perfil salvo|Nada mudou/ }).waitFor({ timeout: 10_000 });
      const depois = await api('GET', idDaApi ? `/perfil/${idDaApi}` : '/perfil', undefined, tok);
      conferir(String(depois.dataNascimento ?? '').startsWith(nascimento), `a data gravada é ${depois.dataNascimento}`);
      return depois;
    };
    const proprio = await fotoENascimento('/perfil', '1990-05-17');
    await foto(p, 'perfil-escuro');
    // O topo: a identificação ao lado da engrenagem.
    const topo = await p.locator('header [data-testid="avatar-da-pessoa"][data-com-foto="sim"]').count();
    if (!topo) aviso('o topo ainda mostra as iniciais, não a foto (a troca por avatar nas outras telas entra numa imagem posterior)');
    // A Equipe: o admin do seed não é pessoa da Equipe; o admin põe foto e data em "Lucas (exemplo)" e confere lá.
    const equipe = await api('GET', '/organograma/equipe', undefined, tok);
    let naEquipe = equipe.pessoas.find((x) => x.id === sessao.user.id);
    if (!naEquipe) {
      naEquipe = equipe.pessoas.find((x) => /^Lucas/.test(x.nome)) ?? equipe.pessoas[0];
      conferir(naEquipe, 'a Equipe não tem ninguém');
      await fotoENascimento(`/perfil?pessoa=${encodeURIComponent(naEquipe.id)}`, '1988-03-09', naEquipe.id);
      await foto(p, 'perfil-de-outra-pessoa-escuro');
    }
    await p.goto(`${WEB}/organograma`, { waitUntil: 'networkidle' });
    const cartao = p.locator(`section[aria-label="${naEquipe.nome}"]`).first();
    await cartao.waitFor({ timeout: 15_000 });
    conferir(await esperar(async () => (await cartao.locator('[data-testid="avatar-da-pessoa"][data-com-foto="sim"]').count()) > 0, 10_000), 'a foto não aparece na Equipe');
    const aniversario = (await cartao.locator(`[data-testid="aniversario-${naEquipe.id}"]`).innerText().catch(() => '')).trim();
    conferir(/(^|\D)0?9(\D|$)|mar/i.test(aniversario) || /17|mai/i.test(aniversario), `a Equipe não mostra o aniversário: "${aniversario}"`);
    conferir(!/19\d\d/.test(aniversario), 'a Equipe mostra o ano de nascimento');
    await cartao.scrollIntoViewIfNeeded();
    await foto(p, 'equipe-avatar-escuro');
    const perfil = proprio;
    // Responsável por avatar nas outras telas (aviso, não falha).
    // Os cards do seed só têm o responsável em texto antigo (sem pessoa ligada: círculo tracejado,
    // como antes). Para provar o avatar, um card fictício ganha a pessoa da sessão como responsável.
    await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    await p.locator('[data-work-task-id]').first().waitFor({ timeout: 15_000 });
    const cardId = await p.locator('[data-work-task-id]').first().getAttribute('data-work-task-id');
    const card = await api('GET', `/trabalho/tarefas/${cardId}`, undefined, tok);
    if (card.assigneeUserId !== sessao.user.id) {
      await api('PATCH', `/trabalho/tarefas/${cardId}`, { assigneeUserId: sessao.user.id, expectedUpdatedAt: card.updatedAt }, tok);
    }
    await p.reload({ waitUntil: 'networkidle' });
    const noCard = p.locator(`[data-work-task-id="${cardId}"] [data-testid="avatar-da-pessoa"]`).first();
    conferir(await esperar(async () => (await noCard.count()) > 0, 10_000), 'o card da Implantação com pessoa ligada não mostra o avatar');
    const balao = (await noCard.getAttribute('title')) ?? (await noCard.getAttribute('aria-label')) ?? '';
    conferir(balao.includes(sessao.user.name), `o balão do avatar não traz o nome: "${balao}"`);
    const avataresNoQuadro = await p.locator('[data-work-task-id] [data-testid="avatar-da-pessoa"]').count();
    await foto(p, 'implantacao-avatar-escuro');
    await tresFotos({ claro, m }, '/perfil', 'perfil');
    return { detalhe: { foto: perfil.foto?.tipo ?? 'sim', aniversario, avatarNoTopo: !!topo, avataresNoQuadro } };
  });

  // ---------------- 13 · Equipe com o vault ----------------
  // O que o vault-dublê diz (homolog/fixtures/vault-equipe): a tabela de sócios e a matriz.
  const ESPERADO_DO_VAULT = {
    Alice: { conduz: 'Comercial e relacionamento', dona: ['Comercial', 'Governança', 'Implantação'], substituta: ['Produto'] },
    Bruno: { conduz: 'Produto e tecnologia', dona: ['Conteúdo', 'Governança', 'Produto'], substituta: ['Comercial', 'Financeiro'] },
    Clara: { conduz: 'Financeiro e pessoas', dona: ['Financeiro', 'Governança'], substituta: ['Conteúdo', 'Implantação'] },
  };
  await passo('13 · Equipe: vault-dublê reindexado; "Nome no vault" de três pessoas; o que conduz, dona e substituta, com link ao Contexto', async () => {
    const preparo = prepararVaultDoDuble();
    prova.preparoDoVault = preparo;
    if (!/já tinha/.test(preparo)) aviso(preparo);
    const reindex = await api('POST', '/knowledge/reindex', undefined, tok);
    const pessoas = (await api('GET', '/perfil/pessoas', undefined, tok)).pessoas;
    const escolher = (re) => pessoas.find((x) => re.test(x.nome));
    const mapa = [
      [escolher(/^Lucas/), 'Alice'],
      [escolher(/^Pedro/), 'Bruno'],
      [escolher(/^Rodrigo/), 'Clara'],
    ].filter(([x]) => x);
    conferir(mapa.length === 3, `o seed não tem as três pessoas de exemplo: ${pessoas.map((x) => x.nome).join(', ')}`);
    // Pela tela do perfil, como admin.
    for (const [pessoa, noVault] of mapa) {
      await p.goto(`${WEB}/perfil?pessoa=${encodeURIComponent(pessoa.id)}`, { waitUntil: 'networkidle' });
      const campo = p.getByLabel('Nome no vault da Root');
      await campo.waitFor();
      await esperar(async () => (await p.locator('h2').filter({ hasText: pessoa.nome }).count()) > 0);
      await campo.fill(noVault);
      await p.locator('form[aria-label="Cadastro"] button[type="submit"]').click();
      await p.locator('[role="status"]').filter({ hasText: /Perfil salvo|Nada mudou/ }).waitFor({ timeout: 10_000 });
      const lido = await api('GET', `/perfil/${pessoa.id}`, undefined, tok);
      conferir(lido.nomeNoVault === noVault, `${pessoa.nome}: nomeNoVault gravado ${lido.nomeNoVault}`);
    }
    await foto(p, 'perfil-nome-no-vault-escuro');
    const equipe = await api('GET', '/organograma/equipe', undefined, tok);
    conferir(equipe.memoria?.disponivel, `a memória está indisponível: ${equipe.memoria?.frase}`);
    await p.goto(`${WEB}/organograma`, { waitUntil: 'networkidle' });
    const vistos = {};
    for (const [pessoa, noVault] of mapa) {
      const bloco = p.getByTestId(`vault-${pessoa.id}`);
      await bloco.waitFor({ timeout: 15_000 });
      const texto = (await bloco.innerText()).replace(/\s+/g, ' ');
      conferir(texto.includes(`como ${noVault}`), `${noVault}: o bloco diz "${texto.slice(0, 120)}"`);
      conferir(/Conduz/i.test(texto), `${noVault}: sem "Conduz"`);
      conferir(/Dona das funções/i.test(texto), `${noVault}: sem as funções de que é dona`);
      const links = await bloco.locator('a[href^="/contexto?nota="]').count();
      conferir(links > 0, `${noVault}: nenhum link para o Contexto`);
      const listas = await bloco.evaluate((el) => {
        const de = (rotulo) => {
          const titulo = [...el.querySelectorAll('p')].find((x) => x.textContent.trim().toLowerCase() === rotulo);
          const ul = titulo?.nextElementSibling;
          return ul ? [...ul.querySelectorAll('li')].map((li) => li.firstElementChild?.textContent.trim() ?? '').sort() : [];
        };
        return { dona: de('dona das funções'), substituta: de('substituta em') };
      });
      const esperado = ESPERADO_DO_VAULT[noVault];
      conferir(JSON.stringify(listas.dona) === JSON.stringify(esperado.dona), `${noVault}: dona de ${listas.dona.join(', ')}; o vault diz ${esperado.dona.join(', ')}`);
      conferir(JSON.stringify(listas.substituta) === JSON.stringify(esperado.substituta), `${noVault}: substituta em ${listas.substituta.join(', ')}; o vault diz ${esperado.substituta.join(', ')}`);
      conferir(texto.includes(esperado.conduz), `${noVault}: não diz que conduz "${esperado.conduz}"`);
      vistos[noVault] = { ...listas, links };
    }
    conferir(Object.values(vistos).some((v) => v.substituta), 'ninguém aparece como substituto(a) de alguma função');
    const primeiro = p.getByTestId(`vault-${mapa[0][0].id}`);
    await primeiro.scrollIntoViewIfNeeded();
    await foto(p, 'equipe-vault-escuro');
    const href = await primeiro.locator('a[href^="/contexto?nota="]').first().getAttribute('href');
    await tresFotos({ claro, m }, '/organograma', 'equipe', async (pg) => { await pg.getByTestId(`vault-${mapa[0][0].id}`).scrollIntoViewIfNeeded(); });
    await p.goto(`${WEB}${href}`, { waitUntil: 'networkidle' });
    await foto(p, 'equipe-link-contexto-escuro');
    return { detalhe: { reindex: reindex.notes, socios: equipe.memoria.socios, vistos } };
  });

  // ---------------- 14 · Integrações ----------------
  await passo('14 · Integrações: sem Asana, Extrato OFX e Zapier; Granola e Evolution no mesmo cartão, "Configurar" abre as ações', async () => {
    await p.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    const cartoes = p.locator('section[data-conector]');
    await cartoes.first().waitFor({ timeout: 20_000 });
    const chaves = await cartoes.evaluateAll((s) => s.map((x) => x.getAttribute('data-conector')));
    const titulos = await cartoes.locator('h2').allInnerTexts();
    const proibidos = titulos.filter((t) => /asana|ofx|zapier/i.test(t)).concat(chaves.filter((k) => /asana|ofx|zapier/i.test(k)));
    conferir(!proibidos.length, `ainda aparecem: ${proibidos.join(', ')}`);
    conferir(chaves.includes('granola') && chaves.includes('evolution'), `faltam Granola/Evolution: ${chaves.join(', ')}`);
    const caixas = {};
    for (const k of chaves) caixas[k] = await p.locator(`section[data-conector="${k}"]`).boundingBox();
    const larguras = [...new Set(Object.values(caixas).map((b) => Math.round(b.width)))];
    conferir(larguras.length === 1, `cartões de larguras diferentes: ${JSON.stringify(Object.fromEntries(Object.entries(caixas).map(([k, b]) => [k, Math.round(b.width)])))}`);
    // Altura: igual à dos vizinhos da mesma linha da grade.
    for (const k of ['granola', 'evolution']) {
      const b = caixas[k];
      const vizinhos = Object.entries(caixas).filter(([kk, bb]) => kk !== k && Math.abs(bb.y - b.y) < 2);
      for (const [kk, bb] of vizinhos) conferir(Math.abs(bb.height - b.height) <= 2, `${k} tem ${Math.round(b.height)}px de altura e ${kk}, na mesma linha, ${Math.round(bb.height)}px`);
    }
    await foto(p, 'conexoes-escuro');
    const gavetas = {};
    for (const k of ['granola', 'evolution']) {
      const sec = p.locator(`section[data-conector="${k}"]`);
      const nomeDoCartao = (await sec.locator('h2').innerText()).trim();
      await sec.getByRole('button', { name: 'Configurar' }).click();
      const gaveta = sec.getByRole('group', { name: `Configurar ${nomeDoCartao}` });
      await gaveta.waitFor();
      // O conteúdo da gaveta é lido da API ao abrir: espera chegar.
      const t = (await esperar(async () => { const x = (await gaveta.innerText()).replace(/\s+/g, ' ').trim(); return x.length > 20 ? x : null; }, 15_000)) ?? '';
      conferir(t.length > 20, `a gaveta de ${k} ficou vazia 15 s depois de abrir`);
      gavetas[k] = t.slice(0, 100);
      await sec.scrollIntoViewIfNeeded();
      await foto(p, `conexoes-${k}-configurar-escuro`);
      await sec.getByRole('button', { name: 'Fechar configuração' }).click();
    }
    await tresFotos({ claro, m }, '/conexoes', 'conexoes');
    return { detalhe: { cartoes: chaves.length, largura: larguras[0], gavetas } };
  });

  if (erros.length) aviso(`erros de página: ${erros.slice(0, 3).join(' | ')}`);
  await navegador.close();
}

main()
  .then(() => {
    const falhas = prova.passos.filter((x) => !x.ok);
    prova.ok = !prova.pulados && !falhas.length;
    gravar();
    console.log(`\n${prova.ok ? 'PASSA' : 'FALHA'} · ${prova.passos.length} passos · ${falhas.length} com falha · ${Math.round((Date.now() - t0) / 1000)} s`);
    if (!prova.ok) process.exit(1);
  })
  .catch((e) => {
    prova.erro = String(e?.message ?? e);
    gravar();
    console.error(`\nFALHA · ${prova.erro}`);
    process.exit(1);
  });
