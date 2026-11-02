#!/usr/bin/env node
/*
 * A PROVA DA ÁREA DO CLIENTE (leva A, 30/10/2026), CONTRA O AMBIENTE DE TESTE DA VPS.
 *
 * Mesmo arranjo do `leva5.mjs`: Playwright da pasta de ferramentas (`UX_PW`), alvo a cópia
 * do banco da produção que o script de teste sobe na VPS (web e api só no IP interno),
 * alcançada do Mac por túnel ssh:
 *   ssh -N -L 4160:172.16.0.1:4160 -L 4161:172.16.0.1:4161 root-vps
 * Login com o usuário de teste (senha em AREA_SENHA, e-mail em AREA_EMAIL).
 *
 * O que ela prova (docs/comercial/RODADA-AREA-DO-CLIENTE-20261030.md):
 *   A1  Dois leads: um em andamento abre a sala de sempre (`sala-publicada` ou a casca); um
 *       fechado (ou com card da implantação) abre a ÁREA com 15 slots, escopo e dúvidas
 *       preenchidos, os outros vazios dizendo a fase.
 *   A2  Publicar UM item (uma ata) pela bancada: o rascunho grava, publicar fica retido (R3),
 *       a versão da sala não muda, e /atendimento mostra o cartão do item.
 *   A3  (com a liberação feita à mão por outra pessoa, ou pulada) abrir o item no link grava a
 *       leitura: o "novo" some e a bancada mostra "lido".
 *   A4  A aba "Área do cliente" no painel do lead e o chip "área N/15" em Clientes ativos.
 * E fotografa a área em escuro, claro e 390 px, conferindo que não rola na horizontal.
 *
 * Escreve no ambiente de teste (nunca na produção): um rascunho e um pedido de publicação
 * de item (retido) e uma leitura. Nada mais.
 *
 * Saída: `homolog/provas/area-do-cliente.json` e `homolog/provas/area-do-cliente-*.png`.
 * Uso: AREA_SENHA=… UX_PW=… node homolog/e2e/area-do-cliente.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4161/api';
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:4160';
const PW = process.env.UX_PW ?? join(RAIZ, '../pw-tools');
const EMAIL = process.env.AREA_EMAIL ?? process.env.LEVA5_EMAIL ?? 'teste-leva5@root.test';
const SENHA = process.env.AREA_SENHA ?? process.env.LEVA5_SENHA;
if (!SENHA) {
  console.error('AREA_SENHA ausente (senha do usuário de teste do ambiente da VPS)');
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
  writeFileSync(join(PROVAS, 'area-do-cliente.json'), `${JSON.stringify(prova, null, 2)}\n`);
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
  const arquivo = `area-do-cliente-${nome}.png`;
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

/** O link em claro da sala (a rota de copiar, auditada), ou nulo quando a chave não abre o token. */
async function linkDaSala(leadId, token) {
  try {
    const r = await api('POST', `/comercial/lead/${leadId}/sala/link`, {}, token);
    return r.link ?? null;
  } catch {
    return null;
  }
}

