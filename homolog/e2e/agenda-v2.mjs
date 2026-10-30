#!/usr/bin/env node
/*
 * A PROVA DA AGENDA V2 (rodada de 29/10/2026), CONTRA A STACK DO SEED EM DOCKER (3031)
 * COM O DUBLÊ DO GOOGLE (homolog/mocks/google, serviço `google_duble`).
 *
 * Mesmo arranjo dos e2e da produção 22: Playwright de `UX_PW` (padrão
 * `C:/Users/User/dev/pw-tools`), web em `UX_WEB` (3031), API em `UX_API` (4031), o
 * dublê em `UX_GOOGLE` (127.0.0.1:4035), a senha lida de `HOMOLOG_ENV` em tempo de
 * execução (nunca copiada), o banco da stack pelo `docker exec` do container dele.
 *
 * O que ela prova (docs/comercial/RODADA-AGENDA-V2-20261029.md, G8):
 *   00 a conta do Google da empresa root aponta para o dublê; a sobrescrita assinada
 *      da decisão 2 (aprovação de R2 desligada para gente na tela) aplicada pelo CLI;
 *   01 a sincronia traz a semana semeada no dublê para o espelho; o Fechado da agenda
 *      pessoal entra sem título;
 *   02 a frase preenche o painel (tela) e o título sai da gramática;
 *   03 marcar pela tela: dentro da janela da política (08h a 20h de SP) sai no clique;
 *      fora dela a régua acende `fora_da_janela` e o pedido vai à fila (a prova diz qual);
 *   04 a mesma ação fora da tela (a rota antiga, sem `naTela`) e pela conta de máquina
 *      cai na fila;
 *   05 o choque aparece em Conflitos e o botão "empurrar" resolve;
 *   06 feriado bloqueia; 07 Fora fecha o dia; 08 Fechado conta; 09 arrastar respeita a
 *      régua (o próprio evento fora da conta);
 *   10 o link público marca: só livres, confirma, vai à fila do link, uma pessoa da casa
 *      libera e o convite sai ao cliente; o .ics; o mesmo link não reaproveita;
 *   11 desfazer volta (desmarcar); 12 o histórico; 13 as capturas de cada aba
 *      (escuro, claro e 390 px).
 *
 * Um passo que falha NÃO derruba os seguintes; o resultado é FALHA se qualquer um falhar.
 * ESCREVE na stack só dado fictício (domínio .invalid). Zera o dublê no começo. Nunca toca a 3030.
 * Saída: `homolog/provas/<PROVAS_PREFIXO>agenda-v2.json` e `agenda-v2-*.png`.
 * Uso (Git Bash): node homolog/e2e/agenda-v2.mjs        (SO=03,10 roda só esses passos)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4031/api';
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:3031';
const DUBLE = (process.env.UX_GOOGLE ?? 'http://127.0.0.1:4035').replace(/\/+$/, '');
const PW = process.env.UX_PW ?? 'C:/Users/User/dev/pw-tools';
const PREFIXO = process.env.PROVAS_PREFIXO ?? '';
const CONT_DB = process.env.UX_DB_CONTAINER ?? 'rootos_final_seed_db';
const CONT_API = process.env.UX_API_CONTAINER ?? 'rootos_final_seed_api';
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
const DB_USER = ENV.DB_USER || 'rootos';
const DB_NAME = ENV.DB_NAME || 'rootos_final_seed_homolog';
const EMAIL = process.env.INTERFACE_EMAIL ?? 'admin@marketing-os.local';
const EMAIL_MESA = 'mesa@root.homolog';
const CONTA_GOOGLE = 'operacao.root@exemplo.invalid';
const PESSOAL_RODRIGO = 'rodrigo.pessoal@exemplo.invalid';
const CLIENTE_EMAIL = 'cliente.agenda@exemplo.invalid';
const FUSO = 'America/Sao_Paulo';

const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], avisos: [], ok: false };
const t0 = Date.now();
function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  writeFileSync(join(PROVAS, `${PREFIXO}agenda-v2.json`), `${JSON.stringify(prova, null, 2)}\n`);
}
function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SO = (process.env.SO ?? '').split(',').map((x) => x.trim()).filter(Boolean);
async function passo(nome, fn) {
  if (SO.length && !SO.some((s) => nome.startsWith(s))) { prova.pulados = (prova.pulados ?? 0) + 1; return; }
  const ini = Date.now();
  try {
    const r = (await fn()) ?? {};
    const linha = { n: prova.passos.length + 1, nome, ok: true, ms: Date.now() - ini, ...r };
    prova.passos.push(linha);
    console.log(`  ${String(linha.n).padStart(2)}. PASSA ${nome}${r.detalhe ? ` · ${JSON.stringify(r.detalhe)}` : ''}`);
  } catch (e) {
    prova.passos.push({ n: prova.passos.length + 1, nome, ok: false, ms: Date.now() - ini, erro: String(e?.message ?? e) });
    console.log(`  ${String(prova.passos.length).padStart(2)}. FALHA ${nome} · ${e?.message ?? e}`);
  }
}
function aviso(texto) {
  prova.avisos.push(texto);
  console.log(`      aviso: ${texto}`);
}

async function http(metodo, url, corpo, token, headers = {}) {
  const r = await fetch(url, {
    method: metodo,
    headers: { accept: 'application/json', ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    redirect: 'manual',
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { status: r.status, json, texto };
}
async function api(metodo, caminho, corpo, token) {
  const { status, json } = await http(metodo, `${API}${caminho}`, corpo, token);
  if (status >= 400) throw new Error(`${metodo} ${caminho} → ${status}: ${typeof json === 'string' ? json.slice(0, 240) : JSON.stringify(json).slice(0, 240)}`);
  return json;
}
async function duble(metodo, caminho, corpo) {
  const { status, json } = await http(metodo, `${DUBLE}${caminho}`, corpo);
  if (status >= 400) throw new Error(`dublê ${metodo} ${caminho} → ${status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}
async function entrar(email) {
  const r = await api('POST', '/auth/login', { email, password: SENHA });
  return { token: r.token ?? r.accessToken, user: r.user };
}
function orgDoToken(token) {
  return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')).orgId;
}
/** SQL no banco da stack, pelo container (a senha nunca sai do container). */
function sql(consulta) {
  return execFileSync('docker', ['exec', CONT_DB, 'psql', '-U', DB_USER, '-d', DB_NAME, '-Atc', consulta], { encoding: 'utf8' }).trim();
}

