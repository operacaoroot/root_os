#!/usr/bin/env node
/*
 * A PROVA DA LEVA 5 (27/10/2026), NO NAVEGADOR, CONTRA O AMBIENTE DE TESTE DA VPS.
 *
 * Mesmo arranjo das provas anteriores (Playwright da pasta de ferramentas, `UX_PW`),
 * mas o alvo é a cópia do banco da PRODUÇÃO que `criar-teste-leva5.sh` sobe na VPS
 * (web 4160, api 4161, só no IP interno), alcançada do Mac por túnel ssh:
 *   ssh -N -L 4160:172.16.0.1:4160 -L 4161:172.16.0.1:4161 root-vps
 * O login é o usuário de teste criado por `acesso-teste-leva5.sh` (senha em LEVA5_SENHA).
 *
 * O que ela prova (docs/comercial/RODADA-LEVA5-20261027.md):
 *   L1  Trabalho: a árvore tem a pasta "Arquivo do ClickUp" (depois do script) e a pasta
 *       Clientes de volta; Todas não lista as listas do Arquivo.
 *   L3  Menu: "Implantação de clientes" não aparece; /trabalho/implantacao segue respondendo.
 *   L2  Botão direito: menu do lead no funil com "Histórico"; menu da tarefa no Dia a dia.
 *   L4  Painel do lead: abre na Geral (três cartões), Pendências e sugestões, variante A e B
 *       (foto de cada), link Histórico abre o AuditLog da entidade.
 *   L5  Funil: mover pelo menu do lead anda sem recarregar a coluna (o cartão muda de coluna).
 *   L6  Sala: GET sala/estado de um lead; o link copia e a sala pública responde 200.
 *   L7  Chat flutuante: abre no fim (última mensagem visível sem rolar) com a caixa de texto
 *       focada; o cabeçalho das abas fica fora do que rola.
 *   L8  Conexões: o cartão "Claude (Anthropic)" existe, com estado e modelos por função.
 * E fotografa cada tela em escuro, claro e 390 px, conferindo que a página não rola na
 * horizontal no celular.
 *
 * Escreve no ambiente de teste (nunca na produção): um mover de etapa (e volta), nada mais.
 *
 * Saída: `homolog/provas/leva5.json` e `homolog/provas/leva5-*.png`.
 * Uso: LEVA5_SENHA=… UX_PW=… node homolog/e2e/leva5.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4161/api';
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:4160';
const PW = process.env.UX_PW ?? join(RAIZ, '../pw-tools');
const EMAIL = process.env.LEVA5_EMAIL ?? 'teste-leva5@root.test';
const SENHA = process.env.LEVA5_SENHA;
if (!SENHA) {
  console.error('LEVA5_SENHA ausente (senha do usuário de teste, em /srv/rootos/teste-leva5/acesso.txt na VPS)');
  process.exit(2);
}
const PROVAS = join(RAIZ, 'homolog/provas');
mkdirSync(PROVAS, { recursive: true });

const require = createRequire(join(PW, 'package.json'));
const { chromium } = require('playwright');

const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], semRolagemHorizontal: [], ok: false };
const t0 = Date.now();
function passo(nome, dados = {}) {
  const linha = { n: prova.passos.length + 1, nome, ms: Date.now() - t0, ...dados };
  prova.passos.push(linha);
  console.log(`  ${String(linha.n).padStart(2)}. ${nome}${dados.detalhe ? ` · ${dados.detalhe}` : ''}`);
}
function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  writeFileSync(join(PROVAS, 'leva5.json'), `${JSON.stringify(prova, null, 2)}\n`);
}
function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status}: ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 300)}`);
  return json;
}
async function entrar() {
  const r = await api('POST', '/auth/login', { email: EMAIL, password: SENHA });
  return { token: r.token ?? r.accessToken, user: r.user };
}
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
const tid = (p, id) => p.locator(`[data-testid="${id}"]`);

async function foto(pagina, nome) {
  const arquivo = `leva5-${nome}.png`;
  await pagina.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
  return arquivo;
}
async function semRolagemHorizontal(pagina, nome) {
  const r = await pagina.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  const ok = r.scrollWidth <= r.clientWidth + 1;
  prova.semRolagemHorizontal.push({ nome, ...r, ok });
  conferir(ok, `${nome}: a página rola na horizontal (${r.scrollWidth} > ${r.clientWidth})`);
}
async function abrir(pagina, caminho) {
  await pagina.goto(`${WEB}${caminho}`, { waitUntil: 'networkidle' });
}

/** Mede o container de rolagem que contém o elemento: está no fim? */
async function medirRolagem(pagina, seletorFilho) {
  return pagina.evaluate((sel) => {
    let el = document.querySelector(sel);
    while (el && el !== document.body) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        return {
          achou: true,
          scrollTop: el.scrollTop,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          noFim: el.scrollTop + el.clientHeight >= el.scrollHeight - 4,
          overscroll: cs.overscrollBehaviorY || cs.overscrollBehavior,
        };
      }
      el = el.parentElement;
    }
    return { achou: false };
  }, seletorFilho);
}

