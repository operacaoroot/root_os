#!/usr/bin/env node
/*
 * A PROVA DA RODADA DE PRODUÇÃO 2 (22/10/2026, melhorias), CONTRA A STACK DO SEED EM DOCKER.
 *
 * Mesmo arranjo do `producao21.mjs`: Playwright (Chromium) de `UX_PW` (padrão
 * `C:/Users/User/dev/pw-tools`), o web em `UX_WEB` (padrão 3031), a API em `UX_API`
 * (padrão 4031), a senha lida de `HOMOLOG_ENV` em tempo de execução (nunca copiada).
 *
 * O que ela prova (docs/comercial/RODADA-PRODUCAO-20261022.md, M6):
 *   M1 cartão da Implantação com a reunião (a stack não tem Google: o painel diz
 *      "Agenda indisponível") e o selo da fase do trilho; "Pedir agora" leva à bancada
 *      no ponto certo; limite pelo menu da coluna marca a coluna e sai; o cartão
 *      "Implantação" na Visão geral leva à Implantação com o filtro;
 *   M2 anexar o PDF de um contrato importado (o aviso some) e lançar as parcelas à mão,
 *      com a régua desligada (e ligada pelo clique de gente com a frase);
 *   M3 Arquivadas e Desarquivar; arrastar pasta para dentro de pasta; o "+ tarefa" do
 *      Comercial recusa título repetido.
 * E fotografa (escuro, claro e 390 px) cada tela tocada.
 *
 * ESCREVE na stack (só dado fictício do seed): limite de uma etapa (posto e tirado),
 * pastas, listas e tarefas "e2e 22 …", o PDF e as parcelas de um contrato importado
 * fictício (`LEAD_IMPORTADO`, semeado antes por `producao22-semente.cjs`) e duas
 * tarefas do comercial.
 *
 * Saída: `homolog/provas/<PROVAS_PREFIXO>producao22.json` e `producao22-*.png`.
 * Uso (Git Bash): LEAD_IMPORTADO=<id> node homolog/e2e/producao22.mjs
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
const LEAD_IMPORTADO = process.env.LEAD_IMPORTADO ?? '';

const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], avisos: [], ok: false };
const t0 = Date.now();

function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  writeFileSync(join(PROVAS, `${PREFIXO}producao22.json`), `${JSON.stringify(prova, null, 2)}\n`);
}
function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** `SO=M2,M3` roda só os passos com esses prefixos (depuração); a prova vale com todos. */
const SO = (process.env.SO ?? '').split(',').map((x) => x.trim()).filter(Boolean);
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
  const arquivo = `${PREFIXO}producao22-${nome}.png`;
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

/** Um PDF mínimo e válido o bastante para o conferente de `%PDF-` (fictício). */
function pdfDeProva() {
  return Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');
}