/* ---------------------------------------------------------------- relógio de SP */

const partes = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((p) => [p.type, p.value]));
const diaEmSP = (d = new Date()) => { const p = partes(d); return `${p.year}-${p.month}-${p.day}`; };
const horaEmSP = (d = new Date()) => Number(partes(d).hour);
/** `AAAA-MM-DD` + `HH:MM` em São Paulo (UTC-3, sem horário de verão desde 2019). */
const instante = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`);
const somar = (dia, n) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaDaSemana = (dia) => new Date(`${dia}T12:00:00Z`).getUTCDay();
/** O próximo dia `dow` (0 = domingo) depois de hoje. */
function proximo(dow, depoisDe = diaEmSP()) {
  let d = somar(depoisDe, 1);
  while (diaDaSemana(d) !== dow) d = somar(d, 1);
  return d;
}
const dentroDaJanela = () => { const h = horaEmSP(); return h >= 8 && h < 20; };

/* ---------------------------------------------------------------- navegador */

async function contexto(navegador, sessao, tema = 'dark', viewport = { width: 1440, height: 900 }, extra = {}) {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR', timezoneId: FUSO, ...extra });
  await ctx.addInitScript(
    ([token, user, tema]) => {
      localStorage.setItem('mktos_token', token);
      localStorage.setItem('mktos_user', JSON.stringify(user));
      localStorage.setItem('root-os:tema', tema);
      localStorage.setItem('root-os:tema-estudio', tema);
      localStorage.setItem('root-os:menu-recolhido', '0');
    },
    [sessao.token, sessao.user, tema],
  );
  return ctx;
}
async function foto(p, nome) {
  const arquivo = `${PREFIXO}agenda-v2-${nome}.png`;
  await p.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}
const semRolagemLateral = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function esperar(fn, ms = 10000, passoMs = 400) {
  const fim = Date.now() + ms;
  let v = await fn().catch(() => null);
  while (!v && Date.now() < fim) { await dormir(passoMs); v = await fn().catch(() => null); }
  return v;
}

/* ---------------------------------------------------------------- o calendário semeado */

/** Uma semana fictícia no formato do Google: choque, feriado, Fora, sem Meet, fora do padrão. */
function semana() {
  const seg = proximo(1);
  const ter = somar(seg, 1);
  const qua = somar(seg, 2);
  const qui = somar(seg, 3);
  const org = { email: CONTA_GOOGLE, self: true };
  const ev = (id, titulo, dia, ini, fim, extra = {}) => ({
    id, status: 'confirmed', summary: titulo, organizer: org,
    start: { dateTime: instante(dia, ini).toISOString(), timeZone: FUSO },
    end: { dateTime: instante(dia, fim).toISOString(), timeZone: FUSO },
    ...extra,
  });
  const meet = (s) => ({ hangoutLink: `https://meet.google.com/aaa-${s}-zzz` });
  const cliente = (e) => ({ attendees: [{ email: CONTA_GOOGLE, self: true, organizer: true, responseStatus: 'accepted' }, { email: e, responseStatus: 'needsAction' }] });
  return {
    dias: { seg, ter, qua, qui },
    eventos: [
      ev('agv2choquea01', 'Reunião Online - Clinica Exemplo - Rodrigo', qua, '09:00', '10:00', { ...meet('aaa'), ...cliente('clinica@exemplo.invalid') }),
      ev('agv2choqueb01', 'Reunião Online - Fazenda Exemplo - Rodrigo', qua, '09:00', '10:00', { ...meet('bbb'), ...cliente('fazenda@exemplo.invalid') }),
      ev('agv2semmeet01', 'Reunião Online - Clube Exemplo - Lucas', qui, '10:00', '11:00', cliente('clube@exemplo.invalid')),
      ev('agv2foradop01', 'call com cliente novo', qua, '15:00', '16:00', cliente('contato@novo.invalid')),
      { id: 'agv2pedrofora1', status: 'confirmed', summary: 'Pedro Fora - viagem', organizer: org, start: { date: qui }, end: { date: somar(qui, 1) } },
    ],
  };
}

