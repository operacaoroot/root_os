import {
  SALA_COMBINADO_PADRAO, SALA_ESTACOES, SALA_ROTULO_DA_ESTACAO, SALA_WHATSAPP_PLACEHOLDER,
  type ConteudoDaSalaPublicada, type EstacaoDaSalaPublicada, type PassoDaSalaPublicada,
  type PublicadoNaSalaVersao, type SalaEstacao, type SalaRascunhoInput,
} from '@mktos/shared';

import { hashDoConteudo } from './eventos';

/*
 * A SALA PUBLICADA POR VERSÃO (rodada da implantação I3, 18/10/2026) — a parte
 * pura: o que a versão congela e de onde cada pedaço vem.
 *
 * ONDE ESTAMOS. Cinco estações, derivadas de fato com data:
 *   · conversa: a ata chegou (o fato), ou o horário da reunião já passou;
 *   · acordo: `cliente.ativo` (o fechamento concluiu);
 *   · kickoff: o horário do kickoff (ficha ou trilho) já passou;
 *   · contexto: o marco `memoria.carregada` do trilho;
 *   · frente rodando: o marco `fase.avancou` para `operacao`.
 * A posição é a afirmação: a estação feita mais adiante decide onde estamos; o
 * que vem antes dela fica feito (com data só quando a fonte a tem, nunca
 * inventada), a seguinte é a atual e o resto é futuro.
 *
 * PUBLICADO PARA VOCÊ. Proposta e contrato pelo fio; o roteiro do kickoff
 * existe quando o trilho existe; o kit chega depois do kickoff (esmaecido).
 *
 * O HASH cobre o conteúdo inteiro da versão: é o que a aprovação prende, e o
 * efeito recusa publicar se o conteúdo de agora não for o assinado.
 */

export interface FatoDaSala { type: string; occurredAt: Date; payload: unknown }
export interface MarcoDoTrilho { tipo: string; em: Date; dados: unknown }

export interface EntradaDaVersao {
  agora: Date;
  nomeDoLead: string;
  empresa: string | null;
  eventos: FatoDaSala[];
  reuniaoEm: Date | null;
  kickoffEm: Date | null;
  temTrilho: boolean;
  marcos: MarcoDoTrilho[];
  dono: string | null;
  /** O que a bancada escreveu (ou nulo: o padrão). */
  escrito: SalaRascunhoInput | null;
  /** O próximo passo do trilho com dono e data, se houver: vira o primeiro passo padrão. */
  passoDoTrilho: PassoDaSalaPublicada | null;
}

type P = Record<string, unknown>;

const primeiro = (evs: FatoDaSala[], tipo: string) => evs.filter((e) => e.type === tipo).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0] ?? null;
const ultimo = (evs: FatoDaSala[], tipo: string) => evs.filter((e) => e.type === tipo).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0] ?? null;

export function estacoesDaSala(e: Pick<EntradaDaVersao, 'agora' | 'eventos' | 'reuniaoEm' | 'kickoffEm' | 'marcos'>): EstacaoDaSalaPublicada[] {
  const agora = e.agora.getTime();
  const feitaEm: Record<SalaEstacao, Date | null | undefined> = { conversa: undefined, acordo: undefined, kickoff: undefined, contexto: undefined, frente: undefined };
  const ata = primeiro(e.eventos, 'ata.chegou');
  if (ata) feitaEm.conversa = ata.occurredAt;
  else if (e.reuniaoEm && e.reuniaoEm.getTime() <= agora) feitaEm.conversa = e.reuniaoEm;
  const ativo = primeiro(e.eventos, 'cliente.ativo');
  if (ativo) feitaEm.acordo = ativo.occurredAt;
  if (e.kickoffEm && e.kickoffEm.getTime() <= agora) feitaEm.kickoff = e.kickoffEm;
  const memoria = e.marcos.filter((m) => m.tipo === 'memoria.carregada').sort((a, b) => a.em.getTime() - b.em.getTime())[0];
  if (memoria) feitaEm.contexto = memoria.em;
  const operacao = e.marcos
    .filter((m) => m.tipo === 'fase.avancou' && ((m.dados ?? {}) as P).para === 'operacao')
    .sort((a, b) => a.em.getTime() - b.em.getTime())[0];
  if (operacao) feitaEm.frente = operacao.em;

  let ultimaFeita = -1;
  SALA_ESTACOES.forEach((k, i) => { if (feitaEm[k] !== undefined) ultimaFeita = i; });
  return SALA_ESTACOES.map((chave, i) => ({
    chave,
    rotulo: SALA_ROTULO_DA_ESTACAO[chave],
    estado: i <= ultimaFeita ? 'feita' : i === ultimaFeita + 1 ? 'atual' : 'futura',
    em: i <= ultimaFeita && feitaEm[chave] ? feitaEm[chave]!.toISOString() : null,
  }));
}

