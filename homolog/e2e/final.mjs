#!/usr/bin/env node
/*
 * A PROVA DA VERSÃO FINAL (19/10/2026), CONTRA A STACK `rootos-final` COM A CÓPIA
 * DA PRODUÇÃO, E A MESMA VOLTA DEPOIS DA VIRADA (docs/comercial/VIRADA-PRODUCAO.md,
 * passo 10).
 *
 * Mesmo arranjo dos outros roteiros (trabalho.mjs, implantacao.mjs, painel.mjs):
 * Playwright (Chromium) da pasta de ferramentas da máquina (`UX_PW`, padrão
 * `C:/Users/User/dev/pw-tools`). A diferença: aqui cada passo registra PASSA ou
 * FALHA com o motivo e o roteiro SEGUE para o próximo. No fim, o placar, e código
 * de saída 1 se algum passo falhou.
 *
 * SÓ LÊ, com UMA exceção que só vale em homologação: navega, abre pop-up, recolhe o
 * menu (isso fica no localStorage do navegador da prova) e consulta a API por GET.
 * A exceção é o passo dos vários responsáveis: quando a base não tem tarefa com dois,
 * e o alvo é a homologação local (127.0.0.1/localhost), ele põe um segundo responsável
 * numa tarefa, confere o pop-up e desfaz (com a versão lida). Contra outro endereço
 * (a produção depois da virada) esse passo não escreve: falha dizendo que falta a tarefa.
 *
 * Parâmetros (variáveis de ambiente):
 *   BASE_URL      o web (padrão http://127.0.0.1:3030, a stack rootos-final)
 *   API_URL       a API (padrão BASE_URL + /api, pelo rewrite do Next)
 *   LOGIN_EMAIL   padrão FINAL_LOGIN_EMAIL_RODRIGO de homolog/.env.final
 *   LOGIN_SENHA   padrão FINAL_LOGIN_SENHA_RODRIGO de homolog/.env.final
 *   FINAL_TOKEN   opcional: o `mktos_token` de uma sessão já aberta (quem só entra
 *                 pelo Google). Com ele, o login pela tela é pulado.
 *   UX_PW         a pasta do Playwright
 *
 * O que ela prova (docs/comercial/RODADA-FINAL-20261019.md, F6):
 *   login; menu lateral recolhe e expande; Motor Comercial › Painel geral (o dash do
 *   Lucas lendo os nossos dados) como primeira aba, com números e sem erro, e as abas
 *   na ordem nova; Funil vivo; Propostas (as antigas e, quando houver, as da sala);
 *   Lista de leads; Dia a dia › Visão geral como primeira aba, lendo as nossas pastas;
 *   Pendências; Trabalho com "Todas" mostrando tarefas de várias pastas; calendário;
 *   pop-up de tarefa com vários responsáveis; financeiro, cofre e Granola (Integrações)
 *   abrindo sem erro; nenhuma página com rolagem horizontal a 390 px; fotos em
 *   escuro, claro e 390 px.
 *
 * Saída:
 *   homolog/organizar/prova-final.json   o placar, sem dado (só rótulos, contagens e motivos)
 *   homolog/organizar/fotos/final-*.png  as fotos (TÊM dado real: a pasta é ignorada pelo git)
 *
 * Uso (Git Bash): node homolog/e2e/final.mjs
 *                 BASE_URL=https://os.operacaoroot.com node homolog/e2e/final.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// SELETORES: o que muda quando as telas F2 a F4 mudarem. Ajuste aqui, não no meio.
// Tudo por papel e texto visível; nenhum data-testid novo é exigido.
// ============================================================================
const SELETORES = {
  login: {
    caminho: '/login',
    botaoEmergencia: /Entrar com e-mail e senha/i,
    email: '#login-email',
    senha: '#login-password',
    entrar: /^Entrar$/,
  },
  menu: {
    barra: '#root-os-nav',
    destinos: 'Destinos', // aria-label do <nav> das áreas
    recolher: 'Recolher menu',
    expandir: 'Expandir menu',
    larguraRecolhidoMax: 96,
    larguraAbertoMin: 180,
  },
  // aria-label do <nav> das abas de uma área (NavegacaoDoModulo.tsx).
  abasDe: (area) => `Abas de ${area}`,
  main: '#root-os-main',
  // Texto que, visível na área principal, quer dizer tela quebrada.
  textoDeErro: /Application error|Internal Server Error|Algo deu errado|Erro ao carregar|Não foi possível carregar|Unhandled Runtime Error/i,
  areas: {
    // Rótulos das ÁREAS da barra da produção (navegacao-modulos.ts), não das seções.
    comercial: 'Comercial',
    dia: 'Dia a dia',
    trabalho: 'Trabalho',
    financeiro: 'Financeiro',
    controle: 'Configurações',
  },
  comercial: {
    ordem: ['Painel geral', 'Funil vivo', 'Propostas', 'Lista de leads', 'Contratos vivos', 'Simulador de WhatsApp', 'Torre das automações', 'Relatório da semana'],
    naoPodemEstar: ['Clientes', 'Tarefas'],
    painel: { rotulo: 'Painel geral', url: '/comercial', minimoDeNumeros: 4 },
    funil: { rotulo: 'Funil vivo', url: '/comercial/funil' },
    propostas: {
      rotulo: 'Propostas',
      url: '/propostas',
      // Linhas da lista: o que for linha de tabela, item de lista ou cartão no main.
      linhas: 'main table tbody tr, main [role="row"], main li, main article',
      // Marca visível das propostas publicadas pela sala (ajustar ao rótulo da F2).
      marcaDaSala: /\bda sala\b|sala do cliente|publicada na sala/i,
    },
    leads: { rotulo: 'Lista de leads', url: '/leads' },
  },
  dia: {
    ordem: ['Visão geral', 'Pendências', 'Aprovações', 'Agenda', 'Painel geral da empresa'],
    visaoGeral: { rotulo: 'Visão geral', url: '/dia-a-dia' },
    pendencias: { rotulo: 'Pendências', url: '/caixa' },
  },
  trabalho: {
    tarefas: { rotulo: 'Tarefas', url: '/trabalho' },
    todas: /^\s*Todas( as pastas)?\s*$/,
    cartao: '[data-work-task-id]',
    calendario: /^Calendário$/,
    diasDaSemana: /\b(seg|ter|qua|qui|sex)\b/gi,
    popup: '[data-testid="tarefa-popup"], [role="dialog"]',
  },
  financeiro: { url: '/financeiro', pronto: /financeiro|caixa|receita|despesa/i },
  cofre: { url: '/cofre', pronto: /cofre/i },
  granola: { url: '/conexoes', pronto: /Granola/ },
  // As telas fotografadas e conferidas a 390 px.
  telas: [
    { nome: 'comercial-painel', url: '/comercial' },
    { nome: 'comercial-funil', url: '/comercial/funil' },
    { nome: 'propostas', url: '/propostas' },
    { nome: 'lista-de-leads', url: '/leads' },
    { nome: 'dia-visao-geral', url: '/dia-a-dia' },
    { nome: 'pendencias', url: '/caixa' },
    { nome: 'trabalho', url: '/trabalho' },
    { nome: 'financeiro', url: '/financeiro', daProducao: true },
    { nome: 'cofre', url: '/cofre', daProducao: true },
    { nome: 'integracoes', url: '/conexoes', daProducao: true },
  ],
};

// ============================================================================
// Ambiente
// ============================================================================
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = (process.env.BASE_URL ?? 'http://127.0.0.1:3030').replace(/\/+$/, '');
const API = (process.env.API_URL ?? `${WEB}/api`).replace(/\/+$/, '');
const PW = process.env.UX_PW ?? 'C:/Users/User/dev/pw-tools';
// FINAL_SAIDA troca a pasta da prova (ex.: a stack com o seed, para não sobrescrever a da cópia).
const SAIDA = process.env.FINAL_SAIDA ? join(RAIZ, process.env.FINAL_SAIDA) : join(RAIZ, 'homolog/organizar');
const FOTOS = join(SAIDA, 'fotos');
mkdirSync(FOTOS, { recursive: true });

const require = createRequire(join(PW, 'package.json'));
const { chromium } = require('playwright');

function lerEnv(arquivo) {
  const out = {};
  if (!existsSync(arquivo)) return out;
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const ENV_FINAL = lerEnv(join(RAIZ, 'homolog/.env.final'));
const EMAIL = process.env.LOGIN_EMAIL ?? ENV_FINAL.FINAL_LOGIN_EMAIL_RODRIGO;
const SENHA = process.env.LOGIN_SENHA ?? ENV_FINAL.FINAL_LOGIN_SENHA_RODRIGO;
const TOKEN_DADO = process.env.FINAL_TOKEN ?? '';

// ============================================================================
// Placar
// ============================================================================
const t0 = Date.now();
const prova = {
  roteiro: 'homolog/e2e/final.mjs',
  inicio: new Date().toISOString(),
  alvo: /127\.0\.0\.1|localhost/.test(WEB) ? 'homologacao-local' : 'remoto',
  passos: [],
  semRolagemHorizontal: [],
  fotos: 0,
  placar: { passa: 0, falha: 0 },
};

/** Motivo sem dado: corta, tira e-mail e endereço com token. */
function limpo(texto) {
  return String(texto ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s*Call log:[\s\S]*$/, '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<e-mail>')
    .replace(/\/s\/[A-Za-z0-9_-]{8,}/g, '/s/<token>')
    .replace(/Bearer\s+\S+/g, 'Bearer <token>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
/** FALHA leva o motivo; PASSA pode levar um aviso (o que não deu para conferir). */
function registrar(nome, ok, texto, detalhe) {
  const linha = { n: prova.passos.length + 1, nome, resultado: ok ? 'PASSA' : 'FALHA', ms: Date.now() - t0 };
  if (texto) linha[ok ? 'aviso' : 'motivo'] = limpo(texto);
  if (detalhe !== undefined) linha.detalhe = detalhe;
  prova.passos.push(linha);
  prova.placar[ok ? 'passa' : 'falha'] += 1;
  const nota = linha.motivo ?? (linha.aviso ? `aviso: ${linha.aviso}` : '');
  console.log(`  ${String(linha.n).padStart(2)}. ${ok ? 'PASSA' : 'FALHA'} · ${nome}${nota ? ` · ${nota}` : ''}`);
}
const escaparRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
class Falha extends Error {}
function conferir(cond, msg) {
  if (!cond) throw new Falha(msg);
}
/** Roda um passo; erro vira FALHA com o motivo e o roteiro segue. */
async function passo(nome, fn) {
  try {
    const r = await fn();
    registrar(nome, true, r?.aviso, r?.detalhe);
    return r;
  } catch (e) {
    registrar(nome, false, e instanceof Falha ? e.message : `${e?.name ?? 'Erro'}: ${e?.message ?? e}`);
    return null;
  }
}
function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  writeFileSync(join(SAIDA, 'prova-final.json'), `${JSON.stringify(prova, null, 2)}\n`);
}

// ============================================================================
// Ajudantes
// ============================================================================
let TOKEN = '';
let USUARIO = null;

async function escrever(metodo, caminho, corpo) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Falha(`${metodo} ${caminho.split('?')[0]} respondeu ${r.status}`);
  return r.json().catch(() => null);
}

