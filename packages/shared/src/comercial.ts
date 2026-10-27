import { z } from 'zod';

import type { SalaVersaoPublica } from './sala-versao.js';
import type { TarefaNoCartaoDoFunil } from './comercial-tarefas.js';
import type { PastaDoClienteNaFicha, ResumoDoVigia } from './comercial-agentes.js';
import type { AnexoDoImportado, ParcelasDoImportado, ReguaDoImportado } from './comercial-contrato-importado.js';

/*
 * O COCKPIT DO LEAD — o contrato do módulo comercial (12 e 13/10/2026).
 *
 * Este arquivo é a Lane 0 da passagem: o que a API grava, o que a tela lê e o
 * que a sala do cliente responde saem DAQUI. Nenhum dos três redigita enum,
 * rótulo ou tabela de preço. Desenho em `docs/comercial/mapa-da-operacao.html`
 * (seções C04, C07, C08, K01, K02, K04, K08) e no roteiro
 * `docs/comercial/PASSAGEM-PREDATOR-COMERCIAL.md`.
 *
 * TRÊS DECISÕES QUE ESTE ARQUIVO SUSTENTA
 *
 * 1. O fio do lead é o `LeadEvent`. Todo fato do comercial é um evento com um
 *    `type` deste catálogo (`COMERCIAL_EVENTOS`) e id derivado do conteúdo —
 *    o mesmo pedido repetido cai no mesmo evento. A ficha (tela 05) é
 *    PROJEÇÃO dos eventos: nenhuma tela grava campo à mão.
 *
 * 2. A etapa é do enum `ComercialEtapa` (E1 a E9 e as quatro saídas), numa
 *    tabela filha 1:1 do Lead. `Lead.status` NÃO morre: é derivado da etapa
 *    por `LEAD_STATUS_DA_ETAPA`, para o funil antigo, os relatórios e o MCP
 *    continuarem lendo o que leem hoje.
 *
 * 3. Quem move a etapa é a reação a um evento, nunca um PATCH de tela. O
 *    portão (`apps/api/src/comercial/portoes.ts`) recusa com a lista exata do
 *    que falta, e a lista é a coluna "obrigatório a partir de" da seção C07.
 *
 * PREÇO: a tabela de 04/10 mora aqui (`TABELA_DE_PRECO`) e em nenhum outro
 * lugar. Produto sem preço decidido fica `null` — e `null` é "[a decidir]",
 * nunca um número inventado.
 */

// ---------------------------------------------------------------------------
// Etapas e saídas (C04)
// ---------------------------------------------------------------------------

/** As nove estações do funil, na ordem em que o lead as percorre. */
export const COMERCIAL_ETAPAS = [
  'novo_lead',
  'qualificacao',
  'reuniao_agendada',
  'sessao',
  'diagnostico',
  'proposta',
  'follow_up',
  'contrato',
  'fechado',
] as const;
export type ComercialEtapaAtiva = (typeof COMERCIAL_ETAPAS)[number];

/** As quatro saídas. Todas com motivo e dono; só a desqualificação é definitiva. */
export const COMERCIAL_SAIDAS = ['desqualificado', 'geladeira', 'perdido', 'parceiro'] as const;
export type ComercialSaida = (typeof COMERCIAL_SAIDAS)[number];

/** O enum inteiro, como o Prisma o declara (`ComercialEtapa`). */
export const COMERCIAL_ESTAGIOS = [...COMERCIAL_ETAPAS, ...COMERCIAL_SAIDAS] as const;
export type ComercialEtapa = (typeof COMERCIAL_ESTAGIOS)[number];
export const ComercialEtapaSchema = z.enum(COMERCIAL_ESTAGIOS);

export function ehSaida(etapa: ComercialEtapa): etapa is ComercialSaida {
  return (COMERCIAL_SAIDAS as readonly string[]).includes(etapa);
}

/** Rótulo de tela de cada estágio (C04). */
export const COMERCIAL_ROTULO_DA_ETAPA: Record<ComercialEtapa, string> = {
  novo_lead: 'E1 · Novo lead',
  qualificacao: 'E2 · Qualificação',
  reuniao_agendada: 'E3 · Reunião agendada',
  sessao: 'E4 · Sessão estratégica',
  diagnostico: 'E5 · Diagnóstico',
  proposta: 'E6 · Proposta',
  follow_up: 'E7 · Follow-up',
  contrato: 'E8 · Contrato',
  fechado: 'E9 · Negócio fechado',
  desqualificado: 'Saída · Desqualificado',
  geladeira: 'Saída · Geladeira',
  perdido: 'Saída · Perdido',
  parceiro: 'Saída · Enviado a parceiro',
};

/** Quem age em cada etapa (a barra colorida do mapa): agente, humano ou os dois. */
export const COMERCIAL_QUEM_AGE: Record<ComercialEtapaAtiva, 'agente' | 'humano' | 'agente_e_socio'> = {
  novo_lead: 'agente',
  qualificacao: 'agente',
  reuniao_agendada: 'agente',
  sessao: 'humano',
  diagnostico: 'agente',
  proposta: 'agente_e_socio',
  follow_up: 'agente_e_socio',
  contrato: 'humano',
  fechado: 'agente_e_socio',
};

/**
 * `Lead.status` derivado da etapa — MAPA FIXO, para as telas antigas não
 * quebrarem. O enum `LeadStatus` (novo, qualificado, oportunidade, reuniao,
 * proposta, ganho, perdido) não muda. Geladeira e parceiro são leituras da
 * casa: o lead da geladeira segue qualificado (volta com data); o enviado a
 * parceiro conta como perdido para a Root.
 */
export const LEAD_STATUS_DA_ETAPA: Record<ComercialEtapa, string> = {
  novo_lead: 'novo',
  qualificacao: 'qualificado',
  reuniao_agendada: 'reuniao',
  sessao: 'reuniao',
  diagnostico: 'oportunidade',
  proposta: 'proposta',
  follow_up: 'proposta',
  contrato: 'proposta',
  fechado: 'ganho',
  desqualificado: 'perdido',
  geladeira: 'qualificado',
  perdido: 'perdido',
  parceiro: 'perdido',
};

/** A ordem numérica de uma etapa ativa (E1 = 1). Saída não tem ordem. */
export function ordemDaEtapa(etapa: ComercialEtapa): number | null {
  const i = (COMERCIAL_ETAPAS as readonly string[]).indexOf(etapa);
  return i >= 0 ? i + 1 : null;
}

export function proximaEtapa(etapa: ComercialEtapa): ComercialEtapaAtiva | null {
  const i = (COMERCIAL_ETAPAS as readonly string[]).indexOf(etapa);
  return i >= 0 && i < COMERCIAL_ETAPAS.length - 1 ? COMERCIAL_ETAPAS[i + 1] : null;
}

// ---------------------------------------------------------------------------
// Mover o cartão pela tela (rodada do painel P5, 18/10/2026; sem limitação desde a
// rodada da interface U4, 20/10/2026)
// ---------------------------------------------------------------------------

/**
 * As etapas que, no caminho dos FATOS, nascem de efeito de sistema. Uma pessoa
 * pode levar o cartão até elas à mão (decisão do dono do produto, 20/10/2026),
 * e o texto diz o que o mover à mão NÃO faz: nenhuma escrita automática do
 * contrato ou do fechamento nasce da etapa.
 *   · E8 nasce do aceite do cliente na sala (`proposta.aceita`), que traz
 *     valor, parcelas e forma;
 *   · E9 nasce do fechamento (`cliente.ativo`), com a 1ª parcela paga, o
 *     contrato assinado pelos dois e a assinatura da titular em /atendimento.
 */
export const COMERCIAL_ETAPAS_DE_SISTEMA: Readonly<Partial<Record<ComercialEtapa, string>>> = {
  contrato: 'só a etapa muda: o contrato e a cobrança nascem do aceite do cliente na sala',
  fechado: 'só a etapa muda: cobrança, contrato, cliente e card da implantação nascem do fechamento de verdade (o aceite ou "Registrar cliente já fechado")',
};

/** O que uma PESSOA pode fazer ao soltar o cartão em `para`. `caminho: 'saida'` leva junto o motivo da saída. */
export interface ComercialDestinoDoMover {
  para: ComercialEtapa;
  permitido: boolean;
  caminho: 'mover' | 'saida' | null;
  /** Por que não pode (permitido = falso). Nulo quando pode. */
  motivo: string | null;
  /** O que fica pendente nas etapas que ficam para trás (quem chama passa a lista dos portões). Vazio = nada. */
  pendencias: string[];
  /** Uma linha de apoio para o menu: o que o mover à mão não faz, ou a etapa de onde o lead saiu. Nulo = nada a dizer. */
  dica: string | null;
}

