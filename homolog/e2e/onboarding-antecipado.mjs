#!/usr/bin/env node
/*
 * A PROVA DO ONBOARDING ANTES DO NEGÓCIO FECHADO (ajustes da versão final A2, 19/10/2026),
 * CONTRA A STACK DO SEED EM DOCKER.
 *
 * Mesmo arranjo do `implantacao.mjs`: Playwright (Chromium) da pasta de ferramentas da
 * máquina (`UX_PW`, padrão `C:/Users/User/dev/pw-tools`), o web em `UX_WEB`, a API em
 * `UX_API`, os dublês do Asaas e da ZapSign em `JORNADA_ASAAS` e `JORNADA_ZAPSIGN`, a senha
 * lida de `HOMOLOG_ENV` em tempo de execução (nunca copiada para arquivo commitado).
 *
 * O que ela prova (docs/comercial/RODADA-AJUSTES-20261019.md, A2 e A3):
 *   1. um lead do seed com a proposta publicada (padrão "Rede Pão Bom", E7 Follow-up; troque
 *      por `ANTECIPADO_LEAD`) ganha o card da implantação pelo botão "Iniciar onboarding" do
 *      painel do lead, na etapa padrão "Kickoff marcado", ainda antes do fechamento;
 *   2. o card aparece na Implantação com o selo "Iniciado antes do fechamento · lead em …",
 *      e o clique abre o pop-up com o trilho de onboarding ligado a ele;
 *   3. o negócio fecha pelos passos da jornada (`jornada-docker.mjs`, 15 a 20): aceite na sala,
 *      cobrança e contrato pela porta (R4, a titular assina com senha e motivo), pagamento no
 *      dublê do Asaas, assinatura do cliente e da Root no dublê da ZapSign, fechamento pela
 *      porta (R4). Nenhum toque da régua é pulado;
 *   4. continua UM card só: a escrita do card é "reaproveitado" com o mesmo id, o selo de antes
 *      do fechamento saiu, o comentário "Fechamento comercial" está no card e o fato
 *      `implantacao.fechamento_registrado` está no fio uma vez.
 * e fotografa o painel, o quadro e o pop-up em escuro (`onboarding-antecipado-*.png`).
 *
 * ESCREVE na stack: o card, o trilho e o cliente do lead escolhido, o aceite dele, a cobrança e
 * o contrato nos dublês, e o fechamento. Por isso o lead padrão não é a Alicerce (o `ux-painel.mjs`
 * lê a sala dela). Lead que já tem card é recusado: rode com outro `ANTECIPADO_LEAD`.
 *
 * Saída: `homolog/provas/<PROVAS_PREFIXO>onboarding-antecipado.json` e as fotos.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.UX_API ?? 'http://127.0.0.1:4031/api';
const WEB = process.env.UX_WEB ?? 'http://127.0.0.1:3031';
const ASAAS = process.env.JORNADA_ASAAS ?? 'http://127.0.0.1:4032';
const ZAPSIGN = process.env.JORNADA_ZAPSIGN ?? 'http://127.0.0.1:4033';
const PW = process.env.UX_PW ?? 'C:/Users/User/dev/pw-tools';
const NOME_DO_LEAD = process.env.ANTECIPADO_NOME ?? 'Rede Pão Bom';
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
const SENHA = lerEnv(process.env.HOMOLOG_ENV ?? join(RAIZ, 'homolog/.env.final-seed')).ADMIN_PASSWORD;
const SUFIXO = Date.now().toString().slice(-8);

const prova = { inicio: new Date().toISOString(), web: WEB, passos: [], screenshots: [], ok: false };
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
  writeFileSync(join(PROVAS, `${process.env.PROVAS_PREFIXO ?? ''}onboarding-antecipado.json`), `${texto}\n`);
}
function conferir(cond, msg) {
  if (!cond) throw new Error(msg);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(metodo, url, corpo, token) {
  const r = await fetch(url, {
    method: metodo,
    headers: { accept: 'application/json', ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    redirect: 'manual',
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: r.status, json };
}
async function api(metodo, caminho, corpo, token) {
  const { status, json } = await http(metodo, `${API}${caminho}`, corpo, token);
  if (status >= 400) throw new Error(`${metodo} ${caminho} → ${status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}
async function esperar(descricao, fn, { ms = 30_000, cada = 1000 } = {}) {
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    const r = await fn();
    if (r) return r;
    await dormir(cada);
  }
  throw new Error(`esperei ${Math.round(ms / 1000)} s e não aconteceu: ${descricao}`);
}
async function entrar(email) {
  const r = await api('POST', '/auth/login', { email, password: SENHA });
  return { token: r.token ?? r.accessToken, user: r.user };
}

/** Confirma pela MESMA rota de /atendimento: R4 vai à titular com senha e motivo; quem pediu não assina. */
async function confirmar(approvalId, pessoas, porque) {
  const lista = await api('GET', '/approvals?status=pendente', undefined, pessoas.mesa.token);
  const a = lista.items.find((x) => x.id === approvalId);
  conferir(a, `a aprovação ${approvalId} não está pendente na fila`);
  const quem = a.alcadaMinima === 'titular' ? pessoas.socio : pessoas.mesa;
  const corpo = a.exigeReauth ? { reauth: { senha: SENHA }, motivo: `conferi na homologação: ${porque}` } : {};
  const r = await api('POST', `/approvals/${approvalId}/confirm`, corpo, quem.token);
  conferir(r?.execucao?.status === 'executado', `a confirmação de ${a.capacidade} não executou (${r?.execucao?.status})`);
  return { nivel: a.nivel, capacidade: a.capacidade, quem: quem.user.email };
}