export function publicadosDaSala(e: Pick<EntradaDaVersao, 'agora' | 'eventos' | 'kickoffEm' | 'temTrilho'>): PublicadoNaSalaVersao[] {
  const pub = ultimo(e.eventos, 'proposta.publicada');
  const aceita = ultimo(e.eventos, 'proposta.aceita');
  const versao = pub ? Number(((pub.payload ?? {}) as P).versao) || null : null;
  const proposta: PublicadoNaSalaVersao = !pub
    ? { tipo: 'proposta', titulo: 'Proposta', estado: 'ainda não publicada', disponivel: false }
    : { tipo: 'proposta', titulo: `Proposta${versao ? ` v${versao}` : ''}`, estado: aceita ? 'aceita' : 'publicada · esperando a sua leitura', disponivel: true };

  const cliente = !!primeiro(e.eventos, 'contrato.assinado_cliente');
  const root = !!primeiro(e.eventos, 'contrato.assinado_root');
  const gerado = !!primeiro(e.eventos, 'contrato.gerado');
  const contrato: PublicadoNaSalaVersao = !gerado && !cliente
    ? { tipo: 'contrato', titulo: 'Contrato', estado: 'sai depois do aceite', disponivel: false }
    : {
        tipo: 'contrato',
        titulo: 'Contrato',
        estado: cliente && root ? 'assinado pelos dois' : cliente ? 'assinado por você · falta a Root' : 'aguardando a sua assinatura',
        disponivel: true,
      };

  const roteiro: PublicadoNaSalaVersao = e.temTrilho
    ? { tipo: 'roteiro', titulo: 'Roteiro do kickoff', estado: 'pronto para você ler antes da conversa', disponivel: true }
    : { tipo: 'roteiro', titulo: 'Roteiro do kickoff', estado: 'chega depois do acordo', disponivel: false };

  const kickoffPassou = !!e.kickoffEm && e.kickoffEm.getTime() <= e.agora.getTime();
  const kit: PublicadoNaSalaVersao = { tipo: 'kit', titulo: 'Kit de implantação', estado: kickoffPassou ? 'em montagem pela Root' : 'chega após o kickoff', disponivel: false };
  return [proposta, contrato, roteiro, kit];
}

/** O conteúdo da versão como sairia agora: o derivado do fio e o escrito pela bancada. */
export function conteudoDaVersao(e: EntradaDaVersao): ConteudoDaSalaPublicada {
  const escrito = e.escrito;
  const nomePadrao = `Sala · ${e.empresa || e.nomeDoLead}`.slice(0, 80);
  return {
    nome: escrito?.nome ?? nomePadrao,
    estacoes: estacoesDaSala(e),
    proximosPassos: escrito ? escrito.proximosPassos : e.passoDoTrilho ? [e.passoDoTrilho] : [],
    publicados: publicadosDaSala(e),
    combinado: escrito ? escrito.combinado : [...SALA_COMBINADO_PADRAO],
    quemCuida: escrito ? escrito.quemCuida : e.dono ? { nome: e.dono, papel: 'cuida da sua conta na Root' } : null,
    whatsapp: { numero: null, rotulo: SALA_WHATSAPP_PLACEHOLDER },
  };
}

export function hashDaSala(c: ConteudoDaSalaPublicada): string {
  return hashDoConteudo(c);
}

/**
 * O que a bancada escreveu, lido de volta do conteúdo guardado (para o
 * rascunho continuar editável sem uma segunda coluna).
 */
export function escritoDoConteudo(c: ConteudoDaSalaPublicada): SalaRascunhoInput {
  return { nome: c.nome, proximosPassos: c.proximosPassos, combinado: c.combinado, quemCuida: c.quemCuida };
}