/**
 * Para onde uma PESSOA pode mover o cartão: para qualquer etapa, menos a etapa
 * em que o lead já está (decisão do dono do produto, 20/10/2026). Puro: a API
 * decide com esta mesma conta, e a tela a usa para desenhar o menu.
 *
 * Saída leva o motivo no mesmo gesto (`caminho: 'saida'`). As pendências vêm de
 * quem chama (os portões moram na API): a função só as devolve no destino.
 *
 * ISTO VALE SÓ PARA GENTE. O agente, as reações e o relógio não passam por
 * aqui: seguem em `mudarEtapa` sem `pessoa`, pelos portões (`avancar`,
 * `avancarDepoisDaSessao`, `podeSair`), que recusam como sempre.
 */
export function destinoDoMover(
  de: ComercialEtapa,
  para: ComercialEtapa,
  voltaPara?: ComercialEtapaAtiva | null,
  pendencias: readonly string[] = [],
): ComercialDestinoDoMover {
  if (de === para) return { para, permitido: false, caminho: null, motivo: 'o lead já está nesta etapa', pendencias: [], dica: null };
  const saida = ehSaida(para);
  const dica =
    COMERCIAL_ETAPAS_DE_SISTEMA[para] ??
    (de === 'geladeira' && voltaPara === para ? 'a etapa em que o lead estava antes da geladeira' : null);
  return { para, permitido: true, caminho: saida ? 'saida' : 'mover', motivo: null, pendencias: saida ? [] : [...pendencias], dica };
}

/** O pedido de mudança da rodada do painel (P5). APOSENTADO em 20/10/2026: o mover grava direto. Fica o tipo para leitura do que já existe. */
export interface ComercialPedidoDeMover {
  approvalId: string;
  token: string;
  expiraEm: string;
  de: ComercialEtapa;
  para: ComercialEtapaAtiva;
  pendencias: string[];
  resumo: string;
}

/** O balão do cartão movido com pendência: some quando a lista zera. */
export interface ComercialBalaoDoMover {
  pendencias: string[];
  movidoPor: string | null;
  em: string;
}

/** O aviso do cartão movido à mão para onde o mover não faz tudo (E8 e E9 à mão, saída sem motivo). Some quando o fato de verdade chega. */
export interface ComercialAvisoDoMover {
  texto: string;
  por: string | null;
  em: string;
}

export interface ComercialResultadoDoMover {
  ok: boolean;
  mudou: boolean;
  de: ComercialEtapa;
  para: ComercialEtapa;
  balao: ComercialBalaoDoMover | null;
  /** O que a etapa de origem (e as atravessadas) deixou pendente. Vazio = nada. */
  pendencias: string[];
  /** As etapas cujas conclusões ficaram para trás. */
  semConclusoesDe: ComercialEtapa[];
  /** A frase da tela: "Movido para <etapa>." ou "Movido para <etapa> sem as conclusões de <etapa>: <lista>." */
  mensagem: string;
  /** O aviso que o cartão passa a mostrar (E8 e E9 à mão, saída sem motivo). Nulo = nenhum. */
  aviso: string | null;
}

/** "E3" de "E3 · Reunião agendada"; "Saída · Perdido" fica inteiro. */
function rotuloDaMensagem(e: ComercialEtapa): string {
  return COMERCIAL_ROTULO_DA_ETAPA[e];
}

/** As etapas citadas como "A", "A e B" ou "A, B e C". */
function listaDeEtapas(etapas: readonly ComercialEtapa[]): string {
  const r = etapas.map(rotuloDaMensagem);
  return r.length <= 1 ? (r[0] ?? '') : `${r.slice(0, -1).join(', ')} e ${r[r.length - 1]}`;
}

/**
 * A MENSAGEM do mover à mão, a única coisa que a tela diz (decisão de 20/10/2026):
 *   · sem pendência: "Movido para E3 · Reunião agendada.";
 *   · com pendência: "Movido para E3 · Reunião agendada sem as conclusões de E1 · Novo lead e E2 · Qualificação: canal de entrada (E1); …".
 */
export function mensagemDoMover(para: ComercialEtapa, semConclusoesDe: readonly ComercialEtapa[], pendencias: readonly string[]): string {
  const base = `Movido para ${rotuloDaMensagem(para)}`;
  if (!pendencias.length || !semConclusoesDe.length) return `${base}.`;
  return `${base} sem as conclusões de ${listaDeEtapas(semConclusoesDe)}: ${pendencias.join('; ')}.`;
}

/** O texto que fica quando a saída vai sem motivo escrito. */
export const COMERCIAL_SEM_MOTIVO_INFORMADO = 'sem motivo informado';

/**
 * O aviso do cartão movido à mão para onde o mover não faz tudo. Nulo quando
 * não há o que avisar. O aviso de E8 some quando o aceite chega; o de E9,
 * quando o fechamento de verdade conclui (`cliente.ativo`); quem decide isso é
 * a projeção do funil.
 */
export function avisoDoMoverAMao(para: ComercialEtapa, semMotivo: boolean): string | null {
  if (para === 'fechado') return 'Negócio fechado à mão: só a etapa mudou. Cobrança, contrato, cliente e card da implantação nascem do aceite ou de "Registrar cliente já fechado".';
  if (para === 'contrato') return 'Contrato à mão: só a etapa mudou. O contrato e a cobrança nascem do aceite do cliente na sala.';
  if (ehSaida(para) && semMotivo) return `Saída ${COMERCIAL_SEM_MOTIVO_INFORMADO}.`;
  return null;
}

// ---------------------------------------------------------------------------
// Campos do lead (C07)
// ---------------------------------------------------------------------------

export const COMERCIAL_PERFIS = ['P1', 'P2', 'P3'] as const;
export type ComercialPerfil = (typeof COMERCIAL_PERFIS)[number];
export const ComercialPerfilSchema = z.enum(COMERCIAL_PERFIS);

/** Os seis canais de entrada (C07: o "Como conheceu?" de lá tinha 16; aqui começa com 6). */
export const COMERCIAL_CANAIS_DE_ENTRADA = ['conteudo', 'erp_parceiro', 'indicacao', 'evento', 'comunidade', 'site'] as const;
export type ComercialCanalDeEntrada = (typeof COMERCIAL_CANAIS_DE_ENTRADA)[number];
export const ComercialCanalDeEntradaSchema = z.enum(COMERCIAL_CANAIS_DE_ENTRADA);

/** O catálogo de 4 produtos (C07). Cresce só por decisão de mesa. */
export const COMERCIAL_PRODUTOS = ['imersao', 'operacao', 'kit', 'turma'] as const;
export type ComercialProduto = (typeof COMERCIAL_PRODUTOS)[number];
export const ComercialProdutoSchema = z.enum(COMERCIAL_PRODUTOS);

export const COMERCIAL_FORMAS_DE_PAGAMENTO = ['pix', 'boleto', 'cartao'] as const;
export type ComercialFormaDePagamento = (typeof COMERCIAL_FORMAS_DE_PAGAMENTO)[number];
export const ComercialFormaDePagamentoSchema = z.enum(COMERCIAL_FORMAS_DE_PAGAMENTO);

/** Motivos de perda — catálogo curto, [a decidir] pela mesa. Estes são os da tela 13 do mapa (dados de exemplo). */
export const COMERCIAL_MOTIVOS_DE_SAIDA = ['sem_base', 'preco', 'sumiu', 'momento', 'nao_e_cliente_root', 'outro'] as const;
export type ComercialMotivoDeSaida = (typeof COMERCIAL_MOTIVOS_DE_SAIDA)[number];
export const ComercialMotivoDeSaidaSchema = z.enum(COMERCIAL_MOTIVOS_DE_SAIDA);

/**
 * A TABELA DE PREÇO DE 04/10/2026 — um preço por produto.
 *
 * Valores em centavos, para a conta de parcelas fechar sem ponto flutuante.
 * `kit` e `turma` não têm preço decidido: ficam `null`, e proposta com eles
 * cai na fila de decisões como "fora da tabela".
 */
export interface LinhaDaTabelaDePreco {
  produto: ComercialProduto;
  rotulo: string;
  valorCentavos: number;
  parcelas: number;
  parcelaCentavos: number;
  formas: readonly ComercialFormaDePagamento[];
  descricao: string;
}

export const TABELA_DE_PRECO_DATA = '2026-10-04';

export const TABELA_DE_PRECO: Readonly<Record<ComercialProduto, LinhaDaTabelaDePreco | null>> = {
  imersao: {
    produto: 'imersao',
    rotulo: 'Imersão',
    valorCentavos: 297_000,
    parcelas: 10,
    parcelaCentavos: 29_700,
    formas: ['cartao'],
    descricao: 'Diagnóstico aprofundado e primeiro fluxo rodando com a sua equipe.',
  },
  operacao: {
    produto: 'operacao',
    rotulo: 'Operação ROOT',
    valorCentavos: 1_199_700,
    parcelas: 3,
    parcelaCentavos: 399_900,
    formas: ['pix', 'boleto', 'cartao'],
    descricao: 'Fechamento automático do mês, conciliação com o banco, painel do dono no dia 1.',
  },
  kit: null,
  turma: null,
};

