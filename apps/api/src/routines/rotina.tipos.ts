import { AgentEstado } from '@prisma/client';
import type { ModuloKey } from '@mktos/shared';

/*
 * O VOCABULÁRIO DAS ROTINAS — RF-N-04.
 *
 * Uma ROTINA é trabalho que acontece sozinho dentro de UMA empresa. Três coisas
 * a definem, e nenhuma delas é o código que ela executa:
 *
 *   · QUANDO — `cron` de 5 campos avaliado no fuso `tz` (o avaliador é o de
 *     `src/pauta/cron.ts`, que já existia e continua sendo o único);
 *   · EM QUE PÉ ELA ESTÁ — `estado`, declarado por gente: `rodando` (em
 *     produção), `aprendendo` (roda e está sob observação), `planejado` (existe
 *     no papel e NÃO dispara), `pausado`;
 *   · QUEM FAZ — `tipo`, a chave do executor no registro. O executor é código,
 *     e trocar de executor é mudança de código; a rotina é dado.
 *
 * `ativo` e `estado` NÃO são a mesma pergunta e por isso são duas colunas.
 * `ativo` é o interruptor operacional (e, na rotina espelhada da pauta, ele
 * acompanha `PautaRotina.ativo`, para que pausar na tela de Pauta continue
 * pausando). `estado` é a declaração de maturidade. Dispara quem satisfaz os
 * DOIS — é a conjunção que permite "pausei hoje" sem apagar "isto está em
 * produção".
 */

/** Os estados em que uma rotina DISPARA. Os outros aparecem na tela e não rodam. */
export const ESTADOS_QUE_DISPARAM: readonly AgentEstado[] = [
  AgentEstado.rodando,
  AgentEstado.aprendendo,
] as const;

export function estadoDispara(estado: AgentEstado): boolean {
  return ESTADOS_QUE_DISPARAM.includes(estado);
}

/** A origem de uma rotina — de onde a linha veio. */
export const ORIGEM_PAUTA = 'pauta';
export const ORIGEM_MANUAL = 'manual';

/**
 * O valor de "livre" nas duas colunas de reserva (`reservadoEm`, `reservadoAte`).
 *
 * As colunas são NOT NULL com a época como default (ver o schema): "livre" vira
 * uma comparação só (`< agora`) em vez de `IS NULL OR <`. Quem devolve o
 * arrendamento escreve ESTE valor, e não `null`.
 */
export const LIVRE = new Date(0);

/**
 * Quanto vale um arrendamento de execução. Passado o prazo sem devolução, o
 * tique seguinte RETOMA a ocorrência: é o que separa "a rodada diária morreu no
 * meio e volta em quinze minutos" de "morreu e volta amanhã".
 *
 * Quinze minutos porque a rodada de pauta chama o modelo várias vezes e uma
 * execução honesta pode passar de cinco. Quem está em curso RENOVA o prazo (ver
 * `RotinasService`), então execução mais longa que isto não é retomada por
 * engano — o prazo só vence quando ninguém mais está renovando, que é o mesmo
 * que dizer que o processo morreu.
 */
export const ARRENDAMENTO_MS = 15 * 60_000;

/** De quanto em quanto tempo a execução em curso renova o arrendamento. */
export const RENOVACAO_MS = 5 * 60_000;

/** O executor da rotina da pauta. Ver `executores/pauta.executor.ts`. */
export const TIPO_PAUTA_RODADA = 'pauta.rodada';

/**
 * O executor da coleta de quinta (MC5). Ver `executores/pauta-coleta.executor.ts`.
 *
 * Não tem espelho em `PautaRotina`: nasce pelo `POST /rotinas`, com origem
 * `manual`, e a rodada que gera espera a curadoria humana em vez de ser curada.
 */
export const TIPO_PAUTA_COLETA = 'pauta.coleta';

/**
 * O encadeamento (MD1): da transcrição à semana em rascunho, um passo por
 * episódio por passagem. Ver `executores/pauta-encadear.executor.ts`. A rotina
 * é o interruptor: sem ela criada em /rotinas, nada anda sozinho. O valor é o
 * de `PAUTA_TIPO_DA_ROTINA_DE_ENCADEAMENTO` no shared (a tela usa aquele).
 */
export const TIPO_PAUTA_ENCADEAR = 'pauta.encadear';

/**
 * O publicador (MD6): conclui a publicação do Instagram que a Meta ainda
 * processava e olha as peças aprovadas no horário. Ver
 * `executores/pauta-publicar.executor.ts`. Publicar sozinha exige a nota
 * `pauta.publicacao.automatica` ligada e o lote assinado (MD8): sem os dois, a
 * passagem só registra `pulada`. O valor é o de
 * `PAUTA_TIPO_DA_ROTINA_DE_PUBLICACAO` no shared.
 */
export const TIPO_PAUTA_PUBLICAR = 'pauta.publicar-agendadas';

