import {
  PAUTA_EPISODIO_STATUS_ROTULO,
  PAUTA_ETAPAS_DO_ENCADEAMENTO,
  PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO,
  PAUTA_STATUS_QUE_AGENDAM,
  PautaEncadeamentoConfigSchema,
  type PautaEpisodioStatus,
  type PautaEtapaDoEncadeamento,
  type PautaFormatoDaSemana,
  type PautaPassoRegistrado,
  type PautaPecaStatus,
  type PautaResultadoDoPasso,
} from '@mktos/shared';

/*
 * O ENCADEAMENTO DO EPISÓDIO (MD1), a parte pura: dado o que o episódio já tem,
 * qual é o próximo passo que a rotina `pauta.encadear` pode dar SOZINHA — ou
 * por que ela para. O serviço (`encadeamento.service.ts`) lê o banco e roda o
 * passo pelos serviços de sempre.
 *
 * A função nunca devolve "publicar": o fim do caminho automático é a semana em
 * rascunho com os slots PROPOSTOS. Pôr a página no ar, aprovar as peças e a
 * agenda de verdade são pontos humanos.
 */

/** Os status em que a rotina mexe. Antes da transcrição não há o que encadear; depois de Agendado, é do operador. */
export const STATUS_QUE_ENCADEIAM = ['pacote', 'derivacao'] as const satisfies readonly PautaEpisodioStatus[];

/** Quantos episódios uma passagem toca (um passo em cada). */
export const TETO_DE_EPISODIOS_POR_PASSAGEM = 2;

/** Quantos erros seguidos na mesma etapa travam o episódio até alguém mexer nele. */
export const ERROS_QUE_TRAVAM = 3;

export interface PecaParaEncadear {
  formato: PautaFormatoDaSemana;
  status: PautaPecaStatus;
  agendada: boolean;
  temSlotProposto: boolean;
  /** O render (PNG no storage ou mp4 registrado) já está pronto. */
  midiaPronta: boolean;
}

export interface EpisodioParaEncadear {
  apelido: string;
  status: PautaEpisodioStatus;
  temTranscricao: boolean;
  /** Títulos, descrição ou thumbs: o `PacoteService` recusa gerar por cima sem `substituir`. */
  temPacote: boolean;
  temTitulos: boolean;
  temPagina: boolean;
  /** Já houve montagem da página e ela não está mais ligada (apagada no /bio): refazer é humano. */
  paginaApagada: boolean;
  paginaNoAr: boolean;
  moduloBio: boolean;
  temNewsletter: boolean;
  /** A newsletter da transcrição existiu e toda ela foi descartada: gerar outra é humano. */
  newsletterDescartada: boolean;
  /** A rodada tem newsletter do miolo APROVADA: gerar a da transcrição a descartaria. */
  mioloAprovado: boolean;
  /** Matérias mantidas pela curadoria. */
  materias: number;
  /** O número (1…) das matérias mantidas sem peça nenhuma da semana — nem descartada. */
  materiasSemPeca: number[];
  /** As matérias com peça de algum formato e sem a de outro (a IA falhou num formato). */
  materiasIncompletas: number[];
  /** Quantas peças da semana o operador descartou. */
  pecasDescartadas: number;
  /** As peças da semana do episódio, menos as descartadas. */
  pecas: PecaParaEncadear[];
}

export type ProximoPasso =
  | { passo: PautaEtapaDoEncadeamento; motivo: null; itens?: number[] }
  | { passo: 'parar'; motivo: string };

export class ConfigDoEncadeamentoInvalidaError extends Error {}

/**
 * As etapas da config da rotina; sem config, todas. A config ILEGÍVEL lança,
 * como na coleta: cair para "todas" faria a rotina restrita a duas etapas
 * andar as cinco sem avisar ninguém.
 */
export function etapasDaConfig(config: unknown): PautaEtapaDoEncadeamento[] {
  if (config === undefined || config === null) return [...PAUTA_ETAPAS_DO_ENCADEAMENTO];
  const lida = PautaEncadeamentoConfigSchema.safeParse(config);
  if (!lida.success) {
    throw new ConfigDoEncadeamentoInvalidaError(
      `configuração da rotina: ${lida.error.issues.map((i) => i.message).join('; ').slice(0, 200)} — corrija em /rotinas`,
    );
  }
  const pedidas = lida.data.etapas ?? PAUTA_ETAPAS_DO_ENCADEAMENTO;
  return PAUTA_ETAPAS_DO_ENCADEAMENTO.filter((e) => pedidas.includes(e));
}

