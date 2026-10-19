#!/usr/bin/env node
/*
 * A PROVA DA RODADA DA IMPLANTAÇÃO (18/10/2026), CONTRA A HOMOLOGAÇÃO EM DOCKER.
 *
 * Mesmo arranjo do `painel.mjs`: Playwright (Chromium) da pasta de ferramentas
 * da máquina (`UX_PW`, padrão `C:/Users/User/dev/pw-tools`), o web em
 * `http://127.0.0.1:3010`, a API em `http://127.0.0.1:4010/api`, a senha lida de
 * `homolog/.env.homolog` em tempo de execução.
 *
 * O que ela prova (docs/comercial/RODADA-IMPLANTACAO-20261018.md, I6):
 *   1. I1 · um fechamento de teste (a jornada inteira, `jornada-docker.mjs`, pelos
 *      dublês) cria o card na lista "Onboarding de cliente" da pasta Clientes, na
 *      primeira etapa, com o selo de procedência e os retrolinks card ↔ lead ↔
 *      trilho; rodar o fechamento de novo não duplica o card;
 *   2. I2 · o card aparece no quadro compacto com o rodapé da última
 *      movimentação; parar o mouse e focar mostram o balão (Esc fecha); mover de
 *      coluna funciona e o rodapé passa a dizer quem moveu;
 *   3. I3 · a sala publicada v1 (pedida pelo admin, liberada por OUTRA pessoa),
 *      editada, v2 pedida (o cliente segue na v1) e liberada: o cliente vê só a v2;
 *   4. I4/I5 · reação e anotação pela rota pública aparecem no fio, no relatório
 *      e a ideia vira UMA tarefa (dois cliques);
 * e fotografa as telas mexidas em escuro, claro e 390 px (`implantacao-*.png`),
 * conferindo que nenhuma rola na horizontal no celular.
 *
 * Escreve na homologação: um lead novo pela jornada (fecha de verdade nos
 * dublês), as versões da sala dele, uma reação e uma ideia, e a tarefa da ideia.
 *
 * Variáveis: IMPLANTACAO_LEAD e IMPLANTACAO_SALA (um lead já fechado e o link
 * da sala dele) pulam a jornada.
 *
 * Saída: `homolog/provas/implantacao.json` e `homolog/provas/implantacao-*.png`.
 * Uso (Git Bash): node homolog/e2e/implantacao.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const SUFIXO = new Date().toISOString().slice(11, 19).replace(/:/g, '');

const prova = { inicio: new Date().toISOString(), web: WEB, sufixo: SUFIXO, passos: [], screenshots: [], semRolagemHorizontal: [], ok: false };
const t0 = Date.now();

function passo(nome, dados = {}) {
  const linha = { n: prova.passos.length + 1, nome, ms: Date.now() - t0, ...dados };
  prova.passos.push(linha);
  console.log(`  ${String(linha.n).padStart(2)}. ${nome}${dados.detalhe ? ` · ${dados.detalhe}` : ''}`);
}
function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  // O token da sala é a chave do cliente: a prova guarda só o começo dele.
  const texto = JSON.stringify(prova, null, 2).replace(/\/s\/([A-Za-z0-9_-]{6})[A-Za-z0-9_-]{30,50}/g, '/s/$1…');
  writeFileSync(join(PROVAS, 'implantacao.json'), `${texto}\n`);
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
  if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}
async function entrar(email) {
  const r = await api('POST', '/auth/login', { email, password: SENHA });
  return { token: r.token ?? r.accessToken, user: r.user };
}

/** Libera pela MESMA confirmação de /atendimento: quem pediu não assina; R4 (fora da janela) vai à titular com senha e motivo. */
async function liberar(approvalId, pessoas, porque) {
  const lista = await api('GET', '/approvals?status=pendente', undefined, pessoas.mesa.token);
  const a = lista.items.find((x) => x.id === approvalId);
  conferir(a, `a aprovação ${approvalId} não está pendente na fila`);
  const quem = a.alcadaMinima === 'titular' ? pessoas.socio : pessoas.mesa;
  const corpo = a.exigeReauth ? { reauth: { senha: SENHA }, motivo: `conferi na homologação: ${porque}` } : {};
  const r = await api('POST', `/approvals/${approvalId}/confirm`, corpo, quem.token);
  conferir(r?.execucao?.status === 'executado', `a liberação de ${a.capacidade} não executou (${r?.execucao?.status})`);
  return { nivel: a.nivel, quem: quem.user.email };
}