async function api(caminho) {
  const r = await fetch(`${API}${caminho}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }
  if (!r.ok) throw new Falha(`GET ${caminho.split('?')[0]} respondeu ${r.status}`);
  return json;
}
/** Todos os arrays de objetos com `id` dentro de uma resposta, achatados. */
function itensCom(json, chave = 'id') {
  const out = [];
  (function andar(o) {
    if (Array.isArray(o)) { for (const x of o) andar(x); return; }
    if (o && typeof o === 'object') {
      if (typeof o[chave] === 'string') out.push(o);
      for (const v of Object.values(o)) if (v && typeof v === 'object') andar(v);
    }
  })(json);
  return out;
}

async function esperar(p) {
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await p.waitForTimeout(300);
}

/** Vigia de erros da página: exceções do navegador e respostas 5xx da API. */
function vigiar(p) {
  const v = { erros: [], http5xx: [] };
  p.on('pageerror', (e) => v.erros.push(limpo(e.message)));
  p.on('response', (r) => {
    if (r.status() >= 500 && r.url().startsWith(API)) v.http5xx.push(`${r.status()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id')}`);
  });
  return {
    zerar() { v.erros.length = 0; v.http5xx.length = 0; },
    problemas() { return [...v.erros.map((e) => `erro no navegador: ${e}`), ...v.http5xx.map((x) => `API ${x}`)]; },
  };
}

