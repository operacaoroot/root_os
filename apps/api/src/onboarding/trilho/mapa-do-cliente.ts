import { OnboardingFase } from '@prisma/client';

import { temasDoBloco } from './espinha';
import type { Portoes } from './fases';
import { formatarData } from './mensagens';

/* ==========================================================================
 * O MAPA DO CLIENTE — onde ele está, do acordo à memória viva
 * ==========================================================================
 *
 * Peça do desenho de 24/09. O link deixa de ser "formulário de onboarding" e
 * passa a ser A ESTAÇÃO ATUAL DE UM TRECHO: o cliente vê o caminho inteiro (a
 * conversa, o acordo, o kickoff de hoje, o contexto, a memória viva, a frente
 * rodando), onde está, o que já ficou para trás e o que recebe na estação 5.
 *
 * O trecho é o RECORTE do cliente das cinco fases do trilho — não é a esteira
 * inteira (os cards internos da Root não são assunto dele). Seis estações,
 * dados versionados, iguais para todo cliente: uma casa só, não uma página por
 * cliente.
 *
 * HONESTIDADE DO MAPA — duas regras que valem mais do que o desenho:
 *   1. NUNCA inventa data. `quando` só existe quando há data gravada (a
 *      reunião, a validade do convite). Estação futura sem data fica sem data,
 *      como o resto do OS ("nunca XX/XX", `SemDataError` das mensagens).
 *   2. A posição é a afirmação. O que vem ANTES da estação atual aparece como
 *      vencido porque o cliente passou por lá — o link B–D só nasce depois do
 *      acordo, e o acordo só depois da conversa. O que vem DEPOIS nunca
 *      aparece como feito.
 *
 * PURO: sem banco, sem Nest. Quem lê o trilho é o serviço; aqui é função do
 * estado, como `fases.ts`.
 */

export type EstadoDaEstacao = 'feita' | 'aqui' | 'adiante';

export interface EstacaoDoMapa {
  n: number;
  chave: ChaveDaEstacao;
  titulo: string;
  /** O que a estação é PARA O CLIENTE, em uma linha. */
  oQueE: string;
  /** Data ou janela real. `null` quando não há data gravada — nunca chute. */
  quando: string | null;
  estado: EstadoDaEstacao;
  /** O número da estação atual ("confirmar 11 · decidir 6") ou a marca de quem já passou. */
  detalhe: string | null;
}

export type ChaveDaEstacao = 'conversa' | 'acordo' | 'kickoff' | 'contexto' | 'memoria' | 'frente';

/** O que o cliente RECEBE na estação 5 — a promessa concreta, não "obrigado". */
export interface PromessaDaMemoria {
  /** A pasta do vault dele, pelo slug do trilho. */
  pasta: string;
  /** Os títulos das notas da casa (bloco B), na ordem da espinha. */
  notas: string[];
  /** O que ele já disse que manda de fonte, quando disse. */
  fontes: string | null;
  /** A pergunta da primeira semana, quando já existe. É por ela que se mede. */
  primeiraPergunta: string | null;
}

export interface MapaDoCliente {
  titulo: string;
  subtitulo: string;
  estacaoAtual: number;
  estacoes: EstacaoDoMapa[];
  promessa: PromessaDaMemoria;
}

export interface ItemParaMapa {
  temaId: string;
  bloco: string;
  status: string;
  proposta: string | null;
  textoFinal: string | null;
  origem: string;
  notaId?: string | null;
}

export interface EstadoParaMapa {
  slug: string;
  fase: OnboardingFase;
  receitaNome: string | null;
  reuniaoEm: Date | string | null;
  kickoffEm: Date | string | null;
  portoes: Portoes;
  /** Quais blocos o link em uso cobre: `A` é antes da conversa; `BCD` é o kickoff. */
  blocosDoLink: 'A' | 'BCD';
  linkConcluido: boolean;
  /** Validade do convite — a única data do futuro que o OS pode afirmar. */
  validoAte: Date | string | null;
  itens: readonly ItemParaMapa[];
}

const ORDEM: readonly ChaveDaEstacao[] = ['conversa', 'acordo', 'kickoff', 'contexto', 'memoria', 'frente'] as const;

