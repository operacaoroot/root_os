import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TABELA_DE_PRECO, type ComercialEtapa, type ComercialEvento, type ComercialProduto, type OpcaoDeDecisao } from '@mktos/shared';

import { rotuloDoHorario } from '../../src/comercial/agenda-de-homologacao';
import { eventoIdComercial, hashDoConteudo, leadIdDoTelefone, normalizarTelefone, uuidDe } from '../../src/comercial/eventos';
import { textoDe } from '../../src/comercial/mensagens';
import { dentroDaTabela, hashDaVersao, montarProposta, revisarProposta, type QuadroDeCustos } from '../../src/comercial/proposta-construtor';
import { REGRA_DO_DONO } from '../../src/comercial/reacoes-da-espinha';

/*
 * O ROTEIRO DAS EMPRESAS DE DEMONSTRAÇÃO (lane F, 13/10/2026) — parte pura.
 *
 * Oito empresas fictícias das telas do mapa (docs/comercial/mapa-da-operacao.html,
 * K04), cada uma com o FIO de eventos que leva o lead à etapa em que a tela 04
 * a mostra. Aqui só se DESCREVE o fio; quem grava é `semear.ts`, e a ficha sai
 * da projeção dos eventos (`projecao.ts`), nunca de campo digitado.
 *
 * REGRAS DA SEMENTE
 *   · número só do mapa e da tabela de preço de 04/10: Alicerce (82, P2, 38
 *     funcionários, 8%, 3 leituras de 2 pessoas, quadro de custos 180 e 340,
 *     saúde 86) e Studio Lume (41) vêm das telas 03, 05, 06, 07 e 11; o preço
 *     de toda proposta é a linha da tabela. O que o mapa não diz fica ausente
 *     no payload ou `[a decidir]` onde a tela imprimiria um buraco. Telefone é
 *     fictício (5511900000001 a 08), CNPJ e e-mail não existem na semente.
 *   · tempo relativo a `agora`: a demonstração parece viva ("há 2 dias") e cada
 *     fio é coerente (os horários do dia seguem a tela 05). Rodar a semente de
 *     novo não muda nada: o id do evento é derivado da chave do fato, e a
 *     ficha é refeita dos eventos que estão no banco, não dos desta passagem.
 *   · a etapa de cada lead é a da tela 04, com UM desvio declarado: a
 *     Construtora Alicerce está em E7 (a tela 04 a põe em "conversa"), porque as
 *     telas 03, 05, 06, 07 e 09 só fecham com ela depois da proposta: o pedido
 *     de 8% da fila de decisões é dela.
 */

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

export const SEMENTE_ATA_ALICERCE = 'homolog/fixtures/ata-alicerce.md';

/** O horário em que a demonstração mostra o quadro de custos de terceiros: o exemplo da tela 07, marcado como exemplo. */
const QUADRO_DE_EXEMPLO: QuadroDeCustos = {
  mesNormalCentavos: 18_000,
  piorMesCentavos: 34_000,
  exemplo: true,
  origem: 'exemplo do mapa (tela 07), a decidir',
};

export interface EventoSemeado {
  type: ComercialEvento;
  chave: string;
  payload: Record<string, unknown>;
  em: Date;
}

export interface DecisaoSemeada {
  id: string;
  tipo: string;
  titulo: string;
  contexto: string;
  opcoes: OpcaoDeDecisao[];
  padrao: string;
  criadaEm: Date;
  expiraEm: Date;
  dados: Record<string, unknown>;
  eventoAberturaId: string;
  /** Presente quando a decisão já foi tomada no fio semeado. */
  tomada?: { escolha: string; por: string; canal: string; em: Date; eventoDecisaoId: string };
}

export interface CobrancaSemeada {
  externoId: string;
  parcela: number;
  parcelas: number;
  valorCentavos: number;
  forma: string;
  vence: Date;
}

export interface DocumentoSemeado {
  externoId: string;
  estado: string;
  hashConteudo: string;
  assinadoClienteEm: Date | null;
}

export interface RoteiroDoLead {
  slug: string;
  empresa: string;
  /** `Lead.name`: o contato quando o mapa diz quem é; a empresa quando só ela aparece. */
  nome: string;
  telefone: string;
  leadId: string;
  salaId: string;
  entrada: Date;
  eventos: EventoSemeado[];
  decisoes: DecisaoSemeada[];
  cobrancas: CobrancaSemeada[];
  documentos: DocumentoSemeado[];
  /** O que não é projeção do fio: a saúde e o texto de "próxima ação" que a tela 04 mostra. */
  overlay: { saude: number | null; proximaAcao: { tipo: string; quando: Date | null; descricao: string } | null };
  /** A coluna da tela 04 (com o desvio da Alicerce declarado no topo). */
  etapaEsperada: ComercialEtapa;
  /** Onde o mapa mostra o lead e o que a semente fez com ele, em uma linha (para o relatório). */
  resumo: string;
}

export interface ContextoDoRoteiro {
  orgId: string;
  agora: Date;
  dono: { id: string; nome: string } | null;
  /** `decisaoExpiraHoras` da config (4 na homologação). */
  decisaoExpiraHoras: number;
  /** `validadePropostaDias` da config (8 na homologação). */
  validadePropostaDias: number;
}

// ---------------------------------------------------------------------------
// O fio em construção
// ---------------------------------------------------------------------------

class Fio {
  readonly eventos: EventoSemeado[] = [];
  /** Decisões já tomadas no caminho do fio (a da proposta com quadro de exemplo). */
  readonly decisoes: DecisaoSemeada[] = [];

  constructor(
    readonly orgId: string,
    readonly leadId: string,
  ) {}

  add(type: ComercialEvento, chave: string, payload: Record<string, unknown>, em: Date): string {
    this.eventos.push({ type, chave, payload, em });
    return eventoIdComercial(this.orgId, this.leadId, type, chave);
  }