/** As parcelas fecham o total? A regra que o revisor de proposta confere. */
export function parcelasFecham(valorCentavos: number, parcelas: number, parcelaCentavos: number): boolean {
  return parcelas > 0 && parcelas * parcelaCentavos === valorCentavos;
}

/** O preço está na tabela? Fora dela, a proposta espera decisão humana. */
export function precoNaTabela(produto: ComercialProduto, valorCentavos: number): boolean {
  const linha = TABELA_DE_PRECO[produto];
  return linha !== null && linha.valorCentavos === valorCentavos;
}

export function formatarReais(centavos: number): string {
  const inteiro = Math.trunc(Math.abs(centavos) / 100);
  const resto = Math.abs(centavos) % 100;
  const milhar = inteiro.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${centavos < 0 ? '-' : ''}R$ ${milhar},${resto.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// O catálogo de eventos (K02) — o fio do lead
// ---------------------------------------------------------------------------

export const COMERCIAL_EVENTOS = [
  // entrada e qualificação
  'lead.chegou',
  'cnpj.enriquecido',
  'lead.pontuado',
  'dono.atribuido',
  'whats.recebida',
  'whats.enviada',
  'form.respondido',
  'agenda.escolhida',
  'agenda.confirmada',
  'reuniao.noshow',
  // a sala
  'sala.aberta',
  'sala.visitada',
  // Rodada da implantação I3 (18/10): uma versão da sala foi publicada (liberada por outra pessoa).
  'sala.publicada',
  'arquivo.enviado',
  // sessão, diagnóstico e proposta
  'ata.chegou',
  'diagnostico.pronto',
  'proposta.publicada',
  'proposta.lida',
  'proposta.duvida',
  'proposta.ajuste_pedido',
  'proposta.aceita',
  // Rodada da implantação I4 (18/10): a página da proposta colhe reação por seção.
  // `faz sentido` vira `proposta.reagida`; a ideia, `proposta.ideia`; a dúvida segue `proposta.duvida`.
  'proposta.reagida',
  'proposta.ideia',
  'followup.enviado',
  // aceite, dinheiro e contrato
  'aceite.dados',
  'cobranca.criada',
  'pix.pago',
  'boleto.pago',
  'cartao.pago',
  'contrato.gerado',
  'contrato.assinado_cliente',
  'contrato.assinado_root',
  // Rodada do trabalho T1b (19/10): cliente que fechou FORA do sistema. O aceite que uma pessoa
  // declarou (nunca como aceite na sala) e o contrato já assinado, anexado em PDF.
  'aceite.declarado',
  'contrato.anexado',
  // fechamento e contrato vivo
  'fechamento.escrita',
  'cliente.ativo',
  // Rodada da implantação I1 (18/10): a sexta escrita do fechamento abriu o card na lista "Onboarding de cliente".
  'implantacao.card_criado',
  // Ajustes da versão final A2 (19/10): uma pessoa iniciou o onboarding com o lead ainda no funil
  // (o card nasce antes do fechamento), e o fechamento depois reaproveitou esse mesmo card.
  'implantacao.iniciada_antes_do_fechamento',
  'implantacao.fechamento_registrado',
  // Revisão adversarial A2: o cliente ligado ao lead antes do fechamento não confere com o CNPJ do
  // aceite; o fechamento seguiu pela regra do CNPJ e deixou o aviso para uma pessoa conciliar.
  'cliente.a_conciliar',
  // Rodada de produção 1 (21/10/2026): o CRM antigo (listas `cadastro` do Trabalho) importado para o
  // Comercial por uma pessoa, pelo script `importar-crm`. Fato passado registrado, não ato comercial novo:
  // nenhum dos dois roda reação (nada sai para fora).
  'lead.importado',
  'contrato.importado',
  // Rodada de produção 2 (22/10/2026, M2): no contrato importado, as parcelas lançadas à mão pela mesa
  // (cada lançamento uma versão) e a régua de cobrança ligada por uma pessoa. Fato passado: sem reação.
  'contrato.parcelas_lancadas',
  'contrato.regua_ligada',
  'kickoff.marcado',
  'parcela.vence',
  'parcela.paga',
  'parcela.atrasada',
  'parcela.estornada',
  'marco.contrato',
  // Rodada do trabalho T8 (19/10): alguém da casa encerrou o contrato à mão, com motivo.
  'contrato.concluido',
  'contrato.desativado',
  // decisões, etapa e saídas
  'decisao.aberta',
  'decisao.tomada',
  'decisao.expirada',
  'veto.registrado',
  'etapa.mudou',
  // Rodada do painel P5 (18/10): uma PESSOA moveu o cartão com portão em aberto; a lista exata vai no fato.
  'etapa.movida_com_pendencia',
  // Rodada da interface U4 (20/10): uma PESSOA moveu o cartão à mão, para qualquer etapa (quem, de, para, pendências).
  'etapa.movida_a_mao',
  'saida.registrada',
  'vigia.premissa',
  // Rodada dos agentes (21/10/2026, lane A2):
  // CO-08: os dois assinaram (o documento inteiro), e a cópia do PDF assinado (ou da minuta, CO-13) na pasta do cliente;
  'contrato.assinado',
  'documento.na_pasta',
  // CO-10: a pasta do cliente pedida por uma porta do card fora do fechamento (o fechamento grava `fechamento.escrita`);
  'pasta.do_cliente',
  // CO-13 e CO-14: a minuta do contrato da Root e o laudo dela;
  'minuta.gerada',
  'minuta.revisada',
  // CO-15: um envio do formulário do site (cada envio, idempotente pela chave da requisição);
  'site.formulario',
  // CO-16: a classe que a triagem do WhatsApp deu a uma mensagem (e para onde ela foi).
  // Layout 26/10: uma pessoa corrigiu o nome do contato e/ou a empresa do lead (sem reação: não move etapa nem dispara automação).
  'identidade.editada',
  // Layout 26/10: uma pessoa definiu o tipo do negócio (pagante, parceria, permuta, repasse), sem reação.
  'negocio.tipo_definido',
  // Layout 26/10: uma pessoa ajustou valor negociado, vendedor ou canal de aquisição, sem reação.
  'negocio.ajustado',
  'whats.triada',
  // Leva 5 (L4, 27/10/2026): nota escrita por uma pessoa no fio ("marcar como feito" na aba Pendências), sem reação.
  'nota.manual',
] as const;
export type ComercialEvento = (typeof COMERCIAL_EVENTOS)[number];
export const ComercialEventoSchema = z.enum(COMERCIAL_EVENTOS);

export function ehEventoComercial(type: string): type is ComercialEvento {
  return (COMERCIAL_EVENTOS as readonly string[]).includes(type);
}

/**
 * D-10 (revisão): o fato da 1ª parcela paga tem o nome da forma. `pix.pago`
 * só para Pix; boleto e cartão têm o seu. Quem pergunta "a 1ª parcela foi
 * paga?" lê os três por esta lista, nunca só `pix.pago`.
 */
export const COMERCIAL_FATOS_DA_PRIMEIRA_PAGA = ['pix.pago', 'boleto.pago', 'cartao.pago'] as const;
export type ComercialFatoDaPrimeiraPaga = (typeof COMERCIAL_FATOS_DA_PRIMEIRA_PAGA)[number];

/** O nome do fato da 1ª parcela paga pela forma da cobrança (a mesma leitura de `billingTypeDoAsaas`: o que não é Pix nem boleto é cartão). */
export function fatoDaPrimeiraPaga(forma: string | null | undefined): ComercialFatoDaPrimeiraPaga {
  if (forma === 'pix') return 'pix.pago';
  if (forma === 'boleto') return 'boleto.pago';
  return 'cartao.pago';
}

/** De onde veio o fato — a fonte marcada em cada linha do fio (tela 05). */
export const COMERCIAL_FONTES = ['whats', 'form', 'sala', 'agenda', 'ata', 'agente', 'asaas', 'zapsign', 'relogio', 'decisao', 'sistema', 'pessoa'] as const;
export type ComercialFonte = (typeof COMERCIAL_FONTES)[number];

// ---------------------------------------------------------------------------
// Decisões (K01: a fila de decisões; tela 03 e 09)
// ---------------------------------------------------------------------------

export const COMERCIAL_TIPOS_DE_DECISAO = [
  'proposta_fora_da_tabela',
  'ponto_zero',
  'lead_parado',
  'pedido_de_ajuste',
  'veto_de_fechamento',
  'excecao_do_vigia',
  'aprovacao_de_envio',
] as const;
export type ComercialTipoDeDecisao = (typeof COMERCIAL_TIPOS_DE_DECISAO)[number];
export const ComercialTipoDeDecisaoSchema = z.enum(COMERCIAL_TIPOS_DE_DECISAO);

/** Por onde a decisão chegou e foi respondida. */
export const COMERCIAL_CANAIS_DE_DECISAO = ['tela', 'simulado', 'evolution', 'meta', 'relogio'] as const;
export type ComercialCanalDeDecisao = (typeof COMERCIAL_CANAIS_DE_DECISAO)[number];

export const COMERCIAL_ESTADOS_DE_DECISAO = ['aberta', 'tomada', 'expirada'] as const;
export type ComercialEstadoDeDecisao = (typeof COMERCIAL_ESTADOS_DE_DECISAO)[number];

export interface OpcaoDeDecisao {
  chave: string;
  rotulo: string;
  /** O que acontece se esta for a escolhida — para a pessoa saber antes de tocar. */
  efeito?: string;
}

// ---------------------------------------------------------------------------
// WhatsApp (C08): os oito textos e o canal por porta
// ---------------------------------------------------------------------------

export const COMERCIAL_TEMPLATES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'] as const;
export type ComercialTemplate = (typeof COMERCIAL_TEMPLATES)[number];

export const COMERCIAL_PROVEDORES_DE_WHATSAPP = ['simulado', 'evolution', 'meta'] as const;
export type ComercialProvedorDeWhatsapp = (typeof COMERCIAL_PROVEDORES_DE_WHATSAPP)[number];

export const COMERCIAL_ESTADOS_DE_MENSAGEM = ['rascunho', 'na_fila', 'em_veto', 'enviando', 'enviada', 'vetada', 'recebida', 'falhou'] as const;
export type ComercialEstadoDeMensagem = (typeof COMERCIAL_ESTADOS_DE_MENSAGEM)[number];

// ---------------------------------------------------------------------------
// A sala do cliente (K01, telas 02/07/08)
// ---------------------------------------------------------------------------

export const SALA_ESTAGIOS = ['conversa', 'diagnostico', 'proposta', 'contrato', 'comeco'] as const;
export type SalaEstagio = (typeof SALA_ESTAGIOS)[number];

export const SALA_TOKEN_RE = /^[A-Za-z0-9_-]{40,48}$/;
export const SALA_VALIDADE_DIAS = 90;

const texto = (max: number) => z.string().trim().min(1).max(max);

/** O formulário de qualificação (tela 01): quatro perguntas, dentro da conversa. */
export const SalaFormSchema = z
  .object({
    sistema: texto(120),
    baseOrganizada: z.boolean(),
    maiorDor: texto(400),
    equipeFinanceiro: z.number().int().min(0).max(10_000),
    nome: texto(120).optional(),
    empresa: texto(160).optional(),
    cnpj: z.string().trim().regex(/^\d{14}$/, 'CNPJ com 14 dígitos').optional(),
  })
  .strict();
export type SalaFormInput = z.infer<typeof SalaFormSchema>;

/** Escolha de horário entre os oferecidos. ISO 8601 com fuso. */
export const SalaAgendaSchema = z.object({ horario: z.string().datetime({ offset: true }) }).strict();
export type SalaAgendaInput = z.infer<typeof SalaAgendaSchema>;

export const SALA_BLOCOS_DA_PROPOSTA = ['ouvimos', 'recomendada', 'alternativa', 'custos', 'validade'] as const;
export type SalaBlocoDaProposta = (typeof SALA_BLOCOS_DA_PROPOSTA)[number];
export const SalaPropostaLidaSchema = z.object({ bloco: z.enum(SALA_BLOCOS_DA_PROPOSTA), versao: z.number().int().min(1) }).strict();
export type SalaPropostaLidaInput = z.infer<typeof SalaPropostaLidaSchema>;

export const SalaDuvidaSchema = z.object({ pergunta: texto(600) }).strict();
export type SalaDuvidaInput = z.infer<typeof SalaDuvidaSchema>;

export const SalaAjusteSchema = z
  .object({
    pedido: texto(600),
    /** Quando o pedido é desconto, o percentual pedido (0 a 100). */
    descontoPct: z.number().min(0).max(100).optional(),
  })
  .strict();
export type SalaAjusteInput = z.infer<typeof SalaAjusteSchema>;

export const SalaAceiteDadosSchema = z
  .object({
    cnpj: z.string().trim().regex(/^\d{11}$|^\d{14}$/, 'CPF (11) ou CNPJ (14) só dígitos'),
    razaoSocial: texto(200),
    endereco: texto(400),
    quemAssina: texto(120),
    email: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();
export type SalaAceiteDadosInput = z.infer<typeof SalaAceiteDadosSchema>;

export const SalaAceitePagamentoSchema = z
  .object({
    produto: ComercialProdutoSchema,
    forma: ComercialFormaDePagamentoSchema,
    /** A versão da proposta que o cliente está aceitando: o hash congela as condições. */
    versao: z.number().int().min(1),
  })
  .strict();
export type SalaAceitePagamentoInput = z.infer<typeof SalaAceitePagamentoSchema>;

export const SalaKickoffSchema = z.object({ horario: z.string().datetime({ offset: true }) }).strict();
export type SalaKickoffInput = z.infer<typeof SalaKickoffSchema>;

// ---------------------------------------------------------------------------
// A página da proposta (rodada da implantação I4, prancheta 4)
// ---------------------------------------------------------------------------

/**
 * As três seções da página `/s/<token>/proposta`. Cada uma cobre blocos do
 * termômetro de antes (`SALA_BLOCOS_DA_PROPOSTA`): ver a seção grava também o
 * `proposta.lida` desses blocos, pelo mesmo caminho da sala, e o follow-up e a
 * ficha (`blocosLidos`, primeira leitura) seguem valendo sem mudar nada.
 *
 * "O que vamos montar" mostra o que ouvimos e a oferta recomendada; "como
 * funciona" mostra parcelas, formas, validade e a outra opção; "investimento"
 * mostra o preço e o quadro de custos de terceiros.
 */
export const PROPOSTA_SECOES = ['montar', 'funciona', 'investimento'] as const;
export type PropostaSecao = (typeof PROPOSTA_SECOES)[number];

export const PROPOSTA_BLOCOS_DA_SECAO: Record<PropostaSecao, readonly SalaBlocoDaProposta[]> = {
  montar: ['ouvimos', 'recomendada'],
  funciona: ['alternativa', 'validade'],
  investimento: ['custos'],
};

export const PROPOSTA_ROTULO_DA_SECAO: Record<PropostaSecao, string> = {
  montar: 'O QUE VAMOS MONTAR',
  funciona: 'COMO FUNCIONA',
  investimento: 'INVESTIMENTO',
};

/** O que o cliente pode deixar numa seção. A leitura (`leitura`) é tipo do banco, nunca do corpo. */
export const PROPOSTA_TIPOS_DE_REACAO = ['faz_sentido', 'duvida', 'ideia'] as const;
export type PropostaTipoDeReacao = (typeof PROPOSTA_TIPOS_DE_REACAO)[number];

/** O teto da anotação do cliente (regra dura da rodada). */
export const PROPOSTA_TEXTO_MAX = 1000;
/** Uma batida de leitura carrega de 1 a 60 segundos visíveis. */
export const PROPOSTA_SEGUNDOS_POR_BATIDA_MAX = 60;

/**
 * A reação do cliente numa seção. O texto é DADO NÃO CONFIÁVEL: limitado,
 * aparado, varrido de segredo antes de gravar, e nunca vira instrução.
 * "faz sentido" não leva texto; dúvida e ideia não aceitam texto vazio.
 */
export const SalaPropostaReacaoSchema = z
  .object({
    secao: z.enum(PROPOSTA_SECOES),
    tipo: z.enum(PROPOSTA_TIPOS_DE_REACAO),
    texto: z.string().trim().max(PROPOSTA_TEXTO_MAX).optional(),
    versao: z.number().int().min(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.tipo === 'faz_sentido' && v.texto) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['texto'], message: '"faz sentido" não leva texto' });
    if (v.tipo !== 'faz_sentido' && !v.texto) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['texto'], message: 'escreva a sua anotação antes de enviar' });
  });
