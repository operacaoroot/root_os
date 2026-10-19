#!/usr/bin/env node
/*
 * A PROVA DO PAINEL DO LEAD, NO NAVEGADOR, CONTRA A HOMOLOGAÇÃO EM DOCKER (lane UX).
 *
 * Playwright (Chromium) contra o web da homologação (`http://127.0.0.1:3010`) e
 * a API (`http://127.0.0.1:4010/api`). O Playwright não é dependência do
 * repositório: vem de uma pasta de ferramentas da máquina (`UX_PW`, padrão
 * `C:/Users/User/dev/pw-tools`). A senha da homologação é lida de
 * `homolog/.env.homolog` em tempo de execução; o link da sala da Construtora
 * Alicerce, da saída da semente em `homolog/.tmp/seed-r5.log` (fora do git) ou
 * de `UX_SALA_ALICERCE`.
 *
 * O que ela prova, sem mudar de página (um marcador no `window` sobrevive do
 * começo ao fim de cada parte; recarregar o apagaria):
 *   1. a Alicerce pede 8% pela sala → a decisão abre na fila;
 *   2. na fila, "ver o lead" abre o painel na aba Decisões (só a query muda);
 *   3. "Manter o preço" dentro do painel → o aviso no canto, o cartão sai da
 *      fila de trás e o fio ganha a linha da decisão;
 *   4. Esc fecha, a URL volta à da fila e o foco volta ao link;
 *   5. no funil, pelo teclado (seta e Enter), o painel abre na aba Fio;
 *   6. a rota antiga /comercial/lead/<id> cai no funil com o painel aberto;
 *   7. a raiz / abre o /login (NEXT_PUBLIC_RAIZ=login);
 *   8. no celular (390 px), a folha abre na tela inteira e fecha, sem rolagem
 *      horizontal da página.
 * E fotografa: fila com o painel (Decisões), funil com o painel (Fio), Sessão,
 * Dinheiro e a folha no celular, nos temas escuro e claro.
 *
 * Saída: `homolog/provas/ux-painel.json` e `homolog/provas/ux-*.png`. Código de
 * saída diferente de zero no primeiro passo que falhar.
 *
 * Uso (Git Bash): node homolog/e2e/ux-painel.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4010/api';
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:3010';
const PW = process.env.UX_PW ?? 'C:/Users/User/dev/pw-tools';
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
const SENHA = lerEnv(join(RAIZ, 'homolog/.env.homolog')).ADMIN_PASSWORD;

const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], ok: false };
const t0 = Date.now();

function passo(nome, dados = {}) {
  const linha = { n: prova.passos.length + 1, nome, ms: Date.now() - t0, ...dados };
  prova.passos.push(linha);
  console.log(`  ${String(linha.n).padStart(2)}. ${nome}${dados.detalhe ? ` · ${dados.detalhe}` : ''}`);
}

function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  writeFileSync(join(PROVAS, 'ux-painel.json'), `${JSON.stringify(prova, null, 2)}\n`);
}

function falhar(msg) {
  prova.erro = msg;
  gravar();
  console.error(`FALHOU: ${msg}`);
  process.exit(1);
}

function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function api(metodo, caminho, corpo, token) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

async function entrar(email) {
  const r = await api('POST', '/auth/login', { email, password: SENHA });
  return { token: r.token ?? r.accessToken, user: r.user };
}

function tokenDaSalaDaAlicerce() {
  if (process.env.UX_SALA_ALICERCE) return process.env.UX_SALA_ALICERCE.replace(/^.*\/s\//, '');
  const log = join(RAIZ, 'homolog/.tmp/seed-r5.log');
  if (!existsSync(log)) return null;
  const linha = readFileSync(log, 'utf8').split(/\r?\n/).find((l) => /Construtora Alicerce/.test(l) && /\/s\//.test(l));
  const m = linha && /\/s\/([A-Za-z0-9_-]+)/.exec(linha);
  return m ? m[1] : null;
}

/** Um contexto do navegador já logado (o token no localStorage, como o login da tela faria) e no tema pedido. */
async function contexto(navegador, sessao, tema, viewport = { width: 1440, height: 900 }) {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript(
    ([token, user, tema]) => {
      localStorage.setItem('mktos_token', token);
      localStorage.setItem('mktos_user', JSON.stringify(user));
      localStorage.setItem('root-os:tema', tema);
    },
    [sessao.token, sessao.user, tema],
  );
  return ctx;
}

async function foto(pagina, nome) {
  const arquivo = `ux-${nome}.png`;
  await pagina.waitForTimeout(350); // a animação de entrada termina
  await pagina.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}

const dialogo = (p) => p.getByRole('dialog');