  /** `etapa.mudou` como o `FichaService.mudarEtapa` grava: a chave leva o gatilho, o motivo diz qual fato sustenta a etapa. */
  mudou(de: ComercialEtapa, para: ComercialEtapa, gatilho: { tipo: ComercialEvento; id: string } | null, em: Date, motivo?: string): void {
    this.add(
      'etapa.mudou',
      `${de}>${para}:${gatilho?.id ?? 'semente'}`,
      {
        de,
        para,
        motivo: motivo ?? (gatilho ? `${gatilho.tipo} sustenta ${para}` : 'semente de demonstração: a tela 04 do mapa põe o lead aqui'),
        eventoGatilho: gatilho?.id ?? null,
      },
      em,
    );
  }

  /** Ordena e garante tempo estritamente crescente (a projeção lê em ordem de tempo). */
  fechar(): EventoSemeado[] {
    const ordem = this.eventos.map((e, i) => ({ e, i })).sort((a, b) => a.e.em.getTime() - b.e.em.getTime() || a.i - b.i);
    let anterior = 0;
    for (const { e } of ordem) {
      if (e.em.getTime() <= anterior) e.em = new Date(anterior + 1000);
      anterior = e.em.getTime();
    }
    return ordem.map((o) => o.e);
  }
}

/** A sessão começa na hora cheia de São Paulo (o fuso é de hora inteira, então a hora cheia de UTC é a mesma): "quinta 10h" e não 10h11. */
function naHora(d: Date): Date {
  return new Date(Math.floor(d.getTime() / H) * H);
}

function seg(base: Date, segundos: number): Date {
  return new Date(base.getTime() + segundos * 1000);
}

/** ISO com o fuso de São Paulo escrito, como a agenda de homologação grava. */
function isoSP(d: Date): string {
  const local = new Date(d.getTime() - 3 * H);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

function validadeDaProposta(publicadaEm: Date, dias: number): string {
  // O fim do dia de São Paulo, `dias` depois: a mesma conta de `validadeAte` (proposta-construtor).
  const sp = new Date(publicadaEm.getTime() - 3 * H);
  const alvo = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + dias));
  return `${alvo.toISOString().slice(0, 10)}T23:59:59-03:00`;
}

function ataDaAlicerce(): { hash: string; caracteres: number | string } {
  try {
    const raiz = join(__dirname, '..', '..', '..', '..');
    const texto = readFileSync(join(raiz, SEMENTE_ATA_ALICERCE), 'utf8');
    return { hash: hashDoConteudo(texto), caracteres: texto.length };
  } catch {
    // Sem a fixture (execução fora do repositório): o hash é do nome, e o tamanho fica por decidir.
    return { hash: hashDoConteudo({ semente: 'ata', lead: 'alicerce' }), caracteres: '[a decidir]' };
  }
}

// ---------------------------------------------------------------------------
// As peças repetidas de qualquer fio
// ---------------------------------------------------------------------------

interface Abertura {
  telefone: string;
  canal: 'conteudo';
  texto?: string;
  palavraChave?: string | null;
  contato?: string | null;
  /** Como o texto do WhatsApp trata o lead: o primeiro nome do contato, ou o nome da empresa. */
  tratamento: string;
  slug: string;
  salaId: string;
  entrada: Date;
}

/** `lead.chegou`, a sala, o dono pela regra e a M1: o que a reação de entrada faz em E1. */
function abrir(f: Fio, ctx: ContextoDoRoteiro, a: Abertura): void {
  f.add('lead.chegou', 'whatsapp', { telefone: normalizarTelefone(a.telefone), ...(a.texto ? { texto: a.texto } : {}), canal: a.canal, palavraChave: a.palavraChave ?? null, nome: a.contato ?? null }, a.entrada);
  if (a.texto) f.add('whats.recebida', 'primeira', { texto: a.texto, mensagemId: 'primeira', provedor: 'simulado' }, seg(a.entrada, 1));
  f.add('sala.aberta', 'sala', { salaId: a.salaId, slug: a.slug, validoAte: new Date(a.entrada.getTime() + 90 * D).toISOString() }, seg(a.entrada, 2));
}

function atribuirDono(f: Fio, ctx: ContextoDoRoteiro, em: Date): void {
  f.add('dono.atribuido', 'regra-v1', { donoId: ctx.dono?.id ?? null, donoNome: ctx.dono?.nome ?? null, regra: REGRA_DO_DONO }, em);
}

function enviarM1(f: Fio, a: Abertura, em: Date): void {
  const texto = textoDe('M1', { nome: a.tratamento, linkDaSala: '/s/…' });
  f.add('whats.enviada', 'M1', { template: 'M1', texto, provedor: 'simulado', mensagemDbId: null, aprovadaPor: null }, em);
}

interface Agenda {
  /** Quando o lead tocou no horário. */
  escolhidaEm: Date;
  /** O começo da sessão. */
  sessaoEm: Date;
}

/** M2, a escolha do horário, E2 → E3 e a confirmação de véspera (M3). */
function agendar(f: Fio, a: Abertura, ag: Agenda, pularQualificacao: boolean): void {
  const segundoHorario = new Date(ag.sessaoEm.getTime() + D + 5 * H);
  const m2 = textoDe('M2', { nome: a.tratamento, horario1: rotuloDoHorario(ag.sessaoEm.toISOString()), horario2: rotuloDoHorario(segundoHorario.toISOString()) });
  f.add('whats.enviada', 'M2', { template: 'M2', texto: m2, provedor: 'simulado', mensagemDbId: null, aprovadaPor: null }, seg(ag.escolhidaEm, -5));
  const escolhida = f.add('agenda.escolhida', 'horario', { horario: isoSP(ag.sessaoEm), oferecidos: [isoSP(ag.sessaoEm), isoSP(segundoHorario)] }, ag.escolhidaEm);
  const gatilho = { tipo: 'agenda.escolhida' as const, id: escolhida };
  if (pularQualificacao) f.mudou('novo_lead', 'qualificacao', gatilho, seg(ag.escolhidaEm, 1), 'agenda.escolhida sustenta reuniao_agendada (a passagem por E2 não tem formulário no mapa)');
  f.mudou('qualificacao', 'reuniao_agendada', gatilho, seg(ag.escolhidaEm, 2));
  const vespera = new Date(ag.sessaoEm.getTime() - D);
  const m3 = textoDe('M3', { nome: a.tratamento, horario: rotuloDoHorario(ag.sessaoEm.toISOString()), linkDaSala: '/s/…' });
  f.add('whats.enviada', 'M3', { template: 'M3', texto: m3, provedor: 'simulado', mensagemDbId: null, aprovadaPor: null }, vespera);
  f.add('agenda.confirmada', 'vespera', { horario: isoSP(ag.sessaoEm), via: 'M3' }, seg(vespera, 1));
}