export type SalaPropostaReacaoInput = z.infer<typeof SalaPropostaReacaoSchema>;

/** Uma batida de leitura: a seção, quantos segundos ela ficou visível desde a última, a versão lida. */
export const SalaPropostaLeituraSchema = z
  .object({
    secao: z.enum(PROPOSTA_SECOES),
    segundos: z.number().int().min(1).max(PROPOSTA_SEGUNDOS_POR_BATIDA_MAX),
    versao: z.number().int().min(1),
  })
  .strict();
export type SalaPropostaLeituraInput = z.infer<typeof SalaPropostaLeituraSchema>;

/** Uma anotação do cliente como a página dele a mostra (o texto já mascarado). */
export interface AnotacaoNaProposta {
  id: string;
  secao: PropostaSecao;
  tipo: 'duvida' | 'ideia';
  texto: string;
  em: string;
}

/** O que a página da proposta mostra das reações do próprio cliente, na versão vigente. */
export interface ReacoesNaPaginaDaProposta {
  versao: number;
  /** O número da visita de agora (`SalaDoCliente.acessos`). */
  acesso: number;
  /** As seções em que o cliente marcou "faz sentido" nesta visita. */
  fazSentido: PropostaSecao[];
  anotacoes: AnotacaoNaProposta[];
  contagem: { anotacoes: number; duvidas: number };
}

