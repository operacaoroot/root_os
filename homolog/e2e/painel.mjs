#!/usr/bin/env node
/*
 * A PROVA DA RODADA DO PAINEL (18/10/2026), NO NAVEGADOR, CONTRA A HOMOLOGAÇÃO EM DOCKER.
 *
 * Mesmo arranjo do `ux-painel.mjs`: Playwright (Chromium) da pasta de
 * ferramentas da máquina (`UX_PW`, padrão `C:/Users/User/dev/pw-tools`), o web em
 * `http://127.0.0.1:3010`, a API em `http://127.0.0.1:4010/api` e a senha lida
 * de `homolog/.env.homolog` em tempo de execução.
 *
 * O que ela prova (docs/comercial/RODADA-PAINEL-20261018.md, P7):
 *   1. CAIXA (P1): o admin comenta numa tarefa da mesa; na caixa da mesa o item
 *      aparece em Atividade, "Limpar" o tira da caixa e ele continua no
 *      histórico; em Minhas tarefas a tarefa aparece e os comentários abrem no
 *      lugar.
 *   2. PASTAS (P2): uma pasta nova criada pela tela e uma lista movida para ela
 *      pelo seletor; o chip da pasta mostra a lista. Quadro e Lista alternam.
 *   3. ATAS (P3): a ata colada na tela gera sugestões (provedor stub) e aceitar
 *      uma cria UMA tarefa no Trabalho. Quem cola é o admin: colar grava nota
 *      da memória e pede `obsidian.editar`, que a mesa (gestor_marketing) não
 *      tem (revisão PA-2, 18/10/2026); a mesa confere pela API que vê a colada.
 *   4. FUNIL (P5 e rodada da interface U4): o admin move um lead novo de E1
 *      para E3 pelo menu do cartão, sem pedido nem assinatura de outra pessoa
 *      (mover livre para gente, 20/10/2026); a tela diz "Movido para … sem as
 *      conclusões de …" e o cartão mostra o balão "movido com pendências".
 * E fotografa cada tela mexida em escuro, claro e 390 px, conferindo que a
 * página não rola na horizontal no celular.
 *
 * Escreve na homologação: um lead novo pelo simulador, uma tarefa com um
 * comentário, uma pasta, uma lista, uma ata colada e a tarefa aceita da ata.
 * Tudo com o sufixo da execução no nome.
 *
 * Saída: `homolog/provas/painel.json` e `homolog/provas/painel-*.png`. Código de
 * saída diferente de zero no primeiro passo que falhar.
 *
 * Uso (Git Bash): node homolog/e2e/painel.mjs
 */
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
const SENHA = lerEnv(process.env.HOMOLOG_ENV ?? join(RAIZ, 'homolog/.env.homolog')).ADMIN_PASSWORD;
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
  writeFileSync(join(PROVAS, `${process.env.PROVAS_PREFIXO ?? ''}painel.json`), `${JSON.stringify(prova, null, 2)}\n`);
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
  const arquivo = `${process.env.PROVAS_PREFIXO ?? ''}painel-${nome}.png`;
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}

/** As telas mexidas na rodada, cada uma fotografada em escuro, claro e 390 px. */
function telas(ids) {
  return [
    { nome: 'caixa-atividade', url: '/caixa?aba=atividade', pronto: '[data-testid="caixa-aba-atividade"]' },
    { nome: 'caixa-tarefas', url: '/caixa?aba=tarefas', pronto: `[data-testid="caixa-aba-tarefas"]` },
    { nome: 'trabalho-pastas', url: `/trabalho?lista=${ids.listaId}`, pronto: '[data-testid="trabalho-pasta-todas"]' },
    { nome: 'trabalho-lista', url: `/trabalho?lista=${ids.listaId}&visao=lista`, pronto: '[data-testid="trabalho-visao-lista"]' },
    { nome: 'atas', url: `/trabalho/atas?ata=${encodeURIComponent(ids.ataRef)}`, pronto: '[data-testid="atas-tela"]' }, // P7 (21/10): no celular a ata aberta é tela própria, sem a lista
    { nome: 'aprovacoes', url: '/atendimento', pronto: '[data-testid="aprov-grupo-voce"]' },
    { nome: 'funil', url: '/comercial/funil', pronto: `[data-testid="funil-card-${ids.leadId}"]` },
    { nome: 'whatsapp', url: '/whatsapp/simulador', pronto: '[data-testid="whats-lista"]' },
  ];
}