interface Diagnostico {
  ataEm: Date;
  ata: { hash: string; caracteres: number | string };
  prontoEm: Date;
  aprovadoEm: Date;
  dores: { n: number; texto: string; minuto: string | null; trecho?: string }[];
  objecoes: string[];
  objecoesComTrecho?: unknown;
  produto: ComercialProduto;
}

/** A ata, o diagnóstico, a aprovação do sócio (o mesmo fato de novo) e as passagens E3 → E4 → E5. */
function diagnosticar(f: Fio, d: Diagnostico): string {
  const ata = f.add('ata.chegou', d.ata.hash, { hash: d.ata.hash, caracteres: d.ata.caracteres, fonte: 'granola', referencia: null, por: 'sócio da vez' }, d.ataEm);
  f.mudou('reuniao_agendada', 'sessao', { tipo: 'ata.chegou', id: ata }, seg(d.ataEm, 1));
  const payload = {
    dores: d.dores,
    objecoes: d.objecoes,
    produtoSugerido: d.produto,
    modelo: 'semente-de-demonstracao',
    custoUsd: 0,
    custoDesconhecido: true,
    aprovadoEm: null,
    aprovadoPor: null,
    ...(d.objecoesComTrecho ? { objecoesComTrecho: d.objecoesComTrecho } : {}),
    avisos: [],
    ataHash: d.ata.hash,
    provider: 'semente',
  };
  const pronto = f.add('diagnostico.pronto', `${d.ata.hash}:semente`, payload, d.prontoEm);
  f.mudou('sessao', 'diagnostico', { tipo: 'diagnostico.pronto', id: pronto }, seg(d.prontoEm, 1));
  // O sócio aprova: o MESMO fato com `aprovadoEm`, outra chave (portão de E5).
  f.add('diagnostico.pronto', `aprovado:${pronto}`, { ...payload, aprovadoEm: d.aprovadoEm.toISOString(), aprovadoPor: 'sócio da vez', aprovaOEvento: pronto }, d.aprovadoEm);
  return pronto;
}

interface Proposta {
  em: Date;
  produto: ComercialProduto;
  dores: string[];
  comoEDiferente: string | null;
  /** O nome para o texto da M4. */
  tratamento: string;
}

/** A proposta v1 publicada na sala (como o `PropostaService` grava), a M4 e E5 → E6. Devolve o id e o valor. */
function publicar(f: Fio, ctx: ContextoDoRoteiro, p: Proposta): { id: string; validaAte: string | null; hash: string; valorCentavos: number; parcelas: number; formas: string[] } {
  const v = montarProposta({
    leadId: f.leadId,
    versao: 1,
    produto: p.produto,
    dores: p.dores,
    comoEDiferente: p.comoEDiferente,
    quadro: QUADRO_DE_EXEMPLO,
    validadeDias: ctx.validadePropostaDias,
    agora: p.em,
  });
  const laudo = revisarProposta(v);
  const hash = hashDaVersao(v);
  // Revisão E-3: o quadro de custos de EXEMPLO é apontamento do revisor. A versão
  // só sai porque uma pessoa da mesa a levou à liberação na decisão
  // `proposta_fora_da_tabela`, sobre ESTE hash; o laudo publicado cita a decisão.
  const liberadoNaDecisao = laudo.ok ? null : decisaoQueLiberou(f, ctx, v.produto, laudo.apontamentos, hash, p.em);
  const id = f.add(
    'proposta.publicada',
    'v1',
    {
      versao: 1,
      produto: v.produto,
      valorCentavos: v.valorCentavos,
      parcelas: v.parcelas,
      parcelaCentavos: v.parcelaCentavos,
      formas: v.formas,
      validaAte: v.validaAte,
      dentroDaTabela: dentroDaTabela(v),
      laudo: { ok: laudo.ok, apontamentos: laudo.apontamentos, ...(liberadoNaDecisao ? { liberadoNaDecisao } : {}) },
      descontoPct: v.descontoPct,
      hash,
      quadroDeCustos: { mesNormalCentavos: QUADRO_DE_EXEMPLO.mesNormalCentavos, piorMesCentavos: QUADRO_DE_EXEMPLO.piorMesCentavos },
      alternativa: v.alternativa,
      ouvimos: v.ouvimos,
      comoEDiferente: v.comoEDiferente,
      ultimaParcelaCentavos: v.ultimaParcelaCentavos,
      notasDoLaudo: laudo.notas,
      quadroDeExemplo: true,
      descontoDecisaoId: null,
      liberadaPor: null,
      approvalId: null,
    },
    seg(p.em, 2),
  );
  f.mudou('diagnostico', 'proposta', { tipo: 'proposta.publicada', id }, seg(p.em, 3));
  const m4 = textoDe('M4', { nome: p.tratamento, linkDaSala: '/s/…', validade: (v.validaAte ?? '').slice(8, 10) + '/' + (v.validaAte ?? '').slice(5, 7) });
  f.add('whats.enviada', 'M4', { template: 'M4', texto: m4, provedor: 'simulado', mensagemDbId: null, aprovadaPor: null }, seg(p.em, 60));
  return { id, validaAte: v.validaAte, hash, valorCentavos: v.valorCentavos, parcelas: v.parcelas, formas: v.formas };
}

/**
 * A decisão `proposta_fora_da_tabela` aberta pelo revisor e tomada pela mesa
 * ("Levar à liberação assim"), como o `PropostaService` e o `DecisoesService`
 * gravam. Aberta no instante da proposta pronta, tomada um segundo depois.
 */