/** A leitura de uma seção, agregada: quantas visitas a viram e o tempo somado. */
export interface LeituraDaSecao {
  versao: number;
  secao: PropostaSecao;
  acessos: number;
  segundos: number;
  ultimaEm: string;
}

/** Ideia ou dúvida deixada na proposta, como a bancada lê (a lane I5 reaproveita). */
export interface AnotacaoDoLead extends AnotacaoNaProposta {
  versao: number;
  acesso: number;
  respondidaEm: string | null;
  tarefaId: string | null;
}

/** `GET /comercial/lead/:id/reacoes`: a leitura e as reações da proposta do lead. */
export interface ReacoesDaPropostaDoLead {
  leadId: string;
  /** A versão vigente (a última publicada), ou `null` sem proposta. */
  versaoVigente: number | null;
  acessosDaSala: number;
  ultimoAcessoEm: string | null;
  leitura: LeituraDaSecao[];
  fazSentido: { versao: number; secao: PropostaSecao; acesso: number; em: string }[];
  anotacoes: AnotacaoDoLead[];
}

// ---------------------------------------------------------------------------
// Rotas internas
// ---------------------------------------------------------------------------

/** Lead que chega pelo WhatsApp (simulador ou provedor): a primeira mensagem. */
export const ComercialEntradaWhatsSchema = z
  .object({
    telefone: z.string().trim().regex(/^\+?\d{10,15}$/, 'telefone só dígitos, com DDI opcional'),
    texto: texto(2000),
    nome: texto(120).optional(),
    canal: ComercialCanalDeEntradaSchema.optional(),
    /** A palavra-chave do Instagram ou a origem do link, quando houver. */
    palavraChave: texto(60).optional(),
    /** Id da mensagem no provedor, para a deduplicação. Sem ele, o hash do texto+telefone+minuto. */
    mensagemId: texto(120).optional(),
  })
  .strict();
export type ComercialEntradaWhatsInput = z.infer<typeof ComercialEntradaWhatsSchema>;

export const ComercialDecisaoRespostaSchema = z
  .object({
    escolha: texto(80),
    motivo: z.string().trim().max(400).optional(),
  })
  .strict();
export type ComercialDecisaoRespostaInput = z.infer<typeof ComercialDecisaoRespostaSchema>;

export const ComercialAtaSchema = z
  .object({
    texto: z.string().min(200).max(400_000),
    fonte: z.enum(['granola', 'texto', 'arquivo']).default('texto'),
    referencia: texto(200).optional(),
  })
  .strict();
export type ComercialAtaInput = z.infer<typeof ComercialAtaSchema>;

export const ComercialSaidaSchema = z
  .object({
    saida: z.enum(COMERCIAL_SAIDAS),
    motivo: ComercialMotivoDeSaidaSchema,
    detalhe: z.string().trim().max(400).optional(),
    /** Só geladeira: quando o lead volta. */
    voltaEm: z.string().datetime({ offset: true }).optional(),
    /** Só parceiro: para quem foi. */
    parceiro: texto(120).optional(),
  })
  .strict();
export type ComercialSaidaInput = z.infer<typeof ComercialSaidaSchema>;

/**
 * O corpo de `POST /comercial/lead/:id/mover` (rodada da interface U4, 20/10/2026):
 * qualquer etapa, ativa ou saída. Na saída, o motivo vai no mesmo gesto, em
 * texto livre e sem trava: sem ele, vale "sem motivo informado". O tipo do
 * motivo (para o relatório de perdas) é opcional; sem ele, "outro". A data de
 * volta da geladeira e o parceiro também são opcionais. Para etapa ativa, os
 * campos da saída são ignorados.
 */
export const ComercialMoverSchema = z
  .object({
    para: z.enum(COMERCIAL_ESTAGIOS),
    motivo: z.string().trim().max(400).optional(),
    tipoDeMotivo: ComercialMotivoDeSaidaSchema.optional(),
    voltaEm: z.string().datetime({ offset: true }).optional(),
    parceiro: z.string().trim().max(120).optional(),
  })
  .strict();
export type ComercialMoverInput = z.infer<typeof ComercialMoverSchema>;

/** Os níveis de autonomia por automação (tela 12). A0 não roda; A3 roda e só avisa quebra. */
export const COMERCIAL_AUTONOMIAS = ['A0', 'A1', 'A2', 'A3'] as const;
export type ComercialAutonomia = (typeof COMERCIAL_AUTONOMIAS)[number];

/** As automações da torre (tela 12), na ordem da tela. */
export const COMERCIAL_AUTOMACOES = [
  'qualificador',
  'agendador',
  'leitor_de_ata',
  'construtor_de_proposta',
  'revisor_de_proposta',
  /** Revisão E-15: o assistente da dúvida na sala, a única automação que escreve ao cliente. Em A0 a dúvida vai a uma pessoa. */
  'assistente_da_proposta',
  'fupeiro',
  'assinador',
  'cobrador',
  'fechador',
  'relator',
  'vigia',
] as const;
export type ComercialAutomacao = (typeof COMERCIAL_AUTOMACOES)[number];

/**
 * A configuração por empresa. Os números da régua nascem `null` = [a decidir]
 * = desligado; a homologação os preenche no seed e marca `valoresDeHomologacao`.
 * Os três interruptores nascem com o PADRÃO DA REGRA VIGENTE (K08): tudo falso.
 */
export const ComercialConfigSchema = z
  .object({
    /** K08-1: envio automático dos oito textos aprovados, com janela de veto. Padrão: regra R3 vigente (pessoa envia). */
    envioAutomatico: z.boolean().optional(),
    /** K08-2: fechamento roda sozinho no horário avisado, salvo VETO. Padrão: humano fecha. */
    fechamentoAutomatico: z.boolean().optional(),
    /** K08-3: proposta dentro da tabela com laudo limpo sai no horário. Padrão: espera liberação. */
    silencioAprova: z.boolean().optional(),
    janelaDeVetoMinutos: z.number().int().min(1).max(24 * 60).nullable().optional(),
    fupLeuDias: z.number().int().min(1).max(60).nullable().optional(),
    fupSilencioDias: z.number().int().min(1).max(90).nullable().optional(),
    prazoDiagnosticoDiasUteis: z.number().int().min(1).max(30).nullable().optional(),
    validadePropostaDias: z.number().int().min(1).max(90).nullable().optional(),
    leadParadoDias: z.number().int().min(1).max(90).nullable().optional(),
    decisaoExpiraHoras: z.number().int().min(1).max(24 * 7).nullable().optional(),
    /** Hora de São Paulo (0 a 23) em que a proposta dentro da tabela sai. */
    horaPublicacaoProposta: z.number().int().min(0).max(23).nullable().optional(),
    autonomia: z.record(z.enum(COMERCIAL_AUTOMACOES), z.enum(COMERCIAL_AUTONOMIAS)).optional(),
    /** Vigia (lane E, fase 2): parcela vencida há mais de N dias sem webhook do Asaas. Nulo = [a decidir] = premissa desligada. */
    cobrancaSemWebhookDias: z.number().int().min(1).max(60).nullable().optional(),
    /** Vigia: efeito do comercial retido na porta há mais de N horas. Nulo = [a decidir] = premissa desligada. */
    efeitoRetidoHoras: z.number().int().min(1).max(24 * 30).nullable().optional(),
    /** A-4: a geladeira decidida pela fila volta em N dias. Nulo = [a decidir]: nasce sem data e a próxima ação pede a data a uma pessoa. */
    geladeiraVoltaDias: z.number().int().min(1).max(365).nullable().optional(),
    valoresDeHomologacao: z.boolean().optional(),
  })
  .strict();
export type ComercialConfigInput = z.infer<typeof ComercialConfigSchema>;

// ---------------------------------------------------------------------------
// Projeções (o que a tela lê)
// ---------------------------------------------------------------------------

export interface ComercialProximaAcao {
  tipo: string;
  quando: string | null;
  descricao: string;
}

export interface ComercialPortaoNaTela {
  chave: string;
  rotulo: string;
  cumprido: boolean;
}