const TEXTO: Record<ChaveDaEstacao, { titulo: string; oQueE: string }> = {
  conversa: {
    titulo: 'Conversa',
    oQueE: 'A conversa em que você conta a casa e a gente escuta — é dela que sai todo o resto.',
  },
  acordo: {
    titulo: 'Acordo',
    oQueE: 'O combinado do trabalho: por onde começamos e com que compromisso de cada lado.',
  },
  kickoff: {
    titulo: 'Kickoff',
    oQueE: 'Confirmar o que você já disse e decidir o que só você decide. É o começo do trabalho.',
  },
  contexto: {
    titulo: 'Contexto',
    oQueE: 'As suas fontes entram: pastas, materiais, propostas — o que a gente precisa ler para falar a sua língua.',
  },
  memoria: {
    titulo: 'Memória viva',
    oQueE: 'O pontapé inicial: o seu vault no Obsidian, as notas da casa na sua voz, com a origem de cada frase.',
  },
  frente: {
    titulo: 'Frente rodando',
    oQueE: 'A frente escolhida em operação, medida contra o número de partida.',
  },
};

const ORDEM_DAS_FASES: readonly OnboardingFase[] = [
  OnboardingFase.qualificar,
  OnboardingFase.diagnostico,
  OnboardingFase.contrato,
  OnboardingFase.imersao,
  OnboardingFase.operacao,
  OnboardingFase.encerrado,
] as const;

function faseAlcancou(fase: OnboardingFase, alvo: OnboardingFase): boolean {
  return ORDEM_DAS_FASES.indexOf(fase) >= ORDEM_DAS_FASES.indexOf(alvo);
}

function texto(i: ItemParaMapa | undefined): string | null {
  const t = (i?.textoFinal ?? i?.proposta ?? '').trim();
  return t || null;
}