function decisaoQueLiberou(f: Fio, ctx: ContextoDoRoteiro, produto: ComercialProduto, apontamentos: string[], hash: string, em: Date): string {
  const linha = TABELA_DE_PRECO[produto]!;
  const d = abrirDecisao(f, ctx, {
    tipo: 'proposta_fora_da_tabela',
    chave: `fora-da-tabela:${f.leadId}:v1:${hash}`,
    titulo: 'Proposta v1 com laudo sujo',
    contexto: [
      `${linha.rotulo}: ${linha.parcelas}× de ${(linha.parcelaCentavos / 100).toFixed(2)} (total ${(linha.valorCentavos / 100).toFixed(2)}).`,
      `O revisor apontou: ${apontamentos.join('; ') || 'nada'}.`,
    ].join(' '),
    opcoes: [
      { chave: 'liberar', rotulo: 'Levar à liberação assim', efeito: 'vai à porta (R3): outra pessoa libera em /atendimento' },
      { chave: 'segurar', rotulo: 'Segurar', efeito: 'a proposta fica parada até alguém refazer' },
    ],
    padrao: 'segurar',
    dados: { versao: 1, hash },
    criadaEm: em,
  });
  const tomadaEm = seg(em, 1);
  const eventoDecisaoId = f.add('decisao.tomada', d.id, { decisaoId: d.id, tipo: d.tipo, escolha: 'liberar', por: MESA_DA_SEMENTE, canal: 'tela' }, tomadaEm);
  f.decisoes.push({ ...d, tomada: { escolha: 'liberar', por: MESA_DA_SEMENTE, canal: 'tela', em: tomadaEm, eventoDecisaoId } });
  return d.id;
}

/** Quem toma, na semente, a decisão de levar a proposta com o quadro de exemplo à liberação. */
const MESA_DA_SEMENTE = 'Mesa · responsável (homologação)';

function lerProposta(f: Fio, bloco: string, visita: number, em: Date, primeira: boolean): void {
  const id = f.add('proposta.lida', `v1:${bloco}:${visita}`, { versao: 1, bloco, visita }, em);
  if (primeira) f.mudou('proposta', 'follow_up', { tipo: 'proposta.lida', id }, seg(em, 1));
}

function abrirDecisao(
  f: Fio,
  ctx: ContextoDoRoteiro,
  d: { tipo: string; chave: string; titulo: string; contexto: string; opcoes: OpcaoDeDecisao[]; padrao: string; dados: Record<string, unknown>; criadaEm: Date },
): DecisaoSemeada {
  const id = uuidDe([ctx.orgId, 'comercial-decisao', f.leadId, d.tipo, d.chave]);
  const expiraEm = new Date(d.criadaEm.getTime() + ctx.decisaoExpiraHoras * H);
  const eventoAberturaId = f.add('decisao.aberta', id, { decisaoId: id, tipo: d.tipo, padrao: d.padrao, expiraEm: expiraEm.toISOString() }, d.criadaEm);
  return { id, tipo: d.tipo, titulo: d.titulo, contexto: d.contexto, opcoes: d.opcoes, padrao: d.padrao, criadaEm: d.criadaEm, expiraEm, dados: d.dados, eventoAberturaId };
}

// ---------------------------------------------------------------------------
// As oito empresas
// ---------------------------------------------------------------------------

function base(ctx: ContextoDoRoteiro, slug: string, n: number): { telefone: string; leadId: string; salaId: string } {
  const telefone = `55119000000${String(n).padStart(2, '0')}`;
  return { telefone, leadId: leadIdDoTelefone(ctx.orgId, telefone), salaId: uuidDe([ctx.orgId, 'seed-comercial', 'sala', slug]) };
}

/** Empresa que só aparece pelo nome no mapa: o nome da empresa é o nome do lead e o tratamento do texto. */
function abertura(slug: string, empresa: string, b: ReturnType<typeof base>, entrada: Date): Abertura {
  return { telefone: b.telefone, canal: 'conteudo', slug, salaId: b.salaId, entrada, tratamento: empresa };
}

const OPCOES_DO_PONTO_ZERO: OpcaoDeDecisao[] = [
  { chave: 'aceitar_excecao', rotulo: 'aceitar exceção', efeito: 'o lead segue na qualificação' },
  { chave: 'geladeira', rotulo: 'geladeira', efeito: 'sai para a geladeira com motivo "sem base" (data de volta [a decidir])' },
  { chave: 'desqualificar', rotulo: 'desqualificar', efeito: 'sai como desqualificado, motivo "sem base"' },
];

/** As opções do pedido de ajuste de 8%, como `opcoesDoAjuste` as monta (metade, o pedido, manter). */
const OPCOES_DO_AJUSTE_DE_8: OpcaoDeDecisao[] = [
  { chave: 'desconto:4', rotulo: 'Aprovar 4%', efeito: 'nova versão da proposta com este desconto, à liberação (R3)' },
  { chave: 'desconto:8', rotulo: 'Aprovar 8%', efeito: 'nova versão da proposta com este desconto, à liberação (R3)' },
  { chave: 'manter', rotulo: 'Manter o preço', efeito: 'nada muda; a sala mostra que o ajuste foi respondido' },
];

export function montarRoteiros(ctx: ContextoDoRoteiro): RoteiroDoLead[] {
  const { agora } = ctx;
  return [cafeSerra(ctx, agora), studioLume(ctx, agora), alicerce(ctx, agora), oticaVista(ctx, agora), redePaoBom(ctx, agora), mercadoBomPreco(ctx, agora), petFeliz(ctx, agora), autoPecasSul(ctx, agora)];
}

// --- Café Serra · E1 · "formulário · lembrete em 2 h" -----------------------

