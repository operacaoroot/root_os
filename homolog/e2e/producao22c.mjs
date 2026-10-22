#!/usr/bin/env node
/*
 * A PROVA DA RODADA DE PRODUÇÃO 4 (22C, 22/10/2026, o WhatsApp por dentro do OS),
 * CONTRA A STACK DO SEED EM DOCKER (3031) COM O DUBLÊ DA EVOLUTION.
 *
 * Mesmo arranjo do `producao22b.mjs`: Playwright (Chromium) de `UX_PW` (padrão
 * `C:/Users/User/dev/pw-tools`), o web em `UX_WEB` (padrão 3031), a API em `UX_API`
 * (padrão 4031), o dublê da Evolution em `UX_EVOLUTION` (padrão 127.0.0.1:4034), a
 * senha lida de `HOMOLOG_ENV` em tempo de execução (nunca copiada).
 *
 * PRÉ-REQUISITOS (o orquestrador):
 *   · a imagem da 22C nas duas pontas (api e web) da stack do seed;
 *   · `CANAL_APROVACAO_SEGREDO` e `CANAL_APROVACAO_CODIGO_SEGREDO` no
 *     `homolog/.env.final-seed` (32+ caracteres cada, DIFERENTES): a api liga o webhook
 *     e o dublê assina com o segredo derivado da empresa;
 *   · o serviço `evolution_duble` de pé (`docker compose ... up -d --build evolution_duble`).
 *
 * O que ela prova (docs/comercial/RODADA-PRODUCAO-20261022-WHATSAPP.md, W5):
 *   00 credencial da Evolution da empresa root apontando ao dublê, estado aberto;
 *   01 a sincronização ("Rodar agora" da rotina whatsapp.sincronizar) traz as 7 conversas;
 *   02 o webhook grava 1:1, grupo e @lid (mensagens simuladas pelo dublê);
 *   03 a caixa com filtros, contagens e busca;
 *   04 o cartão do Dia a dia e a bolha do menu com as não lidas;
 *   05 abrir a conversa marca lida;
 *   06 responder 1:1 e 07 responder no grupo (o dublê recebeu; o balão diz "enviada por");
 *   08 vincular o grupo pela sugestão (um clique) e 09 um 1:1 à mão a um lead;
 *   10 a aba WhatsApp do lead e 11 o bloco WhatsApp da ficha do cliente;
 *   12 arquivar e voltar; 13 o @lid com o número real; 14 a equipe à parte;
 *   15 o simulador em /whatsapp/simulador; 16 a caixa a 390 px (lista, conversa, Voltar);
 *   17 o Dia a dia depois de ler.
 * E fotografa (escuro, claro e 390 px) cada tela tocada.
 *
 * Os seletores das telas novas são os `data-testid` combinados entre as lanes:
 *   caixa-lista, caixa-conversa-<id>, caixa-filtro-<filtro>, caixa-busca, caixa-historico,
 *   caixa-resposta, caixa-enviar, caixa-voltar, caixa-arquivar; whats-vinculo,
 *   whats-vinculo-sugestao, whats-vincular-lead, whats-vincular-cliente, whats-desvincular,
 *   whats-vinculo-busca, whats-vinculo-candidato-<id>; e o cartão do Dia a dia
 *   (dia-a-dia-whatsapp, whatsapp-linha-<filtro>, whatsapp-sem-vinculo-chamada) e a bolha
 *   (whatsapp-bolha).
 *
 * Um passo que falha NÃO derruba os seguintes: ele fica marcado com a frase do que se
 * viu, e o resultado final é FALHA se qualquer passo falhou.
 *
 * ESCREVE na stack (só dado fictício): a credencial da Evolution da empresa root (o
 * endereço do dublê), mensagens fictícias pelo webhook e pela caixa, vínculos (desfeitos
 * e refeitos a cada rodada, então a prova roda de novo), uma conversa arquivada e
 * desarquivada. Reinicia o estado do dublê no começo. Nunca toca a 3030.
 *
 * Saída: `homolog/provas/<PROVAS_PREFIXO>producao22c.json` e `producao22c-*.png`.
 * Uso (Git Bash): node homolog/e2e/producao22c.mjs      (SO=03,08 roda só esses passos)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4031/api';
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:3031';
const DUBLE = (process.env.UX_EVOLUTION ?? 'http://127.0.0.1:4034').replace(/\/+$/, '');
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
/** O endereço do dublê VISTO DE DENTRO da rede da stack (nome sem ponto: a regra da casa). */
const URL_DO_DUBLE_NA_REDE = process.env.EVOLUTION_DUBLE_URL ?? 'http://evolution_duble:8080';
const CHAVE_DO_DUBLE = ENV.EVOLUTION_DUBLE_CHAVE || 'chave-do-duble-evolution';
const INSTANCIA = ENV.EVOLUTION_DUBLE_INSTANCIA || 'rootos';