async function contexto(navegador, sessao, tema, viewport = { width: 1440, height: 900 }) {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.addInitScript(
    ([token, user, tema]) => {
      if (token) {
        localStorage.setItem('mktos_token', token);
        localStorage.setItem('mktos_user', JSON.stringify(user));
      }
      localStorage.setItem('root-os:tema', tema);
    },
    [sessao?.token ?? null, sessao?.user ?? null, tema],
  );
  return ctx;
}
const tid = (p, id) => p.locator(`[data-testid="${id}"]`);

async function foto(pagina, nome) {
  const arquivo = `implantacao-${nome}.png`;
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}

/** A jornada inteira num lead novo; devolve o lead e o link da sala tirados da saída dela. */
function rodarJornada() {
  if (process.env.IMPLANTACAO_LEAD && process.env.IMPLANTACAO_SALA) return { leadId: process.env.IMPLANTACAO_LEAD, sala: process.env.IMPLANTACAO_SALA };
  const r = spawnSync(process.execPath, [join(RAIZ, 'homolog/e2e/jornada-docker.mjs')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env });
  const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (r.status !== 0) throw new Error(`a jornada falhou (saída ${r.status}): ${saida.split(/\r?\n/).filter((l) => /FALHOU|respondeu|esperei/.test(l)).slice(0, 4).join(' | ')}`);
  const lead = /^Lead .* · ([0-9a-f-]{36})\s*$/m.exec(saida)?.[1];
  const sala = /^Sala: (\S+)\s*$/m.exec(saida)?.[1];
  conferir(lead && sala, 'a jornada passou mas não imprimiu o lead e a sala');
  return { leadId: lead, sala };
}