function encurtar(t: string | null, n: number): string | null {
  if (!t) return null;
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/**
 * A promessa da estação 5, construída do que já existe: a pasta pelo slug, as
 * notas da casa pela espinha, as fontes e a primeira pergunta pelo que o
 * cliente já disse. Nada aqui é pedido a modelo.
 */
export function promessaDaMemoria(e: EstadoParaMapa): PromessaDaMemoria {
  const porTema = new Map(e.itens.map((i) => [i.temaId, i]));
  return {
    pasta: `${e.slug}/`,
    notas: temasDoBloco('B').map((t) => t.titulo),
    fontes: encurtar(texto(porTema.get('d-anexos')), 160),
    primeiraPergunta: encurtar(texto(porTema.get('d-primeira-pergunta')), 160),
  };
}

export function montarMapaDoCliente(e: EstadoParaMapa): MapaDoCliente {
  const p = e.portoes ?? {};
  const porTema = new Map(e.itens.map((i) => [i.temaId, i]));
  const veioDaAta = e.itens.some((i) => i.origem === 'ata');
  const memoriaCarregada = e.itens.some((i) => !!i.notaId);

  // O que dá para AFIRMAR de cada estação, pelo que está gravado.
  const feita: Record<ChaveDaEstacao, boolean> = {
    conversa: !!e.reuniaoEm || !!e.kickoffEm || veioDaAta,
    acordo: !!p.propostaEnviadaEm || faseAlcancou(e.fase, OnboardingFase.contrato) || e.blocosDoLink === 'BCD',
    kickoff: e.blocosDoLink === 'BCD' && e.linkConcluido,
    contexto: memoriaCarregada || !!p.ambienteOkEm,
    memoria: memoriaCarregada,
    frente: !!p.criterioDeSaida?.atingidoEm || faseAlcancou(e.fase, OnboardingFase.operacao),
  };

  /*
   * Onde ele está AGORA. O link em uso decide: o link A é a triagem, antes da
   * conversa; o link B–D é o kickoff. Concluído, a estação atual passa a ser a
   * primeira que ainda não aconteceu.
   */
  let atual: ChaveDaEstacao;
  if (e.blocosDoLink === 'A') atual = 'conversa';
  else if (!e.linkConcluido) atual = 'kickoff';
  else atual = ORDEM.find((c) => !feita[c] && c !== 'kickoff') ?? 'frente';

  const iAtual = ORDEM.indexOf(atual);

  const comProposta = e.itens.filter(
    (i) => i.bloco !== 'A' && (!!i.proposta || i.status === 'confirmado' || i.status === 'corrigido'),
  ).length;
  const emBranco = e.itens.filter((i) => i.bloco !== 'A' && !i.proposta && i.status === 'em-branco').length;

  const estacoes: EstacaoDoMapa[] = ORDEM.map((chave, i) => {
    const estado: EstadoDaEstacao = i < iAtual ? 'feita' : i === iAtual ? 'aqui' : feita[chave] ? 'feita' : 'adiante';
    return {
      n: i + 1,
      chave,
      titulo: TEXTO[chave].titulo,
      oQueE: TEXTO[chave].oQueE,
      quando: quandoDaEstacao(chave, e, estado),
      detalhe: detalheDaEstacao(chave, e, estado, { comProposta, emBranco, porTema }),
      estado,
    };
  });

  return {
    titulo: 'Onde você está',
    subtitulo: 'do acordo à memória viva',
    estacaoAtual: iAtual + 1,
    estacoes,
    promessa: promessaDaMemoria(e),
  };
}

function quandoDaEstacao(chave: ChaveDaEstacao, e: EstadoParaMapa, estado: EstadoDaEstacao): string | null {
  const p = e.portoes ?? {};
  switch (chave) {
    case 'conversa':
      return e.reuniaoEm ? formatarData(e.reuniaoEm) : e.kickoffEm ? formatarData(e.kickoffEm) : null;
    case 'acordo':
      return p.propostaEnviadaEm ? formatarData(p.propostaEnviadaEm) : null;
    case 'kickoff': {
      // A única data do futuro que o OS pode afirmar: até quando o link vale.
      const d = estado === 'aqui' ? formatarData(e.validoAte) : null;
      return d ? `até ${d}` : null;
    }
    case 'contexto':
      return p.ambienteOkEm ? formatarData(p.ambienteOkEm) : null;
    case 'memoria':
      return null;
    case 'frente':
      return p.criterioDeSaida?.atingidoEm ? formatarData(p.criterioDeSaida.atingidoEm) : null;
  }
}

function detalheDaEstacao(
  chave: ChaveDaEstacao,
  e: EstadoParaMapa,
  estado: EstadoDaEstacao,
  ctx: { comProposta: number; emBranco: number; porTema: Map<string, ItemParaMapa> },
): string | null {
  const p = e.portoes ?? {};
  switch (chave) {
    case 'kickoff':
      if (estado !== 'aqui') return null;
      return [ctx.comProposta ? `confirmar ${ctx.comProposta}` : null, ctx.emBranco ? `decidir ${ctx.emBranco}` : null]
        .filter(Boolean)
        .join(' · ') || null;
    case 'contexto':
      return encurtar(texto(ctx.porTema.get('d-anexos')), 80);
    case 'memoria':
      return `o vault ${e.slug}/ com as notas da casa`;
    case 'frente':
      return e.receitaNome ?? null;
    case 'acordo':
      return p.propostaEnviadaEm ? null : e.blocosDoLink === 'BCD' ? 'acertado' : null;
    case 'conversa':
      return null;
  }
}

/* ==========================================================================
 * A ORDEM DO KICKOFF — decisão antes de confirmação
 * ==========================================================================
 *
 * O que só o cliente decide vem PRIMEIRO, porque é o que trava o trabalho; o
 * que ele já disse na conversa vem depois, para conferir. Opcional em branco
 * fica no fim, sem peso.
 *
 * A pergunta é sempre a MESMA do roteiro do kickoff (a espinha, ou a versão
 * que o roteirista reescreveu): quem conduziu a conversa perguntou daquele
 * jeito, e o cliente lê daquele jeito. Nada de reescrever aqui.
 */
export interface ItemParaAgrupar {
  temaId: string;
  obrigatorio: boolean;
  modo: 'confirmar' | 'responder' | 'feito';
  status: string;
}

export interface OrdemDoKickoff {
  /** Só o cliente decide: obrigatório que a conversa não respondeu. */
  decisoes: string[];
  /** Ele já disse: tem proposta aprovada para confirmar (ou já confirmou). */
  confirmacoes: string[];
  /** Opcional em branco: entra se ele quiser. */
  extras: string[];
}

export function ordemDoKickoff(itens: readonly ItemParaAgrupar[]): OrdemDoKickoff {
  const ordem: OrdemDoKickoff = { decisoes: [], confirmacoes: [], extras: [] };
  for (const i of itens) {
    const daConversa = i.modo === 'confirmar' || i.status === 'confirmado' || i.status === 'corrigido';
    if (daConversa) ordem.confirmacoes.push(i.temaId);
    else if (i.obrigatorio) ordem.decisoes.push(i.temaId);
    else ordem.extras.push(i.temaId);
  }
  return ordem;
}