const navegador = await chromium.launch();
try {
  const sessao = await entrar();
  conferir(sessao.token, 'login sem token');
  passo('login do usuário de teste', { detalhe: EMAIL });

  // ---------- A4 · Clientes ativos: um lead em modo área e um em modo sala ----------
  const lista = await api('GET', '/comercial/clientes-ativos', undefined, sessao.token);
  const emArea = lista.clientes.filter((c) => c.area && c.funil);
  const emSala = lista.clientes.filter((c) => !c.area && c.funil);
  conferir(emArea.length > 0, 'nenhum cliente em modo área (fechado ou com card da implantação) na cópia do banco');
  passo('A4 · clientes ativos trazem `area` para quem está em modo área', { detalhe: `${emArea.length} em área · ${emSala.length} em sala` });

  // Escolhe o lead em área com link legível; o primeiro em sala serve de contraste.
  let leadArea = null;
  let linkArea = null;
  for (const c of emArea.slice(0, 15)) {
    const link = await linkDaSala(c.funil.leadId, sessao.token);
    if (link) {
      leadArea = c;
      linkArea = link;
      break;
    }
  }
  conferir(leadArea && linkArea, 'nenhum lead em área com link da sala legível (chave de cifra)');
  const tokenArea = linkArea.split('/s/')[1];

  // ---------- A1 · a bancada diz modo área e 15 slots ----------
  const bancada = await api('GET', `/comercial/lead/${leadArea.funil.leadId}/area`, undefined, sessao.token);
  conferir(bancada.modo === 'area', `bancada do lead em área diz modo ${bancada.modo}`);
  conferir(bancada.itens.length === 15, `bancada com ${bancada.itens.length} itens`);
  const por = Object.fromEntries(bancada.itens.map((i) => [i.id, i]));
  conferir(por.duvidas.estado === 'derivado', `dúvidas deveria ser derivado, é ${por.duvidas.estado}`);
  passo('A1 · GET /comercial/lead/:id/area: modo área, 15 slots', { detalhe: `${bancada.noAr}/15 no ar · escopo ${por.escopo.estado} · contrato ${por.contrato.estado}` });

  if (emSala.length) {
    const b2 = await api('GET', `/comercial/lead/${emSala[0].funil.leadId}/area`, undefined, sessao.token);
    conferir(b2.modo === 'sala', `lead em andamento deveria estar em modo sala, está em ${b2.modo}`);
    passo('A1 · lead em andamento continua em modo sala na bancada', { detalhe: emSala[0].funil.leadId.slice(0, 8) });
  }

  // ---------- A1 · o link do cliente abre a área ----------
  const estadoPublico = await api('GET', `/sala/${tokenArea}`);
  conferir(estadoPublico.modo === 'area' && estadoPublico.area, 'GET /sala/:token não devolveu a área');
  const slots = estadoPublico.area.blocos.flatMap((b) => b.itens);
  conferir(slots.length === 15, `a área pública tem ${slots.length} slots`);
  conferir(slots.filter((i) => i.estado === 'vazio').every((i) => i.chegaNaFase?.nome), 'slot vazio sem a fase em que chega');
  passo('A1 · GET /sala/:token em modo área: 15 slots, os vazios dizem a fase', { detalhe: `${estadoPublico.area.noAr}/15 · fase atual ${estadoPublico.area.fase.atual}` });

  // ---------- A2 · publicar um item pela bancada (retido, R3) ----------
  const antes = await api('GET', `/comercial/lead/${leadArea.funil.leadId}/sala/versoes`, undefined, sessao.token);
  const rascunho = { resumo: `Ata da prova e2e de ${new Date().toISOString().slice(0, 10)}`, topicos: ['Combinado: nada muda na produção', 'Próximo passo: liberar em Aprovações'], quando: new Date().toISOString().slice(0, 10) };
  const v1 = await api('PUT', `/comercial/lead/${leadArea.funil.leadId}/area/atas/rascunho`, rascunho, sessao.token);
  conferir(v1.rascunho.estado === 'rascunho' && v1.rascunho.escrito?.resumo === rascunho.resumo, 'o rascunho da ata não gravou');
  const pub = await api('POST', `/comercial/lead/${leadArea.funil.leadId}/area/atas/publicar`, {}, sessao.token);
  conferir(pub.estado === 'na_porta' && pub.approvalId, `publicar a ata deveria ficar retido (R3); veio ${pub.estado}`);
  const depois = await api('GET', `/comercial/lead/${leadArea.funil.leadId}/sala/versoes`, undefined, sessao.token);
  conferir((depois.publicada?.versao ?? null) === (antes.publicada?.versao ?? null), 'publicar um item mexeu na versão da sala');
  passo('A2 · rascunho da ata gravado e publicação retida (R3), sem tocar na versão da sala', { detalhe: `v${pub.rascunho.versao} · aprovação ${pub.approvalId.slice(0, 8)}` });

  const conteudo = await api('GET', `/comercial/lead/${leadArea.funil.leadId}/sala/v/${pub.rascunho.versao}/conteudo`, undefined, sessao.token).catch(() => null);
  if (conteudo) {
    conferir(conteudo.item === 'atas' && conteudo.confere, 'a rota de conteúdo não diz que a versão é da ata, ou o hash não confere');
    passo('A2 · a rota de conteúdo da liberação diz o item e confere o hash', { detalhe: `${conteudo.titulo} · ${conteudo.hashDeAgora.slice(0, 12)}` });
  } else {
    passo('A2 · rota de conteúdo pede `aprovacoes.decidir` (o usuário de teste não tem): pulada');
  }

  // Erro esperado: item derivado não se escreve.
  let recusou = false;
  try {
    await api('PUT', `/comercial/lead/${leadArea.funil.leadId}/area/contrato/rascunho`, { resumo: 'x' }, sessao.token);
  } catch (e) {
    recusou = /400/.test(String(e.message));
  }
  conferir(recusou, 'escrever o contrato (derivado) deveria ser 400');
  passo('A2 · item derivado recusa rascunho com o motivo');

  // ---------- A3 · leitura (só com uma versão publicada de item) ----------
  const publicados = slots.filter((i) => i.origem === 'publicado');
  if (publicados.length) {
    const alvo = publicados.find((i) => i.novo) ?? publicados[0];
    const lido = await api('POST', `/sala/${tokenArea}/area/leitura`, { item: alvo.id, versao: alvo.versao });
    const item = lido.area.blocos.flatMap((b) => b.itens).find((i) => i.id === alvo.id);
    conferir(item && item.novo === false, 'a leitura não tirou o "novo"');
    const b3 = await api('GET', `/comercial/lead/${leadArea.funil.leadId}/area`, undefined, sessao.token);
    conferir(b3.itens.find((i) => i.id === alvo.id)?.lidoEm, 'a bancada não mostra "lido em"');
    passo('A3 · abrir um item publicado grava a leitura; o novo some e a bancada vê a data', { detalhe: alvo.id });
  } else {
    passo('A3 · nenhum item publicado ainda (a liberação é de outra pessoa): leitura por provar depois da liberação');
  }

  // ---------- Telas ----------
  for (const tema of ['dark', 'light']) {
    const ctx = await contexto(navegador, sessao, tema);
    const p = await ctx.newPage();
    await abrir(p, `/s/${tokenArea}`);
    await tid(p, 'area-do-cliente').waitFor({ timeout: 15000 });
    conferir((await tid(p, 'area-fase').count()) === 1, 'a régua das fases não apareceu');
    conferir((await p.locator('[data-testid^="area-item-"]:not([data-testid*="detalhe"]):not([data-testid*="novo"])').count()) >= 15, 'menos de 15 itens na área');
    await foto(p, `link-${tema}`);
    passo(`A1 · o link do cliente abre a área (${tema})`);

    await abrir(p, `/comercial/funil?lead=${leadArea.funil.leadId}&aba=area`);
    await tid(p, 'aba-area-do-cliente').waitFor({ timeout: 15000 });
    await foto(p, `bancada-${tema}`);
    passo(`A4 · aba Área do cliente no painel (${tema})`, { detalhe: await tid(p, 'area-no-ar').first().innerText() });

    await abrir(p, '/comercial/clientes-ativos');
    await tid(p, 'clientes-ativos-lista').waitFor({ timeout: 15000 });
    conferir((await p.locator('[data-testid^="area-do-cliente-"]').count()) > 0, 'nenhum chip "área N/15" na lista');
    await foto(p, `clientes-${tema}`);
    passo(`A4 · chip "área N/15" em Clientes ativos (${tema})`);
    await ctx.close();
  }

  const celular = await contexto(navegador, sessao, 'dark', { width: 390, height: 844 });
  const pc = await celular.newPage();
  await abrir(pc, `/s/${tokenArea}`);
  await tid(pc, 'area-do-cliente').waitFor({ timeout: 15000 });
  await semRolagemHorizontal(pc, 'area-390');
  conferir(await tid(pc, 'area-whatsapp').isVisible(), 'o botão do WhatsApp não está visível no celular');
  await foto(pc, 'link-390');
  // Abrir um item vazio não faz nada; abrir o escopo (derivado) abre a gaveta.
  await pc.locator('[data-testid="area-item-escopo"] button').click();
  conferir((await tid(pc, 'area-item-detalhe-escopo').count()) === 1, 'a gaveta do escopo não abriu');
  await foto(pc, 'link-390-escopo');
  passo('A1 · celular: uma coluna, sem rolagem horizontal, WhatsApp fixo, gaveta do item abre');
  await celular.close();

  prova.ok = true;
  passo('fim: tudo conferido');
} catch (e) {
  prova.erro = String(e?.stack ?? e);
  console.error(`\nFALHOU: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  gravar();
  await navegador.close();
}
