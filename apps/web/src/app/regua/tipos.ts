/*
 * O FORMATO DO QUE A API DA RÉGUA RESPONDE.
 *
 * São tipos, e só tipos: nenhuma regra da escada mora aqui. Nível, gatilho
 * aceso e exigência chegam prontos de `GET /api/policy/regua` e de
 * `POST /api/policy/simular` — o front desenha o que recebeu e não recalcula
 * nada. Uma função `classificar()` nesta pasta seria uma segunda régua, e no
 * dia em que a política mudasse a tela passaria a ensinar o contrário do que a
 * porta faz.
 *
 * O espelho do lado de lá é `apps/api/src/policy/regua.service.ts` e
 * `apps/api/src/policy/simulador.ts`.
 */

/**
 * Os seis degraus, como TIPO — a ordem deles não mora aqui.
 *
 * Havia também uma constante `NIVEIS` com a lista ordenada, e ela saiu: ninguém
 * a usava, e uma escada em ordem dentro do front é a semente da segunda régua.
 * Quem precisa percorrer os níveis percorre `painel.niveis`, que chega do
 * servidor na ordem de `ORDEM_DOS_NIVEIS`.
 */
export type Nivel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

export type SinalId =
  | 'destinatario_novo'
  | 'fora_da_janela'
  | 'volume_atipico'
  | 'fonte_nao_confiavel'
  | 'erro_recente'
  | 'valor_acima_do_limite';

export interface Efeito {
  escreveForaDoOS: boolean;
  produzArtefato: boolean;
  reversibilidade: 'automatica' | 'manual' | 'nenhuma';
  exposicaoExterna: boolean;
  impactoFinanceiro: 'nenhum' | 'obrigacao' | 'movimento';
  sensibilidade: 'publica' | 'interna' | 'confidencial' | 'restrita';
  destruicao: boolean;
  obrigacaoLegal: boolean;
  alcance?: number;
}

export interface Aprovacao {
  exigida: 'nunca' | 'configuravel' | 'sempre';
  vinculo: 'nenhum' | 'conteudo';
  usoUnico: boolean;
  validadeSegundos: number;
  reautenticacao: boolean;
  alcadaMinima: 'operador' | 'responsavel' | 'titular';
}

export interface NivelDaRegua {
  nivel: Nivel;
  nome: string;
  escreve: boolean;
  bloqueado: boolean;
  rastro: string[];
  aprovacao: Aprovacao;
  exigeAprovacao: boolean;
  exigeReautenticacao: boolean;
  exigeMotivo: boolean;
  permitido: boolean;
  motivo: string;
}

export interface SinalDaRegua {
  id: SinalId;
  descricao: string;
  origem: string;
  quando: string;
  /** Procedência externa: no runtime existe marcar, não existe desmarcar. */
  maoUnica: boolean;
}

export interface AgenteDaCapacidade {
  slug: string;
  nome: string;
  estado: string;
  ativo: boolean;
  autonomiaAte: Nivel;
  acimaDaAutonomia: boolean;
}

export interface CapacidadeDaRegua {
  id: string;
  descricao: string;
  nivel: Nivel;
  nivelCalculado: Nivel;
  efeito: Efeito;
  desfazer: string | null;
  ferramenta: string | null;
  rota: string | null;
  validaArgumentos: boolean;
  /** MD7: o modo de aprovação que o catálogo declara. Ausente ou nulo = uso único. */
  aprovacao?: ModoDeAprovacao | null;
  agentes: AgenteDaCapacidade[];
}

/** Espelho do `aprovacao` do catálogo (`@mktos/policy`, MD7). */
export type ModoDeAprovacao =
  | { modo: 'lote'; tetoDeItens: number; validadeMaximaDias: number }
  | { modo: 'sob_lote'; lote: string };

/** Uma capacidade como o agente a declarou, já explicada pelo servidor. */
export interface CapacidadeDeclarada {
  id: string;
  /** Nulo = não está no catálogo desta empresa. */
  nivel: Nivel | null;
  /**
   * O degrau que a régua REALMENTE aplica. Para a capacidade que não está no
   * catálogo, ele é a resposta de `avaliar(null)` — decidida pelo servidor.
   * O front escrevia `?? 'R5'` aqui, o que era uma segunda régua de uma linha.
   */
  nivelEfetivo: Nivel;
  /** A explicação pronta, para o title do rótulo. */
  porque: string;
  acimaDaAutonomia: boolean;
}

/** A fatia do catálogo que um agente declarou poder usar (RF-N-03). */
export interface FatiaDoAgente {
  slug: string;
  nome: string;
  estado: string;
  ativo: boolean;
  autonomiaAte: Nivel;
  capacidades: CapacidadeDeclarada[];
  /** Ids declarados que não existem no catálogo: valem R5 e a porta bloqueia. */
  semClassificacao: string[];
  /**
   * Declaradas por este agente, existentes no produto e escondidas porque a
   * empresa não contratou o módulo. Vem como CONTAGEM: o id não aparece, senão
   * o filtro de módulos vazaria pela porta que ele fecha.
   */
  ocultasPorModulo: number;
}