function cafeSerra(ctx: ContextoDoRoteiro, agora: Date): RoteiroDoLead {
  const slug = 'cafe-serra';
  const b = base(ctx, slug, 1);
  const entrada = new Date(agora.getTime() - 3 * H);
  const f = new Fio(ctx.orgId, b.leadId);
  const a = abertura(slug, 'Café Serra', b, entrada);
  abrir(f, ctx, a);
  atribuirDono(f, ctx, seg(entrada, 3));
  enviarM1(f, a, seg(entrada, 60));
  return {
    slug,
    empresa: 'Café Serra',
    nome: 'Café Serra',
    ...b,
    entrada,
    eventos: f.fechar(),
    decisoes: [],
    cobrancas: [],
    documentos: [],
    overlay: { saude: null, proximaAcao: { tipo: 'lembrete_do_formulario', quando: new Date(agora.getTime() + 2 * H), descricao: 'formulário · lembrete em 2 h' } },
    etapaEsperada: 'novo_lead',
    resumo: 'novo lead há 3 h, M1 enviada, formulário sem resposta',
  };
}

// --- Studio Lume · E2 · decisão sua · ponto zero ---------------------------

function studioLume(ctx: ContextoDoRoteiro, agora: Date): RoteiroDoLead {
  const slug = 'studio-lume';
  const b = base(ctx, slug, 2);
  const entrada = new Date(agora.getTime() - 70 * MIN);
  const f = new Fio(ctx.orgId, b.leadId);
  const a = abertura(slug, 'Studio Lume', b, entrada);
  abrir(f, ctx, a);
  atribuirDono(f, ctx, seg(entrada, 3));
  enviarM1(f, a, seg(entrada, 60));

  // O formulário chega há 40 minutos; "Usa planilhas soltas. Pontuação 41" é a tela 03.
  const formEm = new Date(agora.getTime() - 40 * MIN);
  const form = f.add('form.respondido', 'formulario', { sistema: 'planilhas soltas', baseOrganizada: false, empresa: 'Studio Lume' }, formEm);
  f.add('lead.pontuado', `form:${form}`, { pontuacao: 41, perfil: 'P1', criterios: { canal: 'conteudo', sistema: 'planilhas soltas', baseOrganizada: false, fonte: 'exemplo do mapa (tela 03)' } }, seg(formEm, 2));
  f.mudou('novo_lead', 'qualificacao', { tipo: 'form.respondido', id: form }, seg(formEm, 3));
  const decisao = abrirDecisao(f, ctx, {
    tipo: 'ponto_zero',
    chave: 'form',
    titulo: 'Lead sem base de dados organizada',
    contexto: 'Usa planilhas soltas. Pontuação 41. A regra de 15/09 só aceita cliente com sistema e base; a exceção é decisão de vocês.',
    opcoes: OPCOES_DO_PONTO_ZERO,
    padrao: 'geladeira',
    dados: { baseOrganizada: false, sistema: 'planilhas soltas' },
    criadaEm: seg(formEm, 4),
  });
  return {
    slug,
    empresa: 'Studio Lume',
    nome: 'Studio Lume',
    ...b,
    entrada,
    eventos: f.fechar(),
    decisoes: [decisao],
    cobrancas: [],
    documentos: [],
    overlay: { saude: null, proximaAcao: { tipo: 'decisao', quando: null, descricao: 'decisão sua · ponto zero' } },
    etapaEsperada: 'qualificacao',
    resumo: 'formulário respondido há 40 min (planilhas soltas, sem base, pontuação 41); decisão ponto_zero aberta',
  };
}

// --- Construtora Alicerce · E7 (a tela 04 a põe em "conversa"; ver o topo) --

