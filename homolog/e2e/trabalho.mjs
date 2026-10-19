#!/usr/bin/env node
/*
 * A PROVA DA RODADA DO TRABALHO (19/10/2026), CONTRA A HOMOLOGAÇÃO EM DOCKER.
 *
 * Mesmo arranjo do `implantacao.mjs`: Playwright (Chromium) da pasta de
 * ferramentas da máquina (`UX_PW`, padrão `C:/Users/User/dev/pw-tools`), o web em
 * `http://127.0.0.1:3010`, a API em `http://127.0.0.1:4010/api`, a senha lida de
 * `homolog/.env.homolog` em tempo de execução.
 *
 * O que ela prova (docs/comercial/RODADA-TRABALHO-20261019.md, T9):
 *   1. T1 · o menu "Implantação de clientes" abre o kanban da lista Onboarding de
 *      cliente; /onboarding redireciona; as colunas ficam numa linha só com
 *      rolagem lateral (nenhuma abaixo da outra) a 1280 e a 1440; o clique no
 *      canto e no rodapé do cartão abre o pop-up em todas as densidades;
 *   2. T2 · o pop-up abre por cima, com ?tarefa= no endereço; voltar fecha; a aba
 *      Trilho abre a bancada; Pendências (Atividade) e Minhas tarefas abrem o
 *      pop-up sem sair de /caixa;
 *   3. T3 · uma vista salva em Minhas tarefas, marcada padrão, volta depois de
 *      recarregar;
 *   4. T4 · a tarefa nova exige cliente (tela e API);
 *   5. T5 · a sugestão de ata editada (título, o que será executado, responsável
 *      de perfil, cliente, pasta e lista) e aceita;
 *   6. T6 · o menu comercial sem Decisões e na ordem nova; /comercial vai ao
 *      Funil; uma decisão do comercial tomada pela aba Decisões de Pendências;
 *   7. T7 · `trabalho-t7.mjs` (R3 na linha, R4 com senha, vencida pedir de novo);
 *   8. T8 · um contrato concluído com motivo vai ao fim da lista e o painel reconta;
 *   9. T1b · `trabalho-t1b.mjs`, quando existir (registrar cliente já fechado);
 * e fotografa as telas mexidas em escuro, claro e 390 px (`trabalho-*.png`),
 * conferindo que nenhuma página rola na horizontal no celular.
 *
 * Escreve na homologação: uma tarefa da prova com o cliente da casa, uma ata
 * colada e a tarefa aceita dela, uma vista salva da mesa, a decisão respondida e
 * um contrato concluído (o primeiro ativo sem parcela em aberto).
 *
 * Saída: `homolog/provas/trabalho.json` e `homolog/provas/trabalho-*.png`.
 * Uso (Git Bash): node homolog/e2e/trabalho.mjs
 */
import { spawnSync } from 'node:child_process';
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
const SUFIXO = new Date().toISOString().slice(11, 19).replace(/:/g, '');

const prova = { inicio: new Date().toISOString(), web: WEB, sufixo: SUFIXO, passos: [], screenshots: [], semRolagemHorizontal: [], avisos: [], ok: false };
const t0 = Date.now();