/**
 * `afrouxa` vem PRONTO do servidor, calculado por `afrouxamentosDoDiff()` — a
 * mesma função que a trava do RF-P-06 usa para exigir responsável e motivo.
 * A tela deduzia isso de `direcao`, e a dedução já estava errada: ela ignorava
 * as travas de execução (desligar a validação de argumentos afrouxa sem mexer
 * no nível) e pintava a linha de verde.
 */
export interface MudancaDeCapacidade {
  id: string;
  de: Nivel | null;
  para: Nivel;
  direcao: 'sobe' | 'desce' | 'igual' | 'nova';
  campos: string[];
  travas: Record<string, { direcao: string; porque: string } | undefined>;
  afrouxa: boolean;
}

export interface DiffDePolitica {
  capacidades: MudancaDeCapacidade[];
  limites: { campo: string; de: unknown; para: unknown; direcao: string; afrouxa: boolean }[];
  secoes: { secao: string; direcao: string; itens: string[]; afrouxa: boolean }[];
  /** Diff velho ou de outro formato: o servidor marcou tudo como afrouxamento. */
  ilegivel?: boolean;
}

export interface VersaoDaPolitica {
  versao: number;
  motivo: string;
  responsavel: { id: string; nome: string; email: string | null } | null;
  ativaDe: string;
  ativaAte: string | null;
  emVigor: boolean;
  criadoEm: string;
  diffDaBase: DiffDePolitica | null;
  diffDaVersaoAnterior: DiffDePolitica | null;
}

export interface Sobrescritas {
  herdaTudo: boolean;
  emVigor: VersaoDaPolitica | null;
  historico: VersaoDaPolitica[];
  idsSobrescritos: string[];
  trava: { minimoDoMotivo: number; regra: string };
}

export interface Limites {
  porExecucao: number;
  porHora: number;
  porDia: number;
  janelaHoraria: [string, string];
  tetoCustoCentavosPorExecucao: number;
}

export interface PainelDaRegua {
  politica: {
    versao: string;
    atualizadoEm: string;
    origem: string;
    descricao: string;
    versaoDaEmpresa: number | null;
  };
  niveis: NivelDaRegua[];
  escalonamento: { regra: string; sinais: SinalDaRegua[] };
  gatilhos: Record<string, unknown>;
  invariantes: string[];
  limites: Limites;
  /** Falso = `fora_da_janela` está aceso em toda ação desta empresa. */
  janelaLegivel: boolean;
  /** O fuso em que a janela é lida no servidor (padrão America/Sao_Paulo). */
  fuso: string;
  retencao: Record<string, unknown>;
  /** Já filtrado pelos módulos que ESTA empresa contratou (RF-T-06). */
  capacidades: CapacidadeDaRegua[];
  /** A mesma relação vista do outro lado: o que cada agente declarou. */
  agentes: FatiaDoAgente[];
  /** Quantas capacidades do produto esta empresa não enxerga, por módulo. */
  capacidadesOcultasPorModulo: number;
  sobrescritas: Sobrescritas;
  /**
   * O efeito de partida do formulário do simulador. Vem do servidor de
   * propósito: se o front escrevesse os valores iniciais à mão, o "efeito em
   * branco" da tela e o do motor divergiriam no primeiro campo novo do esquema.
   */
  efeitoNeutro: Efeito;
}

/* ------------------------------------------------------------ simulador ---- */

export interface PedidoDeSimulacao {
  capabilityId?: string;
  efeito?: Partial<Efeito>;
  descricao?: string;
  sinais?: SinalId[];
  procedenciaExterna?: boolean;
  /** Hora de parede no fuso da política, `HH:MM`. */
  horario?: string;
  /** Um instante ISO; o servidor lê a hora dele no fuso da política. */
  momento?: string;
  /** "E se fosse agora?": o servidor usa o relógio DELE, o mesmo da porta. */
  agora?: true;
  valorCentavos?: number;
  aprovacaoR2Ligada?: boolean;
}

export interface GatilhoAceso {
  campo: string;
  valor: string;
  elevaPara: string;
  texto: string;
}

export interface SinalAceso {
  id: SinalId;
  descricao: string;
  origem: 'calculado' | 'declarado' | 'informado';
  maoUnica: boolean;
  porque: string;
}

export interface Exigencia {
  chave: string;
  titulo: string;
  detalhe: string;
}

export interface ResultadoDaSimulacao {
  acao: {
    origem: 'catalogo' | 'descrita' | 'desconhecida';
    capabilityId: string | null;
    rotulo: string;
    descricao: string;
    efeito: Efeito | null;
  };
  nivel: Nivel;
  nivelBase: Nivel;
  permitido: boolean;
  exigeAprovacao: boolean;
  exigeReautenticacao: boolean;
  exigeMotivo: boolean;
  motivo: string;
  aprovacao: Aprovacao;
  gatilhos: GatilhoAceso[];
  sinais: SinalAceso[];
  exigencias: Exigencia[];
  rastro: string[];
  avisos: string[];
  relogio: { fuso: string; horario: string | null };
  politica: { versao: string; atualizadoEm: string; origem: string };
}