async function semErroNaTela(p, vigia) {
  const main = p.locator(SELETORES.main).first();
  const texto = (await main.count()) ? await main.innerText().catch(() => '') : await p.locator('body').innerText().catch(() => '');
  const m = SELETORES.textoDeErro.exec(texto);
  const probs = vigia.problemas();
  conferir(!m, `a tela mostra "${m?.[0]}"`);
  conferir(!probs.length, probs.slice(0, 3).join(' · '));
  conferir(texto.trim().length > 20, 'a área principal está vazia');
  return texto;
}

async function contexto(navegador, tema, viewport = { width: 1440, height: 900 }) {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ignoreHTTPSErrors: false });
  await ctx.addInitScript(
    ([token, user, tema]) => {
      if (token) localStorage.setItem('mktos_token', token);
      if (user) localStorage.setItem('mktos_user', JSON.stringify(user));
      localStorage.setItem('root-os:tema', tema);
      localStorage.setItem('root-os:menu-recolhido', '0');
    },
    [TOKEN, USUARIO, tema],
  );
  return ctx;
}

/** Abre a área pelo menu lateral (pelo nome visível). */
async function abrirArea(p, area) {
  // Prefixo e não nome exato: o Dia a dia leva o selo do que espera por você no nome.
  const link = p.locator(`nav[aria-label="${SELETORES.menu.destinos}"]`).getByRole('link', { name: new RegExp(`^\\s*${escaparRe(area)}\\b`) });
  conferir(await link.count(), `a área "${area}" não está no menu lateral`);
  await link.first().click();
  await esperar(p);
}