/** Os tipos que `PAUTA_CRON=off` tira do tique — os da pauta, e só eles. */
export const TIPOS_DA_PAUTA: readonly string[] = [TIPO_PAUTA_RODADA, TIPO_PAUTA_COLETA, TIPO_PAUTA_ENCADEAR, TIPO_PAUTA_PUBLICAR];

/**
 * A variável que cala o tique das rotinas da pauta neste processo, ou `null` —
 * a mesma leitura que o `RotinasScheduler` faz ao subir. Existe para a tela da
 * pauta não dizer que a rotina "dispara" com o agendador desligado.
 */
export function silencioDoTiqueDaPauta(env: NodeJS.ProcessEnv = process.env): string | null {
  if ((env.ROTINAS_CRON ?? 'on') === 'off') return 'ROTINAS_CRON=off';
  if ((env.PAUTA_CRON ?? 'on') === 'off') return 'PAUTA_CRON=off';
  return null;
}

/** O agente do roster que representa a rotina da pauta no organograma. */
export const AGENTE_DA_PAUTA = 'editor-de-pauta';

/**
 * O agente que representa cada tipo no organograma, para a rotina criada pelo
 * `POST /rotinas`. Tipo fora daqui nasce sem agente, que a tela mostra como tal.
 */
export const AGENTE_DO_TIPO: Readonly<Record<string, string>> = {
  [TIPO_PAUTA_RODADA]: AGENTE_DA_PAUTA,
  [TIPO_PAUTA_COLETA]: AGENTE_DA_PAUTA,
  [TIPO_PAUTA_ENCADEAR]: AGENTE_DA_PAUTA,
  [TIPO_PAUTA_PUBLICAR]: AGENTE_DA_PAUTA,
};

/**
 * O módulo que a empresa precisa contratar para ter rotina de cada tipo. O
 * `POST /rotinas` mora na espinha (não passa pelo gate de módulos), então é
 * aqui que a pauta desligada barra a criação e some da lista de tipos. Tipo
 * fora daqui não depende de módulo.
 */
export const MODULO_DO_TIPO: Readonly<Record<string, ModuloKey>> = {
  [TIPO_PAUTA_RODADA]: 'pauta',
  [TIPO_PAUTA_COLETA]: 'pauta',
  [TIPO_PAUTA_ENCADEAR]: 'pauta',
  [TIPO_PAUTA_PUBLICAR]: 'pauta',
};

/** Como a execução foi disparada. */
export type OrigemDaExecucao = 'cron' | 'manual';

/** O desfecho de uma passagem. */
export type StatusDaExecucao = 'ok' | 'erro' | 'pulada';

/**
 * O que o agendador entrega ao executor.
 *
 * `orgId` vem explícito mesmo com o contexto de execução já aberto: o armazém
 * COMPLEMENTA o parâmetro, nunca o substitui (ver `common/contexto-execucao.ts`),
 * e um executor que precise passar a empresa adiante não deve ter de perguntar
 * ao ambiente qual é.
 */
export interface ContextoDaRotina {
  orgId: string;
  rotinaId: string;
  slug: string;
  /** `Rotina.config` — o que o executor precisa saber, já desserializado. */
  config: Record<string, unknown>;
  /** `Rotina.refExterna`: o id da linha de origem, quando há uma. */
  refExterna: string | null;
  origem: OrigemDaExecucao;
  /**
   * A correlação DESTA execução (RNF-09) — uma por passagem, não uma por tique.
   *
   * É a mesma que `RotinasService.executar` grava em `RotinaExecucao` e a mesma
   * que o contexto aninhado carrega enquanto o executor roda, então o que a
   * rodada escrever no RASTRO cai debaixo dela. A correlação do tique fica como
   * `correlacaoPai` e continua ligando as rotinas de uma mesma batida.
   */
  correlationId: string;
  /** O instante do tique — o mesmo para todas as rotinas da mesma batida. */
  agora: Date;
}

/**
 * O que o executor devolve.
 *
 * `pulada` existe para o executor que ACORDA e descobre que não havia o que
 * fazer. Ela não conta como execução nem como falha, e não vira linha de
 * histórico: diário de bordo é registro do que aconteceu, e "nada aconteceu"
 * repetido a cada minuto afogaria o que aconteceu de verdade.
 *
 * E ela também NÃO MEXE EM `ultimaExecucaoEm`. Enquanto a reserva do minuto
 * morava naquele campo, `pulada` deixava lá o carimbo de uma execução que não
 * houve, e a tela da rotina que checa de minuto em minuto — justamente a que
 * `pulada` existe para servir — dizia "última execução há um minuto, zero
 * execuções" para sempre. Hoje a reserva tem coluna própria (`reservadoEm`).
 */
export interface ResultadoDaRotina {
  status: StatusDaExecucao;
  /** Uma linha legível. Nunca conteúdo de cliente — ver o model no schema. */
  resumo: string;
}