/** As conversas fictícias do dublê (homolog/mocks/evolution/server.mjs). */
const C = {
  contato: { nome: 'Contato Exemplo', jid: '5532900000001@s.whatsapp.net' },
  lid: { nome: 'Contato Lid Exemplo', jid: '190000000000001@lid', numero: '5532900000002' },
  leadTelefone: { nome: 'Café Serra Contato', jid: '5511900000001@s.whatsapp.net' },
  cliente: { nome: 'ROOT | Rede Pão Bom', jid: '120363000000000001@g.us', vinculo: 'Rede Pão Bom' },
  lead: { nome: 'ROOT | Café Serra', jid: '120363000000000002@g.us', vinculo: 'Café Serra' },
  equipe: { nome: 'ROOT | Estratégia e Produto', jid: '120363000000000003@g.us' },
  semPrefixo: { nome: 'Grupo de Exemplo', jid: '120363000000000004@g.us' },
};
const LEAD_DO_VINCULO_A_MAO = process.env.E2E22C_LEAD ?? 'Studio Lume';

const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], avisos: [], ok: false };
const t0 = Date.now();

function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  writeFileSync(join(PROVAS, `${PREFIXO}producao22c.json`), `${JSON.stringify(prova, null, 2)}\n`);
}
function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const SO = (process.env.SO ?? '').split(',').map((x) => x.trim()).filter(Boolean);
async function passo(nome, fn) {
  if (SO.length && !SO.some((s) => nome.startsWith(s))) { console.log(`      pulado: ${nome}`); prova.pulados = (prova.pulados ?? 0) + 1; return; }
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
  if (status >= 400) throw new Error(`${metodo} ${caminho} → ${status}: ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 200)}`);
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
  const corpo = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
  return corpo.orgId;
}

async function contexto(navegador, sessao, tema = 'dark', viewport = { width: 1440, height: 900 }, extra = {}) {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...extra });
  await ctx.addInitScript(
    ([token, user, tema]) => {
      localStorage.setItem('mktos_token', token);
      localStorage.setItem('mktos_user', JSON.stringify(user));
      localStorage.setItem('root-os:tema', tema);
      if (!sessionStorage.getItem('e2e22c:menu')) {
        localStorage.setItem('root-os:menu-recolhido', '0');
        sessionStorage.setItem('e2e22c:menu', '1');
      }
    },
    [sessao.token, sessao.user, tema],
  );
  return ctx;
}
async function foto(p, nome) {
  const arquivo = `${PREFIXO}producao22c-${nome}.png`;
  await p.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}
