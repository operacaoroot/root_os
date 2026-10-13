#!/usr/bin/env node
/*
 * A JORNADA DO COCKPIT DE PONTA A PONTA, CONTRA A HOMOLOGAÇÃO EM DOCKER.
 *
 * Node puro (fetch nativo, nenhuma dependência). Roda no host contra a API da
 * homologação (`http://127.0.0.1:4010/api`) e os dublês do Asaas (4011) e da
 * ZapSign (4012). Lê `homolog/.env.homolog` em tempo de execução (a senha da
 * homologação nunca é copiada para arquivo commitado) e cria um lead NOVO por
 * execução, com telefone e nome fictícios sufixados pelo relógio.
 *
 * O que ela prova, na ordem:
 *   lead entra pelo simulador → M1 com formulário (R3 retido, outra pessoa
 *   libera) → formulário respondido na sala → M2 com horários (R3) → horário
 *   escolhido → M3 da véspera pelo relógio (R3) → confirmação de véspera no fio
 *   → ata da sessão (o sócio conduz e sobe) → diagnóstico com stub (4 falas com
 *   minuto) → sócio aprova → proposta pela tabela, quadro de exemplo apontado
 *   pelo revisor e levado à porta por um toque (E-3), publicada pela porta
 *   (R3) → M4 (R3) → leitura por bloco na sala → pedido de ajuste na
 *   fila de decisões → decisão de um toque → aceite (dados, pagamento,
 *   contrato) → cobrança e contrato nos dublês (R4: titular assina com senha e
 *   motivo) → Pix pago no dublê do Asaas e contrato assinado no da ZapSign
 *   (cliente e Root) → webhooks → fechamento (5 escritas, R4) → contrato vivo
 *   com parcelas → o funil conta o lead em "fechado".
 *
 * O que ela CONTA: cada toque humano (liberar R3, assinar R4, decidir na fila,
 * conduzir a sessão e subir a ata, aprovar o diagnóstico, assinar pela Root),
 * separado das ações do cliente e das ações automáticas (os fatos que o
 * sistema gravou sozinho no fio). Nenhum toque é removido: a régua R3/R4,
 * segunda pessoa, alçada e reautenticação são as do banco.
 *
 * Saída: lista numerada dos toques (quem e por quê), contagem de ações
 * automáticas, tempo total, link da sala, e o resumo JSON em
 * `homolog/provas/jornada-docker.json`. Código de saída diferente de zero em
 * qualquer passo que falhe, com a mensagem da API.
 *
 * Uso (Git Bash):
 *   node homolog/e2e/jornada-docker.mjs
 * Variáveis opcionais: JORNADA_API, JORNADA_ASAAS, JORNADA_ZAPSIGN,
 * JORNADA_WEB, JORNADA_ESPERA_M3_MIN (padrão 4).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.JORNADA_API ?? 'http://127.0.0.1:4010/api';
const ASAAS = process.env.JORNADA_ASAAS ?? 'http://127.0.0.1:4011';
const ZAPSIGN = process.env.JORNADA_ZAPSIGN ?? 'http://127.0.0.1:4012';
const WEB = process.env.JORNADA_WEB ?? 'http://127.0.0.1:3010';
const ESPERA_M3_MS = Number(process.env.JORNADA_ESPERA_M3_MIN ?? 4) * 60_000;

// ---------------------------------------------------------------------------
// Ambiente: o .env.homolog lido em tempo de execução
// ---------------------------------------------------------------------------

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
const ENV = lerEnv(join(RAIZ, 'homolog/.env.homolog'));
const SENHA = ENV.ADMIN_PASSWORD;
if (!SENHA) falhar('ADMIN_PASSWORD ausente em homolog/.env.homolog');

/** As três pessoas da homologação (seed.ts e seed-comercial.ts). */
const PESSOAS = {
  socioDaConta: { email: 'admin@marketing-os.local', papel: 'admin_master (titular)', rotulo: 'sócio da conta (admin)' },
  mesa: { email: 'mesa@root.homolog', papel: 'gestor_marketing (responsável)', rotulo: 'mesa (responsável)' },
  titular: { email: 'socio@root.homolog', papel: 'diretor (titular)', rotulo: 'sócio titular' },
};

// ---------------------------------------------------------------------------
// Registro: toques humanos, ações do cliente, passos
// ---------------------------------------------------------------------------

const INICIO = Date.now();
const toques = [];
const doCliente = [];
const passos = [];