/** A ficha do lead (tela 05): projeção dos eventos, com o portão da próxima etapa. */
export interface FichaDoLead {
  leadId: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  empresa: string | null;
  /** Layout 26/10: pagante (padrão), parceria, permuta ou repasse. O mesmo tipo dos acordos da Análise. */
  tipoNegocio?: ComercialTipoDeNegocio;
  cnpj: string | null;
  canal: ComercialCanalDeEntrada | null;
  origemIndicacao: string | null;
  perfil: ComercialPerfil | null;
  pontuacao: number | null;
  sistemaErp: string | null;
  baseDados: boolean | null;
  dono: { id: string; nome: string } | null;
  /** Layout 26/10: quem VENDEU (diferente do dono, que cuida agora). */
  vendedor?: { id: string; nome: string } | null;
  /** Layout 26/10: o valor negociado, em centavos (pode diferir da proposta). */
  valorNegociadoCentavos?: number | null;
  /** E-24: `id` é o da pessoa que subiu a ata, conferido na empresa; nulo quando a ata não o trouxe (nunca o nome no lugar do id). */
  socioDaConta: { id: string | null; nome: string } | null;
  produto: ComercialProduto | null;
  valorCentavos: number | null;
  parcelas: number | null;
  forma: ComercialFormaDePagamento | null;
  validade: string | null;
  propostaVersao: number;
  etapa: ComercialEtapa;
  etapaDesde: string;
  motivoSaida: ComercialMotivoDeSaida | null;
  voltaEm: string | null;
  saude: number | null;
  proximaAcao: ComercialProximaAcao | null;
  proximasAcoesAutomaticas: string[];
  portao: { proxima: ComercialEtapaAtiva | null; faltando: string[]; itens: ComercialPortaoNaTela[] };
  ligadoA: {
    sala: string | null; ata: boolean; proposta: number | null; contrato: string | null; cobranca: string | null;
    /** I1 (rodada da implantação): o card que o fechamento abriu no Trabalho, e o trilho. Ausente em projeção antiga. */
    implantacao?: { cardId: string; listId: string; etapa: string; trilhoId: string | null } | null;
  };
  fio: LinhaDoFio[];
  /** P5: o balão de quem moveu o cartão com pendência (o mesmo do funil). */
  balao?: ComercialBalaoDoMover | null;
  /** Rodada dos agentes (CO-10): a pasta do cliente no Drive (o ponteiro do `Partner` da ficha). */
  pasta?: PastaDoClienteNaFicha | null;
}

export interface LinhaDoFio {
  eventoId: string;
  type: string;
  fonte: ComercialFonte;
  resumo: string;
  em: string;
  /** Dia relativo à entrada do lead (D1, D4...). */
  dia: number;
}

/** O estado da sala do cliente (telas 02, 07, 08). Tudo o que o LEAD vê. */
export interface EstadoDaSala {
  slug: string;
  empresa: string;
  contato: string | null;
  estagio: SalaEstagio;
  estagios: { chave: SalaEstagio; rotulo: string; estado: 'passou' | 'atual' | 'vem' }[];
  conversa: {
    horario: string | null;
    horariosOferecidos: string[];
    duracaoMin: number;
    oQueContou: string[];
  };
  planoDeAcao: { texto: string; feito: boolean }[];
  diagnostico: { dores: { n: number; texto: string; minuto: string | null }[]; objecoes: string[]; prontoEm: string | null } | null;
  proposta: PropostaNaSala | null;
  aceite: AceiteNaSala | null;
  comeco: { grupoCriado: boolean; kickoffEm: string | null; linkDoTrilho: string | null } | null;
  validoAte: string;
  /** I3 (rodada da implantação): a ÚLTIMA versão publicada da sala; nunca o rascunho. Nula = a sala de antes. */
  publicada?: SalaVersaoPublica | null;
}

export interface PropostaNaSala {
  versao: number;
  publicadaEm: string;
  validaAte: string | null;
  ouvimos: string[];
  recomendada: OfertaNaSala;
  alternativa: OfertaNaSala | null;
  /** `exemplo`: valores de exemplo da homologação; a sala mostra a marca (revisão E-3). */
  custosDeTerceiros: { mesNormalCentavos: number | null; piorMesCentavos: number | null; exemplo?: boolean } | null;
  blocosLidos: SalaBlocoDaProposta[];
  ajustePendente: boolean;
  /** As dúvidas que o lead mandou desta versão, com a resposta quando houver (Lane B; a resposta é da Lane E). */
  duvidas?: { pergunta: string; resposta: string | null; em: string }[];
}

export interface OfertaNaSala {
  produto: ComercialProduto;
  rotulo: string;
  valorCentavos: number;
  parcelas: number;
  parcelaCentavos: number;
  formas: ComercialFormaDePagamento[];
  descricao: string;
  descontoPct: number | null;
}

export interface AceiteNaSala {
  produto: ComercialProduto;
  valorCentavos: number;
  parcelas: number;
  forma: ComercialFormaDePagamento | null;
  dados: { cnpj: string; razaoSocial: string; endereco: string; quemAssina: string; email: string } | null;
  cobranca: { estado: string; linkPagamento: string | null; pixCopiaECola: string | null; primeiraParcelaCentavos: number } | null;
  contrato: { estado: string; linkAssinatura: string | null; assinadoClienteEm: string | null; assinadoRootEm: string | null } | null;
}

/** A fila de decisões (tela 03). */
export interface FilaDeDecisoes {
  resumo: { decisoes: number; acoesAutomaticasHoje: number; leadsVivos: number; automacoesComErro: number };
  decisoes: DecisaoNaFila[];
  rodouSozinhoHoje: { em: string; fonte: ComercialFonte; resumo: string; leadId: string }[];
}

export interface DecisaoNaFila {
  id: string;
  leadId: string;
  leadNome: string;
  tipo: ComercialTipoDeDecisao;
  titulo: string;
  contexto: string;
  opcoes: OpcaoDeDecisao[];
  padrao: string;
  expiraEm: string;
  criadaEm: string;
  estado: ComercialEstadoDeDecisao;
  escolha: string | null;
  decididoPor: string | null;
  canal: ComercialCanalDeDecisao | null;
  /** Id de quem propôs (quando há); essa pessoa não responde a decisão (C-12). */
  propostoPor?: string | null;
}

/** O funil vivo (tela 04). */
export interface FunilVivo {
  colunas: { etapa: ComercialEtapa | 'saidas'; rotulo: string; cartoes: CartaoDoFunil[] }[];
  /**
   * C-20: quantas fichas a empresa tem e a frase quando o funil não as mostra
   * todas (acima do teto, ficam de fora as que mudaram de etapa há mais tempo).
   * Sem corte, `aviso` é nulo.
   */
  total?: number;
  aviso?: string | null;
  /** P5: o filtro que a API aplicou, com a mesma explicação que a etiqueta mostra. */
  filtro?: ComercialFiltroDoFunil | null;
  /** U4: os filtros do painel que a API aplicou (o `?filtro=` antigo já traduzido). */
  filtros?: ComercialFiltrosDoFunil;
  /** U4: quem é dono de algum lead da empresa, para o filtro "Responsável". */
  donos?: { id: string; nome: string }[];
}

/**
 * Os filtros do painel do Funil vivo (rodada da interface U2/U4, 20/10/2026).
 * As chaves são as de `VistaFunilSchema.filtros` e as do endereço. Vazio = sem
 * filtro. `dono` aceita o id de uma pessoa, `eu` (quem pergunta) ou `sem`
 * (lead sem dono); `etapa` aceita uma etapa ou `saidas`; `parado` e `decisao`
 * valem com `1`; `q` busca na empresa e no contato.
 */
export interface ComercialFiltrosDoFunil {
  dono: string;
  produto: string;
  perfil: string;
  etapa: string;
  parado: string;
  decisao: string;
  q: string;
  /** Layout 26/10: pagante, parceria, permuta ou repasse (vazio = todos). */
  tipo: string;
}

export const COMERCIAL_CHAVES_DOS_FILTROS_DO_FUNIL = ['dono', 'produto', 'perfil', 'etapa', 'parado', 'decisao', 'q', 'tipo'] as const;

/** Layout 26/10: o tipo do negócio, o mesmo dos acordos da Análise. Sem tipo gravado = pagante. */
export const COMERCIAL_TIPOS_DE_NEGOCIO = ['pagante', 'parceria', 'permuta', 'repasse'] as const;
export type ComercialTipoDeNegocio = (typeof COMERCIAL_TIPOS_DE_NEGOCIO)[number];
export const ROTULO_DO_TIPO_DE_NEGOCIO: Record<ComercialTipoDeNegocio, string> = { pagante: 'Pagante', parceria: 'Parceria', permuta: 'Permuta', repasse: 'Repasse' };
export function tipoDeNegocio(v: string | null | undefined): ComercialTipoDeNegocio {
  return (COMERCIAL_TIPOS_DE_NEGOCIO as readonly string[]).includes(v ?? '') ? (v as ComercialTipoDeNegocio) : 'pagante';
}

export function filtrosDoFunilVazios(): ComercialFiltrosDoFunil {
  return { dono: '', produto: '', perfil: '', etapa: '', parado: '', decisao: '', q: '', tipo: '' };
}