const parar = (motivo: string): ProximoPasso => ({ passo: 'parar', motivo });

/**
 * O próximo passo. `etapas` são as que a rotina anda; `dispensadas`, as que já
 * recusaram por falta de insumo (sem matéria com link, por exemplo) e só voltam
 * quando alguém mexe no episódio ou roda à mão.
 */
export function proximoPasso(
  ep: EpisodioParaEncadear,
  opts: { etapas?: readonly PautaEtapaDoEncadeamento[]; dispensadas?: readonly PautaEtapaDoEncadeamento[] } = {},
): ProximoPasso {
  const etapas = opts.etapas ?? PAUTA_ETAPAS_DO_ENCADEAMENTO;
  const dispensadas = opts.dispensadas ?? [];
  const pode = (e: PautaEtapaDoEncadeamento) => etapas.includes(e) && !dispensadas.includes(e);

  if (!(STATUS_QUE_ENCADEIAM as readonly string[]).includes(ep.status)) {
    const antes = ['roteiro', 'gravacao', 'edicao'].includes(ep.status);
    return parar(
      antes
        ? `O episódio está em ${PAUTA_EPISODIO_STATUS_ROTULO[ep.status]}: o encadeamento começa quando a transcrição chega do Mac.`
        : `O episódio está em ${PAUTA_EPISODIO_STATUS_ROTULO[ep.status]}: daqui em diante o caminho é do operador.`,
    );
  }
  if (!ep.temTranscricao) {
    return parar('O episódio está sem transcrição (a mídia foi refeita?): no Mac, rode o root-midia de novo.');
  }

  // A rotina só gera onde nunca houve nada: o que o operador descartou ou
  // apagou fica assim, e refazer é o botão da tela.
  if (!ep.temPacote && pode('pacote')) return { passo: 'pacote', motivo: null };
  // A página segue o pacote: é a URL dela que entra no lugar do marcador da descrição.
  if (ep.temTitulos && !ep.temPagina && !ep.paginaApagada && ep.moduloBio && pode('pagina')) return { passo: 'pagina', motivo: null };
  if (!ep.temNewsletter && !ep.newsletterDescartada && !ep.mioloAprovado && pode('newsletter')) return { passo: 'newsletter', motivo: null };
  // Só as matérias que ficaram sem peça (a IA ou o teto de custo cortou no meio).
  if (ep.materiasSemPeca.length && pode('semana')) return { passo: 'semana', motivo: null, itens: [...ep.materiasSemPeca] };
  const semSlot = ep.pecas.filter((p) => p.status === 'rascunho' && !p.agendada && !p.temSlotProposto);
  if (semSlot.length && (PAUTA_STATUS_QUE_AGENDAM as readonly string[]).includes(ep.status) && pode('slots')) {
    return { passo: 'slots', motivo: null };
  }

  const motivos: string[] = [];
  for (const e of dispensadas.filter((x) => etapas.includes(x))) {
    motivos.push(`${PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO[e]}: recusado por falta de insumo — faça à mão, mexa no episódio ou use "Rodar agora" em /rotinas`);
  }
  if (ep.materias === 0) motivos.push('a curadoria não manteve nenhuma matéria');
  if (ep.paginaApagada && !ep.temPagina && ep.moduloBio && etapas.includes('pagina')) {
    motivos.push('a página de links deste episódio foi montada e depois apagada: montar de novo é à mão');
  }
  if (!ep.temNewsletter && etapas.includes('newsletter')) {
    if (ep.newsletterDescartada) motivos.push('a newsletter foi descartada pelo operador: gere à mão se quiser outra');
    else if (ep.mioloAprovado) motivos.push('há newsletter do miolo aprovada na rodada: trocá-la pela da transcrição é decisão humana');
  }
  if (ep.pecas.length === 0 && ep.pecasDescartadas > 0 && etapas.includes('semana')) {
    motivos.push('as peças da semana foram descartadas pelo operador: gere à mão se quiser outras');
  }
  if (ep.materiasIncompletas.length) {
    motivos.push(`matéria(s) ${ep.materiasIncompletas.join(', ')} sem os três formatos: gere de novo à mão na seção Semana de posts`);
  }
  const semRender = ep.pecas.filter((p) => p.status !== 'publicada' && !p.midiaPronta);
  if (semRender.length) motivos.push(`${semRender.length} peça(s) sem render: rode no Mac o /root-midia de carrosséis, stories e cortes do ${ep.apelido}`);
  if (ep.temPagina && !ep.paginaNoAr) motivos.push('a página de links está montada e fora do ar: pôr no ar é humano');
  const rascunhos = ep.pecas.filter((p) => p.status === 'rascunho').length;
  if (rascunhos) motivos.push(`${rascunhos} peça(s) em rascunho aguardando aprovação`);
  const semData = ep.pecas.filter((p) => p.status === 'aprovada' && !p.agendada).length;
  if (semData) motivos.push(`${semData} peça(s) aprovada(s) sem data: distribua na aba Semana`);
  if (!motivos.length) motivos.push('nada a fazer sozinho: o que falta é do operador');
  return parar(`${motivos.join('; ')}.`);
}