function toque(quem, acao, porque, extra = {}) {
  toques.push({ n: toques.length + 1, quem: PESSOAS[quem]?.rotulo ?? quem, email: PESSOAS[quem]?.email ?? null, acao, porque, ...extra });
  log(`  [toque ${toques.length}] ${PESSOAS[quem]?.rotulo ?? quem}: ${acao}`);
}
function cliente(acao) {
  doCliente.push(acao);
  log(`  [cliente] ${acao}`);
}
function passo(nome) {
  passos.push({ nome, emMs: Date.now() - INICIO });
  log(`\n== ${nome}`);
}
function log(...a) {
  console.log(...a);
}
function falhar(msg, detalhe) {
  console.error(`\nFALHOU: ${msg}`);
  if (detalhe !== undefined) console.error(typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe, null, 2));
  try {
    gravarProva({ ok: false, erro: msg, detalhe: detalhe ?? null });
  } catch {
    /* sem prova em disco, a saída diferente de zero basta */
  }
  process.exit(1);
}
function conferir(cond, msg, detalhe) {
  if (!cond) falhar(msg, detalhe);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function http(metodo, url, { token, corpo, cabecalhos } = {}) {
  let r;
  try {
    r = await fetch(url, {
      method: metodo,
      headers: { accept: 'application/json', ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cabecalhos ?? {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      redirect: 'manual',
    });
  } catch (e) {
    falhar(`${metodo} ${url}: sem resposta (${e.message}). A homologação está de pé?`);
  }
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: r.status, json };
}

/** Chamada à API que TEM de dar certo: qualquer 4xx/5xx encerra com a mensagem da API. */
async function api(metodo, caminho, opcoes = {}) {
  const { status, json } = await http(metodo, `${API}${caminho}`, opcoes);
  if (status >= 400) falhar(`${metodo} ${caminho} respondeu ${status}`, json);
  return json;
}

async function esperar(descricao, fn, { ms = 30_000, cada = 1000 } = {}) {
  const ate = Date.now() + ms;
  let ultimo;
  while (Date.now() < ate) {
    ultimo = await fn();
    if (ultimo) return ultimo;
    await new Promise((r) => setTimeout(r, cada));
  }
  falhar(`esperei ${Math.round(ms / 1000)} s e não aconteceu: ${descricao}`);
}

const sessoes = {};
async function entrar(quem) {
  const p = PESSOAS[quem];
  const r = await api('POST', '/auth/login', { corpo: { email: p.email, password: SENHA } });
  sessoes[quem] = { token: r.token, id: r.user.id, nome: r.user.name };
  return sessoes[quem];
}
const como = (quem) => ({ token: sessoes[quem].token });

// ---------------------------------------------------------------------------
// A régua: liberar R3 e assinar R4 pela MESMA confirmação de /atendimento
// ---------------------------------------------------------------------------

async function aprovacaoPendente(id) {
  const lista = await api('GET', '/approvals?status=pendente', como('mesa'));
  return lista.items.find((a) => a.id === id) ?? null;
}

/**
 * Confirma uma aprovação com quem a alçada pede: responsável (mesa) para R3,
 * titular (sócio) para R4 com senha e motivo. Conta o toque.
 */
async function confirmar(approvalId, porque, { como: quemForcado } = {}) {
  const a = await aprovacaoPendente(approvalId);
  conferir(a, `a aprovação ${approvalId} não está pendente na fila`);
  const quem = quemForcado ?? (a.alcadaMinima === 'titular' ? 'titular' : 'mesa');
  const corpo = a.exigeReauth ? { reauth: { senha: SENHA }, motivo: `conferi na homologação: ${porque}` } : {};
  const r = await api('POST', `/approvals/${approvalId}/confirm`, { ...como(quem), corpo });
  const status = r?.execucao?.status;
  conferir(status === 'executado', `a confirmação de ${a.capacidade} não executou (status ${status})`, r);
  const acao = a.nivel === 'R4' || a.exigeReauth ? `assina ${a.capacidade} (${a.nivel}, senha e motivo)` : `libera ${a.capacidade} (${a.nivel})`;
  toque(quem, acao, porque, { nivel: a.nivel, capacidade: a.capacidade, alcada: a.alcadaMinima, approvalId });
  return r;
}

/** A mensagem de um template no celular do lead (simulador). */
async function mensagem(leadId, template) {
  const c = await api('GET', `/comercial/simulador/lead/${leadId}`, como('mesa'));
  return { celular: c, m: c.mensagens.filter((x) => x.template === template).at(-1) ?? null };
}

/** Espera a mensagem na fila (R3 retido) e outra pessoa a libera. */
async function liberarMensagem(leadId, template, porque) {
  const { m } = await esperar(`${template} preparada e retida na fila`, async () => {
    const r = await mensagem(leadId, template);
    return r.m && (r.m.estado === 'na_fila' || r.m.estado === 'enviada') ? r : null;
  });
  conferir(m.estado === 'na_fila' && m.approvalId, `${template} devia estar retida na fila com aprovação (estado ${m.estado})`, m);
  const naFila = await aprovacaoPendente(m.approvalId);
  conferir(naFila && ['R3', 'R4'].includes(naFila.nivel), `${template}: a porta devia reter em R3 (ou R4 por sinal), veio ${naFila?.nivel}`, naFila);
  await confirmar(m.approvalId, `${template}: ${porque}`);
  const depois = await mensagem(leadId, template);
  conferir(depois.m.estado === 'enviada', `${template} liberada mas não enviada (estado ${depois.m.estado})`, depois.m);
  return depois.m;
}

// B-11: o cliente abre a sala como a página abre: POST da visita (o GET da sala só lê).
async function sala(token) {
  const { status, json } = await http('POST', `${API}/sala/${token}/visita`, { corpo: {} });
  if (status >= 400) falhar(`POST /sala/:token/visita respondeu ${status}`, json);
  return json;
}
async function naSala(caminho, token, corpo) {
  const { status, json } = await http('POST', `${API}/sala/${token}${caminho}`, { corpo: corpo ?? {} });
  if (status >= 400) falhar(`POST /sala/:token${caminho} respondeu ${status}`, json);
  return json;
}

async function etapa(leadId) {
  const f = await api('GET', `/comercial/lead/${leadId}`, como('mesa'));
  return f;
}

// ---------------------------------------------------------------------------
// A jornada
// ---------------------------------------------------------------------------

const SUFIXO = Date.now().toString().slice(-8);
const TELEFONE = `+55329${SUFIXO}`;
const NOME = `Marina Teste ${SUFIXO.slice(-4)}`;
const EMPRESA = `Construtora Alicerce Homolog ${SUFIXO.slice(-4)}`;
const CNPJ = `9${Date.now().toString().slice(-13)}`;
const resumo = { lead: { telefone: TELEFONE, nome: NOME, empresa: EMPRESA } };
const etapasVistas = [];

async function anotarEtapa(leadId, quando) {
  const f = await etapa(leadId);
  const e = f.etapa ?? f.ficha?.etapa;
  if (etapasVistas.at(-1)?.etapa !== e) etapasVistas.push({ etapa: e, quando });
  return f;
}

async function main() {
  passo('0. homologação de pé e as três pessoas entram');
  const saude = await http('GET', `${API}/health`);
  conferir(saude.status === 200, `a API não respondeu /health (${saude.status})`, saude.json);
  for (const [nome, url] of [['Asaas', ASAAS], ['ZapSign', ZAPSIGN]]) {
    const h = await http('GET', `${url}/health`);
    conferir(h.status === 200, `o dublê do ${nome} não respondeu em ${url}/health`);
  }
  for (const q of Object.keys(PESSOAS)) await entrar(q);
  const fechadosAntes = (await api('GET', '/comercial/funil', como('mesa'))).colunas.find((c) => c.etapa === 'fechado')?.cartoes.length ?? 0;
  log(`  sessões: ${Object.entries(sessoes).map(([k, v]) => `${k}=${v.nome}`).join(', ')}`);

  passo('1. o lead entra pelo simulador do WhatsApp');
  const entrada = await api('POST', '/comercial/simulador/entrada', {
    ...como('mesa'),
    corpo: { telefone: TELEFONE, texto: 'Oi! Vi o vídeo do fechamento. Funciona com Omie?', nome: NOME, canal: 'conteudo', palavraChave: 'FECHAMENTO', mensagemId: `jornada-${SUFIXO}-1` },
  });
  const leadId = entrada.leadId;
  conferir(leadId && entrada.leadNovo, 'o simulador não criou um lead novo', entrada);
  cliente('manda o primeiro "oi" no WhatsApp (simulador)');
  resumo.lead.id = leadId;
  await anotarEtapa(leadId, 'entrada');

  passo('2. M1 com o formulário: retida em R3, outra pessoa libera');
  const m1 = await liberarMensagem(leadId, 'M1', 'a primeira resposta ao lead sai da casa (R3: irreversível e confidencial)');
  conferir(m1.interativo?.formulario?.campos?.length === 4, 'a M1 devia levar o formulário de 4 campos', m1.interativo);
  const link = /\/s\/([A-Za-z0-9_-]{40,48})/.exec(m1.texto);
  conferir(link, 'a M1 não traz o link da sala', m1.texto);
  const TOKEN = link[1];
  const conversa = await api('GET', `/comercial/simulador/lead/${leadId}`, como('mesa'));
  resumo.linkDaSala = conversa.linkDaSala;
  let s = await sala(TOKEN);
  conferir(s.estagio === 'conversa', `a sala devia abrir em "conversa", abriu em ${s.estagio}`, s);
  const estagios = [s.estagio];

  passo('3. o formulário respondido na sala');
  s = await naSala('/form', TOKEN, { sistema: 'Omie', baseOrganizada: true, maiorDor: 'o fechamento do mês sai no dia 9, sempre atrasado', equipeFinanceiro: 3, nome: NOME, empresa: EMPRESA });
  cliente('responde o formulário de qualificação na sala');
  conferir(s.conversa?.horariosOferecidos?.length >= 2, 'a sala devia oferecer ao menos dois horários', s.conversa);
  await anotarEtapa(leadId, 'formulário');

  passo('4. M2 com dois horários em botões: R3, outra pessoa libera');
  const m2 = await liberarMensagem(leadId, 'M2', 'a oferta de horários sai da casa (R3)');
  const botoes = m2.interativo?.botoes ?? [];
  conferir(botoes.length === 2, 'a M2 devia trazer dois horários em botões', m2.interativo);

  passo('5. o lead escolhe o horário (o primeiro, para a véspera cair dentro desta execução)');
  s = await naSala('/agenda', TOKEN, { horario: botoes[0].chave });
  cliente(`escolhe o horário ${botoes[0].rotulo} na sala`);
  conferir(s.conversa?.horario, 'a sala não mostra o horário escolhido', s.conversa);
  resumo.horario = botoes[0].chave;
  await anotarEtapa(leadId, 'horário escolhido');

  passo('6. a véspera: o relógio prepara a M3 (R3), outra pessoa libera, e a confirmação entra no fio');
  const faltaH = (new Date(botoes[0].chave).getTime() - Date.now()) / 3_600_000;
  conferir(faltaH <= 24, `o primeiro horário oferecido está a ${faltaH.toFixed(1)} h; a M3 só sai nas 24 h antes. Rode depois das 10h de São Paulo num dia que antecede um dia útil.`);
  await esperar(
    'a M3 da véspera preparada pelo relógio (tique de 1 minuto da rotina comercial.relogio)',
    async () => (await mensagem(leadId, 'M3')).m,
    { ms: ESPERA_M3_MS, cada: 5000 },
  );
  await liberarMensagem(leadId, 'M3', 'a confirmação de véspera sai da casa (R3)');
  const confirmada = await esperar('o fato agenda.confirmada no fio', async () => {
    const f = await api('GET', `/comercial/lead/${leadId}/fio`, como('mesa'));
    return f.fio.find((l) => l.type === 'agenda.confirmada') ?? null;
  }, { ms: 15_000 });
  log(`  fio: ${confirmada.resumo}`);
  await anotarEtapa(leadId, 'véspera');

  passo('7. a sessão: o sócio da conta conduz e sobe a ata (fixture da Alicerce)');
  const ata = readFileSync(join(RAIZ, 'homolog/fixtures/ata-alicerce.md'), 'utf8');
  await api('POST', `/comercial/lead/${leadId}/ata`, { ...como('socioDaConta'), corpo: { texto: ata, fonte: 'granola', referencia: `jornada-${SUFIXO}` } });
  toque('socioDaConta', 'conduz a sessão estratégica e sobe a ata', 'a sessão é humana por desenho (E4); a ata é o insumo do diagnóstico');

  passo('8. o diagnóstico com stub: 4 falas com minuto');
  const sessao = await esperar('diagnostico.pronto pelo leitor de ata', async () => {
    const r = await api('GET', `/comercial/lead/${leadId}/sessao`, como('mesa'));
    return r.diagnostico ? r : null;
  });
  const minutos = (sessao.diagnostico.dores ?? []).map((d) => d.minuto);
  conferir(JSON.stringify(minutos) === JSON.stringify(['04:12', '11:40', '19:05', '27:30']), `o diagnóstico devia trazer as 4 dores com minuto da ata, trouxe ${JSON.stringify(minutos)}`, sessao.diagnostico);
  resumo.diagnostico = { dores: minutos, produtoSugerido: sessao.diagnostico.produtoSugerido, modelo: sessao.diagnostico.modelo };
  await anotarEtapa(leadId, 'diagnóstico');

  passo('9. o sócio aprova o diagnóstico');
  // E-4/C-8: aprova o diagnóstico que leu (o eventoId da tela 06); outro vigente é 409.
  await api('POST', `/comercial/lead/${leadId}/diagnostico/aprovar`, { ...como('socioDaConta'), corpo: { eventoId: sessao.diagnostico.eventoId } });
  toque('socioDaConta', 'aprova o diagnóstico', 'portão de E5: diagnóstico aprovado por sócio solta a proposta');

  passo('10. a proposta pela tabela; o quadro de EXEMPLO é apontamento do revisor (E-3): decisão de um toque, depois a porta (R3)');
  const propostaV1 = await esperar('a proposta v1 na fila de decisões', async () => {
    const r = await api('GET', `/comercial/lead/${leadId}/sessao`, como('mesa'));
    return r.proposta?.estado === 'na_fila' || r.proposta?.approvalId ? r.proposta : null;
  });
  if (propostaV1.estado === 'na_fila') {
    conferir((propostaV1.laudo?.apontamentos ?? []).some((a) => /VALORES DE EXEMPLO/.test(a)), `o revisor devia apontar o quadro de exemplo: ${(propostaV1.laudo?.apontamentos ?? []).join('; ')}`, propostaV1);
    const fora = await esperar('a decisão proposta_fora_da_tabela aberta na fila', async () => {
      const d = await api('GET', '/comercial/decisoes?estado=aberta', como('mesa'));
      const itens = Array.isArray(d) ? d : d.itens ?? d.decisoes ?? [];
      return itens.find((x) => x.leadId === leadId && x.tipo === 'proposta_fora_da_tabela') ?? null;
    });
    await api('POST', `/comercial/decisoes/${fora.id}/responder`, { ...como('socioDaConta'), corpo: { escolha: 'liberar' } });
    toque('socioDaConta', 'leva à liberação a proposta com o quadro de exemplo', 'o revisor aponta número de exemplo (E-3): uma pessoa decide, um toque');
  } else {
    conferir(propostaV1.laudo?.ok === true, `sem decisão, o laudo do revisor devia vir limpo: ${(propostaV1.laudo?.apontamentos ?? []).join('; ')}`, propostaV1);
  }
  const v1 = await esperar('a proposta v1 na porta', async () => {
    const r = await api('GET', `/comercial/lead/${leadId}/sessao`, como('mesa'));
    return r.proposta?.approvalId ? r.proposta : null;
  });
  conferir(v1.dentroDaTabela === true && v1.estado === 'na_porta', `a v1 devia estar na porta e dentro da tabela (estado ${v1.estado})`, v1);
  await confirmar(v1.approvalId, 'a proposta sai para o cliente (R3: publicação externa)');
  resumo.proposta = { versao: v1.versao, produto: v1.conteudo?.produto, valorCentavos: v1.conteudo?.valorCentavos, parcelas: v1.conteudo?.parcelas, validaAte: v1.conteudo?.validaAte, laudo: v1.laudo };
  await anotarEtapa(leadId, 'proposta publicada');

  passo('11. M4 avisa que a proposta chegou: R3, outra pessoa libera');
  await liberarMensagem(leadId, 'M4', 'o aviso da proposta sai da casa (R3)');

  passo('12. o cliente lê a proposta por bloco na sala');
  s = await sala(TOKEN);
  conferir(s.estagio === 'proposta' && s.proposta?.versao === 1, `a sala devia estar em "proposta" com a v1 (está em ${s.estagio})`, s.proposta);
  estagios.push(s.estagio);
  for (const bloco of ['ouvimos', 'recomendada', 'alternativa', 'custos', 'validade']) {
    s = await naSala('/proposta/lida', TOKEN, { bloco, versao: 1 });
  }
  cliente('lê os cinco blocos da proposta na sala');
  conferir((s.proposta?.blocosLidos ?? []).length === 5, 'a sala devia registrar os cinco blocos lidos', s.proposta);
  await anotarEtapa(leadId, 'proposta lida');

  passo('13. o pedido de ajuste cai na fila de decisões');
  s = await naSala('/proposta/ajuste', TOKEN, { pedido: 'Consegue 8% de desconto à vista?', descontoPct: 8 });
  cliente('pede 8% de desconto na sala');
  conferir(s.proposta?.ajustePendente === true, 'a sala devia mostrar o ajuste pendente', s.proposta);
  const decisao = await esperar('a decisão pedido_de_ajuste aberta na fila', async () => {
    const d = await api('GET', '/comercial/decisoes?estado=aberta', como('mesa'));
    const itens = Array.isArray(d) ? d : d.itens ?? d.decisoes ?? [];
    return itens.find((x) => x.leadId === leadId && x.tipo === 'pedido_de_ajuste') ?? null;
  });
  log(`  decisão: ${decisao.titulo} · opções ${(decisao.opcoes ?? []).map((o) => o.chave).join(', ')} · padrão ${decisao.padrao}`);

  passo('14. decisão de um toque: manter o preço');
  await api('POST', `/comercial/decisoes/${decisao.id}/responder`, { ...como('socioDaConta'), corpo: { escolha: 'manter' } });
  toque('socioDaConta', 'decide o pedido de ajuste (manter o preço)', 'desconto é decisão de gente: a fila de decisões, um toque');
  s = await sala(TOKEN);
  conferir(s.proposta?.ajustePendente === false && s.proposta?.versao === 1, 'depois de "manter", a sala devia mostrar o ajuste respondido e a v1', s.proposta);

  passo('15. o aceite na sala: dados, pagamento e contrato');
  s = await naSala('/aceite/dados', TOKEN, { cnpj: CNPJ, razaoSocial: `${EMPRESA} Ltda`, endereco: 'Rua Fictícia, 100, Juiz de Fora, MG', quemAssina: NOME, email: `marina.${SUFIXO}@alicerce.homolog` });
  cliente('confere os dados do contratante');
  s = await naSala('/aceite/pagamento', TOKEN, { produto: 'operacao', forma: 'pix', versao: 1 });
  cliente('aceita a Operação ROOT em Pix');
  s = await naSala('/aceite/contrato', TOKEN, {});
  cliente('abre o passo do contrato');
  estagios.push(s.estagio);
  await anotarEtapa(leadId, 'aceite');

  passo('16. cobrança e contrato pela porta: R4, a titular assina');
  const filaR4 = await esperar('as duas aprovações R4 do aceite', async () => {
    const l = await api('GET', '/approvals?status=pendente', como('mesa'));
    const doLead = l.items.filter((a) => String(a.recurso?.id ?? '').includes(leadId));
    const cob = doLead.find((a) => a.capacidade === 'comercial.cobranca.criar');
    const ctr = doLead.find((a) => a.capacidade === 'comercial.contrato.enviar');
    return cob && ctr ? { cob, ctr } : null;
  });
  conferir(filaR4.cob.nivel === 'R4' && filaR4.ctr.nivel === 'R4' && filaR4.cob.alcadaMinima === 'titular', 'cobrança e contrato deviam ser R4 com alçada titular', filaR4);
  await confirmar(filaR4.cob.id, 'obrigação financeira com o cliente (R4: titular, senha e motivo)');
  await confirmar(filaR4.ctr.id, 'contrato enviado para assinatura (R4: titular, senha e motivo)');
  s = await sala(TOKEN);
  const linkPagamento = s.aceite?.cobranca?.linkPagamento;
  const linkAssinatura = s.aceite?.contrato?.linkAssinatura;
  conferir(linkPagamento && linkAssinatura, 'a sala devia mostrar o link de pagamento e o de assinatura', s.aceite);
  resumo.cobranca = { linkPagamento, pix: Boolean(s.aceite?.cobranca?.pixCopiaECola), primeiraParcelaCentavos: s.aceite?.cobranca?.primeiraParcelaCentavos };

  passo('17. o cliente paga o Pix no dublê do Asaas e o webhook grava o fato');
  const pagamentoId = /\/fatura\/([\w-]+)/.exec(linkPagamento)?.[1];
  conferir(pagamentoId, 'link de pagamento sem o id da fatura', linkPagamento);
  const pago = await http('POST', `${ASAAS}/simular/pagar/${pagamentoId}`);
  conferir(pago.status < 400, `o dublê do Asaas recusou o pagamento (${pago.status})`, pago.json);
  cliente('paga a 1ª parcela no Pix (dublê do Asaas)');
  await esperar('pix.pago no fio', async () => (await api('GET', `/comercial/lead/${leadId}/fio`, como('mesa'))).fio.find((l) => l.type === 'pix.pago'));

  passo('18. o cliente assina o contrato no dublê da ZapSign');
  const tokCliente = /\/assinar\/([\w-]+)/.exec(linkAssinatura)?.[1];
  const assinou = await http('POST', `${ZAPSIGN}/simular/assinar/${tokCliente}`);
  conferir(assinou.status < 400, `o dublê da ZapSign recusou a assinatura do cliente (${assinou.status})`, assinou.json);
  cliente('assina o contrato (dublê da ZapSign)');
  await esperar('contrato.assinado_cliente no fio', async () => (await api('GET', `/comercial/lead/${leadId}/fio`, como('mesa'))).fio.find((l) => l.type === 'contrato.assinado_cliente'));

  passo('19. o sócio assina pela Root');
  // D-1: o link de assinar pela Root só sai para o signatário cadastrado (titular), com a senha conferida.
  const pelaRoot = await api('POST', `/comercial/contratos/${leadId}/assinar-pela-root`, { ...como('socioDaConta'), corpo: { senha: SENHA } });
  const tokRoot = /\/assinar\/([\w-]+)/.exec(pelaRoot.linkAssinatura ?? '')?.[1];
  conferir(tokRoot, 'a rota não devolveu o link de assinatura da Root', pelaRoot);
  const assinouRoot = await http('POST', `${ZAPSIGN}/simular/assinar/${tokRoot}`);
  conferir(assinouRoot.status < 400, `o dublê da ZapSign recusou a assinatura da Root (${assinouRoot.status})`, assinouRoot.json);
  toque('socioDaConta', 'assina o contrato pela Root (ZapSign)', 'o contrato tem dois signatários; a Root assina por um sócio');
  await esperar('contrato.assinado_root no fio', async () => (await api('GET', `/comercial/lead/${leadId}/fio`, como('mesa'))).fio.find((l) => l.type === 'contrato.assinado_root'));

  passo('20. o fechamento vai à porta (R4) e a titular assina: cinco escritas');
  const fech = await esperar('a aprovação R4 do fechamento', async () => {
    const l = await api('GET', '/approvals?status=pendente', como('mesa'));
    return l.items.find((a) => a.capacidade === 'comercial.fechamento.executar' && String(a.recurso?.id ?? '').includes(leadId)) ?? null;
  });
  conferir(fech.nivel === 'R4', `o fechamento devia ser R4, veio ${fech.nivel}`, fech);
  await confirmar(fech.id, 'o fechamento cria cliente, contrato, cobrança, trilho e grupo (R4: obrigação financeira)');
  const fechamento = await api('GET', `/comercial/fechamentos/${leadId}`, como('mesa'));
  conferir(fechamento.estado === 'concluido' && fechamento.escritas?.length === 5, `o fechamento devia concluir com 5 escritas (estado ${fechamento.estado})`, fechamento);
  resumo.fechamento = { estado: fechamento.estado, escritas: fechamento.escritas.map((e) => `${e.escrita}:${e.estado}`) };
  await anotarEtapa(leadId, 'fechamento');

  passo('21. o contrato vivo, com parcelas');
  const vivo = await api('GET', `/comercial/contratos/${leadId}`, como('mesa'));
  const parcelas = (vivo.parcelas ?? []).map((p) => p.estado);
  conferir(parcelas.length >= 1 && parcelas[0] === 'paga', `o contrato vivo devia trazer a 1ª parcela paga, trouxe ${JSON.stringify(parcelas)}`, vivo);
  resumo.contratoVivo = { parcelas, marcos: (vivo.marcos ?? []).map((m) => m.chave) };
  s = await sala(TOKEN);
  estagios.push(s.estagio);

  passo('22. o funil conta o lead em "fechado"');
  const funil = await api('GET', '/comercial/funil', como('mesa'));
  const fechados = funil.colunas.find((c) => c.etapa === 'fechado')?.cartoes ?? [];
  conferir(fechados.some((c) => c.leadId === leadId), 'o lead não aparece na coluna "fechado" do funil', funil.colunas.map((c) => [c.etapa, c.cartoes.length]));
  const rel = await http('GET', `${API}/comercial/relatorio/semana`, como('mesa'));
  conferir(fechados.length - fechadosAntes === 1, `o funil devia contar exatamente 1 fechado a mais (antes ${fechadosAntes}, depois ${fechados.length})`);
  const pagina = await http('GET', `${WEB}/s/${TOKEN}`);
  conferir(pagina.status === 200, `a página da sala no web respondeu ${pagina.status}`);
  resumo.funil = { fechadosAntes, fechadosDepois: fechados.length, fechadosNestaExecucao: fechados.length - fechadosAntes, esteLeadFechado: true, paginaDaSalaNoWeb: pagina.status, relatorioDaSemana: rel.status === 501 ? '501: fase 2 da lane E' : rel.status };

  // -------------------------------------------------------------------------
  // A contagem
  // -------------------------------------------------------------------------
  const fio = (await api('GET', `/comercial/lead/${leadId}/fio`, como('mesa'))).fio;
  const fichaFinal = await anotarEtapa(leadId, 'fim');
  // Três origens para cada fato do fio: o ato do cliente, o ato de uma pessoa da casa, e o
  // sistema. Do sistema, separa o que ele fez SOZINHO (reações e relógio) do EFEITO que só
  // saiu porque uma pessoa liberou na porta (R3/R4): os dois são escritas automáticas, mas
  // só o primeiro dispensa gente.
  const DO_CLIENTE = new Set(['lead.chegou', 'whats.recebida', 'form.respondido', 'agenda.escolhida', 'sala.visitada', 'proposta.lida', 'proposta.ajuste_pedido', 'proposta.duvida', 'aceite.dados', 'proposta.aceita', 'pix.pago', 'parcela.paga', 'contrato.assinado_cliente', 'kickoff.marcado']);
  const DE_PESSOA = new Set(['ata.chegou', 'decisao.tomada', 'contrato.assinado_root']);
  const EFEITO_LIBERADO = new Set(['agenda.confirmada', 'followup.enviado', 'whats.enviada', 'proposta.publicada', 'cobranca.criada', 'contrato.gerado', 'fechamento.escrita', 'cliente.ativo']);
  // A aprovação do diagnóstico regrava `diagnostico.pronto` com `aprovadoEm`: o último é ato do sócio.
  const diagAprovado = toques.some((t) => t.acao === 'aprova o diagnóstico') ? fio.filter((l) => l.type === 'diagnostico.pronto').at(-1)?.eventoId : null;
  const origem = (l) => {
    if (DO_CLIENTE.has(l.type)) return 'cliente';
    if (DE_PESSOA.has(l.type) || l.eventoId === diagAprovado) return 'pessoa';
    return EFEITO_LIBERADO.has(l.type) ? 'efeito' : 'sistema';
  };
  const contagem = { cliente: 0, pessoa: 0, efeito: 0, sistema: 0 };
  const porTipo = {};
  for (const l of fio) {
    const o = origem(l);
    contagem[o]++;
    if (o === 'sistema' || o === 'efeito') porTipo[l.type] = (porTipo[l.type] ?? 0) + 1;
  }
  const automaticas = contagem.sistema + contagem.efeito;
  const trilhaDeEtapas = fio.filter((l) => l.type === 'etapa.mudou').map((l) => l.resumo);
  const pendentes = (await api('GET', '/approvals?status=pendente', como('mesa'))).items.filter((a) => String(a.recurso?.id ?? '').includes(leadId) || a.resumo?.includes?.(leadId));
  const naFila = (await api('GET', `/comercial/simulador/lead/${leadId}`, como('mesa'))).mensagens.filter((m) => m.estado === 'na_fila');

  const totalMs = Date.now() - INICIO;
  log('\n================ RESULTADO ================');
  log(`Lead ${NOME} (${TELEFONE}) · ${leadId}`);
  log(`Sala: ${resumo.linkDaSala}`);
  log(`Etapas (etapa.mudou no fio): ${trilhaDeEtapas.join(' · ')}`);
  log(`Estágios da sala vistos: ${estagios.join(' → ')}`);
  log(`\nToques humanos: ${toques.length}`);
  for (const t of toques) log(`  ${t.n}. ${t.quem} · ${t.acao} · ${t.porque}`);
  log(`\nAções do cliente: ${doCliente.length}`);
  for (const [i, c] of doCliente.entries()) log(`  ${i + 1}. ${c}`);
  log(`\nAções automáticas (fatos que o sistema gravou no fio): ${automaticas} de ${fio.length}`);
  log(`  sozinho (reações e relógio): ${contagem.sistema} · efeitos que uma pessoa liberou na porta: ${contagem.efeito} · atos do cliente: ${contagem.cliente} · atos de pessoa da casa: ${contagem.pessoa}`);
  log(`  ${Object.entries(porTipo).map(([k, v]) => `${k}×${v}`).join(', ')}`);
  if (naFila.length) log(`\nMensagens ainda na fila (não exigidas pela jornada): ${naFila.map((m) => m.template ?? 'texto').join(', ')}`);
  log(`\nFunil: ${resumo.funil.fechadosNestaExecucao} fechado a mais nesta execução (${resumo.funil.fechadosAntes} → ${resumo.funil.fechadosDepois}), este lead entre eles · relatório da semana: ${resumo.funil.relatorioDaSemana}`);
  log(`\nTempo total: ${(totalMs / 1000).toFixed(1)} s`);

  gravarProva({
    ok: true,
    em: new Date().toISOString(),
    api: API,
    tempoTotalMs: totalMs,
    ...resumo,
    etapas: trilhaDeEtapas,
    etapasAmostradas: etapasVistas,
    estagiosDaSala: estagios,
    etapaFinal: fichaFinal.etapa ?? null,
    toques,
    acoesDoCliente: doCliente,
    automaticas: { total: automaticas, sozinho: contagem.sistema, efeitosLiberados: contagem.efeito, fatosNoFio: fio.length, atosDoCliente: contagem.cliente, atosDePessoa: contagem.pessoa, porTipo },
    pendentesAoFim: { aprovacoes: pendentes.map((a) => `${a.capacidade} (${a.nivel})`), mensagensNaFila: naFila.map((m) => m.template ?? 'texto') },
    passos,
  });
}

function gravarProva(dados) {
  const arquivo = join(RAIZ, 'homolog/provas/jornada-docker.json');
  mkdirSync(dirname(arquivo), { recursive: true });
  // O token da sala é a chave de acesso do cliente: a prova guarda só o começo dele (a tela mostra o link inteiro).
  const texto = JSON.stringify(dados, null, 2).replace(/\/s\/([A-Za-z0-9_-]{6})[A-Za-z0-9_-]{34,42}/g, '/s/$1…');
  writeFileSync(arquivo, `${texto}\n`);
}

main().catch((e) => falhar(e?.message ?? String(e), e?.stack));