function alicerce(ctx: ContextoDoRoteiro, agora: Date): RoteiroDoLead {
  const slug = 'alicerce';
  const b = base(ctx, slug, 3);
  // O pedido de 8% é a tela 05 (D5 09:02), há 25 minutos; os outros horários do fio andam juntos com ele.
  const pedidoEm = new Date(agora.getTime() - 25 * MIN);
  const entrada = new Date(pedidoEm.getTime() - 4 * D + 10 * MIN); // D1 09:12
  const f = new Fio(ctx.orgId, b.leadId);
  const ata = ataDaAlicerce();
  const a: Abertura = {
    telefone: b.telefone,
    canal: 'conteudo',
    texto: 'Oi! Vi o vídeo do fechamento do mês em 1 dia. Funciona com Omie?',
    palavraChave: 'FECHAMENTO',
    contato: 'Marina Duarte',
    tratamento: 'Marina',
    slug,
    salaId: b.salaId,
    entrada,
  };
  abrir(f, ctx, a);
  f.add(
    'cnpj.enriquecido',
    'receita',
    { razaoSocial: 'Construtora Alicerce Ltda', funcionarios: 38, cidade: 'Juiz de Fora', fonte: 'exemplo do mapa (tela 05)' },
    seg(entrada, 3),
  );
  f.add('lead.pontuado', 'inicial', { pontuacao: 82, perfil: 'P2', criterios: { canal: 'conteudo', sistema: 'Omie', baseOrganizada: true, fonte: 'exemplo do mapa (tela 05)' } }, seg(entrada, 4));
  atribuirDono(f, ctx, seg(entrada, 5));
  enviarM1(f, a, seg(entrada, 60));

  // D1 09:31 · 4 respostas e o horário de quinta 10h; a sessão é D4 10:00.
  const formEm = new Date(entrada.getTime() + 19 * MIN);
  const form = f.add('form.respondido', 'formulario', { sistema: 'Omie', baseOrganizada: true, maiorDor: 'fechamento leva 9 dias', equipeFinanceiro: 3, nome: 'Marina Duarte', empresa: 'Construtora Alicerce' }, formEm);
  f.mudou('novo_lead', 'qualificacao', { tipo: 'form.respondido', id: form }, seg(formEm, 1));
  const sessaoEm = naHora(new Date(entrada.getTime() + 3 * D + 48 * MIN));
  agendar(f, a, { escolhidaEm: seg(formEm, 20), sessaoEm }, false);

  // D4 · a ata (Granola, 42 min), o diagnóstico às 11:05, a aprovação do sócio.
  const ataEm = new Date(sessaoEm.getTime() + 45 * MIN);
  const prontoEm = new Date(ataEm.getTime() + 20 * MIN);
  const dores = [
    { n: 1, texto: 'fechamento do mês só no dia 9', minuto: '04:12', trecho: 'a gente fecha o mês no dia 9, sempre atrasado' },
    { n: 2, texto: 'conciliação manual do Omie com o banco', minuto: '11:40', trecho: 'conciliação do Omie com o banco é na mão' },
    { n: 3, texto: 'dono sem número cedo', minuto: '19:05', trecho: 'o dono só vê o resultado no dia 15' },
    { n: 4, texto: 'consultoria anterior parou no segundo mês', minuto: '27:30', trecho: 'já tentamos uma consultoria, parou no segundo mês' },
  ];
  diagnosticar(f, {
    ataEm,
    ata,
    prontoEm,
    aprovadoEm: new Date(prontoEm.getTime() + 5 * MIN),
    dores,
    objecoes: ['experiência ruim com consultoria'],
    objecoesComTrecho: [{ texto: 'experiência ruim com consultoria', trecho: 'já tentamos uma consultoria, parou no segundo mês', minuto: '27:30' }],
    produto: 'operacao',
  });

  // D4 18:00 · a proposta v1 (dentro da tabela); D5 08:41 · lida 3 vezes por 2 pessoas; 09:02 · pede 8%.
  const publicadaEm = new Date(sessaoEm.getTime() + 8 * H);
  publicar(f, ctx, {
    em: publicadaEm,
    produto: 'operacao',
    dores: dores.map((d) => d.texto),
    comoEDiferente: 'O fechamento passa a rodar com a sua equipe, e a gente fica junto até ele rodar sozinho.',
    tratamento: 'Marina',
  });
  const leituraEm = new Date(pedidoEm.getTime() - 21 * MIN);
  lerProposta(f, 'ouvimos', 1, leituraEm, true);
  lerProposta(f, 'recomendada', 1, seg(leituraEm, 40), false);
  lerProposta(f, 'custos', 2, new Date(leituraEm.getTime() + 9 * MIN), false);
  const ajuste = f.add('proposta.ajuste_pedido', 'desconto-8', { versao: 1, pedido: 'Desconto de 8%', descontoPct: 8 }, pedidoEm);
  const decisao = abrirDecisao(f, ctx, {
    tipo: 'pedido_de_ajuste',
    chave: `ajuste:${ajuste}`,
    titulo: 'Construtora Alicerce pediu 8% de desconto na Operação ROOT',
    contexto: [
      'Pedido: "Desconto de 8%".',
      'Leitura da v1: 3 leitura(s) de bloco, 3 bloco(s), 2 visita(s).',
      `Operação ROOT R$ 11.997 → R$ 11.037 com 8%. Padrão se ninguém responder: manter o preço.`,
    ].join(' '),
    opcoes: OPCOES_DO_AJUSTE_DE_8,
    padrao: 'manter',
    dados: { versao: 1, descontoPedido: 8, eventoDoPedido: ajuste },
    criadaEm: seg(pedidoEm, 20),
  });
  return {
    slug,
    empresa: 'Construtora Alicerce',
    nome: 'Marina Duarte',
    ...b,
    entrada,
    eventos: f.fechar(),
    decisoes: [...f.decisoes, decisao],
    cobrancas: [],
    documentos: [],
    overlay: { saude: 86, proximaAcao: { tipo: 'm6', quando: new Date(agora.getTime() + 3 * D), descricao: 'se não houver resposta em 3 dias: M6 com um caso parecido' } },
    etapaEsperada: 'follow_up',
    resumo: 'fio inteiro da tela 05 (D1 a D5): Omie, 82 P2, sessão, ata, diagnóstico de 4 dores, proposta v1 da Operação, 3 leituras, pedido de 8% e decisão aberta',
  };
}

// --- Ótica Vista · E5 · "proposta sai 18:00 · segurar?" --------------------

function oticaVista(ctx: ContextoDoRoteiro, agora: Date): RoteiroDoLead {
  const slug = 'otica-vista';
  const b = base(ctx, slug, 4);
  const sessaoEm = naHora(new Date(agora.getTime() - 195 * MIN)); // sessão há 3h15 ou mais; ata há 2h30, diagnóstico há 2h
  const entrada = new Date(sessaoEm.getTime() - 6 * D);
  const f = new Fio(ctx.orgId, b.leadId);
  const a = abertura(slug, 'Ótica Vista', b, entrada);
  abrir(f, ctx, a);
  atribuirDono(f, ctx, seg(entrada, 3));
  enviarM1(f, a, seg(entrada, 60));
  agendar(f, a, { escolhidaEm: new Date(entrada.getTime() + 3 * H), sessaoEm }, true);
  diagnosticar(f, {
    ataEm: new Date(agora.getTime() - 150 * MIN),
    ata: { hash: hashDoConteudo({ semente: 'ata', lead: slug }), caracteres: '[a decidir]' },
    prontoEm: new Date(agora.getTime() - 120 * MIN),
    aprovadoEm: new Date(agora.getTime() - 60 * MIN),
    dores: [],
    objecoes: [],
    produto: 'operacao',
  });
  return {
    slug,
    empresa: 'Ótica Vista',
    nome: 'Ótica Vista',
    ...b,
    entrada,
    eventos: f.fechar(),
    decisoes: [],
    cobrancas: [],
    documentos: [],
    overlay: { saude: null, proximaAcao: { tipo: 'proposta', quando: null, descricao: 'proposta sai às 18:00, depois de construída' } },
    etapaEsperada: 'diagnostico',
    resumo: 'sessão há 3 h, ata e diagnóstico (dores [a decidir]) aprovado há 1 h; falta construir e publicar a proposta',
  };
}

// --- Rede Pão Bom · E7 · "leu e sumiu · M6 em 2 dias" ----------------------