async function main() {
  const navegador = await chromium.launch();
  const sessao = await entrar(EMAIL);
  conferir(sessao.token, 'o login não devolveu token');
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
  const carimbo = Date.now().toString(36);
  const nome = (s) => `e2e 22 ${s} ${carimbo}`;
  const estrutura = () => api('GET', '/trabalho/estrutura', undefined, sessao.token);

  // ---------------- M1 · Implantação ----------------
  await passo('M1 · Implantação: o cartão mostra o selo da fase quando diverge; o painel diz da agenda e da fase', async () => {
    await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    const cartoes = p.locator('[data-work-task-id]');
    await cartoes.first().waitFor();
    const n = await cartoes.count();
    const selos = await p.getByTestId('cartao-selo-fase').count();
    const reunioes = await p.getByTestId('cartao-reuniao').count();
    if (!selos) aviso('nenhum cartão do seed tem etapa e fase do trilho divergentes: o selo não aparece');
    await foto(p, 'implantacao-quadro-escuro');
    // Abre um cartão com trilho (de preferência o do selo).
    const alvo = selos ? p.locator('[data-work-task-id]').filter({ has: p.getByTestId('cartao-selo-fase') }).first() : cartoes.first();
    await alvo.click();
    const painel = p.getByTestId('painel-implantacao');
    await painel.waitFor({ timeout: 15_000 });
    const agenda = await p.getByTestId('painel-reuniao').getAttribute('data-agenda').catch(() => null);
    const textoPainel = (await painel.innerText()).replace(/\s+/g, ' ');
    if (selos) conferir(await p.getByTestId('painel-fase-diverge').count(), 'o cartão tem selo e o painel não diz a divergência');
    await foto(p, 'implantacao-painel-escuro');
    return { detalhe: { cartoes: n, selos, reunioes, agenda, indisponivel: /Agenda indisponível/.test(textoPainel) } };
  });

  await passo('M1 · "Pedir agora": cada agente tem o botão (ou a razão), e o link leva à bancada no ponto certo', async () => {
    const quem = p.getByTestId('quem-trabalha');
    await quem.waitFor({ timeout: 15_000 });
    await quem.scrollIntoViewIfNeeded();
    const botoes = quem.locator('[data-testid^="pedir-agora-"]:not([data-testid^="pedir-agora-razao-"])');
    const nb = await botoes.count();
    conferir(nb > 0, 'nenhum "Pedir agora" no painel');
    const razoes = await quem.locator('[data-testid^="pedir-agora-razao-"]').count();
    await foto(p, 'implantacao-pedir-agora-escuro');
    const link = quem.locator('a[data-testid^="pedir-agora-"]').first();
    let destino = null;
    if (await link.count()) {
      const href = await link.getAttribute('href');
      await link.click();
      await p.waitForURL(/\/onboarding\//, { timeout: 15_000 });
      destino = new URL(p.url()).pathname + new URL(p.url()).search;
      conferir(/\/onboarding\/[^/?]+/.test(destino) && (/foco=/.test(destino) || /roteiro/.test(destino)), `o link foi a ${destino}`);
      await p.waitForLoadState('networkidle');
      await foto(p, 'bancada-pedir-agora-escuro');
      return { detalhe: { botoes: nb, razoes, href, destino } };
    }
    aviso('todos os "Pedir agora" do cartão aberto estão desabilitados (a razão está na tela)');
    return { detalhe: { botoes: nb, razoes } };
  });

  await passo('M1 · limite pelo menu da coluna: define, a coluna fica marcada, e tira', async () => {
    await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    const menus = p.locator('[data-testid^="coluna-menu-"]:not([data-testid="coluna-menu-limite"])');
    await menus.first().waitFor();
    // A coluna com mais cartões (para o limite de 1 marcar).
    const ids = (await menus.evaluateAll((ms) => ms.map((m) => m.getAttribute('data-testid')))).map((t) => t.replace('coluna-menu-', '')).filter((t) => t && t !== 'limite');
    conferir(ids.length, 'nenhum menu de coluna');
    const statusId = ids[0];
    await p.getByTestId(`coluna-menu-${statusId}`).click();
    await p.getByTestId('coluna-menu-limite').click();
    await p.getByTestId('coluna-limite-input').fill('1');
    await foto(p, 'implantacao-limite-menu-escuro');
    await p.getByTestId('coluna-limite-salvar').click();
    const marca = await esperar(async () => {
      const el = p.locator('[data-estado-limite]').first();
      return (await el.count()) ? el.getAttribute('data-estado-limite') : null;
    });
    conferir(marca, 'a coluna não ganhou a marca do limite');
    await foto(p, 'implantacao-limite-marcado-escuro');
    await claro.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    await foto(claro, 'implantacao-limite-claro');
    // Tira o limite (nenhum número fica definido nesta rodada).
    await p.getByTestId(`coluna-menu-${statusId}`).click();
    await p.getByTestId('coluna-menu-limite').click();
    await p.getByTestId('coluna-limite-tirar').click();
    const saiu = await esperar(async () => (await p.locator('[data-estado-limite]').count()) === 0);
    conferir(saiu, 'tirar o limite não tirou a marca');
    await m.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    await foto(m, 'implantacao-390');
    return { detalhe: { marca, pagina390SemRolagem: await semRolagemLateral(m) } };
  });

  await passo('M1 · Dia a dia › Visão geral: o cartão "Implantação" e a linha leva à Implantação com o filtro', async () => {
    await p.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    const cartao = p.getByTestId('dia-a-dia-implantacao');
    await cartao.waitFor();
    await cartao.scrollIntoViewIfNeeded();
    await foto(p, 'dia-a-dia-implantacao-escuro');
    const emDia = await p.getByTestId('implantacao-em-dia').count();
    const link = cartao.locator('a[data-testid^="implantacao-linha-"]').first();
    let filtro = null;
    if (await link.count()) {
      await link.click();
      await p.waitForURL(/pendencia=/, { timeout: 15_000 });
      const faixa = p.getByTestId('implantacao-filtro-pendencia');
      await faixa.waitFor();
      filtro = await faixa.getAttribute('data-pendencia');
      await foto(p, 'implantacao-filtro-escuro');
    } else if (!emDia) aviso('o cartão não tem linha com link nem "em dia"');
    await claro.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    await claro.getByTestId('dia-a-dia-implantacao').scrollIntoViewIfNeeded();
    await foto(claro, 'dia-a-dia-implantacao-claro');
    await m.goto(`${WEB}/dia-a-dia`, { waitUntil: 'networkidle' });
    await m.getByTestId('dia-a-dia-implantacao').scrollIntoViewIfNeeded();
    await foto(m, 'dia-a-dia-implantacao-390');
    conferir(await semRolagemLateral(m), 'o Dia a dia rola de lado a 390');
    return { detalhe: { emDia: !!emDia, filtro } };
  });

  // ---------------- M2 · Contrato importado ----------------
  await passo('M2 · Contratos vivos: anexar o PDF do contrato importado e o aviso some', async () => {
    conferir(LEAD_IMPORTADO, 'falta LEAD_IMPORTADO (rode producao22-semente.cjs antes)');
    await p.goto(`${WEB}/comercial/contratos`, { waitUntil: 'networkidle' });
    const item = p.locator('li[data-testid="contrato-importado"]').filter({ has: p.getByTestId('contrato-importado-anexar') }).first();
    await item.waitFor();
    const avisoAntes = await item.getByTestId('contratos-importados-aviso').count().catch(() => 0);
    await foto(p, 'contratos-importado-antes-escuro');
    await item.getByTestId('contrato-importado-anexo-input').setInputFiles({ name: 'contrato-exemplo.pdf', mimeType: 'application/pdf', buffer: pdfDeProva() });
    // A stack do seed não tem storage (MinIO): a API recusa com a frase e nada é gravado pela metade.
    // O caminho com armazém (fato, aviso que some, versão, idempotência) é a suíte comercial-contrato-importado.
    const resultado = await esperar(async () => {
      if (await item.getByTestId('contrato-importado-anexo').count()) return 'anexado';
      const t = (await item.innerText()).replace(/\s+/g, ' ');
      return /indisponível agora: nada foi anexado/.test(t) ? 'sem-storage' : null;
    }, 15_000);
    conferir(resultado, 'nem o anexo nem a recusa legível apareceram');
    let anexo = null;
    if (resultado === 'anexado') {
      anexo = (await item.getByTestId('contrato-importado-anexo').innerText()).replace(/\s+/g, ' ');
      conferir(/contrato-exemplo\.pdf/.test(anexo), `o anexo diz: ${anexo}`);
    } else {
      aviso('a stack não tem storage: o anexo foi recusado com a frase e nada foi gravado (caminho com armazém provado na suíte da API)');
      conferir(await item.getByTestId('contrato-importado-sem-pdf').count(), 'o contrato deixou de dizer "Sem o PDF assinado" sem ter PDF');
      const lista = await api('GET', '/comercial/contratos', undefined, sessao.token);
      const meu = (Array.isArray(lista) ? lista : []).find((c) => c.leadId === LEAD_IMPORTADO);
      conferir(meu && !(meu.importados ?? []).some((c) => c.anexo), 'um anexo foi gravado sem storage');
    }
    await foto(p, 'contratos-importado-anexado-escuro');
    await claro.goto(`${WEB}/comercial/contratos`, { waitUntil: 'networkidle' });
    await foto(claro, 'contratos-importado-claro');
    await m.goto(`${WEB}/comercial/contratos`, { waitUntil: 'networkidle' });
    await foto(m, 'contratos-importado-390');
    conferir(await semRolagemLateral(m), 'Contratos vivos rola de lado a 390');
    return { detalhe: { avisoAntes, resultado, anexo: anexo ? anexo.slice(0, 80) : null } };
  });

  await passo('M2 · painel do lead: lançar as parcelas à mão (série mensal), a soma aparece, a régua segue desligada', async () => {
    await p.goto(`${WEB}/comercial/funil?lead=${encodeURIComponent(LEAD_IMPORTADO)}&aba=dinheiro`, { waitUntil: 'networkidle' });
    const bloco = p.getByTestId('parcelas-do-importado');
    await bloco.waitFor({ timeout: 20_000 });
    await bloco.scrollIntoViewIfNeeded();
    if (await p.getByTestId('parcelas-editar').count()) await p.getByTestId('parcelas-editar').click();
    await p.getByTestId('parcelas-serie-quantidade').fill('3');
    await p.getByTestId('parcelas-serie-valor').fill('1000,00');
    const venc = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await p.getByTestId('parcelas-serie-vencimento').fill(venc);
    await p.getByTestId('parcelas-gerar').click();
    await foto(p, 'parcelas-editando-escuro');
    await p.getByTestId('parcelas-salvar').click();
    await p.getByTestId('parcelas-lista').waitFor({ timeout: 15_000 });
    const soma = (await p.getByTestId('parcelas-soma').innerText()).replace(/\s+/g, ' ');
    conferir(/R\$\s?3\.000(,00)?\b/.test(soma), `a soma diz: ${soma}`);
    const ligada = await p.getByTestId('regua-do-importado-estado').getAttribute('data-ligada');
    conferir(ligada === 'nao', `a régua do importado nasceu ${ligada}`);
    await foto(p, 'parcelas-salvas-escuro');
    return { detalhe: { soma, regua: ligada } };
  });

  await passo('M2 · ligar a régua deste contrato: a frase, a ciência e a confirmação de gente', async () => {
    await p.getByTestId('regua-do-importado-ligar').click();
    const frase = (await p.getByTestId('regua-do-importado-frase').innerText()).replace(/\s+/g, ' ');
    await p.getByTestId('regua-do-importado-ciente').check();
    await foto(p, 'regua-frase-escuro');
    await p.getByTestId('regua-do-importado-confirmar').click();
    const ligou = await esperar(async () => (await p.getByTestId('regua-do-importado-estado').getAttribute('data-ligada')) === 'sim', 15_000);
    conferir(ligou, 'a régua não ligou');
    const editar = await p.getByTestId('parcelas-editar').count();
    await claro.goto(`${WEB}/comercial/funil?lead=${encodeURIComponent(LEAD_IMPORTADO)}&aba=dinheiro`, { waitUntil: 'networkidle' });
    await claro.getByTestId('parcelas-do-importado').scrollIntoViewIfNeeded();
    await foto(claro, 'parcelas-claro');
    await m.goto(`${WEB}/comercial/funil?lead=${encodeURIComponent(LEAD_IMPORTADO)}&aba=dinheiro`, { waitUntil: 'networkidle' });
    await m.getByTestId('parcelas-do-importado').scrollIntoViewIfNeeded();
    await foto(m, 'parcelas-390');
    return { detalhe: { frase: frase.slice(0, 120), editarDepoisDeLigar: editar } };
  });

  // ---------------- M3 · Trabalho ----------------
  await passo('M3 · Arquivadas: a lista arquivada aparece com quem e quando, e "Desarquivar" a devolve à pasta', async () => {
    const pasta = await api('POST', '/trabalho/pastas', { name: nome('pasta arq') }, sessao.token);
    const lista = await api('POST', '/trabalho/listas', { name: nome('lista arq'), folderId: pasta.id }, sessao.token);
    await api('POST', '/trabalho/tarefas', { listId: lista.id, title: nome('tarefa arq'), clienteId: 'interno' }, sessao.token);
    await api('POST', `/trabalho/listas/${lista.id}/arquivar-tarefas`, { esperadas: 1 }, sessao.token);
    await api('DELETE', `/trabalho/listas/${lista.id}`, { confirmarNome: nome('lista arq') }, sessao.token);
    const arquivadas = await api('GET', '/trabalho/arquivadas', undefined, sessao.token);
    conferir(JSON.stringify(arquivadas).includes(lista.id), 'a lista não ficou arquivada');
    await p.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    const alternar = p.getByTestId('trabalho-arquivadas-alternar');
    await alternar.waitFor();
    const rotulo = (await alternar.innerText()).trim();
    await alternar.click();
    const item = p.getByTestId(`trabalho-arquivada-lista-${lista.id}`);
    await item.waitFor();
    const texto = (await item.innerText()).replace(/\s+/g, ' ');
    await foto(p, 'arquivadas-escuro');
    await claro.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    await claro.getByTestId('trabalho-arquivadas-alternar').click();
    await foto(claro, 'arquivadas-claro');
    await p.getByTestId(`trabalho-desarquivar-lista-${lista.id}`).click();
    const voltou = await esperar(async () => (await estrutura()).folders.find((f) => f.id === pasta.id)?.lists.some((l) => l.id === lista.id), 10_000);
    conferir(voltou, 'a lista não voltou à pasta');
    await p.getByTestId(`trabalho-arvore-lista-${lista.id}`).waitFor();
    return { detalhe: { rotulo, item: texto.slice(0, 120) } };
  });

  await passo('M3 · arrastar pasta para dentro de outra pasta (e o nível volta pela API)', async () => {
    const a = await api('POST', '/trabalho/pastas', { name: nome('pasta a') }, sessao.token);
    const b = await api('POST', '/trabalho/pastas', { name: nome('pasta b') }, sessao.token);
    await p.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    const origem = p.getByTestId(`trabalho-arvore-pasta-${a.id}`);
    const destino = p.getByTestId(`trabalho-arvore-pasta-${b.id}`).locator('xpath=..');
    await origem.dragTo(destino);
    const dentro = await esperar(async () => (await estrutura()).folders.find((f) => f.id === a.id)?.parentId === b.id, 10_000);
    conferir(dentro, 'arrastar a pasta não a pôs dentro da outra');
    await p.reload({ waitUntil: 'networkidle' });
    await foto(p, 'arvore-pasta-dentro-escuro');
    await m.goto(`${WEB}/trabalho`, { waitUntil: 'networkidle' });
    await foto(m, 'arvore-390');
    // Ciclo: a mãe não entra na filha (a API recusa).
    const ciclo = await http('POST', `${API}/trabalho/pastas/${b.id}/mover`, { parentId: a.id }, sessao.token);
    conferir(ciclo.status === 400 || ciclo.status === 409, `mover a mãe para dentro da filha deu ${ciclo.status}`);
    return { detalhe: { ciclo: ciclo.status, pagina390SemRolagem: await semRolagemLateral(m) } };
  });

  await passo('M3 · "+ tarefa" do Comercial recusa o título repetido, com a frase do Dia a dia', async () => {
    await p.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
    const bloco = p.getByTestId('funil-tarefas-do-comercial');
    await bloco.waitFor();
    const alternar = p.getByTestId('funil-tarefas-alternar');
    if ((await alternar.getAttribute('aria-expanded')) !== 'true') await alternar.click();
    const criar = async () => {
      await p.getByTestId('funil-tarefas-mais').click();
      const titulo = p.getByTestId('funil-tarefas-nova-titulo');
      await titulo.fill(nome('tarefa repetida'));
      await titulo.press('Enter');
    };
    await criar();
    await bloco.locator('li[data-testid^="tarefa-"]').filter({ hasText: nome('tarefa repetida') }).first().waitFor();
    await criar();
    const alerta = p.getByTestId('funil-tarefas-nova').locator('[role="alert"]');
    await alerta.waitFor({ timeout: 10_000 });
    const frase = (await alerta.innerText()).trim();
    conferir(/Essa tarefa já existe/.test(frase), `a recusa veio: ${frase}`);
    await foto(p, 'funil-tarefa-repetida-escuro');
    const mesma = await bloco.locator('li[data-testid^="tarefa-"]').filter({ hasText: nome('tarefa repetida') }).count();
    conferir(mesma === 1, `ficaram ${mesma} tarefas com o mesmo título`);
    return { detalhe: { frase } };
  });

  conferir(!erros.length, `erros de página: ${erros.slice(0, 3).join(' | ')}`);
  await navegador.close();
}

main()
  .then(() => {
    prova.ok = !prova.pulados;
    gravar();
    console.log(`\nPASSA · ${prova.passos.length} passos · ${Math.round((Date.now() - t0) / 1000)} s`);
  })
  .catch((e) => {
    prova.erro = String(e?.message ?? e);
    gravar();
    console.error(`\nFALHA · ${prova.erro}`);
    process.exit(1);
  });