/**
 * O link antigo `?filtro=` (as etiquetas da tela 04) traduzido para o painel:
 * `parados` → parado, `decisao` → decisão sua, `P1`..`P3` → perfil, produto →
 * produto. `todos` e o desconhecido não filtram nada.
 */
export function filtrosDoFiltroAntigo(filtro: string | null | undefined): Partial<ComercialFiltrosDoFunil> {
  const f = (filtro ?? '').trim();
  if (f === 'parados') return { parado: '1' };
  if (f === 'decisao') return { decisao: '1' };
  if (/^P[123]$/.test(f)) return { perfil: f };
  if ((COMERCIAL_PRODUTOS as readonly string[]).includes(f)) return { produto: f };
  return {};
}

/**
 * As etiquetas de filtro do funil (tela 04), com o que cada uma CALCULA. O
 * texto descreve a conta de `FichaService.funil` (`passa` e `parado`), não uma
 * intenção: mudou a conta, muda aqui. A tela mostra a explicação ao parar o
 * mouse e no foco; a API devolve a do filtro aplicado.
 */
export interface ComercialFiltroDoFunil {
  chave: string;
  rotulo: string;
  explicacao: string;
}

export const COMERCIAL_FILTROS_DO_FUNIL: readonly ComercialFiltroDoFunil[] = [
  { chave: 'todos', rotulo: 'todos', explicacao: 'Todos os leads da empresa, nas etapas e nas saídas.' },
  {
    chave: 'parados',
    rotulo: 'parados',
    explicacao: 'Leads há mais dias na mesma etapa do que o limite de "lead parado" da configuração do comercial. Sem limite configurado, ninguém aparece. Saídas e negócio fechado não contam.',
  },
  { chave: 'decisao', rotulo: 'decisão sua', explicacao: 'Leads com pelo menos uma decisão aberta na fila de decisões do comercial, esperando resposta da mesa.' },
  { chave: 'P1', rotulo: 'P1', explicacao: 'Perfil P1 na pontuação: chegou por conteúdo, comunidade ou site ("conhece o ChatGPT").' },
  { chave: 'P2', rotulo: 'P2', explicacao: 'Perfil P2 na pontuação: chegou por ERP parceiro ("tem sistema com base organizada").' },
  { chave: 'P3', rotulo: 'P3', explicacao: 'Perfil P3 na pontuação: chegou por indicação ou evento ("tem muito dado e não cruza").' },
  { chave: 'operacao', rotulo: 'Operação', explicacao: 'Produto-alvo Operação ROOT na ficha (proposto na qualificação, no diagnóstico, na proposta ou no aceite).' },
  { chave: 'imersao', rotulo: 'Imersão', explicacao: 'Produto-alvo Imersão na ficha (proposto na qualificação, no diagnóstico, na proposta ou no aceite).' },
];

export function filtroDoFunil(chave: string | null | undefined): ComercialFiltroDoFunil | null {
  return COMERCIAL_FILTROS_DO_FUNIL.find((f) => f.chave === (chave || 'todos')) ?? null;
}

export interface CartaoDoFunil {
  leadId: string;
  nome: string;
  empresa: string | null;
  /** Layout 26/10: o card da Implantação, quando o onboarding começou antes do fechamento. */
  onboardingCardId?: string | null;
  /** Layout 26/10: o tipo do negócio (sem tipo gravado = pagante). */
  tipoNegocio?: ComercialTipoDeNegocio;
  etapa: ComercialEtapa;
  saude: number | null;
  proximaAcao: ComercialProximaAcao | null;
  precisaDeDecisao: boolean;
  parado: boolean;
  diasNaEtapa: number;
  motivoSaida: ComercialMotivoDeSaida | null;
  voltaEm: string | null;
  perfil: ComercialPerfil | null;
  produto: ComercialProduto | null;
  /** P5: para onde a geladeira volta (a etapa gravada na saída). Nulo fora da geladeira. */
  voltaPara?: ComercialEtapaAtiva | null;
  /** P5: o balão persistente de quem moveu com pendência. Nulo quando não há pendência aberta. */
  balao?: ComercialBalaoDoMover | null;
  /** U4: o dono do lead (id e nome), para o filtro "Responsável" e a lista. */
  donoId?: string | null;
  dono?: string | null;
  /** U4: o aviso de quem moveu à mão para onde o mover não faz tudo (E8 e E9, saída sem motivo). */
  avisoDoMover?: ComercialAvisoDoMover | null;
  /**
   * Adendo de 21/10/2026 (§A1): a tarefa aberta mais antiga ligada ao lead e quantas
   * estão abertas. Leitura derivada; a ficha não muda. Ver `comercial-tarefas.ts`.
   */
  tarefa?: TarefaNoCartaoDoFunil | null;
  tarefasAbertas?: number;
  /**
   * Produção 22B (I5), para o formato Lista: o valor da ficha (centavos), desde
   * quando o lead está na etapa e a reunião marcada. Leitura da ficha, sem conta nova.
   */
  valorCentavos?: number | null;
  etapaDesde?: string | null;
  reuniaoEm?: string | null;
}

/** O fechamento (tela 10): as cinco escritas com chave. */
export interface EscritaDoFechamento {
  /** `pasta` (rodada dos agentes, CO-10): a 7ª, a pasta do cliente no Drive, fora da transação do banco. */
  escrita: 'cliente' | 'contrato' | 'cobranca' | 'kit_e_trilho' | 'card' | 'grupo' | 'pasta';
  onde: string;
  /**
   * `pulado` (T1b): a escrita não se aplica e o motivo está no detalhe (a cobrança de quem já paga fora).
   * `aguardando_aprovacao` (CO-10): a escrita foi à porta e espera a segunda pessoa (a pasta é R3); `ref` é a aprovação.
   */
  estado: 'pendente' | 'criado' | 'reaproveitado' | 'pulado' | 'aguardando_aprovacao' | 'erro';
  detalhe: string;
  ms: number | null;
  seRodarDeNovo: string;
  ref: string | null;
}

export interface FechamentoDoLead {
  chave: string;
  versao: number;
  estado: 'pendente' | 'em_curso' | 'concluido' | 'erro';
  iniciadoEm: string | null;
  concluidoEm: string | null;
  escritas: EscritaDoFechamento[];
  copiadoSemRedigitar: string[];
}

/** O contrato vivo (tela 11). */
export interface ContratoVivo {
  leadId: string;
  cliente: string;
  produto: ComercialProduto | null;
  valorCentavos: number;
  descontoPct: number | null;
  parcelas: { n: number; total: number; valorCentavos: number; vence: string; estado: 'paga' | 'pendente' | 'atrasada'; pagaEm: string | null; aviso: string | null }[];
  reguaDeCobranca: string[];
  entregas: { texto: string; feito: boolean }[];
  primeiroValorEm: string | null;
  saude: number | null;
  faseDaImplantacao: { atual: number; total: number } | null;
  marcos: { chave: string; rotulo: string; quando: string | null; feito: boolean }[];
  /** C-17: nulo enquanto nenhum código conta aditivos; a tela não afirma número. */
  aditivos: number | null;
  /*
   * Rodada do trabalho T8 (19/10/2026): a situação do contrato. "Em implantação"
   * é só informativo (ativo com o card da implantação aberto); concluído e
   * desativado são decisão de gente, à mão, com motivo, registrada no fio.
   */
  situacao: SituacaoDoContrato;
  encerramento: { situacao: 'concluido' | 'desativado'; motivo: string; em: string; por: string | null; parcelasEmAberto: number } | null;
  cnpj: string | null;
  socioDaConta: string | null;
  /**
   * Rodada de produção 1 (21/10/2026): os contratos que vieram do CRM antigo (`contrato.importado`),
   * um por subtarefa de "Contratos dos clientes". Sem PDF e sem parcela: a régua fica desligada e a
   * tela pede o PDF. Ausente (ou vazio) no contrato que nasceu pelo fechamento.
   */
  importados?: ContratoImportadoNaTela[];
}

/** O contrato importado do CRM antigo, como a tela de Contratos vivos mostra. */
export interface ContratoImportadoNaTela {
  /** `cartao:<id da subtarefa>`: de onde veio. */
  origem: string;
  titulo: string;
  produtoRotulo: string | null;
  valorCentavos: number | null;
  /** AAAA-MM-DD, quando o cartão tinha a data de fechamento. */
  fechadoEm: string | null;
  semDocumento: boolean;
  /** Produção 22 (M2): o PDF anexado (o mais novo) e quantas versões ficaram antes dele no fio. */
  anexo?: AnexoDoImportado | null;
  anexosAnteriores?: number;
  /** Produção 22 (M2): as parcelas lançadas à mão; nulo enquanto a mesa não lançou. */
  parcelasManuais?: ParcelasDoImportado | null;
  /** Produção 22 (M2): a régua de cobrança deste contrato (desligada por padrão). */
  regua?: ReguaDoImportado;
}