function redePaoBom(ctx: ContextoDoRoteiro, agora: Date): RoteiroDoLead {
  const slug = 'rede-pao-bom';
  const b = base(ctx, slug, 5);
  const publicadaEm = new Date(agora.getTime() - 6 * D);
  const sessaoEm = naHora(new Date(publicadaEm.getTime() - 8 * H - 10 * H));
  const entrada = new Date(sessaoEm.getTime() - 4 * D);
  const f = new Fio(ctx.orgId, b.leadId);
  const a = abertura(slug, 'Rede Pão Bom', b, entrada);
  abrir(f, ctx, a);
  atribuirDono(f, ctx, seg(entrada, 3));
  enviarM1(f, a, seg(entrada, 60));
  agendar(f, a, { escolhidaEm: new Date(entrada.getTime() + 2 * H), sessaoEm }, true);
  const ataEm = new Date(sessaoEm.getTime() + 45 * MIN);
  diagnosticar(f, {
    ataEm,
    ata: { hash: hashDoConteudo({ semente: 'ata', lead: slug }), caracteres: '[a decidir]' },
    prontoEm: new Date(ataEm.getTime() + 20 * MIN),
    aprovadoEm: new Date(ataEm.getTime() + 60 * MIN),
    dores: [],
    objecoes: [],
    produto: 'imersao',
  });
  publicar(f, ctx, { em: publicadaEm, produto: 'imersao', dores: [], comoEDiferente: null, tratamento: 'Rede Pão Bom' });
  const lidaEm = new Date(agora.getTime() - 5 * D);
  lerProposta(f, 'recomendada', 1, lidaEm, true);
  // M5 três dias depois da leitura (fupLeuDias da homologação); depois, silêncio.
  const m5Em = new Date(lidaEm.getTime() + 3 * D);
  const m5 = textoDe('M5', { nome: 'Rede Pão Bom', validade: validadeDaProposta(publicadaEm, ctx.validadePropostaDias).slice(8, 10) + '/' + validadeDaProposta(publicadaEm, ctx.validadePropostaDias).slice(5, 7) });
  f.add('whats.enviada', 'M5', { template: 'M5', texto: m5, provedor: 'simulado', mensagemDbId: null, aprovadaPor: null }, m5Em);
  f.add('followup.enviado', 'M5:v1', { qual: 'M5', versao: 1, mensagemDbId: null }, seg(m5Em, 1));
  return {
    slug,
    empresa: 'Rede Pão Bom',
    nome: 'Rede Pão Bom',
    ...b,
    entrada,
    eventos: f.fechar(),
    decisoes: [...f.decisoes],
    cobrancas: [],
    documentos: [],
    overlay: { saude: null, proximaAcao: { tipo: 'm6', quando: new Date(agora.getTime() + 2 * D), descricao: 'leu e sumiu · M6 em 2 dias' } },
    etapaEsperada: 'follow_up',
    resumo: 'proposta v1 da Imersão há 6 dias, lida uma vez há 5, M5 há 2 dias, sem resposta',
  };
}

// --- Mercado Bom Preço · E8 · "assinou · Pix aguardando" -------------------

function mercadoBomPreco(ctx: ContextoDoRoteiro, agora: Date): RoteiroDoLead {
  const slug = 'mercado-bom-preco';
  const b = base(ctx, slug, 6);
  const aceiteEm = new Date(agora.getTime() - 3 * H);
  const publicadaEm = new Date(aceiteEm.getTime() - 5 * D);
  const sessaoEm = naHora(new Date(publicadaEm.getTime() - 8 * H - 10 * H));
  const entrada = new Date(sessaoEm.getTime() - 3 * D);
  const f = new Fio(ctx.orgId, b.leadId);
  const a = abertura(slug, 'Mercado Bom Preço', b, entrada);
  abrir(f, ctx, a);
  atribuirDono(f, ctx, seg(entrada, 3));
  enviarM1(f, a, seg(entrada, 60));
  agendar(f, a, { escolhidaEm: new Date(entrada.getTime() + 2 * H), sessaoEm }, true);
  const ataEm = new Date(sessaoEm.getTime() + 45 * MIN);
  diagnosticar(f, {
    ataEm,
    ata: { hash: hashDoConteudo({ semente: 'ata', lead: slug }), caracteres: '[a decidir]' },
    prontoEm: new Date(ataEm.getTime() + 20 * MIN),
    aprovadoEm: new Date(ataEm.getTime() + 60 * MIN),
    dores: [],
    objecoes: [],
    produto: 'operacao',
  });
  const prop = publicar(f, ctx, { em: publicadaEm, produto: 'operacao', dores: [], comoEDiferente: null, tratamento: 'Mercado Bom Preço' });
  lerProposta(f, 'recomendada', 1, new Date(publicadaEm.getTime() + 2 * H), true);

  // O aceite de hoje: Operação ROOT, Pix (a tabela admite Pix só na Operação), 3 parcelas mensais. Os dados do contratante não estão no mapa.
  const aceita = f.add('proposta.aceita', 'v1', { versao: 1, produto: 'operacao', valorCentavos: prop.valorCentavos, parcelas: prop.parcelas, forma: 'pix', hash: prop.hash }, aceiteEm);
  f.mudou('follow_up', 'contrato', { tipo: 'proposta.aceita', id: aceita }, seg(aceiteEm, 1));
  f.add('aceite.dados', 'v1', { cnpj: '[a decidir]', razaoSocial: 'Mercado Bom Preço', endereco: '[a decidir]', quemAssina: '[a decidir]', email: '[a decidir]' }, seg(aceiteEm, 300));
  const primeiraVence = aceiteEm;
  const vence = (n: number) => new Date(primeiraVence.getTime() + n * 30 * D);
  const linha = TABELA_DE_PRECO.operacao!;
  f.add('cobranca.criada', 'v1', { provedor: 'asaas', externoId: `semente-${slug}`, parcelas: prop.parcelas, forma: 'pix', valorCentavos: prop.valorCentavos, primeiraVence: primeiraVence.toISOString() }, seg(aceiteEm, 480));
  const hashDoc = hashDoConteudo({ semente: 'contrato', lead: slug, proposta: prop.hash });
  f.add('contrato.gerado', hashDoc, { provedor: 'zapsign', externoId: `semente-${slug}`, hash: hashDoc }, seg(aceiteEm, 540));
  const assinouEm = new Date(aceiteEm.getTime() + 10 * MIN);
  f.add('contrato.assinado_cliente', `semente-${slug}`, { provedor: 'zapsign', externoId: `semente-${slug}`, em: assinouEm.toISOString() }, assinouEm);
  return {
    slug,
    empresa: 'Mercado Bom Preço',
    nome: 'Mercado Bom Preço',
    ...b,
    entrada,
    eventos: f.fechar(),
    decisoes: [...f.decisoes],
    cobrancas: Array.from({ length: prop.parcelas }, (_, i) => ({
      externoId: `semente-${slug}-p${i + 1}`,
      parcela: i + 1,
      parcelas: prop.parcelas,
      valorCentavos: linha.parcelaCentavos,
      forma: 'pix',
      vence: vence(i),
    })),
    documentos: [{ externoId: `semente-${slug}`, estado: 'assinado_parcial', hashConteudo: hashDoc, assinadoClienteEm: assinouEm }],
    overlay: { saude: null, proximaAcao: { tipo: 'aguardar_pix', quando: null, descricao: 'assinou · Pix aguardando' } },
    etapaEsperada: 'contrato',
    resumo: 'aceitou a Operação ROOT há 3 h (Pix, 3×), cliente assinou o contrato, 1ª parcela pendente; falta a assinatura da Root e o Pix',
  };
}