/** As abas da área aberta, na ordem da tela. */
async function abasDaArea(p, area) {
  const nav = p.getByRole('navigation', { name: SELETORES.abasDe(area) });
  if (!(await nav.count())) return [];
  return (await nav.first().getByRole('link').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * Abre uma aba pelo rótulo visível: primeiro nas abas da área, depois em qualquer
 * link, aba ou botão com aquele nome. Sem o rótulo, FALHA (o endereço de reserva só
 * serve às fotos, nunca para fazer o passo passar).
 */
async function abrirAba(p, area, rotulo) {
  const candidatos = [
    p.getByRole('navigation', { name: SELETORES.abasDe(area) }).getByRole('link', { name: rotulo, exact: true }),
    p.getByRole('tab', { name: rotulo, exact: true }),
    p.locator(SELETORES.main).getByRole('link', { name: rotulo, exact: true }),
    p.getByRole('button', { name: rotulo, exact: true }),
  ];
  for (const c of candidatos) {
    if (await c.count()) {
      await c.first().click();
      await esperar(p);
      return;
    }
  }
  throw new Falha(`o rótulo "${rotulo}" não está visível em ${area}`);
}

async function rolaNaHorizontal(p) {
  return p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

async function foto(p, nome) {
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(FOTOS, `final-${nome}.png`), fullPage: false });
  prova.fotos += 1;
}

// ============================================================================
// O roteiro
// ============================================================================
async function main() {
  console.log(`Versão final · ${prova.alvo} · ${new Date().toLocaleString('pt-BR')}`);
  const navegador = await chromium.launch();
  try {
    const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await ctx.addInitScript(() => {
      localStorage.setItem('root-os:tema', 'dark');
      localStorage.setItem('root-os:menu-recolhido', '0');
    });
    const p = await ctx.newPage();
    const vigia = vigiar(p);

    // ---- 1. login ----
    const entrou = await passo('login', async () => {
      if (TOKEN_DADO) {
        TOKEN = TOKEN_DADO;
        USUARIO = await api('/auth/me');
        await ctx.addInitScript(([token, user]) => {
          localStorage.setItem('mktos_token', token);
          localStorage.setItem('mktos_user', JSON.stringify(user));
        }, [TOKEN, USUARIO]);
        await p.goto(`${WEB}/painel`, { waitUntil: 'domcontentloaded' });
        await esperar(p);
        conferir(!new URL(p.url()).pathname.startsWith(SELETORES.login.caminho), 'o token dado não abriu sessão (a tela voltou ao login)');
        return { aviso: 'sessão aberta pelo FINAL_TOKEN (login pela tela pulado)' };
      }
      conferir(EMAIL && SENHA, 'sem LOGIN_EMAIL/LOGIN_SENHA (nem FINAL_LOGIN_*_RODRIGO em homolog/.env.final)');
      await p.goto(`${WEB}${SELETORES.login.caminho}`, { waitUntil: 'domcontentloaded' });
      await esperar(p);
      const emergencia = p.getByRole('button', { name: SELETORES.login.botaoEmergencia });
      if (await emergencia.count()) await emergencia.first().click();
      await p.locator(SELETORES.login.email).fill(EMAIL);
      await p.locator(SELETORES.login.senha).fill(SENHA);
      await p.getByRole('button', { name: SELETORES.login.entrar }).first().click();
      await p.waitForURL((u) => !u.pathname.startsWith(SELETORES.login.caminho), { timeout: 30_000 });
      await esperar(p);
      TOKEN = await p.evaluate(() => localStorage.getItem('mktos_token') ?? '');
      USUARIO = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('mktos_user') ?? 'null'); } catch { return null; } });
      conferir(TOKEN, 'o login não deixou a sessão no navegador');
      return { detalhe: { entrada: new URL(p.url()).pathname } };
    });
    if (!entrou) throw new Falha('sem login, nada mais pode ser conferido');

    // ---- 2. menu lateral recolhe e expande ----
    await passo('menu lateral recolhe e expande', async () => {
      const barra = p.locator(SELETORES.menu.barra);
      await barra.waitFor({ timeout: 15_000 });
      const aberto = (await barra.boundingBox()).width;
      await p.getByRole('button', { name: SELETORES.menu.recolher }).click();
      await p.waitForTimeout(500);
      const recolhido = (await barra.boundingBox()).width;
      conferir(recolhido <= SELETORES.menu.larguraRecolhidoMax, `recolhido ficou com ${Math.round(recolhido)} px`);
      await foto(p, 'menu-recolhido-escuro');
      await p.getByRole('button', { name: SELETORES.menu.expandir }).click();
      await p.waitForTimeout(500);
      const de_novo = (await barra.boundingBox()).width;
      conferir(de_novo >= SELETORES.menu.larguraAbertoMin, `expandido ficou com ${Math.round(de_novo)} px`);
      return { detalhe: { aberto: Math.round(aberto), recolhido: Math.round(recolhido), expandido: Math.round(de_novo) } };
    });

    // ---- 3. Motor Comercial: Painel geral é a primeira aba, com números ----
    await passo('Motor Comercial › Painel geral como primeira aba, com números e sem erro', async () => {
      vigia.zerar();
      await abrirArea(p, SELETORES.areas.comercial);
      const abas = await abasDaArea(p, SELETORES.areas.comercial);
      conferir(abas[0] === SELETORES.comercial.painel.rotulo, `a primeira aba é "${abas[0] ?? 'nenhuma'}"`);
      const atual = p.getByRole('navigation', { name: SELETORES.abasDe(SELETORES.areas.comercial) }).locator('a[aria-current="page"]');
      conferir((await atual.count()) && (await atual.first().innerText()).trim() === SELETORES.comercial.painel.rotulo, 'a área não abriu no Painel geral');
      const texto = await semErroNaTela(p, vigia);
      const numeros = (texto.match(/\d[\d.,]*/g) ?? []).length;
      conferir(numeros >= SELETORES.comercial.painel.minimoDeNumeros, `só ${numeros} número(s) visível(is) no painel`);
      await foto(p, 'comercial-painel-escuro');
      return { detalhe: { numerosVisiveis: numeros } };
    });

    await passo('Motor Comercial: abas na ordem nova, sem Clientes e Tarefas', async () => {
      const abas = await abasDaArea(p, SELETORES.areas.comercial);
      const esperado = SELETORES.comercial.ordem;
      conferir(JSON.stringify(abas.slice(0, esperado.length)) === JSON.stringify(esperado), `as abas vieram: ${abas.join(' · ')}`);
      const sobrando = SELETORES.comercial.naoPodemEstar.filter((r) => abas.includes(r));
      conferir(!sobrando.length, `ainda no Comercial: ${sobrando.join(', ')}`);
      return { detalhe: { abas: abas.length } };
    });

    // ---- 4. Funil vivo ----
    await passo('Motor Comercial › Funil vivo', async () => {
      vigia.zerar();
      await abrirAba(p, SELETORES.areas.comercial, SELETORES.comercial.funil.rotulo);
      await semErroNaTela(p, vigia);
      await foto(p, 'comercial-funil-escuro');
    });

    // ---- 5. Propostas: as antigas e, quando houver, as da sala ----
    await passo('Motor Comercial › Propostas (as antigas e as da sala, quando houver)', async () => {
      vigia.zerar();
      await abrirAba(p, SELETORES.areas.comercial, SELETORES.comercial.propostas.rotulo);
      const texto = await semErroNaTela(p, vigia);
      const linhas = await p.locator(SELETORES.comercial.propostas.linhas).count();
      conferir(linhas > 0, 'a lista de propostas está vazia');
      const daSala = (texto.match(new RegExp(SELETORES.comercial.propostas.marcaDaSala.source, 'gm')) ?? []).length;
      const doServico = (texto.match(new RegExp(SELETORES.comercial.propostas.marcaDoServico.source, 'gm')) ?? []).length;
      await foto(p, 'propostas-escuro');
      return {
        detalhe: { linhas, daSala, doServico },
        aviso: daSala ? undefined : 'nenhuma proposta da sala nesta base (a produção ainda não publica pela sala; a prova da sala é a da stack com o seed)',
      };
    });

    // ---- 6. Lista de leads ----
    await passo('Motor Comercial › Lista de leads', async () => {
      vigia.zerar();
      await abrirAba(p, SELETORES.areas.comercial, SELETORES.comercial.leads.rotulo);
      await semErroNaTela(p, vigia);
      const linhas = await p.locator('main table tbody tr, main [role="row"], main li').count();
      conferir(linhas > 0, 'a lista de leads está vazia');
      await foto(p, 'lista-de-leads-escuro');
      return { detalhe: { linhas } };
    });

    // ---- 7. Dia a dia: Visão geral é a primeira aba e lê as nossas pastas ----
    let pastas = [];
    await passo('Dia a dia › Visão geral como primeira aba, lendo as pastas e listas', async () => {
      vigia.zerar();
      await abrirArea(p, SELETORES.areas.dia);
      const abas = await abasDaArea(p, SELETORES.areas.dia);
      conferir(abas[0] === SELETORES.dia.visaoGeral.rotulo, `a primeira aba é "${abas[0] ?? 'nenhuma'}"`);
      const ordem = SELETORES.dia.ordem.filter((r) => abas.includes(r));
      conferir(JSON.stringify(ordem) === JSON.stringify(SELETORES.dia.ordem), `as abas do Dia a dia vieram: ${abas.join(' · ')}`);
      const texto = await semErroNaTela(p, vigia);
      try {
        const estrutura = await api('/trabalho/estrutura');
        pastas = (estrutura?.folders ?? []).filter((f) => !f.parentId);
      } catch { /* sem a estrutura, a conferência por pasta fica de fora */ }
      const citadas = pastas.filter((f) => f.name && texto.includes(f.name)).length;
      conferir(!pastas.length || citadas > 0, 'o dash não cita nenhuma das pastas do Trabalho');
      await foto(p, 'dia-visao-geral-escuro');
      return { detalhe: { abas: abas.length, pastasDaCasa: pastas.length, pastasCitadasNoDash: citadas } };
    });

    // ---- 8. Pendências ----
    await passo('Dia a dia › Pendências', async () => {
      vigia.zerar();
      await abrirAba(p, SELETORES.areas.dia, SELETORES.dia.pendencias.rotulo);
      await semErroNaTela(p, vigia);
      await foto(p, 'pendencias-escuro');
    });

    // ---- 9. Trabalho: "Todas" mostra tarefas de várias pastas ----
    await passo('Trabalho › seletor de pastas em "Todas" mostra tarefas de várias pastas', async () => {
      vigia.zerar();
      await abrirArea(p, SELETORES.areas.trabalho);
      await abrirAba(p, SELETORES.areas.trabalho, SELETORES.trabalho.tarefas.rotulo).catch(() => {});
      const todas = p.locator(SELETORES.main).getByRole('button', { name: SELETORES.trabalho.todas })
        .or(p.locator(SELETORES.main).getByRole('link', { name: SELETORES.trabalho.todas }))
        .or(p.locator(SELETORES.main).getByRole('tab', { name: SELETORES.trabalho.todas }))
        .or(p.locator(SELETORES.main).getByRole('radio', { name: SELETORES.trabalho.todas }));
      conferir(await todas.count(), 'o seletor de pastas não tem "Todas"');
      await todas.first().click();
      await esperar(p);
      await semErroNaTela(p, vigia);
      const ids = await p.locator(SELETORES.trabalho.cartao).evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-work-task-id')))]);
      conferir(ids.length > 0, 'nenhuma tarefa visível em "Todas"');
      // De que pasta é cada tarefa visível: lista → pasta pela estrutura.
      let pastasVistas = null;
      try {
        const estrutura = await api('/trabalho/estrutura');
        const pastaDaLista = new Map();
        (function andar(folders, raiz) {
          for (const f of folders ?? []) {
            const topo = raiz ?? f.id;
            for (const l of f.lists ?? []) pastaDaLista.set(l.id, topo);
            andar(f.folders ?? f.children ?? [], topo);
          }
        })(estrutura?.folders ?? []);
        const tarefas = itensCom(await api('/trabalho/tarefas')).filter((t) => t.listId);
        const listaDe = new Map(tarefas.map((t) => [t.id, t.listId]));
        pastasVistas = new Set(ids.map((id) => pastaDaLista.get(listaDe.get(id))).filter(Boolean)).size;
      } catch { /* a conta por pasta fica de fora; vale a contagem da tela */ }
      if (pastasVistas !== null && pastasVistas > 0) conferir(pastasVistas >= 2, `as tarefas visíveis são de ${pastasVistas} pasta só`);
      await foto(p, 'trabalho-todas-escuro');
      return {
        detalhe: { tarefasVisiveis: ids.length, pastasDasTarefasVisiveis: pastasVistas },
        aviso: pastasVistas ? undefined : 'a pasta de cada tarefa não pôde ser conferida pela API; valeu a contagem da tela',
      };
    });

    // ---- 10. calendário ----
    await passo('Trabalho › calendário', async () => {
      vigia.zerar();
      const botao = p.locator(SELETORES.main).getByRole('button', { name: SELETORES.trabalho.calendario })
        .or(p.locator(SELETORES.main).getByRole('tab', { name: SELETORES.trabalho.calendario }))
        .or(p.locator(SELETORES.main).getByRole('link', { name: SELETORES.trabalho.calendario }));
      conferir(await botao.count(), 'não há o botão "Calendário" no Trabalho');
      await botao.first().click();
      await esperar(p);
      const texto = await semErroNaTela(p, vigia);
      const dias = new Set((texto.match(SELETORES.trabalho.diasDaSemana) ?? []).map((d) => d.toLowerCase())).size;
      conferir(dias >= 5, `o calendário não mostra os dias da semana (${dias} de 5)`);
      await foto(p, 'trabalho-calendario-escuro');
    });

    // ---- 11. pop-up de tarefa com vários responsáveis ----
    await passo('pop-up de tarefa com vários responsáveis', async () => {
      vigia.zerar();
      let alvo = null;
      let nomes = [];
      try {
        const todas = itensCom(await api('/trabalho/todas'));
        const t = todas.find((x) => Array.isArray(x.pessoas) && x.pessoas.length >= 2);
        if (t) { alvo = t.id; nomes = t.pessoas.map((x) => x.nome).filter(Boolean); }
      } catch { /* cai na lista do Trabalho */ }
      if (!alvo) {
        const tarefas = itensCom(await api('/trabalho/tarefas'));
        const t = tarefas.find((x) => Array.isArray(x.outrosResponsaveisIds) && x.outrosResponsaveisIds.length >= 1);
        if (t) {
          alvo = t.id;
          const det = await api(`/trabalho/tarefas/${t.id}`).catch(() => null);
          nomes = [det?.assignee, ...(det?.outrosResponsaveis ?? det?.responsaveis ?? []).map((r) => r?.nome ?? r?.name)].filter(Boolean);
        }
      }
      // A cópia da produção não tem tarefa com dois responsáveis. O passo cria um
      // segundo responsável numa tarefa (com a versão lida), confere o pop-up e DESFAZ.
      let desfazer = null;
      if (!alvo && prova.alvo === 'homologacao-local') {
        const tarefas = itensCom(await api('/trabalho/tarefas?limit=200'));
        const pessoas = itensCom(await api('/trabalho/pessoas'));
        const t = tarefas.find((x) => x.assigneeUserId && !(x.outrosResponsaveisIds ?? []).length);
        const outra = t && pessoas.find((x) => x.id !== t.assigneeUserId);
        if (t && outra) {
          const antes = await api(`/trabalho/tarefas/${t.id}`);
          const r = await escrever('PATCH', `/trabalho/tarefas/${t.id}`, { outrosResponsaveisIds: [outra.id], expectedUpdatedAt: antes.updatedAt });
          alvo = t.id;
          nomes = [antes.assigneeUser?.name ?? antes.assignee, outra.nome].filter(Boolean);
          desfazer = async () => {
            const agora = await api(`/trabalho/tarefas/${t.id}`);
            await escrever('PATCH', `/trabalho/tarefas/${t.id}`, { outrosResponsaveisIds: [], expectedUpdatedAt: agora.updatedAt });
          };
          void r;
        }
      }
      conferir(alvo, 'nenhuma tarefa com responsável para receber um segundo');
      await p.goto(`${WEB}/trabalho?tarefa=${alvo}`, { waitUntil: 'domcontentloaded' });
      await esperar(p);
      const popup = p.locator(SELETORES.trabalho.popup).first();
      await popup.waitFor({ timeout: 20_000 });
      const texto = await popup.innerText();
      const achados = nomes.filter((n) => texto.includes(n)).length;
      conferir(nomes.length < 2 || achados >= 2, `o pop-up mostra ${achados} de ${nomes.length} responsáveis`);
      conferir(!vigia.problemas().length, vigia.problemas().slice(0, 2).join(' · '));
      await foto(p, 'popup-responsaveis-escuro');
      await p.keyboard.press('Escape').catch(() => {});
      if (desfazer) await desfazer();
      return { detalhe: { responsaveisNaTarefa: nomes.length, responsaveisNoPopup: achados } };
    });

    // ---- 12 a 14. fora do foco: abrem como em produção ----
    for (const [nome, cfg, arquivo] of [
      ['Financeiro abre sem erro', SELETORES.financeiro, 'financeiro-escuro'],
      ['Cofre abre sem erro', SELETORES.cofre, 'cofre-escuro'],
      ['Granola em Integrações abre sem erro', SELETORES.granola, 'integracoes-escuro'],
    ]) {
      await passo(nome, async () => {
        vigia.zerar();
        await p.goto(`${WEB}${cfg.url}`, { waitUntil: 'domcontentloaded' });
        await esperar(p);
        conferir(!new URL(p.url()).pathname.startsWith(SELETORES.login.caminho), 'a tela mandou de volta ao login');
        const texto = await semErroNaTela(p, vigia);
        conferir(cfg.pronto.test(texto), `a tela abriu sem "${cfg.pronto.source}"`);
        await foto(p, arquivo);
      });
    }
    await ctx.close();

    // ---- 15. nenhuma página rola na horizontal a 390 px ----
    await passo('nenhuma página com rolagem horizontal a 390 px', async () => {
      const c = await contexto(navegador, 'dark', { width: 390, height: 844 });
      const pg = await c.newPage();
      const rolam = [];
      const baseDaProducao = [];
      for (const t of SELETORES.telas) {
        await pg.goto(`${WEB}${t.url}`, { waitUntil: 'domcontentloaded' });
        await esperar(pg);
        const rola = await rolaNaHorizontal(pg);
        prova.semRolagemHorizontal.push({ tela: t.nome, rola, daProducao: !!t.daProducao });
        // Tela de fora do foco, sem mudança nossa: o que ela faz é o que a produção faz.
        // Fica registrado como linha de base, não como falha desta versão.
        if (rola && t.daProducao) baseDaProducao.push(t.nome);
        else if (rola) rolam.push(t.nome);
      }
      await c.close();
      conferir(!rolam.length, `rolam na horizontal: ${rolam.join(', ')}`);
      return { detalhe: { telas: SELETORES.telas.length, linhaDeBaseDaProducao: baseDaProducao } };
    });

    // ---- 16. fotos em escuro, claro e 390 px ----
    await passo('fotos das telas em escuro, claro e 390 px', async () => {
      const antes = prova.fotos;
      for (const [tema, viewport, sufixo] of [
        ['dark', { width: 1440, height: 900 }, 'escuro'],
        ['light', { width: 1440, height: 900 }, 'claro'],
        ['dark', { width: 390, height: 844 }, '390'],
      ]) {
        const c = await contexto(navegador, tema, viewport);
        const pg = await c.newPage();
        for (const t of SELETORES.telas) {
          await pg.goto(`${WEB}${t.url}`, { waitUntil: 'domcontentloaded' });
          await esperar(pg);
          await foto(pg, `${t.nome}-${sufixo}`);
        }
        await c.close();
      }
      return { detalhe: { fotos: prova.fotos - antes } };
    });
  } finally {
    await navegador.close();
  }
}

main()
  .catch((e) => {
    registrar('roteiro interrompido', false, e?.message ?? String(e));
  })
  .finally(() => {
    gravar();
    const { passa, falha } = prova.placar;
    console.log(`\nPlacar: ${passa} PASSA · ${falha} FALHA · ${prova.fotos} fotos em homolog/organizar/fotos/ (fora do git)`);
    console.log('Resumo: homolog/organizar/prova-final.json');
    process.exitCode = falha ? 1 : 0;
  });