export type ExecutorDeRotina = (ctx: ContextoDaRotina) => Promise<ResultadoDaRotina>;

// ---------------------------------------------------------------------------
// O CONTRATO DA TELA
// ---------------------------------------------------------------------------
//
// Estes tipos moram aqui e não em `@mktos/shared` porque o pacote compartilhado
// não é desta fatia (ver o relatório). A tela `/rotinas` declara a cópia dela em
// `apps/web/src/app/rotinas/tipos.ts`, e as duas se encontram no teste de
// contrato — é a mesma solução que `lib/api.ts` já usa para o código de recusa
// de conector desligado.

/**
 * O que o AGENDADOR sabe sobre si mesmo, e que a leitura não descobre sozinha.
 *
 * Viaja num objeto só, e não em três parâmetros soltos, porque os três vêm do
 * mesmo lugar e crescem juntos — três `boolean` posicionais numa chamada é como
 * um deles acaba trocado de lugar sem nada reclamar.
 *
 * NÃO É PARTE DO CONTRATO DA TELA: os campos entram em `RotinasList`, que é o
 * que a tela lê. Este tipo só evita a assinatura posicional.
 */
export interface EstadoDoAgendador {
  /** O tique está de pé neste processo? (`ROTINAS_CRON`) */
  ativo: boolean;
  /** `PAUTA_CRON=off` ainda está no ambiente? */
  pautaDesligada: boolean;
  /** A descoberta volta vazia por policy? Ver `RotinasList.descobertaCega`. */
  descobertaCega: boolean;
}

export interface RotinaResumo {
  id: string;
  slug: string;
  nome: string;
  tipo: string;
  /** O executor deste `tipo` está inscrito? Rotina sem executor NUNCA dispara. */
  temExecutor: boolean;
  cron: string;
  tz: string;
  ativo: boolean;
  estado: AgentEstado;
  /** `true` quando `ativo` e `estado` permitem disparar. */
  dispara: boolean;
  origem: string;
  agenteSlug: string | null;
  execucoes: number;
  falhas: number;
  ultimaExecucaoEm: string | null;
  ultimoStatus: string | null;
  proximaExecucaoEm: string | null;
  /** RF-N-05. `null` = ninguém declarou; a tela mostra "—". */
  minutosPorExecucao: number | null;
  /** Minutos devolvidos = execuções × linha de base. `null` sem linha de base. */
  minutosDevolvidos: number | null;
}

export interface ExecucaoResumo {
  id: string;
  rotinaId: string;
  status: StatusDaExecucao;
  origem: string;
  inicioEm: string;
  fimEm: string | null;
  duracaoMs: number | null;
  resumo: string | null;
  erro: string | null;
  correlationId: string | null;
}

export interface RotinasList {
  items: RotinaResumo[];
  /** As últimas passagens de TODAS as rotinas da empresa, da mais nova. */
  execucoes: ExecucaoResumo[];
  /** O tique está de pé neste processo? */
  agendadorAtivo: boolean;
  /**
   * `PAUTA_CRON=off` ainda está no ambiente? A variável virou apelido de
   * compatibilidade (ver `rotinas.scheduler.ts`) e a tela precisa poder dizer
   * por que a rotina da pauta não dispara.
   */
  pautaDesligadaPorVariavel: boolean;
  /**
   * A DESCOBERTA DO TIQUE ESTÁ CEGA?
   *
   * A pergunta "quais empresas varrer" roda sem empresa na sessão. Sob um papel
   * que não atravessa o isolamento por linha ela volta VAZIA e CALADA — por
   * policy, não por falta de rotina —, e NENHUMA rotina dispara em lugar nenhum.
   * Enquanto isso saía só como um aviso no log do arranque, esta tela ficava
   * inteiramente verde enquanto nada acontecia. É o único campo aqui que fala do
   * processo e não da empresa, e é de propósito: é a pergunta que a tela não
   * podia responder.
   */
  descobertaCega: boolean;
  /**
   * Os tipos com executor inscrito neste processo e com o módulo contratado
   * pela empresa (`MODULO_DO_TIPO`): os únicos que o `POST /rotinas` aceita. A
   * tela só oferece "Nova rotina de coleta" quando `pauta.coleta` está aqui.
   */
  tiposDisponiveis: string[];
  /**
   * O que a última reconciliação desta empresa não conseguiu fazer — colisão de
   * nome, origem que sumiu, espelho que não deu para criar. Vazio é o normal.
   *
   * VOLATILE E POR PROCESSO: vive na memória do serviço, ao lado de quem
   * reconciliou. A cópia durável é o log (`log.error`). Uma tabela de avisos
   * seria um segundo diário de bordo para dizer o que o log já diz, e com
   * retenção própria para decidir.
   */
  avisos: string[];
  source: { tool: string; generatedAt: string };
}