// --- Pet Feliz · geladeira · volta 10/12 ------------------------------------

function petFeliz(ctx: ContextoDoRoteiro, agora: Date): RoteiroDoLead {
  const slug = 'pet-feliz';
  const b = base(ctx, slug, 7);
  const entrada = new Date(agora.getTime() - 20 * D);
  const f = new Fio(ctx.orgId, b.leadId);
  const a = abertura(slug, 'Pet Feliz', b, entrada);
  abrir(f, ctx, a);
  atribuirDono(f, ctx, seg(entrada, 3));
  enviarM1(f, a, seg(entrada, 60));
  // "10/12" é o próximo 10 de dezembro; o motivo não aparece no mapa, então fica por decidir.
  const ano = agora.getUTCMonth() === 11 && agora.getUTCDate() > 10 ? agora.getUTCFullYear() + 1 : agora.getUTCFullYear();
  const voltaEm = `${ano}-12-10T12:00:00-03:00`;
  const saiuEm = new Date(agora.getTime() - 5 * D);
  const saida = f.add(
    'saida.registrada',
    'geladeira:semente',
    { saida: 'geladeira', motivo: 'outro', detalhe: 'motivo [a decidir]: o mapa só mostra "geladeira · volta 10/12"', voltaEm, parceiro: null, por: null },
    saiuEm,
  );
  f.mudou('novo_lead', 'geladeira', { tipo: 'saida.registrada', id: saida }, seg(saiuEm, 1), 'saída: outro');
  return {
    slug,
    empresa: 'Pet Feliz',
    nome: 'Pet Feliz',
    ...b,
    entrada,
    eventos: f.fechar(),
    decisoes: [],
    cobrancas: [],
    documentos: [],
    overlay: { saude: null, proximaAcao: { tipo: 'volta_da_geladeira', quando: new Date(voltaEm), descricao: 'geladeira · volta 10/12' } },
    etapaEsperada: 'geladeira',
    resumo: `geladeira há 5 dias com volta em 10/12, motivo "outro" ([a decidir])`,
  };
}

// --- Auto Peças Sul · perdido · preço ---------------------------------------

function autoPecasSul(ctx: ContextoDoRoteiro, agora: Date): RoteiroDoLead {
  const slug = 'auto-pecas-sul';
  const b = base(ctx, slug, 8);
  const perdeuEm = new Date(agora.getTime() - 2 * D);
  const lidaEm = new Date(perdeuEm.getTime() - 5 * D);
  const publicadaEm = new Date(lidaEm.getTime() - 6 * H);
  const sessaoEm = naHora(new Date(publicadaEm.getTime() - 8 * H - 10 * H));
  const entrada = new Date(sessaoEm.getTime() - 3 * D);
  const f = new Fio(ctx.orgId, b.leadId);
  const a = abertura(slug, 'Auto Peças Sul', b, entrada);
  abrir(f, ctx, a);
  atribuirDono(f, ctx, seg(entrada, 3));
  enviarM1(f, a, seg(entrada, 60));
  agendar(f, a, { escolhidaEm: new Date(entrada.getTime() + 2 * H), sessaoEm }, true);
  const ataEm = new Date(sessaoEm.getTime() + 45 * MIN);
  diagnosticar(f, {
    ataEm,
    ata: { hash: hashDoConteudo({ semente: 'ata', lead: slug }), caracteres: '[a decidir]' },
    prontoEm: new Date(ataEm.getTime() + 20 * MIN),
    aprovadoEm: new Date(ataEm.getTime() + 60 * MIN),
    dores: [],
    objecoes: [],
    produto: 'operacao',
  });
  publicar(f, ctx, { em: publicadaEm, produto: 'operacao', dores: [], comoEDiferente: null, tratamento: 'Auto Peças Sul' });
  lerProposta(f, 'recomendada', 1, lidaEm, true);
  const saida = f.add('saida.registrada', 'perdido:semente', { saida: 'perdido', motivo: 'preco', detalhe: null, voltaEm: null, parceiro: null, por: null }, perdeuEm);
  f.mudou('follow_up', 'perdido', { tipo: 'saida.registrada', id: saida }, seg(perdeuEm, 1), 'saída: preco');
  return {
    slug,
    empresa: 'Auto Peças Sul',
    nome: 'Auto Peças Sul',
    ...b,
    entrada,
    eventos: f.fechar(),
    decisoes: [...f.decisoes],
    cobrancas: [],
    documentos: [],
    overlay: { saude: null, proximaAcao: null },
    etapaEsperada: 'perdido',
    resumo: 'proposta v1 da Operação lida, perdido há 2 dias por preço',
  };
}
