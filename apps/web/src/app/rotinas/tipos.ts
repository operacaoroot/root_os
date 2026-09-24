/*
 * O CONTRATO DA TELA DE ROTINAS — a cópia deste lado.
 *
 * O original mora em `apps/api/src/routines/rotina.tipos.ts`. Ele NÃO está em
 * `@mktos/shared` porque o pacote compartilhado não é da fatia que criou as
 * rotinas, e criar a dependência de lá para cá custaria mais do que a
 * duplicação. É a mesma solução que `lib/api.ts` já usa para o código de recusa
 * de conector desligado, e o que amarra os dois lados é o mesmo: um caso de
 * teste em cada suíte.
 *
 * QUANDO MOVER PARA `@mktos/shared`: quando alguma outra tela precisar destes
 * tipos. Uma cópia com dono declarado é barata; duas telas lendo cópias
 * diferentes não.
 */

export type EstadoDaRotina = 'rodando' | 'aprendendo' | 'planejado' | 'pausado';
export type StatusDaExecucao = 'ok' | 'erro' | 'pulada';

export interface RotinaResumo {
  id: string;
  slug: string;
  nome: string;
  tipo: string;
  temExecutor: boolean;
  cron: string;
  tz: string;
  ativo: boolean;
  estado: EstadoDaRotina;
  dispara: boolean;
  origem: string;
  agenteSlug: string | null;
  execucoes: number;
  falhas: number;
  ultimaExecucaoEm: string | null;
  ultimoStatus: string | null;
  proximaExecucaoEm: string | null;
  minutosPorExecucao: number | null;
  /**
   * NÃO USE ESTE CAMPO NA TELA — RF-N-05.
   *
   * Ele é `minutosPorExecucao × Rotina.execucoes`, e `execucoes` conta as
   * passagens que deram ERRO junto com as que deram certo (só `pulada` fica de
   * fora — ver `RotinasService.registrarDesfecho`). Como número de venda, isso
   * é tempo devolvido inflado por retrabalho. Quem mede aqui é `horas.ts`, do
   * log real de passagens; o conserto do campo na API está no relatório da
   * fatia 5.6. O campo continua no contrato porque o contrato é espelho do que
   * a API manda, não uma escolha desta tela.
   */
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
  execucoes: ExecucaoResumo[];
  agendadorAtivo: boolean;
  pautaDesligadaPorVariavel: boolean;
  /**
   * A descoberta do tique volta vazia por causa do isolamento por linha — e
   * portanto NENHUMA rotina dispara, em empresa nenhuma. É o caso em que esta
   * tela ficaria inteiramente verde enquanto nada acontece, e por isso ele vira
   * tarja vermelha em cima de tudo.
   */
  descobertaCega: boolean;
  /**
   * Os tipos com executor inscrito e módulo contratado: os únicos que `POST
   * /rotinas` aceita. Opcional porque web e API sobem em serviços separados, e
   * a API anterior não manda o campo — faltar só esconde o botão.
   */
  tiposDisponiveis?: string[];
  /** O que a última reconciliação não conseguiu fazer. Vazio é o normal. */
  avisos: string[];
  source: { tool: string; generatedAt: string };
}

/** O executor da coleta de quinta (MC5). */
export const TIPO_PAUTA_COLETA = 'pauta.coleta';

/** O executor do encadeamento da transcrição à semana em rascunho (MD1). */
export const TIPO_PAUTA_ENCADEAR = 'pauta.encadear';

/** O executor que conclui e olha a publicação no Instagram (MD6). */
export const TIPO_PAUTA_PUBLICAR = 'pauta.publicar-agendadas';

/** O que `POST /rotinas/:id/rodar` devolve. */
export interface ResultadoDoRodar {
  ok: boolean;
  status: 'ok' | 'erro' | 'pulada';
  resumo: string;
}

/** O corpo de `POST /rotinas` para a coleta de quinta. */
export interface CorpoDaNovaColeta {
  nome: string;
  slug?: string;
  tipo: typeof TIPO_PAUTA_COLETA;
  cron: string;
  tz: string;
  estado: EstadoDaRotina;
  config: { horas: number };
}

/** O corpo de `POST /rotinas` para o encadeamento (MD1): sem `etapas`, todas. */
export interface CorpoDoNovoEncadeamento {
  nome: string;
  slug?: string;
  tipo: typeof TIPO_PAUTA_ENCADEAR;
  cron: string;
  tz: string;
  estado: EstadoDaRotina;
  config: { etapas?: string[] };
}

/** O corpo de `POST /rotinas` para a publicação (MD6): sem configuração. */
export interface CorpoDaNovaPublicacao {
  nome: string;
  slug?: string;
  tipo: typeof TIPO_PAUTA_PUBLICAR;
  cron: string;
  tz: string;
  estado: EstadoDaRotina;
  config: Record<string, never>;
}

/** Os quatro estados, na ordem em que a tela os oferece. */
export const ESTADOS: ReadonlyArray<{ valor: EstadoDaRotina; rotulo: string; explica: string }> = [
  { valor: 'rodando', rotulo: 'rodando', explica: 'em produção — dispara no horário' },
  { valor: 'aprendendo', rotulo: 'aprendendo', explica: 'dispara, e está sob observação' },
  { valor: 'planejado', rotulo: 'planejada', explica: 'existe no papel e NÃO dispara' },
  { valor: 'pausado', rotulo: 'pausada', explica: 'parada por decisão de alguém' },
];

export function tomDoEstado(estado: EstadoDaRotina): 'good' | 'brand' | 'muted' | 'warn' {
  if (estado === 'rodando') return 'good';
  if (estado === 'aprendendo') return 'brand';
  if (estado === 'pausado') return 'warn';
  return 'muted';
}

/** Data e hora no formato brasileiro, ou o travessão quando não há. */
export function quando(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

/** Minutos em "Xh Ymin", que é como uma pessoa lê tempo devolvido. */
export function emHoras(minutos: number): string {
  if (minutos < 60) return `${minutos}min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