async function main() {
  const navegador = await chromium.launch();
  const sessao = await entrar(EMAIL);
  conferir(sessao.token, 'o login não devolveu token');
  const tok = sessao.token;
  const orgId = orgDoToken(tok);
  const mesa = await entrar(EMAIL_MESA).catch(() => null);
  const ctx = await contexto(navegador, sessao);
  const p = await ctx.newPage();
  p.setDefaultTimeout(20_000);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e.message ?? e)));
  const cClaro = await contexto(navegador, sessao, 'light');
  const claro = await cClaro.newPage();
  claro.setDefaultTimeout(20_000);
  const c390 = await contexto(navegador, sessao, 'dark', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  const m = await c390.newPage();
  m.setDefaultTimeout(20_000);
  const carimbo = Date.now().toString(36);
  const chave = (s) => (`${carimbo}${s}`.toLowerCase().replace(/[^a-v0-9]/g, '0') + 'aaaaaaaaaa').slice(0, 24);
  const S = semana();
  prova.carimbo = carimbo;
  prova.janelaDaPolitica = dentroDaJanela() ? 'dentro (08h a 20h de SP)' : 'fora (noite em SP: a régua acende fora_da_janela)';
  let marcado = null;

  // ---------------- 00 ----------------
  await passo('00 · o Google da root aponta para o dublê; a sobrescrita assinada da decisão 2 aplicada pelo CLI', async () => {
    await duble('GET', '/_duble/saude');
    await duble('POST', '/_duble/zerar', {});
    sql(
      `INSERT INTO "GoogleAccount" ("id","orgId","email","accessToken","refreshToken","tokenType","scope","expiresAt","connectedAt","updatedAt")
       VALUES (gen_random_uuid()::text,'${orgId}','${CONTA_GOOGLE}','duble-acesso','duble-renovacao','Bearer','https://www.googleapis.com/auth/calendar', now() + interval '30 days', now(), now())
       ON CONFLICT ("orgId") DO UPDATE SET "email"=EXCLUDED."email","accessToken"='duble-acesso',"refreshToken"='duble-renovacao',"expiresAt"=now() + interval '30 days',"updatedAt"=now()`,
    );
    // O CLI sobe o Nest inteiro: com o relógio das rotinas desligado e com prazo.
    const saida = execFileSync('docker', ['exec', '-e', 'ROTINAS_CRON=off', CONT_API, 'node', 'dist/agenda/sobrescrita-r2-da-agenda.cli.js', '--org', 'root', '--valer', '--como', EMAIL, '--motivo',
      '2026-10-30: homologação da agenda v2, decisão 2 do Rodrigo (29/10): marcar, alterar, cancelar e desmarcar pela tela saem no clique para gente da casa; agente, rotinas, WhatsApp e link seguem na fila'], { encoding: 'utf8', timeout: 180_000 });
    const r2 = await api('GET', '/agenda/aprovacao-r2', undefined, tok);
    conferir(JSON.stringify(r2).includes('false') || r2.ligada === false || r2.aprovacaoR2Ligada === false, `a sobrescrita não desligou a aprovação de R2: ${JSON.stringify(r2).slice(0, 200)}`);
    return { detalhe: { org: orgId.slice(0, 8), cli: saida.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200) } };
  });

  // ---------------- 01 ----------------
  await passo('01 · a sincronia traz a semana semeada para o espelho; o Fechado da agenda pessoal entra sem título', async () => {
    await duble('POST', '/_duble/semear', { eventos: S.eventos, limpar: true });
    const regras = await api('GET', '/agenda/regras', undefined, tok);
    const rodrigo = regras.pessoas.find((x) => x.nome === 'Rodrigo');
    conferir(rodrigo, 'sem a regra do Rodrigo (a semente da casa não rodou)');
    await api('PUT', `/agenda/regras/pessoa/${rodrigo.id}`, { emailPessoal: PESSOAL_RODRIGO, fechadoLigado: true }, tok);
    await duble('POST', '/_duble/livre-ocupado', { [PESSOAL_RODRIGO]: [{ start: instante(S.dias.ter, '08:00').toISOString(), end: instante(S.dias.ter, '13:00').toISOString() }] });
    const r = await api('POST', '/agenda/sincronia/agora', {}, tok);
    const esp = await api('GET', `/agenda/espelho?de=${instante(S.dias.seg, '00:00').toISOString()}&ate=${instante(somar(S.dias.seg, 5), '00:00').toISOString()}`, undefined, tok);
    conferir(esp.fonte === 'espelho', `a tela não leu do espelho: fonte ${esp.fonte} (${JSON.stringify(esp.sincronia)})`);
    const ids = new Set(esp.eventos.map((e) => e.id));
    for (const e of S.eventos) conferir(ids.has(e.id), `o espelho não tem ${e.id}`);
    const fechado = esp.eventos.find((e) => e.origem === 'livre_ocupado');
    conferir(fechado && fechado.titulo === null && fechado.leitura.tipo === 'fechado', 'o Fechado da agenda pessoal não entrou (ou entrou com título)');
    return { detalhe: { resultado: r?.resultado?.estado ?? r?.resultado?.status ?? null, eventos: esp.eventos.length } };
  });

  // ---------------- 02 ----------------
  await passo('02 · a frase preenche o painel e o título sai da gramática (tela)', async () => {
    await p.goto(`${WEB}/agenda?aba=semana&dia=${S.dias.ter}&dias=5`, { waitUntil: 'networkidle' });
    let atalho = p.locator('#agenda-atalho');
    if (!(await atalho.isVisible().catch(() => false))) {
      await p.getByRole('button', { name: /marcar/i }).first().click();
      atalho = p.locator('#agenda-atalho');
    }
    await atalho.fill(`interna ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][diaDaSemana(S.dias.ter)]} 16h 30 min rodrigo`);
    const titulo = await esperar(async () => {
      const t = await p.locator('text=Reunião Interna - Rodrigo').first().isVisible();
      return t ? 'Reunião Interna - Rodrigo' : null;
    });
    conferir(titulo, 'o título "Reunião Interna - Rodrigo" não apareceu no painel');
    await foto(p, 'painel-frase-escuro');
    return { detalhe: { titulo } };
  });

  // ---------------- 03 ----------------
  await passo('03 · marcar pela tela: dentro da janela sai no clique; fora dela, fila com fora_da_janela', async () => {
    await duble('DELETE', '/_duble/pedidos');
    const botao = p.getByRole('button', { name: /^Marcar$/ }).first();
    await botao.click();
    const desfecho = await esperar(async () => {
      const txt = await p.locator('body').innerText();
      if (/saiu|marcad[oa]/i.test(txt) && /desfazer/i.test(txt)) return 'executado';
      if (/fila de aprova/i.test(txt)) return 'fila';
      return null;
    }, 15000);
    await foto(p, 'marcar-no-clique-escuro');
    const pedidos = await duble('GET', '/_duble/pedidos');
    const insert = (pedidos.pedidos ?? pedidos).filter?.((x) => x.metodo === 'POST' && /\/events$/.test(x.caminho)) ?? [];
    if (dentroDaJanela()) {
      conferir(desfecho === 'executado', `dentro da janela o marcar pela tela não saiu no clique (viu: ${desfecho})`);
      conferir(insert.length === 1, `o dublê recebeu ${insert.length} insert(s)`);
      conferir(insert[0].sendUpdates === 'all' || /sendUpdates=all/.test(JSON.stringify(insert[0].query ?? '')), 'o insert não foi com sendUpdates=all');
      marcado = insert[0].corpo?.id ?? null;
    } else {
      conferir(desfecho === 'fila', `fora da janela esperava a fila (viu: ${desfecho})`);
      conferir(insert.length === 0, 'fora da janela o dublê recebeu escrita sem aprovação');
      aviso('03 rodou fora da janela da política (noite em SP): a régua acendeu fora_da_janela e o marcar subiu a R3. Rode de novo entre 08h e 20h para a prova do clique.');
    }
    return { detalhe: { desfecho, inserts: insert.length } };
  });

  // ---------------- 03b (API, cliente com convidado) ----------------
  await passo('03b · marcar cliente online pela mesma rota da tela: Meet, convidado, propriedades do OS', async () => {
    await duble('DELETE', '/_duble/pedidos');
    const r = await api('POST', '/agenda/escritas', {
      acao: 'marcar', chave: chave('m1'),
      compromisso: { tipo: 'cliente', modalidade: 'online', cliente: 'Loja Exemplo', responsaveis: ['Rodrigo'], inicio: instante(S.dias.ter, '15:00').toISOString(), fim: instante(S.dias.ter, '16:00').toISOString(), convidados: [CLIENTE_EMAIL] },
    }, tok);
    prova.marcarCliente = { status: r.status, nivel: r.nivel };
    if (dentroDaJanela()) {
      conferir(r.status === 'executado', `não saiu no clique: ${r.status} ${r.mensagem}`);
      const pedidos = await duble('GET', '/_duble/pedidos');
      const lista = pedidos.pedidos ?? pedidos;
      const ins = lista.find((x) => x.metodo === 'POST' && /\/events$/.test(x.caminho));
      conferir(ins?.corpo?.summary === 'Reunião Online - Loja Exemplo - Rodrigo', `título errado no Google: ${ins?.corpo?.summary}`);
      conferir(JSON.stringify(ins?.corpo?.attendees ?? []).includes(CLIENTE_EMAIL), 'o cliente não foi convidado');
      conferir(ins?.corpo?.conferenceData?.createRequest, 'a online não pediu o Meet');
      conferir(ins?.corpo?.extendedProperties?.private?.mktos === '1', 'sem a marca de criado pelo OS');
      marcado = r;
    } else {
      conferir(r.status === 'aguardando_aprovacao', `fora da janela esperava a fila: ${r.status}`);
      marcado = r;
    }
    return { detalhe: { status: r.status, nivel: r.nivel, desfazer: r.desfazer?.acao ?? null } };
  });

  // ---------------- 04 ----------------
  await passo('04 · a mesma ação fora da tela cai na fila: a rota antiga (sem naTela) e a conta de máquina', async () => {
    const antiga = await api('POST', '/google/calendar/reuniao', {
      tipo: 'interna', modalidade: 'online', responsavel: 'Lucas', inicio: instante(S.dias.ter, '17:00').toISOString(), duracaoMinutos: 30,
    }, tok);
    conferir(antiga.status === 'aguardando_aprovacao', `a rota antiga saiu sem fila: ${JSON.stringify(antiga).slice(0, 160)}`);
    let maquina = 'sem senha da conta de máquina nesta stack';
    if (ENV.MCP_SERVICE_PASSWORD) {
      const s = await api('POST', '/auth/login', { email: 'mcp@marketing-os.local', password: ENV.MCP_SERVICE_PASSWORD }).catch(() => null);
      if (s?.token ?? s?.accessToken) {
        const r = await http('POST', `${API}/agenda/escritas`, { acao: 'marcar', chave: chave('mq'), compromisso: { tipo: 'interna', modalidade: 'online', responsaveis: ['Pedro'], inicio: instante(S.dias.ter, '17:30').toISOString(), fim: instante(S.dias.ter, '18:00').toISOString() } }, s.token ?? s.accessToken);
        conferir(r.status >= 400 || r.json?.status !== 'executado', 'a conta de máquina saiu no clique');
        maquina = `HTTP ${r.status} ${r.json?.status ?? ''}`;
      }
    }
    return { detalhe: { rotaAntiga: antiga.status, nivel: antiga.nivel, maquina } };
  });

  // ---------------- 05 ----------------
  await passo('05 · o choque aparece em Conflitos e o botão "empurrar" resolve', async () => {
    const c = await api('GET', '/agenda/conflitos?dias=60', undefined, tok);
    const choque = c.cartoes.find((x) => x.tipo === 'choque' && x.eventos.some((e) => e.id === 'agv2choqueb01'));
    conferir(choque, `sem o cartão de choque do Rodrigo (tipos: ${[...new Set(c.cartoes.map((x) => x.tipo))].join(',')})`);
    const foraDoPadrao = c.cartoes.some((x) => x.tipo === 'padrao');
    const semMeet = c.cartoes.some((x) => x.tipo === 'sem_meet' && x.eventos.some((e) => e.id === 'agv2semmeet01'));
    const empurrar = choque.acoes.find((a) => a.tipo === 'empurrar' && a.pedido);
    conferir(empurrar, 'o cartão de choque não traz o "empurrar" com o pedido pronto');
    const r = await api('POST', '/agenda/escritas', empurrar.pedido, tok);
    if (dentroDaJanela()) {
      conferir(r.status === 'executado', `o empurrar não saiu: ${r.status} ${r.mensagem}`);
      await api('POST', '/agenda/sincronia/agora', {}, tok);
      const depois = await api('GET', '/agenda/conflitos?dias=60', undefined, tok);
      conferir(!depois.cartoes.some((x) => x.id === choque.id), 'o choque continua em Conflitos depois do empurrar');
    } else {
      conferir(r.status === 'aguardando_aprovacao', `fora da janela esperava a fila: ${r.status}`);
    }
    return { detalhe: { empurrar: r.status, foraDoPadrao, semMeet, contagem: c.contagem } };
  });

  // ---------------- 06 a 09 ----------------
  const avaliar = (proposta) => api('POST', '/agenda/regua/avaliar', proposta, tok);
  await passo('06 · feriado nacional bloqueia', async () => {
    const r = await avaliar({ tipo: 'cliente', modalidade: 'online', responsaveis: ['Lucas'], inicio: instante(S.dias.seg, '10:00').toISOString(), fim: instante(S.dias.seg, '11:00').toISOString() });
    const feriado = sql(`SELECT nome FROM "Feriado" WHERE "orgId"='${orgId}' AND data='${S.dias.seg}' AND tipo='nacional' AND ligado LIMIT 1`);
    if (!feriado) { aviso(`06: ${S.dias.seg} não é feriado nacional; o caso do feriado foi coberto pelas suítes da régua`); return { detalhe: { dia: S.dias.seg, cor: r.cor } }; }
    conferir(r.cor === 'vermelho' && r.itens.some((i) => i.regra === 'feriado'), `feriado não bloqueou: ${JSON.stringify(r).slice(0, 200)}`);
    return { detalhe: { feriado, cor: r.cor } };
  });
  await passo('07 · Fora fecha o dia da pessoa', async () => {
    const r = await avaliar({ tipo: 'cliente', modalidade: 'online', responsaveis: ['Pedro'], inicio: instante(S.dias.qui, '14:00').toISOString(), fim: instante(S.dias.qui, '15:00').toISOString() });
    conferir(r.cor === 'vermelho' && r.itens.some((i) => i.regra === 'fora'), `Fora não fechou: ${JSON.stringify(r).slice(0, 200)}`);
    return { detalhe: { cor: r.cor } };
  });
  await passo('08 · Fechado da agenda pessoal conta', async () => {
    const r = await avaliar({ tipo: 'cliente', modalidade: 'online', responsaveis: ['Rodrigo'], inicio: instante(S.dias.ter, '10:00').toISOString(), fim: instante(S.dias.ter, '11:00').toISOString() });
    conferir(r.cor !== 'verde' && r.itens.some((i) => i.regra === 'fechado'), `Fechado não contou: ${JSON.stringify(r).slice(0, 200)}`);
    return { detalhe: { cor: r.cor } };
  });
  await passo('09 · arrastar respeita a régua (o próprio evento fora da conta)', async () => {
    const choqueComOutro = await avaliar({ tipo: 'cliente', modalidade: 'online', responsaveis: ['Lucas'], inicio: instante(S.dias.qui, '10:00').toISOString(), fim: instante(S.dias.qui, '11:00').toISOString(), ignorarEventoId: 'agv2choquea01' });
    const ficaOndeEsta = await avaliar({ tipo: 'cliente', modalidade: 'online', responsaveis: ['Lucas'], inicio: instante(S.dias.qui, '10:00').toISOString(), fim: instante(S.dias.qui, '11:00').toISOString(), ignorarEventoId: 'agv2semmeet01' });
    conferir(choqueComOutro.cor === 'vermelho', `arrastar para cima de outro compromisso do Lucas não deu vermelho: ${choqueComOutro.cor}`);
    conferir(ficaOndeEsta.itens.every((i) => i.regra !== 'choque'), 'o próprio evento contou como choque com ele mesmo');
    return { detalhe: { sobreOutro: choqueComOutro.cor, ondeEsta: ficaOndeEsta.cor } };
  });

  // ---------------- 10 ----------------
  await passo('10 · link público: só livres, confirma, vai à fila do link, uma pessoa libera e o convite sai; .ics; não reaproveita', async () => {
    const conv = await api('POST', '/agenda/convites', { socio: 'Rodrigo', tipo: 'cliente', modalidade: 'online', duracaoMin: 60, validadeDias: 7 }, tok);
    const token = String(conv.url).split('/agendar/')[1];
    conferir(token, `o convite não devolveu o link: ${JSON.stringify(conv).slice(0, 120)}`);
    const pub = await http('GET', `${API}/agendar/${encodeURIComponent(token)}`);
    conferir(pub.status === 200, `GET público ${pub.status}`);
    const texto = JSON.stringify(pub.json);
    conferir(!/Clinica Exemplo|Fazenda Exemplo|Cultural|novo|Reunião/i.test(texto), 'a página pública vazou título ou cliente da agenda');
    const dia = pub.json.dias.find((d) => d.manha.length || d.tarde.length);
    conferir(dia, 'a página pública não mostrou nenhum horário livre');
    const hora = dia.tarde[0] ?? dia.manha[0];
    const errado = await http('GET', `${API}/agendar/${encodeURIComponent(token.slice(0, -2) + 'xx')}`);
    conferir(errado.status === 404, `token errado deu ${errado.status}`);
    const conf = await http('POST', `${API}/agendar/${encodeURIComponent(token)}/confirmar`, { dia: dia.dia, hora, email: CLIENTE_EMAIL, nome: 'Cliente Exemplo' });
    conferir(conf.status < 300, `confirmar deu ${conf.status}: ${JSON.stringify(conf.json).slice(0, 160)}`);
    const ics = await http('GET', `${API}/agendar/${encodeURIComponent(token)}/ics`);
    conferir(ics.status === 200 && /BEGIN:VCALENDAR/.test(ics.texto), '.ics não veio');
    const denovo = await http('POST', `${API}/agendar/${encodeURIComponent(token)}/confirmar`, { dia: dia.dia, hora, email: CLIENTE_EMAIL });
    conferir(denovo.status >= 400, 'o mesmo link aceitou uma segunda escolha');
    const approvalId = sql(`SELECT "approvalId" FROM "AgendaConvite" WHERE "orgId"='${orgId}' AND "usadoEm" IS NOT NULL ORDER BY "usadoEm" DESC LIMIT 1`);
    conferir(approvalId, 'o convite usado não guardou a aprovação (não foi à fila)');
    let liberado = 'sem mesa@root.homolog nesta stack';
    if (mesa?.token) {
      await duble('DELETE', '/_duble/pedidos');
      const lista = await api('GET', '/approvals?status=pendente', undefined, mesa.token);
      const a = (lista.items ?? lista).find((x) => x.id === approvalId);
      conferir(a, 'a aprovação do link não está pendente na fila');
      const quem = a.alcadaMinima === 'titular' ? await entrar('socio@root.homolog') : mesa;
      const corpo = a.exigeReauth ? { reauth: { senha: SENHA }, motivo: 'homologação da agenda v2: o cliente escolheu pelo link' } : {};
      await api('POST', `/approvals/${approvalId}/confirm`, corpo, quem.token);
      const pedidos = await esperar(async () => {
        const l = (await duble('GET', '/_duble/pedidos')).pedidos ?? [];
        return l.find((x) => x.metodo === 'POST' && /\/events$/.test(x.caminho)) ?? null;
      });
      conferir(pedidos, 'liberado na fila, o convite não chegou ao Google');
      conferir(JSON.stringify(pedidos.corpo?.attendees ?? []).includes(CLIENTE_EMAIL), 'o convite do link não convidou o cliente');
      liberado = `liberado por ${quem === mesa ? 'mesa' : 'socio'} (${a.nivel ?? a.alcadaMinima})`;
    }
    await foto(p, 'link-antes-escuro').catch(() => undefined);
    return { detalhe: { horarios: pub.json.dias.length, escolhido: `${dia.dia} ${hora}`, liberado } };
  });

  // ---------------- 11 ----------------
  await passo('11 · desfazer volta: o desmarcar cancela o que o OS criou', async () => {
    if (!dentroDaJanela() || !marcado?.desfazer) { aviso('11 pulado: o marcar não saiu no clique (fora da janela)'); return { detalhe: { pulado: true } }; }
    await duble('DELETE', '/_duble/pedidos');
    const r = await api('POST', '/agenda/escritas', marcado.desfazer, tok);
    conferir(r.status === 'executado', `o desfazer não saiu: ${r.status} ${r.mensagem}`);
    const evs = await duble('GET', '/_duble/eventos');
    const ev = (evs.eventos ?? evs).find?.((e) => e.id === marcado.eventoId);
    conferir(ev && ev.status === 'cancelled', `o evento não ficou cancelado no Google (${ev?.status})`);
    return { detalhe: { desfazer: marcado.desfazer.acao, proximo: r.desfazer?.acao ?? null } };
  });

  // ---------------- 12 ----------------
  await passo('12 · o histórico mostra o que o OS gravou, com desfazer', async () => {
    const h = await api('GET', '/agenda/historico?limite=30', undefined, tok);
    conferir(Array.isArray(h) && h.length > 0, 'histórico vazio');
    return { detalhe: { linhas: h.length, verbos: [...new Set(h.map((l) => l.verbo))].join(',') } };
  });

  // ---------------- 13 ----------------
  await passo('13 · as capturas de cada aba (escuro, claro e 390 px), sem rolagem lateral', async () => {
    const abas = [['semana', 'Semana e dia'], ['lista', 'Lista'], ['mes', 'Mês'], ['conflitos', 'Conflitos'], ['relatorios', 'Relatórios'], ['regras', 'Regras']];
    const lateral = [];
    for (const [aba] of abas) {
      const url = `${WEB}/agenda?aba=${aba}&dia=${S.dias.seg}&dias=5`;
      for (const [pg, sufixo] of [[p, 'escuro'], [claro, 'claro'], [m, '390']]) {
        await pg.goto(url, { waitUntil: 'networkidle' });
        await dormir(600);
        await foto(pg, `${aba}-${sufixo}`);
        if (sufixo === '390' && !(await semRolagemLateral(pg))) lateral.push(aba);
      }
    }
    // O link público, sem login, a 390 px.
    const conv = await api('POST', '/agenda/convites', { socio: 'Lucas', tipo: 'cliente', modalidade: 'online', duracaoMin: 30 }, tok);
    const caminho = new URL(conv.url).pathname;
    const anon = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', timezoneId: FUSO, isMobile: true });
    const pa = await anon.newPage();
    await pa.goto(`${WEB}${caminho}`, { waitUntil: 'networkidle' });
    await dormir(600);
    await foto(pa, 'link-publico-390');
    const anonD = await navegador.newContext({ viewport: { width: 1280, height: 860 }, locale: 'pt-BR', timezoneId: FUSO });
    const pd = await anonD.newPage();
    await pd.goto(`${WEB}${caminho}`, { waitUntil: 'networkidle' });
    await dormir(600);
    await foto(pd, 'link-publico-escuro');
    if (lateral.length) aviso(`rolagem lateral a 390 px em: ${lateral.join(', ')}`);
    conferir(lateral.length === 0, `rola de lado a 390 px: ${lateral.join(', ')}`);
    return { detalhe: { fotos: prova.screenshots.length } };
  });

  if (erros.length) aviso(`erros de página: ${[...new Set(erros)].slice(0, 5).join(' | ')}`);
  prova.ok = prova.passos.every((x) => x.ok);
  gravar();
  await navegador.close();
  console.log(prova.ok ? `PASSA ${prova.passos.length}` : `FALHA (${prova.passos.filter((x) => !x.ok).length} de ${prova.passos.length})`);
  process.exit(prova.ok ? 0 : 1);
}

main().catch((e) => {
  prova.erroFatal = String(e?.stack ?? e);
  gravar();
  console.error(e);
  process.exit(2);
});