// ---------------------------------------------------------------------------
// O HISTÓRICO: travar depois de três erros, dispensar o que não tem insumo
// ---------------------------------------------------------------------------

/** O `after` do evento `pauta.encadeamento_passo`, relido do RASTRO. */
export interface PassoNoRastro {
  etapa: PautaEtapaDoEncadeamento;
  resultado: PautaResultadoDoPasso;
  detalhe: string | null;
  /** O `atualizadoEm` do episódio quando o passo rodou: mudou, alguém mexeu. */
  episodioAtualizadoEm: string | null;
  em: string;
}

export function lerPassoDoRastro(after: unknown, criadoEm: Date): PassoNoRastro | null {
  if (!after || typeof after !== 'object' || Array.isArray(after)) return null;
  const a = after as Record<string, unknown>;
  const etapa = a.etapa as PautaEtapaDoEncadeamento;
  const resultado = a.resultado as PautaResultadoDoPasso;
  if (!(PAUTA_ETAPAS_DO_ENCADEAMENTO as readonly string[]).includes(etapa)) return null;
  if (!['ok', 'erro', 'pulada', 'dispensada', 'travada'].includes(resultado)) return null;
  return {
    etapa,
    resultado,
    detalhe: typeof a.detalhe === 'string' ? a.detalhe : null,
    episodioAtualizadoEm: typeof a.episodioAtualizadoEm === 'string' ? a.episodioAtualizadoEm : null,
    em: criadoEm.toISOString(),
  };
}

/**
 * O que o histórico (do mais novo para o mais velho) diz agora:
 *   · `travada`: a etapa que falhou três vezes seguidas sem ninguém mexer no
 *     episódio desde então (o aviso de trava não interrompe a contagem);
 *   · `dispensadas`: as etapas cujo último passo foi recusado por falta de
 *     insumo, com o episódio igual desde então.
 */
export function leituraDoHistorico(
  passos: readonly PassoNoRastro[],
  atualizadoEm: Date,
): { travada: PautaEtapaDoEncadeamento | null; jaAvisada: boolean; dispensadas: PautaEtapaDoEncadeamento[] } {
  const agora = atualizadoEm.toISOString();
  const igual = (p: PassoNoRastro) => p.episodioAtualizadoEm === agora;

  let travada: PautaEtapaDoEncadeamento | null = null;
  let erros = 0;
  const jaAvisada = passos[0]?.resultado === 'travada';
  for (const p of passos) {
    if (p.resultado === 'travada') continue;
    if (p.resultado !== 'erro' || !igual(p) || (travada && p.etapa !== travada)) break;
    travada = p.etapa;
    erros++;
    if (erros >= ERROS_QUE_TRAVAM) break;
  }
  if (erros < ERROS_QUE_TRAVAM) travada = null;

  const dispensadas: PautaEtapaDoEncadeamento[] = [];
  for (const e of PAUTA_ETAPAS_DO_ENCADEAMENTO) {
    const ultimo = passos.find((p) => p.etapa === e && p.resultado !== 'travada');
    if (ultimo && ultimo.resultado === 'dispensada' && igual(ultimo)) dispensadas.push(e);
  }
  return { travada, jaAvisada: jaAvisada && travada !== null, dispensadas };
}

export function paraATela(p: PassoNoRastro): PautaPassoRegistrado {
  return { etapa: p.etapa, resultado: p.resultado, detalhe: p.detalhe, em: p.em };
}
