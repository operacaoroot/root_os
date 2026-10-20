#!/usr/bin/env node
/*
 * A PROVA DA RODADA DA INTERFACE (20/10/2026), CONTRA A STACK DO SEED EM DOCKER.
 *
 * Mesmo arranjo dos outros roteiros: Playwright (Chromium) da pasta de ferramentas da
 * máquina (`UX_PW`, padrão `C:/Users/User/dev/pw-tools`), o web em `UX_WEB` (padrão 3031),
 * a API em `UX_API` (padrão 4031), a senha lida de `HOMOLOG_ENV` em tempo de execução
 * (nunca copiada para arquivo commitado).
 *
 * O que ela prova (docs/comercial/RODADA-INTERFACE-20261020.md, U7):
 *   menu aberto com as subseções da área → recolher → balão no hover → clicar subseção;
 *   Painel geral fora do menu e /painel vivo; Trabalho com o painel de filtros
 *   (responsável e prazo), vista salva e Todas com segmento; Implantação com filtros;
 *   Funil sem chips, filtro por responsável, lista, mover para trás com a mensagem;
 *   WhatsApp como área com a tela; Atas › Reuniões do Granola (dublê) › Gerar ata ›
 *   sugestões › aceitar uma vira tarefa; Conexões › DigiSac com a URL do webhook.
 * E fotografa (escuro, claro e 390 px): menu aberto, recolhido com balão, Trabalho com
 * o painel de filtros, Funil, WhatsApp e Atas.
 *
 * ESCREVE na stack: uma vista salva do Trabalho, um mover no funil (e o de volta), e,
 * se o Granola dublê estiver ligado, uma ata e uma tarefa aceita.
 *
 * Saída: `homolog/provas/<PROVAS_PREFIXO>interface.json` e `interface-*.png`.
 * Uso (Git Bash): node homolog/e2e/interface.mjs
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
  writeFileSync(join(PROVAS, `${PREFIXO}interface.json`), `${JSON.stringify(prova, null, 2)}\n`);
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
  const arquivo = `${PREFIXO}interface-${nome}.png`;
  await p.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}
async function semRolagemLateral(p) {
  return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
const MAIN = '#root-os-main';

async function main() {
  const navegador = await chromium.launch();
  const sessao = await entrar(EMAIL);
  conferir(sessao.token, 'o login não devolveu token');
  const ctx = await contexto(navegador, sessao);
  const p = await ctx.newPage();
  p.setDefaultTimeout(20_000);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e.message ?? e)));

  // ---------------- U1 · o menu ----------------
  await passo('Menu aberto: a logo oficial sem texto ao lado e as subseções da área ativa', async () => {
    await p.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    const logo = p.getByRole('link', { name: 'ROOT OS, início' });
    await logo.waitFor();
    conferir(await logo.locator('svg').count(), 'a logo não é SVG');
    const textoDoCabecalho = (await logo.innerText()).trim();
    conferir(!/ROOT OS|operação root/i.test(textoDoCabecalho), `há texto ao lado da logo: "${textoDoCabecalho}"`);
    const lista = p.getByRole('list', { name: 'Subseções de Dia a dia' });
    await lista.waitFor();
    const itens = (await lista.getByRole('link').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    conferir(JSON.stringify(itens.slice(0, 4)) === JSON.stringify(['Visão geral', 'Pendências', 'Aprovações', 'Agenda']), `Dia a dia veio: ${itens.join(' · ')}`);
    conferir(!itens.includes('Painel geral da empresa'), 'o Painel geral da empresa ainda está no menu');
    conferir((await lista.locator('a[aria-current="page"]').innerText()).trim() === 'Visão geral', 'a subseção da rota atual não está marcada');
    conferir(!(await p.locator(`${MAIN} nav[aria-label^="Abas de"]`).count()), 'as abas da área ainda estão no campo principal');
    await foto(p, 'menu-aberto-escuro');
    return { detalhe: { itens } };
  });

  await passo('/painel continua vivo fora do menu', async () => {
    await p.goto(`${WEB}/painel`, { waitUntil: 'networkidle' });
    conferir(new URL(p.url()).pathname === '/painel', `/painel foi para ${p.url()}`);
    conferir(!(await p.locator('#root-os-nav a[href="/painel"]').count()), '/painel tem link no menu');
  });

  await passo('Recolher: só o R, e o balão no hover com as subseções, clicável', async () => {
    await p.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'Recolher menu' }).click();
    await dormir(300);
    const largura = (await p.locator('#root-os-nav').boundingBox()).width;
    conferir(largura <= 96, `recolhido ficou com ${Math.round(largura)} px`);
    const trabalho = p.locator('#root-os-nav a[data-area="trabalho"]');
    await trabalho.hover();
    const balao = p.locator('[data-balao-da-area]');
    await balao.waitFor({ state: 'visible' });
    const titulo = (await balao.locator('p').first().innerText()).trim();
    conferir(/Trabalho/i.test(titulo), `o balão abriu com o título "${titulo}"`);
    const links = (await balao.getByRole('link').allInnerTexts()).map((t) => t.trim());
    conferir(links.includes('Todas as tarefas') && links.includes('Implantação de clientes') && links.includes('Atas'), `o balão do Trabalho veio: ${links.join(' · ')}`);
    await foto(p, 'menu-recolhido-balao-escuro');
    // Entrar no balão com o mouse não fecha (ponte de hover).
    await balao.getByRole('link', { name: 'Todas as tarefas' }).hover();
    await dormir(250);
    conferir(await balao.isVisible(), 'o balão fechou quando o mouse entrou nele');
    await balao.getByRole('link', { name: 'Todas as tarefas' }).click();
    await p.waitForURL(/\/trabalho\/todas/);
    // Esc fecha e devolve o foco ao ícone.
    await p.locator('#root-os-nav a[data-area="comercial"]').focus();
    await balao.waitFor({ state: 'visible' });
    await p.keyboard.press('Escape');
    await balao.waitFor({ state: 'detached' }).catch(() => balao.waitFor({ state: 'hidden' }));
    const foco = await p.evaluate(() => document.activeElement?.getAttribute('data-area'));
    conferir(foco === 'comercial', `o foco foi para ${foco}`);
    await p.getByRole('button', { name: 'Expandir menu' }).click();
    return { detalhe: { largura: Math.round(largura), links } };
  });

  // ---------------- U2 · U3 · Trabalho ----------------
  await passo('Trabalho: Filtros (n) com responsável e prazo, estado no endereço', async () => {
    await p.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    await p.getByTestId('trabalho-filtros-botao').click();
    const painel = p.getByTestId('trabalho-filtros-painel');
    await painel.waitFor();
    const pessoas = await p.getByTestId('trabalho-filtros-assigneeUserId').locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    conferir(pessoas.length, 'o filtro de responsável não tem pessoas');
    await p.getByTestId('trabalho-filtros-assigneeUserId').selectOption(pessoas[0]);
    await p.getByTestId('trabalho-filtros-prazo').selectOption({ index: 1 });
    await dormir(400);
    const u = new URL(p.url());
    conferir(u.searchParams.get('assigneeUserId') === pessoas[0] && u.searchParams.get('prazo'), `o endereço ficou ${u.search}`);
    await foto(p, 'trabalho-filtros-escuro');
    await p.keyboard.press('Escape');
    conferir((await p.getByTestId('trabalho-filtros-contagem').innerText()).includes('2'), 'a contagem não diz 2');
    return { detalhe: { endereco: u.search } };
  });

  await passo('Trabalho: salvar a vista com os filtros', async () => {
    const nome = `Interface ${Date.now().toString().slice(-6)}`;
    p.once('dialog', (d) => d.accept(nome));
    await p.getByTestId('trabalho-vista-salvar').click();
    await p.getByTestId('trabalho-vistas').getByText(`Vista "${nome}" salva.`).waitFor();
    return { detalhe: { nome } };
  });

  await passo('Todas as tarefas: segmentos por pasta de topo, e o segmento filtra', async () => {
    await p.goto(`${WEB}/trabalho/todas`, { waitUntil: 'networkidle' });
    const seg = p.getByTestId('trabalho-segmentos');
    await seg.waitFor();
    const botoes = await seg.locator('[data-testid^="trabalho-segmento-"]').evaluateAll((bs) => bs.map((b) => [b.getAttribute('data-testid'), b.textContent?.trim()]));
    const dePasta = botoes.filter(([id]) => id !== 'trabalho-segmento-todas' && id !== 'trabalho-segmento-sem-pasta');
    conferir(dePasta.length >= 1, `sem segmentos de pasta: ${JSON.stringify(botoes)}`);
    const contar = () => p.locator('[data-work-task-id]').count();
    const todas = await contar();
    await p.getByTestId(dePasta[0][0]).click();
    await dormir(800);
    conferir(new URL(p.url()).searchParams.get('segmento'), 'o segmento não foi ao endereço');
    const doSegmento = await contar();
    conferir(doSegmento <= todas, `o segmento trouxe mais (${doSegmento}) que Todas (${todas})`);
    return { detalhe: { segmentos: botoes.map((b) => b[1]), todas, doSegmento } };
  });

  await passo('Implantação: o par Vistas e Filtros, sem a aba da Rodada', async () => {
    await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    await p.getByTestId('implantacao-vistas').waitFor();
    await p.getByTestId('implantacao-filtros-botao').click();
    await p.getByTestId('implantacao-filtros-painel').waitFor();
    for (const chave of ['assigneeUserId', 'cliente', 'statusId', 'q']) {
      conferir(await p.getByTestId(`implantacao-filtros-${chave}`).count(), `falta o filtro ${chave} na Implantação`);
    }
    await p.keyboard.press('Escape');
    conferir(!(await p.getByTestId('implantacao-aba-rodada').count()), 'a aba Rodada da semana ainda está na Implantação');
  });

  // ---------------- U1 · WhatsApp ----------------
  await passo('WhatsApp como área própria, com a tela; o endereço antigo redireciona', async () => {
    await p.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    const area = p.locator('#root-os-nav a[data-area="whatsapp"]');
    conferir(await area.count(), 'a área WhatsApp não está no menu');
    await area.click();
    await p.waitForURL(/\/whatsapp/);
    await p.locator('[data-testid="whats-lista"]').waitFor();
    conferir(!(await p.locator(`${MAIN} h1, ${MAIN} h2`).filter({ hasText: /simulador/i }).count()), 'o título ainda diz simulador');
    await foto(p, 'whatsapp-escuro');
    await p.goto(`${WEB}/comercial/simulador?x=1`, { waitUntil: 'networkidle' });
    conferir(new URL(p.url()).pathname === '/whatsapp' && new URL(p.url()).searchParams.get('x') === '1', `o simulador foi para ${p.url()}`);
    const comercial = (await p.locator('#root-os-nav').innerText());
    conferir(!/Simulador de WhatsApp/.test(comercial), 'o Simulador ainda aparece no menu');
  });

  // As partes do Funil (U4), das Atas com o Granola (U5) e do DigiSac (U6) entram abaixo.
  await partesDasOutrasLanes(p, sessao);

  // ---------------- Temas e celular ----------------
  for (const [tema, sufixo] of [['light', 'claro'], ['mono', 'contraste']]) {
    const c2 = await contexto(navegador, sessao, tema);
    const p2 = await c2.newPage();
    await p2.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    await foto(p2, `menu-aberto-${sufixo}`);
    await p2.getByTestId('trabalho-filtros-botao').click();
    await foto(p2, `trabalho-filtros-${sufixo}`);
    await c2.close();
  }
  await passo('Celular (390 px): o menu abre inteiro e as telas não rolam de lado', async () => {
    const c3 = await contexto(navegador, sessao, 'dark', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    const p3 = await c3.newPage();
    const medidas = {};
    for (const [nome, url] of [['trabalho', '/trabalho'], ['funil', '/comercial/funil'], ['whatsapp', '/whatsapp'], ['atas', '/trabalho/atas']]) {
      await p3.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
      medidas[nome] = await semRolagemLateral(p3);
      await foto(p3, `${nome}-390`);
    }
    await p3.getByRole('button', { name: 'Abrir navegação' }).click();
    await dormir(300);
    await foto(p3, 'menu-390');
    await p3.getByTestId('trabalho-filtros-botao').count();
    await c3.close();
    const ruins = Object.entries(medidas).filter(([, ok]) => !ok).map(([n]) => n);
    conferir(!ruins.length, `rolagem lateral a 390 px em: ${ruins.join(', ')}`);
    return { detalhe: medidas };
  });

  conferir(!erros.length, `erros de página: ${erros.slice(0, 3).join(' | ')}`);
  await navegador.close();
}

const ETAPAS_ATIVAS = ['novo_lead', 'qualificacao', 'reuniao_agendada', 'sessao', 'diagnostico', 'proposta', 'follow_up', 'contrato', 'fechado'];

async function partesDasOutrasLanes(p, sessao) {
  // ---------------- U4 · Funil vivo ----------------
  await passo('Funil vivo: sem os chips das etapas, com Vistas e Filtros (responsável primeiro)', async () => {
    await p.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
    await p.locator('[data-testid^="funil-coluna-"]').first().waitFor();
    conferir(!(await p.locator('nav[aria-label="etapas do funil"], [data-testid^="funil-chip-"]').count()), 'os chips das etapas continuam no funil');
    await p.getByTestId('funil-vistas').waitFor();
    await p.getByTestId('funil-filtros-botao').click();
    const painel = p.getByTestId('funil-filtros-painel');
    await painel.waitFor();
    const primeiro = await painel.locator('[data-corpo] select, [data-corpo] input').first().getAttribute('data-testid');
    conferir(primeiro === 'funil-filtros-dono', `o primeiro filtro do funil é ${primeiro}`);
    await p.getByTestId('funil-filtros-dono').selectOption('eu');
    await dormir(600);
    conferir(new URL(p.url()).searchParams.get('dono') === 'eu', `o endereço do funil ficou ${new URL(p.url()).search}`);
    await p.keyboard.press('Escape');
    await foto(p, 'funil-filtro-dono-escuro');
    await p.getByTestId('funil-filtros-botao').click();
    await p.getByTestId('funil-filtros-limpar-tudo').click();
    await p.keyboard.press('Escape');
  });

  await passo('Funil vivo: a Lista, com o clique abrindo o painel do lead', async () => {
    await p.getByTestId('funil-visao-lista').click();
    await p.getByTestId('funil-lista').waitFor();
    conferir(new URL(p.url()).searchParams.get('visao') === 'lista', 'a visão Lista não foi ao endereço');
    const linhas = p.locator('[data-testid^="funil-linha-"]');
    conferir(await linhas.count(), 'a lista do funil está vazia');
    await foto(p, 'funil-lista-escuro');
    await linhas.first().click();
    await p.locator('[role="dialog"]').first().waitFor();
    await p.keyboard.press('Escape');
    await p.getByTestId('funil-visao-quadro').click();
  });

  await passo('Funil vivo: mover para trás sem pedido, com a mensagem; e de volta', async () => {
    const funil = await api('GET', '/comercial/funil', undefined, sessao.token);
    const cartoes = [];
    const varrer = (v) => {
      if (Array.isArray(v)) v.forEach(varrer);
      else if (v && typeof v === 'object') {
        if (typeof v.leadId === 'string' && typeof v.etapa === 'string') cartoes.push(v);
        else Object.values(v).forEach(varrer);
      }
    };
    varrer(funil);
    const alvo = cartoes.find((c) => ['reuniao_agendada', 'sessao', 'diagnostico'].includes(c.etapa));
    conferir(alvo, `nenhum lead do seed em E3 a E5 para mover para trás (${cartoes.length} lidos)`);
    const para = ETAPAS_ATIVAS[ETAPAS_ATIVAS.indexOf(alvo.etapa) - 1];
    await p.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
    await p.getByTestId(`funil-mover-${alvo.leadId}`).click();
    await p.getByTestId(`funil-mover-para-${para}`).first().click();
    await p.getByTestId(`funil-mensagem-${alvo.leadId}`).waitFor();
    const mensagem = (await p.getByTestId(`funil-mensagem-${alvo.leadId}`).innerText()).replace(/\s+/g, ' ').trim();
    conferir(/^Movido para/.test(mensagem), `a mensagem do mover veio: ${mensagem}`);
    conferir(await p.getByTestId(`funil-coluna-${para}`).locator(`[data-testid="funil-card-${alvo.leadId}"]`).count() === 1, `o cartão não está em ${para}`);
    await foto(p, 'funil-movido-escuro');
    // De volta, pela mesma rota da tela (gente com leads.editar, sem token).
    await api('POST', `/comercial/lead/${alvo.leadId}/mover`, { para: alvo.etapa }, sessao.token);
    return { detalhe: { de: alvo.etapa, para, mensagem: mensagem.slice(0, 160) } };
  });

  // ---------------- U5 · Granola direto e atas ----------------
  // A stack do seed aponta GRANOLA_MCP_URL para o dublê fictício que roda dentro do
  // container da API (loopback), com a porta publicada só em 127.0.0.1 para o navegador.
  await passo('Conexões › Granola: "Conectar ao Granola" faz o OAuth (dublê) e volta conectado', async () => {
    await p.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    const bloco = p.getByTestId('granola-direto');
    await bloco.waitFor();
    if (await p.getByTestId('granola-conectar').count()) {
      await p.getByTestId('granola-conectar').click();
      await p.waitForURL(/\/conexoes/, { timeout: 30_000 });
      await p.waitForLoadState('networkidle');
    }
    const texto = (await p.getByTestId('granola-direto').innerText()).replace(/\s+/g, ' ');
    conferir(/conectad/i.test(texto) && !/não conectad/i.test(texto), `o Granola não ficou conectado: ${texto.slice(0, 200)}`);
    return { detalhe: { estado: texto.slice(0, 120) } };
  });

  await passo('Atas › Reuniões do Granola › Gerar ata: ata da transcrição, decisões, pendências e sugestões', async () => {
    await p.goto(`${WEB}/trabalho/atas`, { waitUntil: 'networkidle' });
    const bloco = p.getByTestId('granola-reunioes');
    await bloco.waitFor();
    const reunioes = bloco.locator('[data-testid^="granola-reuniao-"]');
    await reunioes.first().waitFor({ timeout: 30_000 });
    const n = await reunioes.count();
    await foto(p, 'atas-granola-escuro');
    await bloco.locator('[data-testid^="granola-gerar-"]').first().click();
    await p.locator('[data-testid^="ata-aceitar-"]').first().waitFor({ timeout: 60_000 });
    conferir(await p.getByTestId('ata-decisoes').count() && await p.getByTestId('ata-pendencias').count(), 'a ata aberta não mostra decisões e pendências em lista');
    await foto(p, 'atas-gerada-escuro');
    return { detalhe: { reunioes: n } };
  });

  await passo('Atas: aceitar uma sugestão vira tarefa no Trabalho', async () => {
    const aceitar = p.locator('[data-testid^="ata-aceitar-"]').first();
    const sid = (await aceitar.getAttribute('data-testid')).replace('ata-aceitar-', '');
    const cliente = p.getByTestId(`ata-cliente-${sid}`);
    if (await cliente.count()) {
      await cliente.locator('[role="combobox"]').click();
      await p.getByTestId('opcao-cliente-interno').first().click();
    }
    const pasta = p.getByTestId(`ata-pasta-${sid}`);
    if (await pasta.count()) await pasta.selectOption({ label: 'Clientes' }).catch(() => pasta.selectOption({ index: 1 }));
    const lista = p.getByTestId(`ata-lista-${sid}`);
    if (await lista.count()) await lista.selectOption({ label: 'Execução' }).catch(() => lista.selectOption({ index: 1 }));
    await p.getByTestId(`ata-aceitar-${sid}`).click();
    let tarefa = null;
    for (let i = 0; i < 40 && !tarefa; i++) {
      const s = await api('GET', '/trabalho/atas/sugestoes?estado=aceita', undefined, sessao.token).catch(() => null);
      const lidas = Array.isArray(s) ? s : s?.sugestoes ?? s?.itens ?? [];
      tarefa = lidas.find((x) => x.id === sid)?.workTaskId ?? null;
      if (!tarefa) await dormir(400);
    }
    conferir(tarefa, 'aceitar a sugestão da ata do Granola não criou a tarefa');
    const t = await api('GET', `/trabalho/tarefas/${tarefa}`, undefined, sessao.token);
    return { detalhe: { tarefa: t.title } };
  });

  // ---------------- U6 · DigiSac ----------------
  await passo('Conexões › WhatsApp (DigiSac): o cartão com a URL do webhook, sem token na tela', async () => {
    await p.goto(`${WEB}/conexoes`, { waitUntil: 'networkidle' });
    const url = p.getByTestId('url-do-webhook-digisac');
    await url.waitFor();
    const texto = (await url.innerText()).trim();
    conferir(/\/api\/comercial\/webhooks\/digisac\/[0-9a-f-]{36}/.test(texto), `a URL do webhook veio: ${texto}`);
    conferir(/segredo=\s*$/.test(texto) || !/segredo=[^\s&]+/.test(texto), 'a URL do webhook mostra um segredo');
    const cartao = url.locator('xpath=ancestor::section[1]');
    const alvo = (await cartao.count()) ? cartao : url;
    await alvo.scrollIntoViewIfNeeded();
    await foto(p, 'conexoes-digisac-escuro');
    // A entrada recusa sem segredo (a stack do seed não tem DigiSac configurado: 404 para tudo).
    const orgId = texto.match(/digisac\/([0-9a-f-]{36})/)[1];
    const r = await http('POST', `${API}/comercial/webhooks/digisac/${orgId}`, { event: 'message.created', data: { id: 'x', isFromMe: false, type: 'chat', text: 'oi' } });
    conferir(r.status === 401 || r.status === 403 || r.status === 404, `o webhook sem segredo respondeu ${r.status}`);
    return { detalhe: { webhook: texto.replace(/[0-9a-f-]{36}/, '<empresa>'), semSegredo: r.status } };
  });
}

main()
  .then(() => { prova.ok = true; gravar(); console.log(`PASSA · ${prova.passos.length} passos · ${Math.round((Date.now() - t0) / 1000)} s`); })
  .catch((e) => { gravar(); console.error(`FALHA · ${e?.message ?? e}`); process.exit(1); });