function passo(nome, dados = {}) {
  const linha = { n: prova.passos.length + 1, nome, ms: Date.now() - t0, ...dados };
  prova.passos.push(linha);
  console.log(`  ${String(linha.n).padStart(2)}. ${nome}${dados.detalhe ? ` · ${dados.detalhe}` : ''}`);
}
function gravar() {
  prova.fim = new Date().toISOString();
  prova.duracaoMs = Date.now() - t0;
  const texto = JSON.stringify(prova, null, 2).replace(/\/s\/([A-Za-z0-9_-]{6})[A-Za-z0-9_-]{30,50}/g, '/s/$1…');
  writeFileSync(join(PROVAS, 'trabalho.json'), `${texto}\n`);
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
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  if (!r.ok) {
    const e = new Error(`${metodo} ${caminho} → ${r.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
    e.status = r.status;
    throw e;
  }
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
  const arquivo = `trabalho-${nome}.png`;
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}
function rodarScript(arquivo, env = {}) {
  const r = spawnSync(process.execPath, [join(RAIZ, 'homolog/e2e', arquivo)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  return { ok: r.status === 0, saida: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

/** Abre o pop-up pelo clique num ponto do cartão FORA do título e confere que abriu sem sair da tela. */
async function abrirPeloPonto(p, alvo, x, y, caminhoEsperado) {
  // Clique por coordenada, como o mouse de verdade: o que estiver por cima naquele
  // ponto (o "link esticado" do título, no cartão) é quem recebe.
  await alvo.scrollIntoViewIfNeeded();
  const caixa = await alvo.boundingBox();
  await p.mouse.click(caixa.x + x, caixa.y + y);
  await tid(p, 'tarefa-popup').waitFor({ timeout: 10_000 });
  const url = new URL(p.url());
  conferir(url.pathname === caminhoEsperado, `o pop-up levou para ${url.pathname} (devia ficar em ${caminhoEsperado})`);
  conferir(/^[0-9a-f-]{36}$/.test(url.searchParams.get('tarefa') ?? ''), 'o pop-up abriu sem ?tarefa= no endereço');
}
async function fecharPorEsc(p) {
  await p.keyboard.press('Escape');
  await tid(p, 'tarefa-popup').waitFor({ state: 'detached', timeout: 10_000 });
}

async function main() {
  conferir(SENHA, 'ADMIN_PASSWORD ausente em homolog/.env.homolog');
  const pessoas = { mesa: await entrar('mesa@root.homolog'), socio: await entrar('socio@root.homolog'), admin: await entrar('admin@marketing-os.local') };
  passo('mesa, sócio e admin entraram pela API');

  const estrutura = await api('GET', '/trabalho/estrutura', undefined, pessoas.mesa.token);
  const clientes = estrutura.folders.find((f) => !f.parentId && f.name === 'Clientes');
  const onb = clientes?.lists.find((l) => l.name === 'Onboarding de cliente');
  const execucao = clientes?.lists.find((l) => l.name === 'Execução');
  conferir(onb && execucao, 'a pasta Clientes devia ter as listas Onboarding de cliente e Execução');
  const cards = await api('GET', `/trabalho/tarefas?listId=${onb.id}`, undefined, pessoas.mesa.token);
  conferir(cards.items.length > 0, 'a lista da implantação está vazia (rode o db:seed:comercial)');

  // T4 pela API: sem cliente é 400; com o da casa, nasce.
  let semCliente = null;
  try { await api('POST', '/trabalho/tarefas', { listId: execucao.id, title: `Sem cliente ${SUFIXO}` }, pessoas.mesa.token); } catch (e) { semCliente = e.status; }
  conferir(semCliente === 400, `a tarefa sem cliente devia ser recusada (veio ${semCliente})`);
  let solta = null;
  try { await api('POST', '/trabalho/tarefas', { listId: onb.id, title: `Cliente solto ${SUFIXO}`, clienteId: 'interno' }, pessoas.mesa.token); } catch (e) { solta = e.message; }
  conferir(/Registrar cliente já fechado/.test(solta ?? ''), 'a lista da implantação aceitou cartão solto');
  const daProva = await api('POST', '/trabalho/tarefas', { listId: execucao.id, title: `Conferir a prova do trabalho ${SUFIXO}`, assignee: pessoas.mesa.user.name, clienteId: 'interno' }, pessoas.admin.token);
  await api('POST', `/trabalho/tarefas/${daProva.id}/comentarios`, { text: `Comentário da prova ${SUFIXO}.` }, pessoas.admin.token);
  conferir(daProva.clienteNome && /interno/.test(daProva.clienteNome), 'a tarefa com o cliente da casa não trouxe o nome');
  passo('T4 (API): sem cliente é 400; a implantação recusa cartão solto; com o cliente da casa a tarefa nasce', { detalhe: daProva.clienteNome });

  const navegador = await chromium.launch();
  try {
    const ctx = await contexto(navegador, pessoas.mesa, 'dark');
    const p = await ctx.newPage();

    // ---- T6: o menu comercial e /comercial ----
    await p.goto(`${WEB}/caixa`, { waitUntil: 'networkidle' });
    const hrefsComerciais = await p.locator('nav a[href^="/comercial"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    conferir(JSON.stringify(hrefsComerciais) === JSON.stringify(['/comercial/funil', '/comercial/contratos', '/comercial/simulador', '/comercial/torre', '/comercial/relatorio']),
      `o menu comercial devia ser Funil · Contratos · Simulador · Torre · Relatório (veio ${hrefsComerciais.join(', ')})`);
    conferir(await p.locator('nav a[title="Decisões do comercial"]').count() === 0, 'Decisões do comercial ainda está no menu');
    await p.goto(`${WEB}/comercial`, { waitUntil: 'networkidle' });
    conferir(new URL(p.url()).pathname === '/comercial/funil', `/comercial devia ir ao Funil vivo (foi a ${p.url()})`);
    passo('T6: o menu comercial sem Decisões, na ordem Funil · Contratos · Simulador · Torre · Relatório; /comercial vai ao Funil');

    // ---- T1: o menu Implantação abre o kanban ----
    await p.goto(`${WEB}/caixa`, { waitUntil: 'networkidle' });
    await p.locator('nav a[title="Implantação de clientes"]').first().click();
    await p.waitForURL(/\/trabalho\/implantacao/, { timeout: 20_000 });
    await p.locator('#root-os-main').getByRole('heading', { name: 'Implantação de clientes' }).waitFor({ timeout: 20_000 });
    await p.locator('[data-coluna]').first().waitFor({ timeout: 20_000 });
    conferir(await p.getByPlaceholder('Nova tarefa…').count() === 0, 'a implantação ainda tem "+ adicionar"');
    await p.goto(`${WEB}/onboarding`, { waitUntil: 'networkidle' });
    conferir(new URL(p.url()).pathname === '/trabalho/implantacao', `/onboarding devia redirecionar ao kanban (foi a ${p.url()})`);
    passo('T1: o menu "Implantação de clientes" abre o kanban da lista Onboarding de cliente, sem "+ adicionar"; /onboarding redireciona');

    for (const largura of [1280, 1440]) {
      await p.setViewportSize({ width: largura, height: 900 });
      await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
      await p.locator('[data-coluna]').first().waitFor({ timeout: 20_000 });
      const topos = await p.locator('[data-coluna]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      conferir(new Set(topos).size === 1, `a ${largura} px há coluna abaixo de outra (topos ${topos.join(',')})`);
      const q = await tid(p, 'trabalho-quadro').evaluate((el) => ({ scroll: el.scrollWidth, cliente: el.clientWidth, overflow: getComputedStyle(el).overflowX }));
      conferir(q.overflow === 'auto' && q.scroll > q.cliente, `a ${largura} px o quadro devia rolar para o lado (${JSON.stringify(q)})`);
      const pagina = await p.evaluate(() => ({ larg: document.documentElement.scrollWidth > window.innerWidth + 1, alt: document.scrollingElement.scrollHeight > window.innerHeight + 2 }));
      conferir(!pagina.larg && !pagina.alt, `a ${largura} px a página rola inteira (${JSON.stringify(pagina)})`);
      const ultima = p.locator('[data-coluna]').last();
      await tid(p, 'trabalho-chips-de-etapa').locator('button').last().click();
      await p.waitForTimeout(700);
      const caixa = await ultima.boundingBox();
      conferir(caixa && caixa.x + caixa.width <= largura + 1 && caixa.x >= 0, `o chip da última etapa não levou até a coluna a ${largura} px`);
      passo(`T1: a ${largura} px as ${topos.length} colunas ficam numa linha, o quadro rola para o lado e o chip leva à última etapa`, { detalhe: `${q.scroll} > ${q.cliente}` });
      if (largura === 1440) await foto(p, 'implantacao-escuro');
    }

    // ---- T1/T2: o clique fora do título, em todas as densidades ----
    const card = p.locator('[data-work-task-id]').first();
    const cardId = await card.getAttribute('data-work-task-id');
    for (const d of ['compacto', 'medio', 'cheio']) {
      await tid(p, `trabalho-densidade-${d}`).click();
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      await abrirPeloPonto(p, card, box.width - 5, 5, '/trabalho/implantacao');
      await fecharPorEsc(p);
      const rodape = tid(p, `trabalho-rodape-${cardId}`);
      const rb = await rodape.boundingBox();
      await abrirPeloPonto(p, rodape, Math.max(4, rb.width - 6), rb.height / 2, '/trabalho/implantacao');
      if (d === 'compacto') await foto(p, 'popup-escuro');
      await p.goBack();
      await tid(p, 'tarefa-popup').waitFor({ state: 'detached', timeout: 10_000 });
      conferir(!new URL(p.url()).searchParams.get('tarefa'), 'voltar do navegador não tirou ?tarefa= do endereço');
    }
    passo('T1/T2: o canto e o rodapé do cartão abrem o pop-up nas três densidades; Esc e o voltar do navegador fecham');

    await tid(p, 'trabalho-densidade-medio').click();
    const atalho = p.locator('[data-testid^="trabalho-trilho-"]').first();
    if (await atalho.count()) {
      await atalho.click();
      await tid(p, 'tarefa-trilho').waitFor({ timeout: 15_000 });
      conferir(new URL(p.url()).searchParams.get('tarefaAba') === 'trilho', 'o atalho do trilho não abriu a aba Trilho');
      await foto(p, 'popup-trilho-escuro');
      await fecharPorEsc(p);
      passo('T1/T2: o atalho do trilho abre o pop-up na aba Trilho, com a bancada');
    } else {
      prova.avisos.push('Nenhum cartão da implantação com trilho ligado: a aba Trilho ficou sem prova no navegador (coberta no teste de tela).');
    }
    await tid(p, 'trabalho-densidade-compacto').click();

    // ---- T2: Pendências e Minhas tarefas abrem o pop-up sem sair ----
    await p.goto(`${WEB}/caixa?aba=atividade`, { waitUntil: 'networkidle' });
    const item = p.locator('[data-testid^="caixa-item-"]').first();
    await item.waitFor({ timeout: 20_000 });
    const ib = await item.boundingBox();
    await abrirPeloPonto(p, item, 8, ib.height - 6, '/caixa');
    await fecharPorEsc(p);
    passo('T2: na Atividade de Pendências o clique na linha abre o pop-up sem sair de /caixa');
    await p.goto(`${WEB}/caixa?aba=tarefas`, { waitUntil: 'networkidle' });
    const linha = tid(p, `caixa-tarefa-${daProva.id}`);
    await linha.waitFor({ timeout: 20_000 });
    const lb = await linha.boundingBox();
    await abrirPeloPonto(p, linha, Math.round(lb.width * 0.45), lb.height / 2, "/caixa");
    await fecharPorEsc(p);
    passo('T2: em Minhas tarefas o clique na linha abre o pop-up sem sair de /caixa');

    // ---- T3: vista salva, padrão, reaplicada depois de recarregar ----
    const nomeDaVista = `Prova ${SUFIXO}`;
    await tid(p, 'caixa-agrupar').selectOption('vencimento');
    await tid(p, 'caixa-ordem-campo').selectOption('cliente');
    p.once('dialog', (d) => void d.accept(nomeDaVista));
    await tid(p, 'caixa-vista-salvar-como').click();
    await p.locator('[role="status"]', { hasText: `Vista "${nomeDaVista}" salva.` }).waitFor({ timeout: 10_000 });
    const vistas = await api('GET', '/trabalho/vistas?tela=minhas-tarefas', undefined, pessoas.mesa.token);
    const minha = vistas.find((v) => v.nome === nomeDaVista);
    conferir(minha, 'a vista não foi gravada no servidor');
    if (!minha.padrao) {
      await tid(p, 'caixa-vista-padrao').click();
      await p.locator('[role="status"]', { hasText: 'vista padrão' }).waitFor({ timeout: 10_000 });
    }
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForFunction((id) => document.querySelector('[data-testid="caixa-vista"]')?.value === id, minha.id, { timeout: 15_000 });
    conferir(await tid(p, 'caixa-agrupar').inputValue() === 'vencimento', 'a vista padrão não reaplicou o agrupamento');
    conferir(await tid(p, 'caixa-ordem-campo').inputValue() === 'cliente', 'a vista padrão não reaplicou a ordenação');
    await foto(p, 'minhas-tarefas-vista-escuro');
    passo('T3: a vista salva no servidor, marcada padrão, volta depois de recarregar (agrupada por vencimento, ordenada por cliente)', { detalhe: nomeDaVista });

    // ---- T4: a tarefa nova exige cliente na tela ----
    await p.goto(`${WEB}/trabalho?lista=${execucao.id}`, { waitUntil: 'networkidle' });
    const nova = p.locator('[data-coluna] [data-testid^="trabalho-nova-"]').first();
    await nova.waitFor({ timeout: 20_000 });
    const tituloNovo = `Enviar o resumo da prova ${SUFIXO}`;
    await nova.getByLabel('Nome da nova tarefa').fill(tituloNovo);
    const criar = nova.getByRole('button', { name: 'Criar tarefa' });
    conferir(await criar.isDisabled(), '"Criar tarefa" devia ficar travado sem cliente');
    await nova.locator('[role="combobox"]').click();
    await tid(p, 'opcao-cliente-interno').first().click();
    await criar.click();
    let criada = null;
    for (let i = 0; i < 20 && !criada; i++) {
      const r = await api('GET', `/trabalho/tarefas?listId=${execucao.id}&q=${encodeURIComponent(tituloNovo)}`, undefined, pessoas.mesa.token);
      criada = r.items.find((t) => t.title === tituloNovo) ?? null;
      if (!criada) await p.waitForTimeout(400);
    }
    conferir(criada?.clienteId, 'a tarefa nova da tela não nasceu com o cliente');
    passo('T4: na tela, "Criar tarefa" fica travado até escolher o cliente; a tarefa nasce com ele', { detalhe: criada.clienteNome });

    // ---- T5: a sugestão da ata editada e aceita ----
    const ata = await api('POST', '/trabalho/atas', { titulo: `Ata da prova do trabalho ${SUFIXO}`, texto: readFileSync(join(RAIZ, 'homolog/fixtures/ata-trabalho-exemplo.md'), 'utf8') }, pessoas.admin.token);
    const ref = ata.id ?? ata.ref;
    await api('POST', `/trabalho/atas/${encodeURIComponent(ref)}/sugestoes`, {}, pessoas.admin.token);
    const sugs = await api('GET', `/trabalho/atas/sugestoes?ata=${encodeURIComponent(ref)}&estado=rascunho`, undefined, pessoas.mesa.token);
    const lista = Array.isArray(sugs) ? sugs : sugs.sugestoes ?? sugs.itens ?? [];
    conferir(lista.length > 0, 'a ata da prova não gerou sugestão');
    const sug = lista[0];
    const ctxAdmin = await contexto(navegador, pessoas.admin, 'dark');
    const pa = await ctxAdmin.newPage();
    await pa.goto(`${WEB}/trabalho/atas?ata=${encodeURIComponent(ref)}`, { waitUntil: 'networkidle' });
    await tid(pa, `ata-formulario-${sug.id}`).waitFor({ timeout: 30_000 });
    const tituloEditado = `Revisar o relatório da prova ${SUFIXO}`;
    await tid(pa, `ata-titulo-${sug.id}`).fill(tituloEditado);
    await tid(pa, `ata-descricao-${sug.id}`).fill('Conferir os números e mandar no grupo.');
    const pessoasDaCasa = await api('GET', '/trabalho/pessoas', undefined, pessoas.admin.token);
    const rodrigo = pessoasDaCasa.find((x) => x.id === pessoas.socio.user.id) ?? pessoasDaCasa[0];
    await tid(pa, `ata-responsavel-${sug.id}`).selectOption(rodrigo.id);
    await tid(pa, `ata-cliente-${sug.id}`).locator('[role="combobox"]').click();
    await tid(pa, 'opcao-cliente-interno').first().click();
    await tid(pa, `ata-pasta-${sug.id}`).selectOption({ label: 'Clientes' });
    await tid(pa, `ata-lista-${sug.id}`).selectOption({ label: 'Execução' });
    await foto(pa, 'ata-aceite-escuro');
    await tid(pa, `ata-aceitar-${sug.id}`).click();
    let aceita = null;
    for (let i = 0; i < 30 && !aceita?.workTaskId; i++) {
      const s = await api('GET', `/trabalho/atas/sugestoes?ata=${encodeURIComponent(ref)}`, undefined, pessoas.mesa.token);
      aceita = (Array.isArray(s) ? s : s.sugestoes ?? s.itens ?? []).find((x) => x.id === sug.id) ?? null;
      if (!aceita?.workTaskId) await pa.waitForTimeout(400);
    }
    conferir(aceita?.workTaskId, 'aceitar a sugestão editada não criou a tarefa');
    const daAta = await api('GET', `/trabalho/tarefas/${aceita.workTaskId}`, undefined, pessoas.mesa.token);
    conferir(daAta.title === tituloEditado, `o título editado não foi (veio ${daAta.title})`);
    conferir(daAta.description.startsWith('Conferir os números e mandar no grupo.'), 'o que será executado não abriu a descrição');
    conferir(/> /.test(daAta.description), 'o trecho da ata sumiu da procedência');
    conferir(daAta.assignee === rodrigo.nome, `o responsável devia ser o perfil escolhido (veio ${daAta.assignee})`);
    conferir(daAta.clienteId && daAta.listId === execucao.id, 'o cliente ou a lista escolhida não foram');
    await ctxAdmin.close();
    passo('T5: a sugestão da ata editada (título, o que será executado, responsável de perfil, cliente, pasta e lista) virou a tarefa', { detalhe: `${daAta.title} · ${daAta.assignee}` });

    // ---- T6: uma decisão do comercial tomada pela aba Decisões ----
    const fila = await api('GET', '/comercial/fila', undefined, pessoas.mesa.token);
    const decisoes = (fila.itens ?? fila.decisoes ?? []).filter((d) => Array.isArray(d.opcoes) && d.opcoes.length > 0);
    await p.goto(`${WEB}/caixa?aba=decisoes`, { waitUntil: 'networkidle' });
    await tid(p, 'caixa-decisoes-lista').waitFor({ timeout: 20_000 });
    await foto(p, 'pendencias-decisoes-escuro');
    if (decisoes.length) {
      const d = decisoes[0];
      const artigo = p.locator(`article[id*="${d.id}"]`).first();
      const botao = (await artigo.count()) ? artigo.getByRole('button').first() : tid(p, 'caixa-decisoes-lista').locator('article').first().getByRole('button').first();
      await botao.click();
      await tid(p, 'caixa-decisoes-aviso').filter({ hasText: /./ }).waitFor({ timeout: 15_000 });
      passo('T6: uma decisão do comercial tomada com um toque na aba Decisões de Pendências', { detalhe: d.tipo ?? d.id });
    } else {
      prova.avisos.push('Nenhuma decisão do comercial pendente: a resposta pela aba Decisões ficou sem prova no navegador (coberta no teste de tela).');
    }

    // ---- T8: concluir um contrato com motivo ----
    const contratos = await api('GET', '/comercial/contratos', undefined, pessoas.mesa.token);
    const alvo = contratos.find((c) => (c.situacao === 'ativo' || c.situacao === 'em_implantacao') && c.parcelas.every((x) => x.estado === 'paga'))
      ?? contratos.find((c) => c.situacao === 'ativo' || c.situacao === 'em_implantacao');
    conferir(alvo, 'nenhum contrato vivo ativo na homologação');
    await p.goto(`${WEB}/comercial/contratos`, { waitUntil: 'networkidle' });
    await tid(p, `contrato-${alvo.leadId}`).waitFor({ timeout: 20_000 });
    const antes = Number(await tid(p, 'contratos-contagem-concluido').locator('span').first().innerText());
    await foto(p, 'contratos-escuro');
    await tid(p, `contrato-concluir-${alvo.leadId}`).click();
    await tid(p, 'contrato-motivo').fill(`Escopo entregue na prova ${SUFIXO}.`);
    if (await tid(p, 'contrato-ciente').count()) await tid(p, 'contrato-ciente').check();
    await tid(p, 'contrato-confirmar').click();
    await p.waitForFunction((id) => document.querySelector(`[data-testid="contrato-${id}"]`)?.getAttribute('data-situacao') === 'concluido', alvo.leadId, { timeout: 20_000 });
    const depois = Number(await tid(p, 'contratos-contagem-concluido').locator('span').first().innerText());
    conferir(depois === antes + 1, `o painel devia recontar os concluídos (${antes} → ${depois})`);
    const ordem = await tid(p, 'contratos-lista').locator('li[data-situacao]').evaluateAll((lis) => lis.map((li) => li.getAttribute('data-situacao')));
    const primeiroEncerrado = ordem.findIndex((s) => s === 'concluido' || s === 'desativado');
    conferir(primeiroEncerrado >= 0 && ordem.slice(primeiroEncerrado).every((s) => s === 'concluido' || s === 'desativado'), `os encerrados deviam ficar por último (${ordem.join(',')})`);
    const fio = (await api('GET', `/comercial/lead/${alvo.leadId}/fio`, undefined, pessoas.mesa.token)).fio;
    conferir(fio.some((l) => l.type === 'contrato.concluido'), 'o fio do lead não registrou o contrato concluído');
    passo('T8: o contrato concluído com motivo vai para o fim da lista, o painel reconta e o fio registra', { detalhe: `${alvo.cliente} · concluídos ${antes} → ${depois}` });

    // ---- fotos: escuro, claro e 390 px; nenhuma página rola na horizontal no celular ----
    const telas = [
      { nome: 'implantacao', url: '/trabalho/implantacao', pronto: '[data-coluna]' },
      { nome: 'popup', url: `/trabalho/implantacao?tarefa=${cardId}`, pronto: '[data-testid="tarefa-popup"]' },
      { nome: 'pendencias-atividade', url: '/caixa?aba=atividade', pronto: '[data-testid="caixa-aba-atividade"]' },
      { nome: 'minhas-tarefas', url: '/caixa?aba=tarefas', pronto: '[data-testid="caixa-vista"]' },
      { nome: 'pendencias-decisoes', url: '/caixa?aba=decisoes', pronto: '[data-testid="caixa-decisoes-lista"]' },
      { nome: 'trabalho', url: `/trabalho?lista=${execucao.id}`, pronto: '[data-coluna]' },
      { nome: 'atas', url: `/trabalho/atas?ata=${encodeURIComponent(ref)}`, pronto: 'article' },
      { nome: 'contratos', url: '/comercial/contratos', pronto: '[data-testid="contratos-painel"]' },
    ];
    for (const [tema, viewport, sufixo] of [['light', { width: 1440, height: 900 }, 'claro'], ['dark', { width: 390, height: 844 }, '390']]) {
      const c = await contexto(navegador, pessoas.mesa, tema, viewport);
      const pg = await c.newPage();
      for (const t of telas) {
        await pg.goto(`${WEB}${t.url}`, { waitUntil: 'networkidle' });
        await pg.locator(t.pronto).first().waitFor({ timeout: 30_000 });
        if (sufixo === '390') {
          const rola = await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
          prova.semRolagemHorizontal.push({ tela: t.nome, rola });
          conferir(!rola, `${t.nome} rola na horizontal a 390 px`);
        }
        await foto(pg, `${t.nome}-${sufixo}`);
      }
      await c.close();
    }
    passo('fotos das telas mexidas em escuro, claro e 390 px; nenhuma página rola na horizontal no celular', { detalhe: `${prova.screenshots.length} fotos` });
  } finally {
    await navegador.close();
  }

  // ---- T7 e T1b: os roteiros das lanes ----
  // A prova do R4 com senha precisa de um R4 pendente para a titular em qualquer horário:
  // a jornada para no R4 da cobrança (JORNADA_PARAR_NO_R4) e o T7 o aprova na linha.
  let envT7 = {};
  if (!process.env.T7_R4_ID) {
    const j = rodarScript('jornada-docker.mjs', { JORNADA_PARAR_NO_R4: '1' });
    const id = /^R4 pendente: ([0-9a-f-]{36})\s*$/m.exec(j.saida)?.[1];
    if (id) envT7 = { T7_R4_ID: id };
    else prova.avisos.push(`A jornada não deixou um R4 pendente (${j.saida.split(/\r?\n/).filter((l) => /FALHOU/.test(l)).slice(0, 1).join('')}).`);
  }
  const t7 = rodarScript('trabalho-t7.mjs', envT7);
  conferir(t7.ok, `trabalho-t7.mjs falhou: ${t7.saida.split(/\r?\n/).filter((l) => /FALHOU|OK/.test(l)).slice(-2).join(' | ')}`);
  for (const l of t7.saida.split(/\r?\n/).filter((x) => /^\s+\d+\./.test(x))) prova.passos.push({ n: prova.passos.length + 1, nome: `T7 · ${l.trim()}`, ms: Date.now() - t0 });
  if (/OK, com avisos/.test(t7.saida)) prova.avisos.push(...t7.saida.split('OK, com avisos:')[1].split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((x) => `T7: ${x}`));
  passo('T7: trabalho-t7.mjs passou (R3 na linha, R4 com senha no lugar, vencida pedir de novo)');
  if (existsSync(join(RAIZ, 'homolog/e2e/trabalho-t1b.mjs'))) {
    const t1b = rodarScript('trabalho-t1b.mjs');
    conferir(t1b.ok, `trabalho-t1b.mjs falhou: ${t1b.saida.split(/\r?\n/).filter((l) => /FALHOU|OK/.test(l)).slice(-2).join(' | ')}`);
    if (/sem storage/.test(t1b.saida)) {
      passo('T1b: trabalho-t1b.mjs passou SEM storage: o formulário do Funil vivo preenchido, o registro recusou antes de gravar e nenhum lead nasceu');
      prova.avisos.push('T1b: a homologação não tem storage (MinIO sem imagem nesta máquina); o caminho completo (fechamento R4 assinado, card na implantação, contrato vivo) está provado na suíte da API comercial-fechado-fora.');
    } else {
      passo('T1b: trabalho-t1b.mjs passou (registrar cliente já fechado pelo Funil vivo, a titular assina e o card nasce na implantação)');
    }
  } else {
    prova.avisos.push('trabalho-t1b.mjs ainda não existe: o registrar cliente já fechado ficou sem prova no navegador.');
  }
  prova.ok = true;
}

main()
  .then(() => {
    gravar();
    console.log(prova.avisos.length ? `\nOK, com avisos:\n  ${prova.avisos.join('\n  ')}` : '\nOK');
  })
  .catch((e) => {
    gravar();
    console.error(`\nFALHOU: ${e.message}`);
    process.exit(1);
  });