async function semRolagemLateral(p) {
  return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
async function esperar(fn, ms = 8000, passoMs = 300) {
  const fim = Date.now() + ms;
  let v = await fn().catch(() => null);
  while (!v && Date.now() < fim) { await dormir(passoMs); v = await fn().catch(() => null); }
  return v;
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
  if (!(await semRolagemLateral(m))) throw new Error(`${caminho} rola de lado a 390 px`);
}

// ---------------------------------------------------------------- a caixa

/** O item da lista pelo nome da conversa. */
const itemDaLista = (p, nome) => p.locator('[data-testid^="caixa-conversa-"]').filter({ hasText: nome }).first();

async function abrirCaixa(p, filtro = null) {
  await p.goto(`${WEB}/whatsapp${filtro ? `?filtro=${filtro}` : ''}`, { waitUntil: 'networkidle' });
  await p.getByTestId('caixa-lista').waitFor({ timeout: 20_000 });
}
async function abrirConversa(p, nome, filtro = null) {
  if (!(await itemDaLista(p, nome).isVisible().catch(() => false))) await abrirCaixa(p, filtro);
  const item = itemDaLista(p, nome);
  await item.waitFor({ timeout: 15_000 });
  await item.click();
  await p.getByTestId('caixa-historico').waitFor({ timeout: 15_000 });
  return item;
}
/** O número que o chip do filtro mostra (a contagem), ou null. */
async function contagemDoChip(p, filtro) {
  const t = (await p.getByTestId(`caixa-filtro-${filtro}`).innerText()).replace(/\s+/g, ' ');
  const m = /(\d+)\s*$/.exec(t) ?? /(\d+)/.exec(t);
  return m ? Number(m[1]) : null;
}
async function itensVisiveis(p) {
  return p.locator('[data-testid^="caixa-conversa-"]').count();
}
async function clicarFiltro(p, filtro) {
  await p.getByTestId(`caixa-filtro-${filtro}`).click();
  await p.waitForLoadState('networkidle');
  await dormir(300);
}
/** A lista da caixa pela API (W2), ou null se a rota responder diferente do combinado. */
async function listaPelaApi(tok, filtro = 'todas') {
  const r = await http('GET', `${API}/whatsapp/conversas?filtro=${filtro}`, undefined, tok);
  if (r.status >= 400 || !r.json || !Array.isArray(r.json.conversas)) return null;
  return r.json;
}
/** Desfaz o vínculo da conversa aberta, se houver (para a prova rodar de novo). */
async function semVinculo(p) {
  const desv = p.getByTestId('whats-desvincular');
  if (await desv.isVisible().catch(() => false)) {
    await desv.click();
    const confirmar = p.getByRole('button', { name: /^(confirmar|desvincular)$/i });
    if (await confirmar.isVisible().catch(() => false)) await confirmar.click();
    await esperar(async () => !(await desv.isVisible().catch(() => false)), 8000);
    return true;
  }
  return false;
}

async function main() {
  const navegador = await chromium.launch();
  const sessao = await entrar(EMAIL);
  conferir(sessao.token, 'o login não devolveu token');
  const tok = sessao.token;
  const orgId = orgDoToken(tok);
  const nomeDoAdmin = sessao.user?.name ?? '';
  const ctx = await contexto(navegador, sessao);
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
  const texto = (s) => `Mensagem de exemplo e2e 22c ${s} ${carimbo}`;
  prova.carimbo = carimbo;

  // ---------------- 00 · credencial ----------------
  await passo('00 · o dublê está de pé com o segredo; a credencial da Evolution da root aponta para ele e a instância abre', async () => {
    const saude = await duble('GET', '/');
    conferir(saude.segredo === 'configurado', 'o dublê está sem CANAL_APROVACAO_SEGREDO: ponha os dois segredos do canal no .env.final-seed e recrie api e evolution_duble');
    await duble('POST', '/simular/reiniciar', {});
    // A 3031 não grava no cofre (a ENCRYPTION_KEY dela tem 48 bytes desde a montagem): a casa usa a
    // reserva do ambiente (EVOLUTION_* no compose, apontando para o dublê). Com o cofre bom, vale o PUT.
    let conexao = await api('GET', '/integrations/evolution/conexao', undefined, tok);
    if (conexao.origem !== 'ambiente') {
      conexao = await api('PUT', '/integrations/evolution/credencial', { url: URL_DO_DUBLE_NA_REDE, chave: CHAVE_DO_DUBLE, instancia: INSTANCIA }, tok);
    }
    conferir(['cofre', 'ambiente'].includes(conexao.origem), `a credencial da Evolution não está configurada: ${conexao.origem}`);
    conferir(conexao.url === URL_DO_DUBLE_NA_REDE && conexao.instancia === INSTANCIA, 'a credencial da casa não aponta para o dublê');
    const estado = await api('GET', '/integrations/evolution/estado', undefined, tok);
    conferir(JSON.stringify(estado).includes('open'), `a instância do dublê não abriu: ${JSON.stringify(estado).slice(0, 200)}`);
    const seg = await api('GET', '/integrations/evolution/segredo-do-webhook', undefined, tok);
    conferir(seg.ligado === true, 'o webhook do canal está desligado na api (faltam os dois segredos no .env.final-seed)');
    return { detalhe: { org: orgId.slice(0, 8), origem: conexao.origem, daCasa: seg.daCasa } };
  });

  // ---------------- 01 · sincronização ----------------
  await passo('01 · "Rodar agora" da rotina whatsapp.sincronizar traz as 7 conversas do dublê para a caixa', async () => {
    // Abrir a caixa semeia a rotina na empresa da casa (garantirRotina).
    await http('GET', `${API}/whatsapp/conversas?filtro=todas`, undefined, tok);
    const rotinas = await api('GET', '/rotinas', undefined, tok);
    const rotina = (rotinas.items ?? []).find((r) => r.tipo === 'whatsapp.sincronizar');
    conferir(rotina, `a rotina whatsapp.sincronizar não existe na root (tipos: ${(rotinas.items ?? []).map((r) => r.tipo).join(', ')})`);
    conferir(rotina.ativo !== false, 'a rotina whatsapp.sincronizar nasceu desligada');
    const rodada = await api('POST', `/rotinas/${rotina.id}/rodar`, {}, tok);
    const nomes = Object.values(C).map((c) => c.nome);
    const lista = await esperar(async () => {
      const l = await listaPelaApi(tok);
      return l && nomes.every((n) => l.conversas.some((c) => c.nome === n)) ? l : null;
    }, 30_000, 1000);
    await abrirCaixa(p);
    const vistos = [];
    for (const n of nomes) if (await itemDaLista(p, n).isVisible().catch(() => false)) vistos.push(n);
    conferir(vistos.length === nomes.length, `a caixa mostra ${vistos.length} de ${nomes.length}: falta ${nomes.filter((n) => !vistos.includes(n)).join(', ')}`);
    if (!lista) aviso('GET /whatsapp/conversas não respondeu no formato ListaDaCaixa; a conferência foi só pela tela');
    await foto(p, 'caixa-sincronizada-escuro');
    return { detalhe: { rotina: rotina.id.slice(0, 8), execucao: rodada?.resultado ?? rodada?.status ?? null, conversas: lista?.conversas.length ?? vistos.length } };
  });

  // ---------------- 02 · webhook ----------------
  await passo('02 · o webhook grava 1:1, grupo (participante @lid) e o 1:1 @lid: as mensagens simuladas aparecem na caixa', async () => {
    const entregas = [];
    for (const [chat, corpo] of [
      ['contato', { texto: texto('1:1') }],
      ['cliente', { texto: texto('grupo'), participante: '5532900000012' }],
      ['lid', { texto: texto('lid') }],
      ['equipe', { texto: texto('equipe'), participante: '5532900000031' }],
      ['sem-prefixo', { texto: texto('sem prefixo') }],
    ]) {
      const r = await duble('POST', '/simular/mensagem', { orgId, chat, ...corpo });
      entregas.push(`${chat}:${r.webhook.status}`);
      conferir(r.webhook.status >= 200 && r.webhook.status < 300, `o webhook respondeu ${r.webhook.status} para ${chat} (${r.webhook.erro ?? ''})`);
    }
    await abrirCaixa(p);
    for (const [nome, s] of [[C.contato.nome, '1:1'], [C.cliente.nome, 'grupo'], [C.lid.nome, 'lid']]) {
      const ok = await esperar(async () => {
        await p.reload({ waitUntil: 'networkidle' });
        return (await itemDaLista(p, nome).innerText()).includes(texto(s).slice(0, 30)) || (await itemDaLista(p, nome).innerText()).includes(carimbo);
      }, 15_000, 1500);
      conferir(ok, `a prévia de "${nome}" não mostra a mensagem simulada`);
    }
    await foto(p, 'caixa-mensagens-novas-escuro');
    return { detalhe: { entregas } };
  });

  // ---------------- 03 · filtros ----------------
  await passo('03 · a caixa: chips Todas · Leads · Clientes · Grupos · Sem vínculo · Equipe com contagem que bate com a lista; busca por nome e por texto', async () => {
    await abrirCaixa(p);
    const contagens = {};
    for (const f of ['todas', 'leads', 'clientes', 'grupos', 'sem_vinculo', 'equipe']) {
      const chip = p.getByTestId(`caixa-filtro-${f}`);
      conferir(await chip.isVisible().catch(() => false), `o chip ${f} não aparece`);
      await clicarFiltro(p, f);
      const n = await contagemDoChip(p, f);
      const itens = await itensVisiveis(p);
      contagens[f] = { chip: n, lista: itens };
      if (n !== null) conferir(n === itens, `o chip ${f} diz ${n} e a lista mostra ${itens}`);
    }
    await clicarFiltro(p, 'grupos');
    for (const g of [C.cliente.nome, C.lead.nome, C.equipe.nome, C.semPrefixo.nome]) conferir(await itemDaLista(p, g).isVisible().catch(() => false), `o filtro Grupos não mostra "${g}"`);
    conferir(!(await itemDaLista(p, C.contato.nome).isVisible().catch(() => false)), 'o filtro Grupos mostra um 1:1');
    await clicarFiltro(p, 'equipe');
    conferir(await itemDaLista(p, C.equipe.nome).isVisible().catch(() => false), 'a Equipe não mostra "Estratégia e Produto"');
    await foto(p, 'caixa-filtro-equipe-escuro');
    await clicarFiltro(p, 'todas');
    const busca = p.getByTestId('caixa-busca');
    await busca.fill('Rede Pão');
    conferir(await esperar(async () => (await itensVisiveis(p)) === 1 && (await itemDaLista(p, C.cliente.nome).isVisible()), 8000), 'a busca por nome não deixou só o grupo do cliente');
    await busca.fill(`22c lid ${carimbo}`);
    conferir(await esperar(async () => itemDaLista(p, C.lid.nome).isVisible(), 8000), 'a busca pelo texto da mensagem não achou a conversa @lid');
    await busca.fill('');
    await tresFotos(telas, '/whatsapp', 'caixa');
    return { detalhe: contagens };
  });

  // ---------------- 04 · Dia a dia ----------------
  await passo('04 · o Dia a dia: cartão WhatsApp com as não lidas por Leads, Clientes e Sem vínculo, a chamada para ligar e a bolha no menu', async () => {
    // O resumo é guardado 30 s na API: espera a medição que já vê as mensagens novas.
    let n = null;
    await esperar(async () => {
      await p.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
      const card = p.getByTestId('dia-a-dia-whatsapp');
      await card.waitFor({ timeout: 10_000 });
      const linha = p.getByTestId('whatsapp-linha-sem_vinculo');
      if (!(await linha.isVisible().catch(() => false))) return false;
      n = Number(/(\d+)\s*não lida/.exec(await linha.innerText())?.[1] ?? 0);
      return n > 0;
    }, 40_000, 5000);
    conferir(n > 0, 'o cartão não mostra não lidas sem vínculo depois das mensagens simuladas');
    for (const [f, url] of [['leads', '/whatsapp?filtro=leads'], ['clientes', '/whatsapp?filtro=clientes'], ['sem_vinculo', '/whatsapp?filtro=sem_vinculo']]) {
      conferir((await p.getByTestId(`whatsapp-linha-${f}`).getAttribute('href')) === url, `a linha ${f} não abre ${url}`);
    }
    const chamada = p.getByTestId('whatsapp-sem-vinculo-chamada');
    conferir(await chamada.isVisible().catch(() => false), 'sem a chamada "Conversas sem vínculo"');
    conferir(/Conversas sem vínculo: \d+/.test(await chamada.innerText()), 'a chamada não diz quantas');
    const bolha = p.getByTestId('whatsapp-bolha');
    conferir(await esperar(async () => bolha.isVisible(), 35_000, 2000), 'a bolha de não lidas não apareceu no item WhatsApp');
    const rotulo = await bolha.getAttribute('aria-label');
    conferir(/^\d+ mensage(m|ns) não lidas? no WhatsApp$/.test(rotulo ?? ''), `aria-label da bolha: ${rotulo}`);
    await foto(p, 'dia-a-dia-whatsapp-escuro');
    await p.getByTestId('whatsapp-linha-sem_vinculo').click();
    await p.waitForURL(/\/whatsapp\?filtro=sem_vinculo/);
    await p.getByTestId('caixa-lista').waitFor();
    conferir(await itemDaLista(p, C.contato.nome).isVisible().catch(() => false), 'a caixa filtrada por Sem vínculo não mostra o 1:1 sem vínculo');
    await tresFotos({ claro, m }, '/dia-a-dia', 'dia-a-dia');
    return { detalhe: { semVinculo: n, bolha: await bolha.textContent().catch(() => null) } };
  });

  // ---------------- 05 · marcar lida ----------------
  await passo('05 · abrir a conversa marca lida: o histórico mostra a mensagem e a bolha da conversa some', async () => {
    await abrirCaixa(p);
    const item = await abrirConversa(p, C.contato.nome);
    const hist = p.getByTestId('caixa-historico');
    // O contêiner do histórico aparece antes de a conversa carregar: espera o texto.
    conferir(await esperar(async () => (await hist.innerText()).includes(texto('1:1')), 15_000, 500), 'o histórico não mostra a mensagem simulada');
    const lida = await esperar(async () => {
      const l = await listaPelaApi(tok);
      if (l) return l.conversas.find((c) => c.nome === C.contato.nome)?.naoLidas === 0;
      return !/\b\d+\b\s*$/.test((await item.innerText()).trim());
    }, 10_000, 1000);
    conferir(lida, 'a conversa aberta continua com não lidas');
    await foto(p, 'conversa-1a1-escuro');
    return {};
  });

  // ---------------- 06 · responder 1:1 ----------------
  await passo('06 · responder 1:1: o dublê recebe pelo sendText e o balão diz quem enviou', async () => {
    await abrirConversa(p, C.contato.nome);
    const resposta = texto('resposta 1:1');
    await p.getByTestId('caixa-resposta').fill(resposta);
    await p.getByTestId('caixa-enviar').click();
    const enviada = await esperar(async () => (await duble('GET', '/enviadas')).find((e) => e.text === resposta), 15_000, 1000);
    conferir(enviada, 'o dublê não recebeu a resposta 1:1');
    conferir(enviada.remoteJid === C.contato.jid, `a resposta foi para ${enviada.remoteJid}`);
    const hist = p.getByTestId('caixa-historico');
    conferir(await esperar(async () => (await hist.innerText()).includes(resposta), 10_000), 'o histórico não mostra a resposta');
    const balao = hist.getByText(resposta).last();
    const textoDoHist = await hist.innerText();
    conferir(/enviada por/i.test(textoDoHist), 'o balão da resposta não diz "enviada por"');
    if (nomeDoAdmin && !textoDoHist.includes(nomeDoAdmin.split(' ')[0])) aviso(`o balão não traz o nome de quem enviou (${nomeDoAdmin})`);
    await balao.scrollIntoViewIfNeeded().catch(() => undefined);
    await foto(p, 'resposta-1a1-escuro');
    return { detalhe: { para: enviada.number } };
  });

  // ---------------- 07 · responder grupo ----------------
  await passo('07 · responder no grupo: o dublê recebe com o JID do grupo', async () => {
    await abrirConversa(p, C.cliente.nome);
    const resposta = texto('resposta grupo');
    await p.getByTestId('caixa-resposta').fill(resposta);
    await p.getByTestId('caixa-enviar').click();
    const enviada = await esperar(async () => (await duble('GET', '/enviadas')).find((e) => e.text === resposta), 15_000, 1000);
    conferir(enviada, 'o dublê não recebeu a resposta no grupo');
    conferir(enviada.remoteJid === C.cliente.jid, `a resposta do grupo foi para ${enviada.remoteJid}`);
    const hist = p.getByTestId('caixa-historico');
    conferir(await esperar(async () => (await hist.innerText()).includes(resposta), 10_000), 'o histórico do grupo não mostra a resposta');
    // Nos grupos, o balão leva o nome do remetente.
    conferir((await hist.innerText()).includes('Pessoa Exemplo'), 'o histórico do grupo não mostra o nome de quem falou');
    await foto(p, 'resposta-grupo-escuro');
    return {};
  });

  // ---------------- 08 · vínculo por sugestão ----------------
  await passo('08 · vincular o grupo "ROOT | Rede Pão Bom" ao cliente pela sugestão, num clique', async () => {
    await abrirConversa(p, C.cliente.nome);
    const desfeito = await semVinculo(p);
    const sugestao = p.getByTestId('whats-vinculo-sugestao');
    conferir(await esperar(async () => sugestao.isVisible(), 10_000), 'sem a sugestão de vínculo no grupo do cliente');
    conferir((await sugestao.innerText()).includes(C.cliente.vinculo), `a sugestão não é "${C.cliente.vinculo}": ${await sugestao.innerText()}`);
    await foto(p, 'vinculo-sugestao-escuro');
    const botao = sugestao.getByRole('button').first();
    if (await botao.isVisible().catch(() => false)) await botao.click();
    else await sugestao.click();
    const vinculo = p.getByTestId('whats-vinculo');
    conferir(await esperar(async () => (await vinculo.innerText()).includes(C.cliente.vinculo) && !(await sugestao.isVisible().catch(() => false)), 10_000), 'o vínculo do grupo não ficou no cliente');
    await foto(p, 'vinculo-cliente-escuro');
    return { detalhe: { refeito: desfeito } };
  });

  // ---------------- 09 · vínculo à mão ----------------
  await passo(`09 · vincular o 1:1 "Contato Exemplo" à mão ao lead "${LEAD_DO_VINCULO_A_MAO}" pela busca`, async () => {
    await abrirConversa(p, C.contato.nome);
    await semVinculo(p);
    await p.getByTestId('whats-vincular-lead').click();
    const busca = p.getByTestId('whats-vinculo-busca');
    await busca.waitFor();
    await busca.fill(LEAD_DO_VINCULO_A_MAO);
    const candidato = p.locator('[data-testid^="whats-vinculo-candidato-"]').filter({ hasText: LEAD_DO_VINCULO_A_MAO }).first();
    await candidato.waitFor({ timeout: 10_000 });
    await foto(p, 'vinculo-busca-escuro');
    await candidato.click();
    const confirmar = p.getByRole('button', { name: /^(confirmar|vincular)$/i });
    if (await confirmar.isVisible().catch(() => false)) await confirmar.click();
    const vinculo = p.getByTestId('whats-vinculo');
    conferir(await esperar(async () => (await vinculo.innerText()).includes(LEAD_DO_VINCULO_A_MAO), 10_000), 'o 1:1 não ficou ligado ao lead');
    // Ligado a lead, sai de "Sem vínculo" e entra em "Leads".
    await clicarFiltro(p, 'leads');
    conferir(await itemDaLista(p, C.contato.nome).isVisible().catch(() => false), 'o 1:1 vinculado não aparece no filtro Leads');
    await clicarFiltro(p, 'sem_vinculo');
    conferir(!(await itemDaLista(p, C.contato.nome).isVisible().catch(() => false)), 'o 1:1 vinculado continua em Sem vínculo');
    return {};
  });

  // ---------------- 10 · aba do lead ----------------
  await passo('10 · a aba WhatsApp do painel do lead mostra a conversa ligada, com link para a caixa', async () => {
    const leads = await api('GET', '/leads', undefined, tok);
    const lead = (Array.isArray(leads) ? leads : leads.items ?? leads.leads ?? []).find((l) => l.name === LEAD_DO_VINCULO_A_MAO);
    conferir(lead, `o lead "${LEAD_DO_VINCULO_A_MAO}" não está no seed`);
    await p.goto(`${WEB}/comercial/funil?lead=${encodeURIComponent(lead.id)}&aba=whatsapp`, { waitUntil: 'networkidle' });
    const aba = p.getByRole('tab', { name: /whatsapp/i });
    await aba.waitFor({ timeout: 15_000 });
    if ((await aba.getAttribute('aria-selected')) !== 'true') await aba.click();
    const painel = p.getByRole('tabpanel').filter({ hasText: C.contato.nome }).first();
    conferir(await esperar(async () => painel.isVisible(), 10_000), 'a aba WhatsApp do lead não mostra a conversa ligada');
    conferir(await painel.locator('a[href*="/whatsapp"]').count() > 0, 'a aba WhatsApp do lead não leva à caixa');
    await foto(p, 'lead-aba-whatsapp-escuro');
    await tresFotos({ claro, m }, `/comercial/funil?lead=${encodeURIComponent(lead.id)}&aba=whatsapp`, 'lead-aba-whatsapp');
    return { detalhe: { lead: lead.id.slice(0, 8) } };
  });

  // ---------------- 11 · ficha do cliente ----------------
  await passo('11 · o bloco WhatsApp da ficha do cliente mostra o grupo ligado e as últimas mensagens', async () => {
    await abrirConversa(p, C.cliente.nome);
    const link = p.getByTestId('whats-vinculo-link');
    conferir(await link.waitFor({ timeout: 15_000 }).then(() => true, () => false), 'o cabeçalho do vínculo não tem link para a ficha do cliente');
    await link.click();
    const ficha = p.getByRole('dialog', { name: 'Ficha do cliente' });
    const naFicha = await esperar(async () => {
      const alvo = (await ficha.isVisible().catch(() => false)) ? ficha : p.locator('main');
      const t = await alvo.innerText();
      return /WhatsApp/.test(t) && t.includes(C.cliente.nome) ? alvo : null;
    }, 15_000, 1000);
    conferir(naFicha, 'a ficha do cliente não mostra o bloco WhatsApp com o grupo ligado');
    const t = await naFicha.innerText();
    if (!t.includes(carimbo)) aviso('o bloco WhatsApp da ficha não mostra a mensagem desta rodada entre as últimas');
    await foto(p, 'ficha-cliente-whatsapp-escuro');
    return {};
  });

  // ---------------- 12 · arquivar ----------------
  await passo('12 · arquivar a conversa: some de Todas, aparece em Arquivadas; desarquivar volta', async () => {
    await abrirCaixa(p);
    await abrirConversa(p, C.semPrefixo.nome);
    await p.getByTestId('caixa-arquivar').click();
    await p.waitForLoadState('networkidle');
    await clicarFiltro(p, 'todas');
    conferir(await esperar(async () => !(await itemDaLista(p, C.semPrefixo.nome).isVisible().catch(() => false)), 8000), 'a conversa arquivada continua em Todas');
    await clicarFiltro(p, 'arquivadas');
    conferir(await itemDaLista(p, C.semPrefixo.nome).isVisible().catch(() => false), 'a conversa arquivada não aparece em Arquivadas');
    await foto(p, 'caixa-arquivadas-escuro');
    await itemDaLista(p, C.semPrefixo.nome).click();
    await p.getByTestId('caixa-historico').waitFor();
    await p.getByTestId('caixa-arquivar').click();
    await p.waitForLoadState('networkidle');
    await clicarFiltro(p, 'todas');
    conferir(await esperar(async () => itemDaLista(p, C.semPrefixo.nome).isVisible(), 8000), 'desarquivar não devolveu a conversa a Todas');
    return {};
  });

  // ---------------- 13 · @lid ----------------
  await passo('13 · o 1:1 no modo @lid aparece como uma conversa só, com o número real', async () => {
    await abrirCaixa(p);
    const n = await p.locator('[data-testid^="caixa-conversa-"]').filter({ hasText: C.lid.nome }).count();
    conferir(n === 1, `o contato @lid aparece ${n} vezes na lista`);
    await abrirConversa(p, C.lid.nome);
    conferir(await esperar(async () => (await p.getByTestId('caixa-historico').innerText()).includes(texto('lid')), 15_000, 500), 'o histórico do @lid não mostra a mensagem do webhook');
    // O número real (fictício) do @lid, em qualquer formatação: só os dígitos da tela.
    const digitos = (await p.locator('main').innerText()).replace(/\D/g, '');
    if (!digitos.includes(C.lid.numero.slice(2))) aviso('a conversa @lid não mostra o número real na tela (conferir o cabeçalho)');
    await foto(p, 'conversa-lid-escuro');
    return {};
  });

  // ---------------- 14 · equipe ----------------
  await passo('14 · o grupo da equipe fica no chip Equipe, sem vínculo de cliente e fora de Sem vínculo', async () => {
    await abrirCaixa(p, 'sem_vinculo');
    conferir(!(await itemDaLista(p, C.equipe.nome).isVisible().catch(() => false)), 'o grupo da equipe aparece em Sem vínculo');
    await clicarFiltro(p, 'equipe');
    await abrirConversa(p, C.equipe.nome);
    conferir(!(await p.getByTestId('whats-vinculo-sugestao').isVisible().catch(() => false)), 'o grupo da equipe ganhou sugestão de vínculo');
    return {};
  });

  // ---------------- 15 · simulador ----------------
  await passo('15 · o simulador de celulares mudou para /whatsapp/simulador e continua de pé', async () => {
    await p.goto(`${WEB}/whatsapp/simulador`, { waitUntil: 'networkidle' });
    const ok = await esperar(async () => (await p.getByTestId('whats-lista').isVisible().catch(() => false)) || (await p.getByTestId('whats-atendimento').isVisible().catch(() => false)), 15_000);
    conferir(ok, 'o simulador não abriu em /whatsapp/simulador');
    await tresFotos(telas, '/whatsapp/simulador', 'simulador');
    return {};
  });

  // ---------------- 16 · 390 px ----------------
  await passo('16 · a caixa a 390 px: lista e conversa em telas separadas, com Voltar, sem rolagem lateral', async () => {
    await m.goto(`${WEB}/whatsapp`, { waitUntil: 'networkidle' });
    await m.getByTestId('caixa-lista').waitFor();
    conferir(await semRolagemLateral(m), 'a lista rola de lado a 390');
    await foto(m, 'caixa-lista-390');
    await itemDaLista(m, C.cliente.nome).click();
    await m.getByTestId('caixa-historico').waitFor();
    conferir(!(await m.getByTestId('caixa-lista').isVisible().catch(() => false)), 'a 390 px a lista continua visível com a conversa aberta');
    conferir(await semRolagemLateral(m), 'a conversa rola de lado a 390');
    await foto(m, 'caixa-conversa-390');
    await m.getByTestId('caixa-voltar').click();
    conferir(await esperar(async () => m.getByTestId('caixa-lista').isVisible(), 8000), 'Voltar não devolveu a lista');
    await claro.goto(`${WEB}/whatsapp`, { waitUntil: 'networkidle' });
    await claro.getByTestId('caixa-lista').waitFor();
    await itemDaLista(claro, C.cliente.nome).click();
    await claro.getByTestId('caixa-historico').waitFor();
    await foto(claro, 'caixa-conversa-claro');
    return {};
  });

  // ---------------- 17 · Dia a dia depois de ler ----------------
  await passo('17 · depois de ler, o Dia a dia e a bolha descem (o resumo é medido de novo em até 30 s)', async () => {
    const antes = prova.passos.find((x) => x.nome.startsWith('04'))?.detalhe?.semVinculo ?? null;
    let depois = null;
    await esperar(async () => {
      await p.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
      await p.getByTestId('dia-a-dia-whatsapp').waitFor({ timeout: 10_000 });
      const linha = p.getByTestId('whatsapp-linha-sem_vinculo');
      if (await p.getByTestId('whatsapp-nada-novo').isVisible().catch(() => false)) { depois = 0; return true; }
      if (!(await linha.isVisible().catch(() => false))) return false;
      depois = Number(/(\d+)\s*não lida/.exec(await linha.innerText())?.[1] ?? 0);
      return antes === null || depois < antes;
    }, 40_000, 5000);
    conferir(antes === null || (depois !== null && depois < antes), `as não lidas sem vínculo não desceram: antes ${antes}, depois ${depois}`);
    await foto(p, 'dia-a-dia-depois-escuro');
    return { detalhe: { antes, depois } };
  });

  if (erros.length) aviso(`erros de página: ${erros.slice(0, 3).join(' | ')}`);
  prova.webhooks = (await duble('GET', '/webhooks').catch(() => [])).map((w) => ({ status: w.status, erro: w.erro }));
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