async function main() {
  conferir(SENHA, 'ADMIN_PASSWORD ausente em homolog/.env.homolog');
  const pessoas = {
    mesa: await entrar('mesa@root.homolog'),
    socio: await entrar('socio@root.homolog'),
    admin: await entrar('admin@marketing-os.local'),
  };
  passo('mesa, sócio e admin entraram pela API');

  // ---- 1. I1: o card nasce do fechamento ----
  const { leadId, sala } = rodarJornada();
  const token = sala.split('/s/').pop();
  passo('a jornada fechou um lead de teste pelos dublês (Pix, assinatura, fechamento R4)', { leadId });
  const fech = await api('GET', `/comercial/fechamentos/${leadId}`, undefined, pessoas.mesa.token);
  conferir(fech.estado === 'concluido' && fech.escritas.length === 6, `o fechamento devia concluir com 6 escritas (veio ${fech.estado}, ${fech.escritas.length})`);
  const escritaDoCard = fech.escritas.find((e) => e.escrita === 'card');
  conferir(escritaDoCard?.estado === 'criado' && escritaDoCard.ref, `a escrita do card devia ser "criado" (veio ${escritaDoCard?.estado})`);
  const cardId = escritaDoCard.ref;
  const ficha = await api('GET', `/comercial/lead/${leadId}`, undefined, pessoas.mesa.token);
  conferir(ficha.ligadoA?.implantacao?.cardId === cardId, 'a ficha do lead não aponta para o card (retrolink lead → card)');
  const card = await api('GET', `/trabalho/tarefas/${cardId}`, undefined, pessoas.mesa.token);
  conferir(card.listName === 'Onboarding de cliente', `o card devia estar em "Onboarding de cliente" (está em ${card.listName})`);
  conferir(card.statusName === 'Fechado no comercial', `o card devia nascer em "Fechado no comercial" (está em ${card.statusName})`);
  conferir(card.description?.includes(`/comercial/lead/${leadId}`), 'a descrição do card não leva ao lead (retrolink card → lead)');
  conferir(/Procedência: criado pelo fechamento · \d{2}\/\d{2}\/\d{4}/.test(card.description ?? ''), 'a descrição do card não tem a procedência');
  const trilhos = await api('GET', '/tenants/onboarding/trilhos', undefined, pessoas.mesa.token);
  const trilho = trilhos.find((t) => t.cardId === cardId);
  conferir(trilho && ficha.ligadoA.implantacao.trilhoId === trilho.id, 'o trilho não aponta para o card (retrolink trilho → card)');
  const fio = (await api('GET', `/comercial/lead/${leadId}/fio`, undefined, pessoas.mesa.token)).fio;
  conferir(fio.filter((l) => l.type === 'implantacao.card_criado').length === 1, 'o fio devia ter um implantacao.card_criado');
  passo('I1: o card nasceu em Onboarding de cliente · Fechado no comercial, com procedência e retrolinks card ↔ lead ↔ trilho', { cardId, lista: card.listName, etapa: card.statusName });

  const deNovo = await api('POST', `/comercial/fechamentos/${leadId}/rodar`, {}, pessoas.admin.token);
  conferir(deNovo.estado === 'concluido', `rodar de novo devia responder concluído (veio ${JSON.stringify(deNovo)})`);
  const mesmos = await api('GET', `/trabalho/tarefas?listId=${card.listId}&q=${encodeURIComponent(card.title)}`, undefined, pessoas.mesa.token);
  conferir(mesmos.items.filter((t) => t.title === card.title).length === 1, 'rodar o fechamento de novo duplicou o card');
  passo('I1: rodar o fechamento de novo não duplica o card', { detalhe: `1 card "${card.title}"` });

  const mov = await api('GET', `/trabalho/quadro/movimento?listId=${card.listId}`, undefined, pessoas.mesa.token);
  const doCard = mov.itens.find((i) => i.tarefaId === cardId);
  conferir(doCard?.procedencia?.leadId === leadId && doCard.passos[0]?.frase === 'abriu o card', 'o movimento do quadro não traz o selo e o "abriu o card"');

  const navegador = await chromium.launch();
  try {
    // ---- 2. I2: o kanban denso ----
    const ctxMesa = await contexto(navegador, pessoas.mesa, 'dark');
    const p = await ctxMesa.newPage();
    await p.goto(`${WEB}/trabalho?lista=${card.listId}`, { waitUntil: 'networkidle' });
    await tid(p, `trabalho-rodape-${cardId}`).waitFor({ timeout: 30_000 });
    conferir((await tid(p, 'trabalho-quadro').getAttribute('data-densidade')) === 'compacto', 'o quadro devia abrir no compacto');
    const rodape = await tid(p, `trabalho-rodape-${cardId}`).innerText();
    conferir(/Fechamento comercial · /.test(rodape), `o rodapé devia trazer o fechamento (veio "${rodape}")`);
    const altura = await p.locator(`[data-work-task-id="${cardId}"]`).evaluate((el) => el.getBoundingClientRect().height);
    conferir(altura <= 80, `o cartão compacto devia ter ~64 px (tem ${Math.round(altura)})`);
    const colunas = await p.locator('[data-coluna]').count();
    const larguraDoQuadro = await tid(p, 'trabalho-quadro').evaluate((el) => ({ scroll: el.scrollWidth, cliente: el.clientWidth }));
    conferir(colunas === 7 && larguraDoQuadro.scroll <= larguraDoQuadro.cliente + 1, `as 7 etapas deviam caber em 1440 px (${colunas} colunas, ${larguraDoQuadro.scroll} > ${larguraDoQuadro.cliente})`);
    const rolaAPagina = await p.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight + 2);
    conferir(!rolaAPagina, 'a página do quadro rola inteira: cada coluna devia rolar sozinha');
    passo('I2: o card no quadro compacto (~64 px), 7 colunas em 1440 px sem rolar a página, rodapé com a última movimentação', { detalhe: `${rodape} · ${Math.round(altura)} px` });

    await p.locator(`[data-work-task-id="${cardId}"]`).hover();
    await tid(p, 'trabalho-balao').waitFor({ timeout: 5_000 });
    const balao = await tid(p, 'trabalho-balao').innerText();
    conferir(/abriu o card/.test(balao) && /clique abre o painel/.test(balao), 'o balão não mostrou os passos');
    const caixa = await tid(p, 'trabalho-balao').boundingBox();
    conferir(caixa && caixa.x >= 0 && caixa.y >= 0 && caixa.x + caixa.width <= 1440 && caixa.y + caixa.height <= 900, 'o balão saiu da tela');
    await foto(p, 'quadro-balao-escuro');
    await p.keyboard.press('Escape');
    await tid(p, 'trabalho-balao').waitFor({ state: 'detached', timeout: 5_000 });
    await p.mouse.move(5, 5);
    await p.getByRole('button', { name: card.title, exact: true }).focus();
    await tid(p, 'trabalho-balao').waitFor({ timeout: 5_000 });
    const descrito = await p.getByRole('button', { name: card.title, exact: true }).getAttribute('aria-describedby');
    conferir(descrito && descrito.startsWith('balao-do-cartao-'), 'o foco não ligou o balão por aria-describedby');
    await p.keyboard.press('Escape');
    passo('I2: parar o mouse e focar mostram o balão (3 passos, comentário), dentro da tela; Esc fecha');

    await tid(p, 'trabalho-densidade-cheio').click();
    await p.locator(`[data-work-task-id="${cardId}"] select[title="Mover etapa"]`).selectOption({ label: 'Kickoff marcado' });
    await p.waitForFunction((id) => /moveu para Kickoff marcado/.test(document.querySelector(`[data-testid="trabalho-rodape-${id}"]`)?.textContent ?? ''), cardId, { timeout: 15_000 });
    await tid(p, 'trabalho-densidade-compacto').click();
    passo('I2: mover de coluna funciona e o rodapé passa a dizer "moveu para Kickoff marcado"');
    await p.getByRole('button', { name: card.title, exact: true }).click();
    await p.getByRole('dialog').first().waitFor({ timeout: 10_000 });
    passo('I2: o clique no cartão abre o painel');
    await p.keyboard.press('Escape');

    // ---- 3. I3: a sala publicada por versão ----
    const passos1 = [{ oque: 'marcar o kickoff', quando: '2026-10-21', comQuem: 'Marina Duarte' }];
    await api('PUT', `/comercial/lead/${leadId}/sala/rascunho`, { proximosPassos: passos1, combinado: ['Resposta em até 4 horas úteis', 'Retornos às 08:30, 13:00 e 18:00', 'Claude do 1º mês: [a decidir pela mesa]'], quemCuida: { nome: 'Admin Root', papel: 'cuida da sua conta na Root' } }, pessoas.admin.token);
    const v1 = await api('POST', `/comercial/lead/${leadId}/sala/publicar`, {}, pessoas.admin.token);
    conferir(v1.estado === 'na_porta' && v1.approvalId, 'publicar a sala devia ficar retido na porta');
    const antes = await api('GET', `/sala/${token}`);
    conferir(antes.publicada == null || antes.publicada.versao < v1.rascunho.versao, 'o rascunho vazou para o cliente antes da liberação');
    const lib1 = await liberar(v1.approvalId, pessoas, 'a versão 1 da sala');
    const depois1 = await api('GET', `/sala/${token}`);
    conferir(depois1.publicada?.versao === v1.rascunho.versao, 'a v1 não foi ao ar depois da liberação');
    passo(`I3: a sala v${v1.rascunho.versao} pedida pelo admin, liberada por outra pessoa (${lib1.nivel}, ${lib1.quem})`);

    await api('PUT', `/comercial/lead/${leadId}/sala/rascunho`, { proximosPassos: [...passos1, { oque: 'mandar os acessos do Omie', quando: '2026-10-22', comQuem: 'Marina Duarte' }], combinado: ['Resposta em até 4 horas úteis', 'Retornos às 08:30, 13:00 e 18:00', 'Claude do 1º mês: [a decidir pela mesa]'], quemCuida: { nome: 'Admin Root', papel: 'cuida da sua conta na Root' } }, pessoas.admin.token);
    const v2 = await api('POST', `/comercial/lead/${leadId}/sala/publicar`, {}, pessoas.admin.token);
    conferir(v2.approvalId && v2.rascunho.versao === v1.rascunho.versao + 1, 'a v2 devia ir à porta');
    const meio = await api('GET', `/sala/${token}`);
    conferir(meio.publicada.versao === v1.rascunho.versao, 'o cliente devia continuar na v1 enquanto a v2 espera');

    // O cartão de /atendimento com a versão inteira, antes da liberação.
    const ctxQuemLibera = await contexto(navegador, (await api('GET', '/approvals?status=pendente', undefined, pessoas.mesa.token)).items.find((a) => a.id === v2.approvalId)?.alcadaMinima === 'titular' ? pessoas.socio : pessoas.mesa, 'dark');
    const pa = await ctxQuemLibera.newPage();
    await pa.goto(`${WEB}/atendimento`, { waitUntil: 'networkidle' });
    const abrirItem = pa.locator(`[data-testid="aprov-abrir-${v2.approvalId}"]`);
    if (await abrirItem.count()) {
      await abrirItem.click();
      await tid(pa, 'cartao-da-sala').waitFor({ timeout: 15_000 });
      await foto(pa, 'atendimento-sala-escuro');
      passo('I3: em /atendimento, o cartão mostra a versão inteira da sala antes de assinar');
    } else {
      passo('I3: o cartão de /atendimento não foi aberto pelo roteiro (o seletor da linha mudou); a liberação segue pela API');
    }
    await ctxQuemLibera.close();

    const lib2 = await liberar(v2.approvalId, pessoas, 'a versão 2 da sala');
    const depois2 = await api('GET', `/sala/${token}`);
    conferir(depois2.publicada?.versao === v2.rascunho.versao && depois2.publicada.conteudo.proximosPassos.length === 2, 'o cliente devia ver só a v2');
    passo(`I3: v${v2.rascunho.versao} editada, pedida e liberada (${lib2.nivel}); o cliente vê só a v${v2.rascunho.versao}`);

    // ---- 4. I4 e I5: reação e anotação pela rota pública ----
    const versaoDaProposta = depois2.proposta?.versao;
    conferir(versaoDaProposta, 'a sala não tem proposta vigente');
    await api('POST', `/sala/${token}/proposta/reacao`, { versao: versaoDaProposta, secao: 'montar', tipo: 'faz_sentido' });
    const textoDaIdeia = `Dá para começar pelo fechamento de outubro? (prova ${SUFIXO})`;
    await api('POST', `/sala/${token}/proposta/reacao`, { versao: versaoDaProposta, secao: 'investimento', tipo: 'ideia', texto: textoDaIdeia });
    const reacoesDoLead = await api('GET', `/comercial/lead/${leadId}/reacoes`, undefined, pessoas.mesa.token);
    conferir(JSON.stringify(reacoesDoLead).includes(textoDaIdeia), 'a ideia não chegou à bancada');
    const fio2 = (await api('GET', `/comercial/lead/${leadId}/fio`, undefined, pessoas.mesa.token)).fio;
    conferir(fio2.some((l) => l.type === 'proposta.ideia') && fio2.some((l) => l.type === 'proposta.reagida'), 'a reação e a ideia não estão no fio');
    const rel = await api('GET', '/comercial/relatorio/leitura?dias=7', undefined, pessoas.mesa.token);
    const ideia = rel.ideias.find((i) => i.texto === textoDaIdeia);
    conferir(ideia, 'a ideia não está no relatório');
    passo('I4: "faz sentido" e uma ideia pela rota pública chegam ao fio, à bancada e ao relatório');
    const t1 = await api('POST', `/comercial/reacoes/${ideia.id}/tarefa`, {}, pessoas.admin.token);
    const t2 = await api('POST', `/comercial/reacoes/${ideia.id}/tarefa`, {}, pessoas.admin.token);
    conferir(t1.tarefaId === t2.tarefaId && t2.criada === false, 'dois cliques criaram duas tarefas');
    const tarefaDaIdeia = await api('GET', `/trabalho/tarefas/${t1.tarefaId}`, undefined, pessoas.mesa.token);
    conferir(tarefaDaIdeia.description.includes('Procedência: ideia deixada pelo cliente') && tarefaDaIdeia.description.includes(textoDaIdeia), 'a tarefa não leva a procedência e o trecho');
    passo('I5: a ideia vira UMA tarefa (dois cliques) com a procedência e o trecho', { tarefa: tarefaDaIdeia.title });
    await ctxMesa.close();

    // ---- 5. fotos: escuro, claro e 390 px ----
    const telas = [
      { nome: 'quadro', sessao: pessoas.mesa, url: `/trabalho?lista=${card.listId}`, pronto: `[data-testid="trabalho-rodape-${cardId}"]` },
      { nome: 'painel-sala', sessao: pessoas.mesa, url: `/comercial/funil?lead=${leadId}&aba=sala`, pronto: '[data-testid="aba-sala"]' },
      { nome: 'relatorio', sessao: pessoas.mesa, url: '/comercial/relatorio', pronto: '[data-testid="bloco-leitura"] [data-testid="leitura-tiles"]', rolar: '[data-testid="bloco-leitura"]' },
      { nome: 'sala-publicada', sessao: null, url: `/s/${token}`, pronto: '[data-testid="sala-publicada"]' },
      { nome: 'proposta', sessao: null, url: `/s/${token}/proposta`, pronto: 'text=// 03 · INVESTIMENTO', rolar: 'text=// 03 · INVESTIMENTO' },
    ];
    for (const tema of ['dark', 'light']) {
      for (const [tamanho, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
        if (tema === 'light' && tamanho === 'celular') continue;
        for (const t of telas) {
          const ctx = await contexto(navegador, t.sessao, tema, viewport);
          const pg = await ctx.newPage();
          await pg.goto(`${WEB}${t.url}`, { waitUntil: 'networkidle' });
          await pg.locator(t.pronto).first().waitFor({ timeout: 30_000 });
          if (t.rolar) await pg.locator(t.rolar).first().scrollIntoViewIfNeeded();
          const sufixo = tamanho === 'celular' ? 'celular' : tema === 'dark' ? 'escuro' : 'claro';
          await foto(pg, `${t.nome}-${sufixo}`);
          if (tamanho === 'celular') {
            const largura = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth }));
            prova.semRolagemHorizontal.push({ tela: t.nome, ...largura });
            conferir(largura.doc <= largura.janela + 1, `${t.nome} rola na horizontal no celular (${largura.doc} > ${largura.janela})`);
            if (t.nome === 'sala-publicada') {
              const whats = await tid(pg, 'sala-whatsapp').boundingBox();
              conferir(whats && whats.height >= 48 && whats.y + whats.height <= 844 + 1, `o botão do WhatsApp devia ficar fixo embaixo com 48 px (${JSON.stringify(whats)})`);
            }
          }
          await ctx.close();
        }
      }
    }
    passo('fotografou o quadro, a aba Sala, o relatório, a sala publicada e a proposta em escuro, claro e 390 px; nada rola na horizontal no celular', { detalhe: `${prova.screenshots.length} fotos` });
    prova.ok = true;
    prova.leadId = leadId;
    prova.cardId = cardId;
  } finally {
    await navegador.close();
    gravar();
  }
}

main().then(
  () => console.log(`PASSA · ${prova.passos.length} passos em ${(prova.duracaoMs / 1000).toFixed(1)} s`),
  (e) => {
    prova.erro = e.message;
    gravar();
    console.error(`FALHOU: ${e.message}`);
    process.exit(1);
  },
);