async function contexto(navegador, sessao, tema = 'dark', viewport = { width: 1440, height: 900 }) {
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
  const arquivo = `${process.env.PROVAS_PREFIXO ?? ''}onboarding-antecipado-${nome}.png`;
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: join(PROVAS, arquivo), fullPage: false });
  prova.screenshots.push(arquivo);
}

/** O lead: `ANTECIPADO_LEAD`, ou o do seed com o nome pedido, em Proposta ou Follow-up e sem card. */
async function escolherLead(pessoas) {
  if (process.env.ANTECIPADO_LEAD) return process.env.ANTECIPADO_LEAD;
  const funil = await api('GET', '/comercial/funil', undefined, pessoas.mesa.token);
  for (const coluna of funil.colunas.filter((c) => ['proposta', 'follow_up'].includes(c.etapa))) {
    const c = coluna.cartoes.find((x) => [x.empresa, x.nome].includes(NOME_DO_LEAD));
    if (c) return c.leadId;
  }
  throw new Error(`nenhum lead "${NOME_DO_LEAD}" em Proposta ou Follow-up no funil: rode com ANTECIPADO_LEAD=<id>`);
}

async function main() {
  conferir(SENHA, 'ADMIN_PASSWORD ausente no env da homologação (HOMOLOG_ENV)');
  for (const [nome, url] of [['Asaas', ASAAS], ['ZapSign', ZAPSIGN]]) {
    const h = await http('GET', `${url}/health`);
    conferir(h.status === 200, `o dublê do ${nome} não respondeu em ${url}/health`);
  }
  const pessoas = {
    admin: await entrar('admin@marketing-os.local'),
    mesa: await entrar('mesa@root.homolog'),
    socio: await entrar('socio@root.homolog'),
  };
  passo('admin, mesa e sócio entraram pela API; os dublês respondem');

  const leadId = await escolherLead(pessoas);
  const antes = await api('GET', `/comercial/lead/${leadId}`, undefined, pessoas.mesa.token);
  conferir(['proposta', 'follow_up'].includes(antes.etapa), `o lead devia estar em Proposta ou Follow-up (está em ${antes.etapa})`);
  conferir(!antes.ligadoA?.implantacao, 'o lead já tem card da implantação: rode com outro ANTECIPADO_LEAD');
  conferir(antes.ligadoA?.proposta, 'o lead não tem proposta publicada: o fechamento pela jornada precisa dela');
  passo('o lead do seed está em andamento, com proposta e sem card', { leadId, detalhe: `${antes.empresa ?? antes.nome} · ${antes.etapa}` });

  const navegador = await chromium.launch();
  try {
    // ---- 1. Iniciar onboarding pelo painel do lead ----
    const ctx = await contexto(navegador, pessoas.admin);
    const p = await ctx.newPage();
    await p.goto(`${WEB}/comercial/funil?lead=${leadId}&aba=fio`, { waitUntil: 'networkidle' });
    const bloco = tid(p, 'lead-iniciar-onboarding');
    await bloco.waitFor({ timeout: 30_000 });
    await bloco.getByRole('button', { name: 'Iniciar onboarding' }).click();
    const etapa = bloco.getByLabel('etapa de entrada');
    await etapa.waitFor({ timeout: 10_000 });
    await p.waitForFunction(() => document.querySelector('[data-testid="lead-iniciar-onboarding"] select')?.value === 'Kickoff marcado', null, { timeout: 10_000 });
    await foto(p, 'painel-escolha');
    await bloco.getByRole('button', { name: 'Iniciar onboarding' }).click();
    await tid(p, 'lead-onboarding-link').waitFor({ timeout: 30_000 });
    await tid(p, 'lead-card-implantacao').waitFor({ timeout: 30_000 });
    await foto(p, 'painel-iniciado');
    passo('o botão "Iniciar onboarding" do painel abriu o card (etapa padrão Kickoff marcado) e o painel mostra o link');

    const ficha = await api('GET', `/comercial/lead/${leadId}`, undefined, pessoas.mesa.token);
    const cardId = ficha.ligadoA?.implantacao?.cardId;
    const trilhoId = ficha.ligadoA?.implantacao?.trilhoId;
    conferir(cardId && trilhoId, 'a ficha não aponta para o card e o trilho (retrolinks lead → card → trilho)');
    conferir(ficha.etapa === antes.etapa, `iniciar o onboarding não move a etapa do funil (foi de ${antes.etapa} para ${ficha.etapa})`);
    const card = await api('GET', `/trabalho/tarefas/${cardId}`, undefined, pessoas.mesa.token);
    conferir(card.listName === 'Onboarding de cliente' && card.statusName === 'Kickoff marcado', `o card devia nascer em Onboarding de cliente · Kickoff marcado (está em ${card.listName} · ${card.statusName})`);
    conferir(card.clienteId, 'o card nasceu sem cliente (T4: todo card novo tem cliente)');
    conferir(/Procedência: iniciado antes do fechamento/.test(card.description ?? ''), 'a descrição do card não tem a procedência de antes do fechamento');
    const mov = await api('GET', `/trabalho/quadro/movimento?listId=${card.listId}`, undefined, pessoas.mesa.token);
    const selo = mov.itens.find((i) => i.tarefaId === cardId)?.procedencia;
    conferir(selo?.tipo === 'antecipado' && /^Iniciado antes do fechamento · lead em /.test(selo.rotulo), `o selo devia ser o de antes do fechamento (veio ${JSON.stringify(selo)})`);
    const fio = (await api('GET', `/comercial/lead/${leadId}/fio`, undefined, pessoas.mesa.token)).fio;
    conferir(fio.filter((l) => l.type === 'implantacao.iniciada_antes_do_fechamento').length === 1, 'o fio devia ter um implantacao.iniciada_antes_do_fechamento');
    passo('o card: Onboarding de cliente · Kickoff marcado, com cliente, selo e o fato no fio', { cardId, detalhe: selo.rotulo });

    // ---- 2. A Implantação: o selo no card e o pop-up com o trilho ----
    await p.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    await tid(p, `trabalho-rodape-${cardId}`).waitFor({ timeout: 30_000 });
    if (await tid(p, 'trabalho-densidade-cheio').count()) await tid(p, 'trabalho-densidade-cheio').click();
    await tid(p, `trabalho-procedencia-${cardId}`).waitFor({ timeout: 15_000 });
    const textoDoSelo = await tid(p, `trabalho-procedencia-${cardId}`).innerText();
    conferir(/Iniciado antes do fechamento/.test(textoDoSelo), `o card na Implantação devia mostrar o selo (veio "${textoDoSelo}")`);
    conferir((await tid(p, 'implantacao-iniciar-onboarding').count()) === 1, 'a Implantação devia ter o botão "Iniciar onboarding" no topo');
    await foto(p, 'quadro-com-selo');
    await p.getByRole('button', { name: card.title, exact: true }).click();
    await p.getByRole('dialog').first().waitFor({ timeout: 10_000 });
    await p.goto(`${WEB}/trabalho/implantacao?tarefa=${cardId}&tarefaAba=trilho`, { waitUntil: 'networkidle' });
    const dialogo = p.getByRole('dialog').first();
    await dialogo.waitFor({ timeout: 15_000 });
    await dialogo.locator(`a[href="/onboarding/${trilhoId}/roteiro"]`).first().waitFor({ timeout: 15_000 });
    await foto(p, 'popup-trilho');
    await p.keyboard.press('Escape');
    passo('na Implantação o card mostra o selo, e o pop-up abre o trilho ligado a ele', { detalhe: textoDoSelo });
    await ctx.close();

    // ---- 3. O negócio fecha pela jornada (passos 15 a 20 do jornada-docker.mjs) ----
    const conversa = await api('GET', `/comercial/simulador/lead/${leadId}`, undefined, pessoas.mesa.token);
    const token = /\/s\/([A-Za-z0-9_-]{40,48})/.exec(conversa.linkDaSala ?? '')?.[1];
    conferir(token, 'o simulador não devolveu o link da sala do lead (o provedor da homologação é o simulado?)');
    const naSala = async (caminho, corpo) => {
      const { status, json } = await http('POST', `${API}/sala/${token}${caminho}`, corpo ?? {});
      if (status >= 400) throw new Error(`POST /sala/:token${caminho} → ${status}: ${JSON.stringify(json)}`);
      return json;
    };
    let s = await naSala('/visita');
    const versao = s.proposta?.versao;
    conferir(s.estagio === 'proposta' && versao, `a sala devia estar em "proposta" com a proposta vigente (está em ${s.estagio})`);
    const produto = ficha.produto ?? 'operacao';
    const forma = produto === 'imersao' ? 'cartao' : 'pix';
    await naSala('/aceite/dados', { cnpj: `8${SUFIXO}00000`, razaoSocial: `${antes.empresa ?? antes.nome} Ltda`, endereco: 'Rua Fictícia, 200, Juiz de Fora, MG', quemAssina: 'Contato Fictício', email: `contato.${SUFIXO}@antecipado.homolog` });
    await naSala('/aceite/pagamento', { produto, forma, versao });
    s = await naSala('/aceite/contrato', {});
    passo('o cliente aceita na sala (dados, pagamento e contrato)', { detalhe: `${produto} · ${forma}` });

    const r4 = await esperar('as duas aprovações R4 do aceite', async () => {
      const l = await api('GET', '/approvals?status=pendente', undefined, pessoas.mesa.token);
      const doLead = l.items.filter((a) => String(a.recurso?.id ?? '').includes(leadId));
      const cob = doLead.find((a) => a.capacidade === 'comercial.cobranca.criar');
      const ctr = doLead.find((a) => a.capacidade === 'comercial.contrato.enviar');
      return cob && ctr ? { cob, ctr } : null;
    });
    conferir(r4.cob.nivel === 'R4' && r4.ctr.nivel === 'R4', 'cobrança e contrato deviam ser R4');
    await confirmar(r4.cob.id, pessoas, 'obrigação financeira com o cliente (R4)');
    await confirmar(r4.ctr.id, pessoas, 'contrato enviado para assinatura (R4)');
    s = await naSala('/visita');
    const linkPagamento = s.aceite?.cobranca?.linkPagamento;
    const linkAssinatura = s.aceite?.contrato?.linkAssinatura;
    conferir(linkPagamento && linkAssinatura, 'a sala devia mostrar o link de pagamento e o de assinatura');
    passo('cobrança e contrato pela porta: R4, a titular assinou com senha e motivo');

    const pagamentoId = /\/fatura\/([\w-]+)/.exec(linkPagamento)?.[1];
    const pago = await http('POST', `${ASAAS}/simular/pagar/${pagamentoId}`);
    conferir(pago.status < 400, `o dublê do Asaas recusou o pagamento (${pago.status})`);
    await esperar('a 1ª parcela paga no fio', async () => (await api('GET', `/comercial/lead/${leadId}/fio`, undefined, pessoas.mesa.token)).fio.find((l) => ['pix.pago', 'boleto.pago', 'cartao.pago'].includes(l.type)));
    const tokCliente = /\/assinar\/([\w-]+)/.exec(linkAssinatura)?.[1];
    const assinou = await http('POST', `${ZAPSIGN}/simular/assinar/${tokCliente}`);
    conferir(assinou.status < 400, `o dublê da ZapSign recusou a assinatura do cliente (${assinou.status})`);
    await esperar('contrato.assinado_cliente no fio', async () => (await api('GET', `/comercial/lead/${leadId}/fio`, undefined, pessoas.mesa.token)).fio.find((l) => l.type === 'contrato.assinado_cliente'));
    const pelaRoot = await api('POST', `/comercial/contratos/${leadId}/assinar-pela-root`, { senha: SENHA }, pessoas.admin.token);
    const tokRoot = /\/assinar\/([\w-]+)/.exec(pelaRoot.linkAssinatura ?? '')?.[1];
    conferir(tokRoot, 'a rota não devolveu o link de assinatura da Root');
    const assinouRoot = await http('POST', `${ZAPSIGN}/simular/assinar/${tokRoot}`);
    conferir(assinouRoot.status < 400, `o dublê da ZapSign recusou a assinatura da Root (${assinouRoot.status})`);
    await esperar('contrato.assinado_root no fio', async () => (await api('GET', `/comercial/lead/${leadId}/fio`, undefined, pessoas.mesa.token)).fio.find((l) => l.type === 'contrato.assinado_root'));
    passo('o cliente pagou no dublê do Asaas; cliente e Root assinaram no dublê da ZapSign');

    const fech = await esperar('a aprovação R4 do fechamento', async () => {
      const l = await api('GET', '/approvals?status=pendente', undefined, pessoas.mesa.token);
      return l.items.find((a) => a.capacidade === 'comercial.fechamento.executar' && String(a.recurso?.id ?? '').includes(leadId)) ?? null;
    });
    await confirmar(fech.id, pessoas, 'o fechamento reaproveita o card iniciado antes (R4)');
    const fechamento = await api('GET', `/comercial/fechamentos/${leadId}`, undefined, pessoas.mesa.token);
    conferir(fechamento.estado === 'concluido' && fechamento.escritas.length === 6, `o fechamento devia concluir com 6 escritas (veio ${fechamento.estado})`);
    const escritaDoCard = fechamento.escritas.find((e) => e.escrita === 'card');
    conferir(escritaDoCard?.estado === 'reaproveitado' && escritaDoCard.ref === cardId, `a escrita do card devia reaproveitar o mesmo card (veio ${escritaDoCard?.estado} · ${escritaDoCard?.ref})`);
    const escritaDoTrilho = fechamento.escritas.find((e) => e.escrita === 'kit_e_trilho');
    conferir(escritaDoTrilho?.estado === 'reaproveitado' && escritaDoTrilho.ref === trilhoId, 'o fechamento devia reaproveitar o trilho iniciado antes');
    const escritaDoCliente = fechamento.escritas.find((e) => e.escrita === 'cliente');
    conferir(escritaDoCliente?.estado === 'reaproveitado' && escritaDoCliente.ref === card.clienteId, 'o fechamento devia reaproveitar o cliente (Partner) do card');
    passo('o fechamento (R4) concluiu as seis escritas reaproveitando o card, o trilho e o cliente', { detalhe: fechamento.escritas.map((e) => `${e.escrita}:${e.estado}`).join(' ') });

    // ---- 4. Continua um card só, sem o selo de antes ----
    const depois = await api('GET', `/comercial/lead/${leadId}`, undefined, pessoas.mesa.token);
    conferir(depois.ligadoA?.implantacao?.cardId === cardId, 'a ficha mudou de card depois do fechamento');
    const doCard = await api('GET', `/trabalho/tarefas/${cardId}`, undefined, pessoas.mesa.token);
    conferir(doCard.statusName === 'Kickoff marcado', `o fechamento não move a etapa do card (está em ${doCard.statusName})`);
    const doFechamento = (doCard.comentarios ?? []).filter((c) => c.authorName === 'Fechamento comercial');
    conferir(doFechamento.length === 1 && /O card foi iniciado antes do fechamento/.test(doFechamento[0].text), 'o card devia ter um comentário "Fechamento comercial"');
    const mesmos = await api('GET', `/trabalho/tarefas?listId=${card.listId}&q=${encodeURIComponent(card.title)}`, undefined, pessoas.mesa.token);
    conferir(mesmos.items.filter((t) => t.title === card.title).length === 1, 'o fechamento duplicou o card');
    const mov2 = await api('GET', `/trabalho/quadro/movimento?listId=${card.listId}`, undefined, pessoas.mesa.token);
    const selo2 = mov2.itens.find((i) => i.tarefaId === cardId)?.procedencia;
    conferir(selo2?.tipo === 'fechamento' && !/antes do fechamento/.test(selo2.rotulo), `o selo de antes do fechamento devia ter saído (veio ${JSON.stringify(selo2)})`);
    const fio2 = (await api('GET', `/comercial/lead/${leadId}/fio`, undefined, pessoas.mesa.token)).fio;
    conferir(fio2.filter((l) => l.type === 'implantacao.fechamento_registrado').length === 1, 'o fio devia ter um implantacao.fechamento_registrado');
    conferir(!fio2.some((l) => l.type === 'implantacao.card_criado'), 'o fechamento não devia abrir outro card (implantacao.card_criado no fio)');

    const ctx2 = await contexto(navegador, pessoas.admin);
    const p2 = await ctx2.newPage();
    await p2.goto(`${WEB}/trabalho/implantacao`, { waitUntil: 'networkidle' });
    await tid(p2, `trabalho-rodape-${cardId}`).waitFor({ timeout: 30_000 });
    if (await tid(p2, 'trabalho-densidade-cheio').count()) await tid(p2, 'trabalho-densidade-cheio').click();
    const textoDepois = await tid(p2, `trabalho-procedencia-${cardId}`).innerText();
    conferir(!/antes do fechamento/.test(textoDepois), `o card ainda mostra o selo de antes do fechamento ("${textoDepois}")`);
    conferir((await p2.locator(`[data-work-task-id="${cardId}"]`).count()) === 1, 'o card aparece mais de uma vez no quadro');
    await foto(p2, 'quadro-depois-do-fechamento');
    await ctx2.close();
    passo('continua um card só, na mesma etapa, sem o selo de antes, com o comentário do fechamento e o fato no fio', { detalhe: textoDepois });

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

/*
 * COMO RODAR (Git Bash, na raiz do repositório, com a stack `rootos-final-seed` de pé e a imagem nova):
 *
 *   UX_WEB=http://127.0.0.1:3031 UX_API=http://127.0.0.1:4031/api UX_PW=C:/Users/User/dev/pw-tools \
 *   JORNADA_ASAAS=http://127.0.0.1:4032 JORNADA_ZAPSIGN=http://127.0.0.1:4033 \
 *   HOMOLOG_ENV="$PWD/homolog/.env.final-seed" PROVAS_PREFIXO=final-seed- \
 *   node homolog/e2e/onboarding-antecipado.mjs
 *
 * Opcional: ANTECIPADO_LEAD=<id> (outro lead em Proposta ou Follow-up, sem card) ou
 * ANTECIPADO_NOME="<empresa do seed>". O lead escolhido termina fechado: para repetir a prova,
 * use outro lead ou semeie a stack de novo.
 */