async function main() {
  conferir(SENHA, 'ADMIN_PASSWORD ausente em homolog/.env.homolog');
  const mesa = await entrar('mesa@root.homolog');
  const socio = await entrar('socio@root.homolog');
  const admin = await entrar('admin@marketing-os.local');
  passo('mesa, sócio e admin entraram pela API', { detalhe: `${mesa.user?.name} · ${socio.user?.name} · ${admin.user?.name}` });

  // ---- preparação pela API (o que outra pessoa faria antes) ----
  const estrutura = await api('GET', '/trabalho/estrutura', undefined, mesa.token);
  const todas = [...estrutura.folders.flatMap((f) => f.lists), ...estrutura.listasSoltas];
  const execucao = todas.find((l) => l.name === 'Execução') ?? todas[0];
  conferir(execucao, 'o Trabalho não tem lista nenhuma (rode a estrutura sugerida)');
  // Rodada do trabalho T4: toda tarefa nova tem cliente (o da casa, aqui).
  // Versão final (19/10/2026, F1): Minhas tarefas e Atividade identificam a pessoa pela CONTA
  // (assigneeUserId e outros responsáveis), como a produção; o texto do responsável sozinho
  // não põe a tarefa na caixa de ninguém. A tarefa da prova leva a conta da mesa.
  const tarefa = await api('POST', '/trabalho/tarefas', { listId: execucao.id, title: `Prova do painel ${SUFIXO}`, assignee: mesa.user.name, assigneeUserId: mesa.user.id, clienteId: 'interno' }, admin.token);
  await api('POST', `/trabalho/tarefas/${tarefa.id}/comentarios`, { text: `Comentário da prova ${SUFIXO}: confere o relatório antes de sexta.` }, admin.token);
  const lista = await api('POST', '/trabalho/listas', { name: `Lista da prova ${SUFIXO}` }, mesa.token);
  const entrada = await api('POST', '/comercial/simulador/entrada', {
    telefone: `55329${SUFIXO.padStart(8, '0')}`.slice(0, 13),
    texto: 'Oi! Quero entender o fechamento do mês.',
    nome: `Prova Painel ${SUFIXO}`,
    canal: 'conteudo',
    palavraChave: 'FECHAMENTO',
    mensagemId: `painel-${SUFIXO}-1`,
  }, mesa.token);
  conferir(entrada.leadId && entrada.leadNovo, 'o simulador não criou um lead novo');
  const leadId = entrada.leadId;
  passo('preparou: tarefa da mesa comentada pelo admin, lista solta e um lead novo em E1', { tarefaId: tarefa.id, listaId: lista.id, leadId });

  const navegador = await chromium.launch();
  const ids = { listaId: lista.id, leadId, ataRef: '' };
  try {
    const ctxMesa = await contexto(navegador, mesa, 'dark');
    const p = await ctxMesa.newPage();

    // ---- 1. caixa ----
    const atv = await api('GET', '/caixa/atividade', undefined, mesa.token);
    const item = atv.itens.find((i) => i.tarefaId === tarefa.id && i.tipo === 'comentario') ?? atv.itens.find((i) => i.tarefaId === tarefa.id);
    conferir(item, `a atividade da tarefa não chegou à caixa da mesa (identidades: ${atv.identidades.join(', ')})`);
    await p.goto(`${WEB}/caixa?aba=atividade`, { waitUntil: 'networkidle' });
    await tid(p, `caixa-item-${item.id}`).waitFor({ timeout: 30_000 });
    passo('na caixa da mesa, Atividade mostra o comentário do admin', { detalhe: item.id });
    await tid(p, `caixa-limpar-${item.id}`).click();
    await tid(p, `caixa-item-${item.id}`).waitFor({ state: 'detached', timeout: 15_000 });
    const comLimpos = await api('GET', '/caixa/atividade?incluirLimpos=true', undefined, mesa.token);
    conferir(comLimpos.itens.some((i) => i.id === item.id), 'o item limpo sumiu também do histórico');
    passo('"Limpar" tirou o item da caixa e ele continua no histórico');
    await tid(p, 'caixa-aba-tarefas').click();
    await tid(p, `caixa-tarefa-${tarefa.id}`).waitFor({ timeout: 20_000 });
    await tid(p, `caixa-comentarios-${tarefa.id}`).click();
    await p.getByText(`Comentário da prova ${SUFIXO}`).first().waitFor({ timeout: 15_000 });
    conferir(new URL(p.url()).pathname === '/caixa', 'os comentários tiraram a pessoa da caixa');
    passo('Minhas tarefas mostra a tarefa e os comentários abrem no lugar');
    await p.keyboard.press('Escape');

    // ---- 2. pastas ----
    await p.goto(`${WEB}/trabalho?lista=${lista.id}`, { waitUntil: 'networkidle' });
    await tid(p, 'trabalho-nova-pasta').click();
    const nomeDaPasta = `Pasta da prova ${SUFIXO}`;
    await tid(p, 'trabalho-nova-pasta-nome').fill(nomeDaPasta);
    await tid(p, 'trabalho-nova-pasta-criar').click();
    let pasta = null;
    for (let i = 0; i < 30 && !pasta; i++) {
      pasta = (await api('GET', '/trabalho/estrutura', undefined, mesa.token)).folders.find((f) => f.name === nomeDaPasta) ?? null;
      if (!pasta) await esperar(400);
    }
    conferir(pasta, 'a pasta criada pela tela não apareceu na estrutura');
    passo('pasta criada pela tela', { detalhe: nomeDaPasta });
    await p.reload({ waitUntil: 'networkidle' });
    await tid(p, 'trabalho-mover-lista').waitFor({ timeout: 20_000 });
    await tid(p, 'trabalho-mover-lista').selectOption(pasta.id);
    let movida = false;
    for (let i = 0; i < 30 && !movida; i++) {
      const e = await api('GET', '/trabalho/estrutura', undefined, mesa.token);
      movida = e.folders.find((f) => f.id === pasta.id)?.lists.some((l) => l.id === lista.id) ?? false;
      if (!movida) await esperar(400);
    }
    conferir(movida, 'a lista não foi para a pasta nova');
    await tid(p, `trabalho-pasta-${pasta.id}`).click();
    await p.getByRole('button', { name: `Lista da prova ${SUFIXO}` }).first().waitFor({ timeout: 15_000 });
    passo('a lista foi movida para a pasta pelo seletor e o chip da pasta a mostra');
    await tid(p, 'trabalho-visao-lista').click();
    conferir(new URL(p.url()).searchParams.get('visao') === 'lista', 'a troca para Lista não foi para a URL');
    await tid(p, 'trabalho-visao-quadro').click();
    passo('Quadro e Lista alternam sobre a mesma lista');

    // ---- 3. atas ----
    // Colar pede obsidian.editar (a permissão do POST /memoria): é o admin quem cola e decide.
    const ctxAdmin = await contexto(navegador, admin, 'dark');
    const pa = await ctxAdmin.newPage();
    await pa.goto(`${WEB}/trabalho/atas`, { waitUntil: 'networkidle' });
    await tid(pa, 'ata-colar').click();
    const tituloDaAta = `Reunião de operação da prova ${SUFIXO}`;
    await tid(pa, 'ata-colar-titulo').fill(tituloDaAta);
    await tid(pa, 'ata-colar-texto').fill(readFileSync(join(RAIZ, 'homolog/fixtures/ata-trabalho-exemplo.md'), 'utf8'));
    await tid(pa, 'ata-colar-salvar').click();
    let ata = null;
    for (let i = 0; i < 30 && !ata; i++) {
      ata = (await api('GET', '/trabalho/atas', undefined, mesa.token)).atas.find((a) => a.titulo === tituloDaAta) ?? null;
      if (!ata) await esperar(400);
    }
    conferir(ata, 'a ata colada não entrou no banco de atas');
    ids.ataRef = ata.id;
    passo('ata colada pela tela entrou no banco de atas (pela memória)', { detalhe: ata.id });
    await tid(pa, `ata-${ata.id}`).click();
    await tid(pa, `ata-gerar-${ata.id}`).click();
    await pa.locator('[data-testid^="ata-aceitar-"]').first().waitFor({ timeout: 60_000 });
    const sugestoes = await api('GET', `/trabalho/atas/sugestoes?ata=${encodeURIComponent(ata.id)}&estado=rascunho`, undefined, mesa.token);
    const lidas = Array.isArray(sugestoes) ? sugestoes : sugestoes.sugestoes ?? sugestoes.itens ?? [];
    conferir(lidas.length > 0, 'a ata não gerou sugestão');
    const sug = lidas[0];
    passo('"Sugerir tarefas" trouxe rascunhos conferidos contra a ata', { detalhe: `${lidas.length} rascunho(s)` });
    // Rodada do trabalho T4/T5: o aceite pede o cliente; a lista vai em dois níveis (pasta e lista).
    await tid(pa, `ata-cliente-${sug.id}`).locator('[role="combobox"]').click();
    await tid(pa, 'opcao-cliente-interno').first().click();
    await tid(pa, `ata-pasta-${sug.id}`).selectOption({ label: 'Clientes' });
    await tid(pa, `ata-lista-${sug.id}`).selectOption({ label: 'Execução' });
    await tid(pa, `ata-aceitar-${sug.id}`).click();
    let aceita = null;
    for (let i = 0; i < 30 && !aceita?.workTaskId; i++) {
      const s = await api('GET', `/trabalho/atas/sugestoes?ata=${encodeURIComponent(ata.id)}`, undefined, mesa.token);
      aceita = (Array.isArray(s) ? s : s.sugestoes ?? s.itens ?? []).find((x) => x.id === sug.id) ?? null;
      if (!aceita?.workTaskId) await esperar(400);
    }
    conferir(aceita?.workTaskId, 'aceitar não criou a tarefa');
    const criada = await api('GET', `/trabalho/tarefas/${aceita.workTaskId}`, undefined, mesa.token);
    conferir(criada.title === sug.titulo, 'a tarefa criada não tem o título da sugestão');
    conferir(!!criada.clienteId, 'a tarefa aceita da ata nasceu sem cliente');
    passo('aceitar com um clique criou a tarefa no Trabalho', { detalhe: criada.title });
    await ctxAdmin.close();

    // ---- 4. mover livre (rodada da interface U4, 20/10/2026) → mensagem e balão ----
    // A pessoa com leads.editar move para qualquer etapa, sem pedido nem assinatura de outra
    // pessoa; a tela diz "Movido para <etapa> sem as conclusões de …" e o balão fica.
    const ctxSocio = await contexto(navegador, admin, 'dark');
    const ps = await ctxSocio.newPage();
    await ps.goto(`${WEB}/comercial/funil`, { waitUntil: 'networkidle' });
    await tid(ps, `funil-mover-${leadId}`).waitFor({ timeout: 30_000 });
    await tid(ps, `funil-mover-${leadId}`).click();
    await tid(ps, 'funil-mover-para-reuniao_agendada').first().click();
    await tid(ps, `funil-mensagem-${leadId}`).waitFor({ timeout: 20_000 });
    const mensagem = (await tid(ps, `funil-mensagem-${leadId}`).innerText()).trim();
    conferir(/^Movido para/.test(mensagem) && /sem as conclusões/.test(mensagem), `a mensagem do mover veio: ${mensagem}`);
    await tid(ps, `funil-balao-${leadId}`).waitFor({ timeout: 20_000 });
    const balao = (await tid(ps, `funil-balao-${leadId}`).innerText()).trim();
    conferir(/pend/i.test(balao), `o balão não fala de pendência: ${balao}`);
    const naColuna = await tid(ps, 'funil-coluna-reuniao_agendada').locator(`[data-testid="funil-card-${leadId}"]`).count();
    conferir(naColuna === 1, 'o cartão não está na coluna E3');
    passo('o admin moveu o lead novo de E1 para E3 sem pedido: a mensagem diz o que ficou sem concluir e o balão fica', { detalhe: `${mensagem.slice(0, 120)} · ${balao.replace(/\s+/g, ' ').slice(0, 80)}` });
    await ctxSocio.close();
    await ctxMesa.close();

    // ---- 5. fotos de cada tela, escuro, claro e 390 px ----
    for (const tema of ['dark', 'light']) {
      for (const [tamanho, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
        if (tema === 'light' && tamanho === 'celular') continue;
        const ctx = await contexto(navegador, mesa, tema, viewport);
        const pg = await ctx.newPage();
        for (const t of telas(ids)) {
          await pg.goto(`${WEB}${t.url}`, { waitUntil: 'networkidle' });
          await pg.locator(t.pronto).first().waitFor({ timeout: 30_000 });
          const sufixo = tamanho === 'celular' ? 'celular' : tema === 'dark' ? 'escuro' : 'claro';
          await foto(pg, `${t.nome}-${sufixo}`);
          if (tamanho === 'celular') {
            const largura = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth }));
            prova.semRolagemHorizontal.push({ tela: t.nome, ...largura });
            conferir(largura.doc <= largura.janela + 1, `${t.nome} rola na horizontal no celular (${largura.doc} > ${largura.janela})`);
          }
        }
        await ctx.close();
      }
    }
    passo('fotografou as telas mexidas em escuro, claro e 390 px; nenhuma rola na horizontal no celular', { detalhe: `${prova.screenshots.length} fotos` });
    prova.ok = true;
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