/** A marca de toda escrita do importador do CRM antigo no fio, na auditoria e no RASTRO. */
export const IMPORTACAO_CRM_MARCA = 'importacao.crm';
/** O aviso do contrato que veio do CRM antigo sem o PDF assinado. */
export const AVISO_DO_CONTRATO_IMPORTADO = 'Contrato importado do CRM antigo · anexar o PDF';

export const SITUACOES_DO_CONTRATO = ['ativo', 'em_implantacao', 'concluido', 'desativado'] as const;
export type SituacaoDoContrato = (typeof SITUACOES_DO_CONTRATO)[number];
export const ROTULO_DA_SITUACAO_DO_CONTRATO: Record<SituacaoDoContrato, string> = {
  ativo: 'Ativo', em_implantacao: 'Em implantação', concluido: 'Concluído', desativado: 'Desativado',
};

/** Encerrar à mão (T8): concluir ou desativar, com motivo; parcela em aberto pede ciência explícita. */
export const ContratoEncerrarSchema = z.object({
  situacao: z.enum(['concluido', 'desativado']),
  motivo: z.string().trim().min(5, 'Escreva o motivo (pelo menos 5 caracteres).').max(500),
  /** Há parcela em aberto: quem encerra declara que viu. A cobrança NÃO é cancelada ([a decidir] pela mesa). */
  cienteDasParcelas: z.boolean().optional(),
}).strict();
export type ContratoEncerrarInput = z.infer<typeof ContratoEncerrarSchema>;

/** A torre (tela 12). */
export interface TorreDasAutomacoes {
  vigia: {
    ultimaPassagemEm: string | null;
    premissasConferidas: number;
    premissasQuebradas: number;
    /** Acréscimo da lane E (fase 2): cada premissa da última passagem, com o que quebrou. */
    premissas?: PremissaDoVigia[];
    /** Rodada dos agentes (CO-11): as três linhas do topo; os números são do sistema. Ausente em passagem antiga. */
    resumo?: ResumoDoVigia | null;
  };
  custoDeIaHojeCentavos: number | null;
  custoDesconhecido: boolean;
  /** Acréscimo da lane E: o custo do dia em dólar, como o livro-caixa do teto o mede (sem câmbio, [a decidir]). */
  custoDeIaHojeUsd?: number | null;
  /** Acréscimo da lane E: quem respondeu as chamadas de modelo (stub, ponte, anthropic...). */
  provedorDeIa?: string;
  automacoes: {
    chave: ComercialAutomacao;
    rotulo: string;
    autonomia: ComercialAutonomia;
    ultimaVezEm: string | null;
    acerto30Dias: number | null;
    premissa: string;
    premissaOk: boolean | null;
    /** Acréscimo da lane E: o degrau que a régua dá hoje (o padrão sem nível gravado). */
    autonomiaVigente?: ComercialAutonomia;
    /** Acréscimo da lane E: o nível veio da config (true) ou é o vigente (false). */
    autonomiaGravada?: boolean;
    /** Acréscimo da lane E: as passagens que entraram no acerto (sem passagem, o acerto é null). */
    passagens30Dias?: number;
    /** Acréscimo da lane E: o degrau máximo pela régua (R3 e R4 param em A2). */
    tetoDaRegua?: ComercialAutonomia;
    /** Acréscimo da lane E: o degrau que a torre sugere subir (um mês sem erro); quem sobe é gente. */
    proximoDegrau?: ComercialAutonomia | null;
  }[];
}

/** Uma premissa conferida pelo vigia das 08:00 (lane E, fase 2). */
export interface PremissaDoVigia {
  chave: string;
  automacao: ComercialAutomacao | null;
  premissa: string;
  /** `null` = não conferível hoje (número [a decidir] ou fonte que o vigia não alcança). */
  ok: boolean | null;
  detalhe: string;
  leads: string[];
}

/** O relatório da quinta (tela 13). */
export interface RelatorioDaSemana {
  periodoDias: number;
  leads: number;
  fechados: number;
  medianaDiasDoOiAoPix: number | null;
  acoes: { automaticas: number; humanas: number };
  funil: { etapa: string; n: number }[];
  perdasPorMotivo: { motivo: ComercialMotivoDeSaida; n: number }[];
  previsao: { fechamentosProvaveis: number; leadsEmProposta: number } | null;
  geradoEm: string;
  narrativa: string | null;
  /** Acréscimo da lane E: os leads em proposta ou follow-up agora (a contagem existe; a taxa da previsão é [a decidir]). */
  leadsEmPropostaAgora?: number;
  /** Acréscimo da lane E: por que a previsão é nula. */
  previsaoPendente?: string | null;
  /** Acréscimo da lane E: o recorte, em ISO. */
  desde?: string;
  ate?: string;
  /** Acréscimo da lane E: o que a narrativa do modelo trouxe e o sistema tirou (frase com número). */
  narrativaAvisos?: string[];
  /** Acréscimo da lane E: propostas publicadas cuja validade vence dentro do mesmo recorte à frente (C10: "propostas vencendo"). */
  propostasVencendo?: { leadId: string; nome: string; validade: string }[];
  /** Acréscimo da lane E: `relogio` (a quinta 18h), `pessoa` (o botão) ou `ao_vivo` (leitura sem gerar). */
  origem?: 'relogio' | 'pessoa' | 'ao_vivo';
}

/** Rótulos das automações da torre. */
export const COMERCIAL_ROTULO_DA_AUTOMACAO: Record<ComercialAutomacao, string> = {
  qualificador: 'qualificador',
  agendador: 'agendador',
  leitor_de_ata: 'leitor de ata',
  construtor_de_proposta: 'construtor de proposta',
  revisor_de_proposta: 'revisor de proposta',
  assistente_da_proposta: 'assistente da proposta',
  fupeiro: 'fupeiro',
  assinador: 'assinador',
  cobrador: 'cobrador',
  fechador: 'fechador',
  relator: 'relator da quinta',
  vigia: 'vigia das 08:00',
};

export const SALA_ROTULO_DO_ESTAGIO: Record<SalaEstagio, string> = {
  conversa: 'conversa',
  diagnostico: 'diagnóstico',
  proposta: 'proposta',
  contrato: 'contrato',
  comeco: 'começo',
};

// ---------------------------------------------------------------------------
// A sala e o simulador (Lane B, acréscimo de 13/10/2026)
// ---------------------------------------------------------------------------

/** O que o lead "digita" no celular do simulador: texto, formulário ou toque em botão. */
export const SimuladorRespostaSchema = z
  .object({
    texto: texto(2000).optional(),
    formulario: SalaFormSchema.optional(),
    /** A chave do botão tocado (o horário em ISO, nos botões de agenda). */
    botao: texto(120).optional(),
  })
  .strict()
  .refine((v) => [v.texto, v.formulario, v.botao].filter((x) => x !== undefined).length === 1, {
    message: 'mande exatamente um: texto, formulario ou botao',
  });
export type SimuladorRespostaInput = z.infer<typeof SimuladorRespostaSchema>;

/** A mesa toca num botão de uma decisão (tela 09). */
export const SimuladorMesaRespostaSchema = z
  .object({ decisaoId: z.string().uuid(), escolha: texto(80), motivo: z.string().trim().max(400).optional() })
  .strict();
export type SimuladorMesaRespostaInput = z.infer<typeof SimuladorMesaRespostaSchema>;

/** Uma mensagem como o celular simulado a mostra. */
export interface MensagemNoCelular {
  id: string;
  direcao: 'entrada' | 'saida';
  destino: 'lead' | 'mesa' | 'grupo';
  template: string | null;
  texto: string;
  estado: ComercialEstadoDeMensagem;
  interativo: {
    formulario?: { id: string; titulo: string; campos: { chave: string; rotulo: string; tipo: string }[] };
    botoes?: { chave: string; rotulo: string }[];
  } | null;
  approvalId: string | null;
  vetoAte: string | null;
  em: string;
  enviadaEm: string | null;
  erro: string | null;
}

export interface CelularDoLead {
  leadId: string;
  nome: string;
  telefone: string | null;
  etapa: ComercialEtapa | null;
  linkDaSala: string | null;
  mensagens: MensagemNoCelular[];
}

export interface ListaDeCelulares {
  provedor: ComercialProvedorDeWhatsapp;
  leads: { leadId: string; nome: string; telefone: string | null; etapa: ComercialEtapa | null; ultimaEm: string | null; naFila: number }[];
}

export interface CelularDaMesa {
  decisoes: { id: string; leadId: string; leadNome: string; tipo: string; titulo: string; contexto: string; opcoes: OpcaoDeDecisao[]; padrao: string; expiraEm: string; criadaEm: string }[];
  mensagensNaFila: { id: string; leadId: string; leadNome: string; template: string | null; texto: string; estado: ComercialEstadoDeMensagem; approvalId: string | null; vetoAte: string | null; em: string }[];
  responderDisponivel: boolean;
}