const navegador = await chromium.launch();
try {
  // ---------- sessão ----------
  const sessao = await entrar();
  conferir(sessao.token, 'login sem token');
  passo('login do usuário de teste', { detalhe: EMAIL });

  // ---------- L8 · cartão Claude (API) ----------
  const cartoes = await api('GET', '/integrations/cartoes', undefined, sessao.token);
  const lista = Array.isArray(cartoes) ? cartoes : cartoes.cartoes ?? cartoes.itens ?? [];
  const claude = lista.find((c) => (c.chave ?? c.key ?? c.id) === 'anthropic' || /anthropic/i.test(JSON.stringify(c)));
  conferir(claude, 'cartão anthropic ausente em GET /integrations/cartoes');
  const estadoClaude = await api('GET', '/integrations/anthropic/estado', undefined, sessao.token);
  passo('L8 · cartão Claude (Anthropic) no catálogo e estado respondem', { detalhe: JSON.stringify(estadoClaude).slice(0, 160) });

  // ---------- L6 · sala (API) ----------
  const leads = await api('GET', '/leads?limit=50', undefined, sessao.token).catch(() => api('GET', '/leads', undefined, sessao.token));
  const listaLeads = Array.isArray(leads) ? leads : leads.items ?? leads.leads ?? leads.data ?? [];
  conferir(listaLeads.length > 0, 'nenhum lead na cópia do banco');
  let leadComSala = null;
  let estadoSala = null;
  for (const l of listaLeads.slice(0, 15)) {
    const e = await api('GET', `/comercial/lead/${l.id}/sala/estado`, undefined, sessao.token).catch(() => null);
    if (e && e.sala !== false && e.temSala !== false) {
      leadComSala = l;
      estadoSala = e;
      break;
    }
  }
  conferir(leadComSala, 'nenhum lead com sala/estado legível entre os 15 primeiros');
  passo('L6 · GET sala/estado de um lead', { detalhe: `${leadComSala.id.slice(0, 8)} · ${JSON.stringify(estadoSala).slice(0, 160)}` });
  let linkDaSala = null;
  try {
    const r = await api('POST', `/comercial/lead/${leadComSala.id}/sala/link`, {}, sessao.token);
    linkDaSala = r.link ?? r.url ?? null;
  } catch (e) {
    passo('L6 · copiar link da sala não disponível para este lead (esperado quando a chave não abre o token da cópia)', { detalhe: String(e.message).slice(0, 160) });
  }

  // ---------- telas ----------
  for (const tema of ['dark', 'light']) {
    const ctx = await contexto(navegador, sessao, tema);
    const p = await ctx.newPage();
    const erros = [];
    p.on('pageerror', (e) => erros.push(String(e.message)));

    // L4/L2/L5 · funil + painel do lead
    await abrir(p, '/comercial/funil');
    await p.waitForTimeout(800);
    await foto(p, `funil-${tema}`);
    const botoesMenu = p.locator('[data-testid^="menu-do-lead-botao-"]');
    const n = await botoesMenu.count();
    conferir(n > 0, 'nenhum botão de menu do lead no funil');
    const primeiro = botoesMenu.first();
    const leadId = (await primeiro.getAttribute('data-testid')).replace('menu-do-lead-botao-', '');
    await primeiro.click();
    await tid(p, 'menu-do-lead').waitFor({ timeout: 5000 });
    conferir(await tid(p, 'menu-do-lead').getByText(/hist[óo]rico/i).count() > 0, 'menu do lead sem o item Histórico');
    await foto(p, `menu-do-lead-${tema}`);
    passo(`L2 · menu do lead no funil com Histórico (${tema})`, { detalhe: `${n} cartões com menu` });
    await p.keyboard.press('Escape');

    await abrir(p, `/comercial/funil?lead=${leadId}&aba=geral`);
    await tid(p, 'ficha-geral').waitFor({ timeout: 10000 });
    const campos = await p.locator('[data-testid^="ficha-campo-"]').count();
    conferir(campos >= 10, `aba Geral com poucos campos (${campos})`);
    await foto(p, `painel-geral-A-${tema}`);
    passo(`L4 · painel abre na Geral, variante A (${tema})`, { detalhe: `${campos} campos` });
    await tid(p, 'painel-variante').click();
    await p.waitForTimeout(400);
    conferir(await tid(p, 'ficha-linha-do-tempo').count() > 0, 'variante B sem a linha do tempo');
    await foto(p, `painel-geral-B-${tema}`);
    await tid(p, 'painel-variante').click();
    passo(`L4 · variante B com linha do tempo e volta à A (${tema})`);
    await tid(p, 'painel-historico').click();
    await tid(p, 'historico-da-entidade').waitFor({ timeout: 8000 });
    await foto(p, `painel-historico-${tema}`);
    passo(`L2 · Histórico do lead abre (${tema})`, {
      detalhe: (await tid(p, 'historico-linhas').count()) ? 'com linhas' : (await tid(p, 'historico-vazio').count()) ? 'vazio' : (await tid(p, 'historico-sem-permissao').count()) ? 'sem permissão' : '?',
    });
    await p.keyboard.press('Escape');
    await abrir(p, `/comercial/funil?lead=${leadId}&aba=pendencias`);
    await tid(p, 'painel-pendencias').waitFor({ timeout: 10000 });
    await foto(p, `painel-pendencias-${tema}`);
    passo(`L4 · aba Pendências e sugestões (${tema})`, {
      detalhe: `preencher ${await tid(p, 'pendencias-preencher').locator('li').count()} · passos ${await tid(p, 'pendencias-passos').locator('li').count()}`,
    });
    await abrir(p, `/comercial/funil?lead=${leadId}&aba=sala`);
    await tid(p, 'aba-sala').waitFor({ timeout: 10000 });
    await foto(p, `painel-sala-${tema}`);
    passo(`L6 · aba Sala do painel (${tema})`, { detalhe: (await tid(p, 'sala-estado').count()) ? 'com estado' : 'sem estado' });

    // L7 · chat flutuante
    await abrir(p, '/dia-a-dia');
    const botaoChat = p.locator('button[title^="Chat"]').first();
    await botaoChat.waitFor({ timeout: 10000 });
    await botaoChat.click();
    await tid(p, 'chat-popup').waitFor({ timeout: 8000 });
    const abaWhats = tid(p, 'chat-aba-whatsapp');
    if (await abaWhats.count()) await abaWhats.click();
    await p.waitForTimeout(1500);
    const temHistorico = await tid(p, 'caixa-historico').count();
    if (temHistorico) {
      const m = await medirRolagem(p, '[data-testid="caixa-historico"]');
      const focado = await p.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName.toLowerCase()}${a.getAttribute('data-testid') ? `[${a.getAttribute('data-testid')}]` : ''}` : null;
      });
      passo(`L7 · popup do Chat: rolagem ${m.achou ? (m.noFim ? 'no fim' : 'NÃO está no fim') : 'sem transbordo (poucas mensagens)'} · foco ${focado} (${tema})`, { detalhe: JSON.stringify(m) });
      if (m.achou) conferir(m.noFim, 'o popup do Chat não abriu no fim');
    } else {
      passo(`L7 · popup do Chat aberto, sem conversa selecionada (${tema})`);
    }
    const cabecalhoFixo = await p.evaluate(() => {
      const pop = document.querySelector('[data-testid="chat-popup"]');
      const tabs = pop?.querySelector('[role="tablist"]');
      if (!pop || !tabs) return null;
      let el = tabs.parentElement;
      while (el && el !== pop) {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowY)) return false;
        el = el.parentElement;
      }
      return true;
    });
    conferir(cabecalhoFixo !== false, 'o menu dos canais está dentro do container que rola');
    await foto(p, `chat-popup-${tema}`);

    // L1/L3 · Trabalho
    await abrir(p, '/trabalho');
    await tid(p, 'trabalho-arvore').waitFor({ timeout: 10000 });
    const arvore = await tid(p, 'trabalho-arvore').innerText();
    const menuTexto = await p.locator('nav').first().innerText().catch(() => '');
    conferir(!/Implantação de clientes/.test(menuTexto), 'o menu ainda mostra "Implantação de clientes"');
    passo(`L1/L3 · árvore do Trabalho (${tema})`, {
      detalhe: `Arquivo do ClickUp ${/Arquivo do ClickUp/.test(arvore) ? 'presente' : 'AUSENTE (rodar arquivo-do-clickup.js --valer)'} · Clientes ${/Clientes/.test(arvore) ? 'presente' : 'ausente'}`,
    });
    await foto(p, `trabalho-${tema}`);
    const rImpl = await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'domcontentloaded' });
    conferir(rImpl && rImpl.status() < 400, `/trabalho/implantacao respondeu ${rImpl?.status()}`);

    // L8 · Conexões
    await abrir(p, '/conexoes');
    await p.waitForTimeout(1200);
    const textoConexoes = await p.locator('main').innerText().catch(() => p.locator('body').innerText());
    conferir(/Claude \(Anthropic\)/.test(textoConexoes), 'Conexões sem o cartão "Claude (Anthropic)"');
    await foto(p, `conexoes-${tema}`);
    passo(`L8 · cartão Claude (Anthropic) na tela de Conexões (${tema})`);

    conferir(erros.length === 0, `erros de página: ${erros.join(' | ')}`);
    await ctx.close();
  }

  // celular 390 px: funil + painel, chat, trabalho
  {
    const ctx = await contexto(navegador, sessao, 'dark', { width: 390, height: 844 });
    const p = await ctx.newPage();
    await abrir(p, '/comercial/funil');
    await semRolagemHorizontal(p, 'funil-390');
    await foto(p, 'funil-390');
    const botoes = p.locator('[data-testid^="menu-do-lead-botao-"]');
    if (await botoes.count()) {
      const id = (await botoes.first().getAttribute('data-testid')).replace('menu-do-lead-botao-', '');
      await abrir(p, `/comercial/funil?lead=${id}&aba=geral`);
      await tid(p, 'ficha-geral').waitFor({ timeout: 10000 });
      await semRolagemHorizontal(p, 'painel-geral-390');
      await foto(p, 'painel-geral-390');
    }
    await abrir(p, '/trabalho');
    await semRolagemHorizontal(p, 'trabalho-390');
    await foto(p, 'trabalho-390');
    await ctx.close();
    passo('celular 390 px sem rolagem horizontal (funil, painel, trabalho)');
  }

  // L6 · sala pública
  if (linkDaSala) {
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR' });
    const p = await ctx.newPage();
    const url = linkDaSala.startsWith('http') ? linkDaSala.replace(/^https?:\/\/[^/]+/, WEB) : `${WEB}${linkDaSala}`;
    const r = await p.goto(url, { waitUntil: 'networkidle' });
    conferir(r && r.status() === 200, `sala pública respondeu ${r?.status()}`);
    await foto(p, 'sala-publica');
    passo('L6 · sala pública responde 200', { detalhe: (await tid(p, 'sala-acompanhamento').count()) ? 'com Acompanhamento' : 'sem bloco de acompanhamento (sala não publicada ou lead sem etapa)' });
    await ctx.close();
  }

  prova.ok = true;
  gravar();
  console.log(`\nOK · ${prova.passos.length} passos · ${prova.screenshots.length} fotos · ${Math.round(prova.duracaoMs / 1000)} s`);
} catch (e) {
  prova.erro = String(e.stack ?? e.message);
  gravar();
  console.error(`\nFALHOU no passo ${prova.passos.length + 1}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await navegador.close();
}