async function marcar(p) {
  await p.evaluate(() => {
    window.__semRecarregar = 'marcado';
  });
}
async function aindaMarcado(p) {
  return (await p.evaluate(() => window.__semRecarregar)) === 'marcado';
}

async function main() {
  conferir(SENHA, 'ADMIN_PASSWORD ausente em homolog/.env.homolog');
  const mesa = await entrar('mesa@root.homolog');
  passo('mesa entrou pela API', { detalhe: mesa.user?.email });

  // 1. A Alicerce pede 8% pela sala: a decisão abre na fila.
  const funil = await api('GET', '/comercial/funil?filtro=todos', undefined, mesa.token);
  const cartaoAlicerce = funil.colunas.flatMap((c) => c.cartoes).find((c) => (c.empresa ?? c.nome) === 'Construtora Alicerce');
  conferir(cartaoAlicerce, 'a Construtora Alicerce não está no funil (rode db:seed:comercial)');
  const leadId = cartaoAlicerce.leadId;
  const salaToken = tokenDaSalaDaAlicerce();
  conferir(salaToken, 'link da sala da Alicerce ausente: rode db:seed:comercial ou defina UX_SALA_ALICERCE');
  const marca = `prova ux ${new Date().toISOString().slice(11, 19)}`;
  await api('POST', `/sala/${salaToken}/proposta/ajuste`, { pedido: `Dá para fazer 8%? (${marca})`, descontoPct: 8 });
  let decisao = null;
  for (let i = 0; i < 40 && !decisao; i++) {
    const lista = await api('GET', '/comercial/decisoes?estado=aberta', undefined, mesa.token);
    decisao = lista.find((d) => d.leadId === leadId && d.tipo === 'pedido_de_ajuste' && d.contexto.includes(marca)) ?? null;
    if (!decisao) await new Promise((r) => setTimeout(r, 500));
  }
  conferir(decisao, 'a decisão do pedido de ajuste não abriu');
  const fichaAntes = await api('GET', `/comercial/lead/${leadId}`, undefined, mesa.token);
  const tomadasAntes = fichaAntes.fio.filter((l) => l.type === 'decisao.tomada').length;
  passo('a Alicerce pediu 8% pela sala e a decisão abriu', { detalhe: decisao.titulo, leadId, decisaoId: decisao.id });

  const navegador = await chromium.launch();
  try {
    for (const tema of ['dark', 'light']) {
      const ctx = await contexto(navegador, mesa, tema);
      const p = await ctx.newPage();
      const sufixo = tema === 'dark' ? 'escuro' : 'claro';

      // 2. Da fila, "ver o lead" abre o painel na aba Decisões.
      await p.goto(`${WEB}/comercial/decisoes`, { waitUntil: 'networkidle' });
      await marcar(p);
      const cartaoNaFila = p.locator(`#dec-${decisao.id}`);
      if (tema === 'dark') {
        await cartaoNaFila.waitFor({ timeout: 30_000 });
        const link = cartaoNaFila.getByRole('link', { name: /ver o lead/ });
        await link.click();
        await dialogo(p).waitFor();
        const url = new URL(p.url());
        conferir(url.pathname === '/comercial/decisoes', `a fila mudou de página: ${url.pathname}`);
        conferir(url.searchParams.get('lead') === leadId && url.searchParams.get('aba') === 'decisoes', `query errada: ${url.search}`);
        conferir(await aindaMarcado(p), 'a página recarregou ao abrir o painel');
        conferir((await dialogo(p).getAttribute('aria-modal')) === 'true', 'o painel não é modal');
        await p.getByRole('dialog', { name: /Construtora Alicerce/ }).waitFor({ timeout: 15_000 });
        conferir((await dialogo(p).getByRole('heading', { level: 2 }).count()) === 1, 'o painel tem mais de um h2: o nome do lead tem de ser o único');
        passo('da fila, "ver o lead" abriu o painel na aba Decisões; só a query mudou', { detalhe: url.search });
        await dialogo(p).locator(`#painel-dec-${decisao.id}`).waitFor();
        await foto(p, `fila-painel-decisoes-${sufixo}`);

        // 3. "Manter o preço" dentro do painel.
        await dialogo(p).locator(`#painel-dec-${decisao.id}`).getByRole('button', { name: /Manter o preço/ }).click();
        await p.getByText(/^Respondido: Manter o preço\./).waitFor({ timeout: 15_000 });
        passo('decidiu "manter o preço" dentro do painel; o aviso no canto disse o que aconteceu');
        await p.locator('main').locator(`#dec-${decisao.id}`).waitFor({ state: 'detached', timeout: 20_000 });
        passo('o cartão da decisão saiu da fila de trás sem recarregar');
        await dialogo(p).getByRole('tab', { name: 'Fio' }).click();
        await p.waitForFunction(
          (n) => document.querySelectorAll('[data-painel-do-lead] [data-linha-do-fio="decisao.tomada"]').length > n,
          tomadasAntes,
          { timeout: 20_000 },
        );
        conferir(await aindaMarcado(p), 'a página recarregou durante a decisão');
        conferir(new URL(p.url()).pathname === '/comercial/decisoes', 'a decisão mudou de página');
        passo('o fio ganhou a linha da decisão; a URL mudou só na query', { detalhe: new URL(p.url()).search });

        // 4. Esc fecha e o foco volta.
        await p.keyboard.press('Escape');
        await dialogo(p).waitFor({ state: 'detached' });
        const depois = new URL(p.url());
        conferir(depois.pathname === '/comercial/decisoes' && !depois.searchParams.has('lead'), `fechar deixou a URL errada: ${p.url()}`);
        const focoNoMain = await p.evaluate(() => !!document.activeElement && document.getElementById('root-os-main')?.contains(document.activeElement));
        conferir(focoNoMain, 'o foco não voltou à tela de trás');
        conferir(await aindaMarcado(p), 'fechar recarregou a página');
        passo('Esc fechou o painel, a URL voltou à da fila e o foco voltou à tela de trás');
      } else {
        await p.goto(`${WEB}/comercial/decisoes?lead=${leadId}&aba=decisoes`, { waitUntil: 'networkidle' });
        await dialogo(p).waitFor();
        await p.waitForTimeout(800);
        await foto(p, `fila-painel-decisoes-${sufixo}`);
      }

      // 5. No funil, pelo teclado: seta e Enter.
      await p.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
      await marcar(p);
      const cartoes = p.locator('[data-cartao-do-funil]');
      await cartoes.first().waitFor({ timeout: 30_000 });
      // A Alicerce da semente, pelo id: as jornadas criam outras "Construtora Alicerce Homolog ...".
      const doLead = `lead=${leadId}&`;
      const indice = await cartoes.evaluateAll((els, marca) => els.findIndex((e) => (e.getAttribute('href') ?? '').includes(marca)), doLead);
      conferir(indice >= 0, 'a Alicerce não aparece no funil da tela');
      await cartoes.first().focus();
      // Anda pelas setas até a Alicerce (direita entre colunas, baixo dentro da coluna).
      for (let i = 0; i < 40; i++) {
        const atual = await p.evaluate(() => document.activeElement?.getAttribute('href') ?? '');
        if (atual.includes(doLead)) break;
        const colunaAtual = await p.evaluate(() => {
          const c = document.activeElement?.closest('[data-coluna-do-funil]');
          return Array.from(document.querySelectorAll('[data-coluna-do-funil]')).indexOf(c);
        });
        const colunaAlvo = await cartoes.nth(indice).evaluate((e) => Array.from(document.querySelectorAll('[data-coluna-do-funil]')).indexOf(e.closest('[data-coluna-do-funil]')));
        await p.keyboard.press(colunaAtual < colunaAlvo ? 'ArrowRight' : 'ArrowDown');
      }
      conferir((await p.evaluate(() => document.activeElement?.getAttribute('href') ?? '')).includes(doLead), 'as setas não chegaram à Alicerce');
      await p.keyboard.press('Enter');
      await dialogo(p).waitFor();
      const urlFunil = new URL(p.url());
      conferir(urlFunil.pathname === '/comercial/funil' && urlFunil.searchParams.get('aba') === 'fio', `o funil abriu errado: ${p.url()}`);
      conferir(await aindaMarcado(p), 'abrir pelo teclado recarregou o funil');
      await dialogo(p).locator('[data-linha-do-fio]').first().waitFor();
      if (tema === 'dark') passo('no funil, as setas andaram até a Alicerce e Enter abriu o painel na aba Fio', { detalhe: urlFunil.search });
      await foto(p, `funil-painel-fio-${sufixo}`);

      await dialogo(p).getByRole('tab', { name: 'Sessão' }).click();
      await dialogo(p).getByText(/da ata · com minuto/).waitFor();
      await p.waitForTimeout(500);
      conferir(new URL(p.url()).searchParams.get('aba') === 'sessao', 'a aba Sessão não foi para a URL');
      await foto(p, `painel-sessao-${sufixo}`);
      await dialogo(p).getByRole('tab', { name: 'Dinheiro' }).click();
      await dialogo(p).getByText(/aceite e cobrança/).waitFor();
      await p.waitForTimeout(500);
      await foto(p, `painel-dinheiro-alicerce-${sufixo}`);
      await p.keyboard.press('Escape');
      await dialogo(p).waitFor({ state: 'detached' });

      // A aba Dinheiro de um lead fechado (os da jornada), aberta pela lista de contratos.
      await p.goto(`${WEB}/comercial/contratos`, { waitUntil: 'networkidle' });
      const linha = p.locator('main a[href*="aba=dinheiro"]').first();
      if (await linha.count()) {
        await linha.click();
        await dialogo(p).getByText(/fechamento · as cinco escritas/).waitFor({ timeout: 20_000 });
        conferir(new URL(p.url()).pathname === '/comercial/contratos', 'contratos mudou de página');
        await p.waitForTimeout(800);
        await foto(p, `contratos-painel-dinheiro-${sufixo}`);
        if (tema === 'dark') passo('a linha da lista de contratos abriu o painel na aba Dinheiro');
        await p.keyboard.press('Escape');
      }

      if (tema === 'dark') {
        // 6. A rota antiga cai no funil com o painel aberto.
        await p.goto(`${WEB}/comercial/lead/${leadId}`, { waitUntil: 'networkidle' });
        await dialogo(p).waitFor({ timeout: 20_000 });
        const urlAntiga = new URL(p.url());
        conferir(urlAntiga.pathname === '/comercial/funil' && urlAntiga.searchParams.get('lead') === leadId && urlAntiga.searchParams.get('aba') === 'fio', `a rota antiga foi para ${p.url()}`);
        passo('a rota antiga /comercial/lead/<id> redirecionou para o funil com o painel na aba Fio');
        await p.goto(`${WEB}/comercial/lead/${leadId}/sessao`, { waitUntil: 'networkidle' });
        await dialogo(p).waitFor({ timeout: 20_000 });
        conferir(new URL(p.url()).searchParams.get('aba') === 'sessao', 'a rota antiga da sessão não abriu a aba Sessão');
        passo('a rota antiga /sessao abriu a aba Sessão');

        // 7. A raiz abre o login.
        const raiz = await (await navegador.newContext()).newPage();
        await raiz.goto(`${WEB}/`, { waitUntil: 'domcontentloaded' });
        await raiz.waitForURL(/\/login|\/painel/, { timeout: 20_000 });
        conferir(/\/login|\/painel/.test(new URL(raiz.url()).pathname), `a raiz foi para ${raiz.url()}`);
        passo('a raiz / abriu o login (NEXT_PUBLIC_RAIZ=login)', { detalhe: new URL(raiz.url()).pathname });
        await raiz.context().close();
      }
      await ctx.close();

      // 8. Celular, 390 px.
      const cel = await contexto(navegador, mesa, tema, { width: 390, height: 844 });
      const pc = await cel.newPage();
      await pc.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
      await marcar(pc);
      const cartaoCel = pc.locator(`[data-cartao-do-funil][href*="lead=${leadId}&"]`);
      await cartaoCel.scrollIntoViewIfNeeded();
      await cartaoCel.click();
      await dialogo(pc).waitFor();
      const caixa = await dialogo(pc).boundingBox();
      conferir(caixa && caixa.width >= 389 && caixa.height >= 843, `a folha não ocupa a tela: ${JSON.stringify(caixa)}`);
      const larguraPagina = await pc.evaluate(() => document.documentElement.scrollWidth);
      conferir(larguraPagina <= 390, `rolagem horizontal na página: ${larguraPagina}px`);
      const fechar = dialogo(pc).getByRole('button', { name: 'fechar o painel do lead' });
      const alturaFechar = (await fechar.boundingBox())?.height ?? 0;
      // Arredonda ao décimo: a altura sai 43,999996 px por subpixel (rodada do painel, 18/10/2026).
      conferir(Math.round(alturaFechar * 10) / 10 >= 44, `o botão fechar tem ${alturaFechar}px no celular`);
      await dialogo(pc).locator('[data-linha-do-fio]').first().waitFor();
      await foto(pc, `celular-folha-${sufixo}`);
      await fechar.click();
      await dialogo(pc).waitFor({ state: 'detached' });
      conferir(await aindaMarcado(pc), 'fechar a folha recarregou a página');
      if (tema === 'dark') passo('no celular (390 px) a folha abriu na tela inteira e fechou; sem rolagem horizontal; fechar com 44 px', { detalhe: `${caixa.width}x${caixa.height}` });
      await cel.close();
    }
  } finally {
    await navegador.close();
  }

  prova.ok = true;
  gravar();
  console.log(`OK em ${((Date.now() - t0) / 1000).toFixed(1)} s · ${prova.passos.length} passos · ${prova.screenshots.length} screenshots · homolog/provas/ux-painel.json`);
}

main().catch((e) => falhar(e instanceof Error ? e.message : String(e)));
