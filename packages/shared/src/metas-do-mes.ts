import { z } from 'zod';
import { PautaMesSchema } from './schemas.js';

// ---------- Metas do mês: alvo mensal e medição semanal (ROOT-53a, C-12) ----------
// `GoalConfig`/`GoalWeek` são o desafio de 365 dias e ficam como estão. Isto é
// outra coisa: um alvo por indicador e por mês, e uma medição que o sistema
// CALCULA por semana a partir do que já está no banco — nunca digitada.
//
// O alvo é nota da memória por mês (`metas.mes.AAAA-MM`), como a estratégia e a
// performance: um mês é um documento que alguém revisa, e a nota já dá versão,
// histórico e RASTRO. O catálogo de indicadores é código, não dado: indicador
// novo é decisão de produto (G-PED-INDICADOR), e uma lista editável pela tela
// deixaria o alvo apontar para um número que ninguém sabe calcular.

export const METAS_PREFIXO_DA_NOTA = 'metas.mes.';

export function chaveDasMetasDoMes(mes: string): string {
  return `${METAS_PREFIXO_DA_NOTA}${mes}`;
}

/** O mês de uma chave de metas, ou nulo quando a chave não é de uma. */
export function mesDaChaveDasMetas(chave: string): string | null {
  if (!chave.startsWith(METAS_PREFIXO_DA_NOTA)) return null;
  const mes = chave.slice(METAS_PREFIXO_DA_NOTA.length);
  return PautaMesSchema.safeParse(mes).success ? mes : null;
}

/** Em que fuso a semana e o mês são contados. É o mesmo da agenda da Pauta. */
export const METAS_FUSO = 'America/Sao_Paulo';

export const METAS_TETO_DE_METAS_POR_MES = 30;
export const METAS_TETO_DA_OBSERVACAO = 500;
/** O corpo da nota passa disso, ele nem é lido: a nota é editável por `/memoria` e o corpo vem de fora. */
export const METAS_TAMANHO_MAXIMO_DA_NOTA = 64_000;

// ---------- O catálogo ----------

export const METAS_FONTES = ['leads', 'bio', 'pauta', 'instagram'] as const;
export type MetasFonte = (typeof METAS_FONTES)[number];

export interface IndicadorDeMeta {
  chave: string;
  rotulo: string;
  unidade: string;
  fonte: MetasFonte;
  /** Como o número é calculado, em uma frase. A tela mostra isto ao lado do número. */
  calculo: string;
  /** Todas as permissões da fonte (R1: a pessoa precisa de todas). Sem elas, "sem acesso". */
  permissoes: readonly string[];
  /** `mensal` só existe como foto do mês; a semana sai dos posts publicados nela. */
  periodicidade: 'semanal' | 'mensal';
  /** A meta precisa apontar uma campanha da empresa. */
  exigeCampanha: boolean;
}

/*
 * SÓ O QUE TEM FONTE NO BANCO HOJE (C-12). Indicador e alvo reais são a decisão
 * G-PED-INDICADOR (Pedro, com Lucas na parte de Marketing): este catálogo é o
 * que dá para calcular, não a lista do que importa.
 */
export const METAS_CATALOGO: readonly IndicadorDeMeta[] = [
  {
    chave: 'leads.novos',
    rotulo: 'Leads novos',
    unidade: 'leads',
    fonte: 'leads',
    calculo: 'Leads que entraram no período (data de entrada), sem as linhas de demonstração.',
    permissoes: ['leads.ver'],
    periodicidade: 'semanal',
    exigeCampanha: false,
  },
  {
    chave: 'leads.por_campanha',
    rotulo: 'Leads por campanha',
    unidade: 'leads',
    fonte: 'leads',
    calculo: 'Leads do período ligados à campanha escolhida, sem as linhas de demonstração.',
    permissoes: ['leads.ver'],
    periodicidade: 'semanal',
    exigeCampanha: true,
  },
  {
    chave: 'bio.cliques',
    rotulo: 'Cliques na bio',
    unidade: 'cliques',
    fonte: 'bio',
    calculo: 'Eventos de clique em link ou WhatsApp da página de links, por data do clique.',
    permissoes: ['bio.ver'],
    periodicidade: 'semanal',
    exigeCampanha: false,
  },
  {
    chave: 'pauta.publicadas',
    rotulo: 'Peças publicadas',
    unidade: 'peças',
    fonte: 'pauta',
    calculo: 'Peças da Pauta com status publicada, por data de publicação.',
    permissoes: ['pauta.ver'],
    periodicidade: 'semanal',
    exigeCampanha: false,
  },
  {
    chave: 'instagram.visualizacoes',
    rotulo: 'Visualizações no Instagram',
    unidade: 'visualizações',
    fonte: 'instagram',
    calculo:
      'Soma das visualizações dos posts publicados no período, lida da foto mensal de performance. Sem a foto do mês a fonte fica bloqueada.',
    permissoes: ['pauta.ver'],
    periodicidade: 'mensal',
    exigeCampanha: false,
  },
] as const;

export function indicadorDeMeta(chave: string): IndicadorDeMeta | null {
  return METAS_CATALOGO.find((i) => i.chave === chave) ?? null;
}

// ---------- A origem "veio da estratégia" ----------
// O texto das metas da estratégia (`pauta.estrategia.AAAA-MM`, seção "Metas") é
// uma lista sem id por item. A origem aponta a LINHA por três coisas: a nota, a
// versão em que a linha estava e o hash do texto dela. Sem o hash, "item 2" da
// versão 3 deixaria de ser o item 2 na versão 4 e a origem passaria a apontar
// outra meta sem ninguém ver. O texto nunca vira número sozinho: alguém escolhe
// indicador e alvo, e a meta só guarda de onde a ideia veio.

const ORIGEM_DA_ESTRATEGIA_RE = /^estrategia:([A-Za-z0-9_-]{8,64}):([0-9a-f]{12})@v([1-9]\d{0,5})$/;

export interface OrigemDaEstrategia {
  notaId: string;
  hash: string;
  versao: number;
}

/** O `itemId` da origem: a nota e o hash da linha. */
export function itemIdDaEstrategia(notaId: string, hash: string): string {
  return `${notaId}:${hash}`;
}

export function origemDaEstrategia(o: OrigemDaEstrategia): string {
  return `estrategia:${itemIdDaEstrategia(o.notaId, o.hash)}@v${o.versao}`;
}

export function lerOrigemDaEstrategia(origem: string): OrigemDaEstrategia | null {
  const m = ORIGEM_DA_ESTRATEGIA_RE.exec(origem);
  return m ? { notaId: m[1], hash: m[2], versao: Number(m[3]) } : null;
}

// ---------- O que entra e o que sai ----------

export const MetaDoMesEntradaSchema = z.object({
  indicador: z
    .string()
    .trim()
    .min(1, 'Escolha o indicador.')
    .refine((i) => indicadorDeMeta(i) !== null, 'Indicador desconhecido.'),
  alvo: z
    .number({ invalid_type_error: 'O alvo é um número.' })
    .finite('O alvo é um número.')
    .positive('O alvo precisa ser maior que zero.')
    .max(1_000_000_000, 'O alvo passa do limite.'),
  campanhaId: z.string().trim().min(1).max(64).nullish(),
  origem: z
    .string()
    .trim()
    .max(200)
    .refine((o) => lerOrigemDaEstrategia(o) !== null, 'A origem só pode ser uma linha da estratégia do mês.')
    .nullish(),
  observacao: z.string().trim().max(METAS_TETO_DA_OBSERVACAO).nullish(),
});
export type MetaDoMesEntrada = z.infer<typeof MetaDoMesEntradaSchema>;

/** `PUT /goals/month/:mes`: a revisão do mês. A lista inteira substitui a anterior. */
export const MetasDoMesSalvarSchema = z
  .object({
    metas: z.array(MetaDoMesEntradaSchema).max(METAS_TETO_DE_METAS_POR_MES),
    /** A versão que a tela leu; diferente da atual, a revisão é recusada (409). */
    versao: z.number().int().positive().optional(),
    motivo: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    const vistos = new Set<string>();
    v.metas.forEach((m, i) => {
      const ind = indicadorDeMeta(m.indicador);
      if (!ind) return;
      if (ind.exigeCampanha && !m.campanhaId) {
        ctx.addIssue({ code: 'custom', path: ['metas', i, 'campanhaId'], message: 'Este indicador pede uma campanha.' });
      }
      if (!ind.exigeCampanha && m.campanhaId) {
        ctx.addIssue({ code: 'custom', path: ['metas', i, 'campanhaId'], message: 'Este indicador não usa campanha.' });
      }
      const chave = `${m.indicador}|${m.campanhaId ?? ''}`;
      if (vistos.has(chave)) {
        ctx.addIssue({ code: 'custom', path: ['metas', i, 'indicador'], message: 'Indicador repetido neste mês.' });
      }
      vistos.add(chave);
    });
  });
export type MetasDoMesSalvarInput = z.infer<typeof MetasDoMesSalvarSchema>;

/** Como a meta fica gravada na nota. A unidade vem do catálogo, nunca da tela. */
export interface MetaDoMes {
  indicador: string;
  alvo: number;
  unidade: string;
  campanhaId: string | null;
  origem: string | null;
  observacao: string | null;
}

// ---------- A medição ----------

/**
 * `sem_dado`: a fonte não tem registro que cubra o período. NUNCA é zero.
 * `parcial`: parte das semanas já decorridas está coberta e parte não.
 * `com_dado`: todas as semanas decorridas estão cobertas (zero aqui é zero de verdade).
 * `bloqueada`: a fonte existe mas não pode ser lida agora; `motivo` diz por quê.
 * `sem_acesso`: quem pediu não tem a permissão da fonte; nenhum número sai.
 */
export const METAS_ESTADOS = ['sem_dado', 'parcial', 'com_dado', 'bloqueada', 'sem_acesso'] as const;
export type MetasEstado = (typeof METAS_ESTADOS)[number];

export const METAS_ESTADO_ROTULO: Record<MetasEstado, string> = {
  sem_dado: 'sem dado',
  parcial: 'dado parcial',
  com_dado: 'com dado',
  bloqueada: 'fonte bloqueada',
  sem_acesso: 'sem acesso',
};

export type MetasEstadoDaSemana = 'sem_dado' | 'com_dado' | 'futura';

export interface MetasSemana {
  /** Semana ISO, `AAAA-Www`. */
  semana: string;
  segunda: string;
  domingo: string;
  /** O recorte da semana que cai no mês, em dias civis `AAAA-MM-DD`. */
  primeiroDia: string;
  ultimoDia: string;
  diasNoMes: number;
}

export interface MetasMedidaDaSemana extends MetasSemana {
  estado: MetasEstadoDaSemana;
  valor: number | null;
}

export interface MetaMedida {
  indicador: string;
  rotulo: string;
  unidade: string;
  calculo: string;
  alvo: number;
  campanhaId: string | null;
  campanhaNome: string | null;
  origem: string | null;
  observacao: string | null;
  estado: MetasEstado;
  /** Por que a fonte está bloqueada, ou por que está sem dado. */
  motivo: string | null;
  /** O número do mês: a soma das semanas que têm dado. Nulo sem dado, bloqueada ou sem acesso. */
  valor: number | null;
  /** `valor` sobre o alvo, em %, uma casa. Nulo quando não há valor. */
  pct: number | null;
  semanas: MetasMedidaDaSemana[];
}

export interface MetasLinhaDaEstrategia {
  /** `<notaId>:<hash da linha>`: é o `itemId` da origem. */
  itemId: string;
  texto: string;
  /** Origem pronta para a meta (`estrategia:<itemId>@v<versao>`). */
  origem: string;
  /** Já existe meta neste mês apontando para esta linha. */
  jaViraMeta: boolean;
}

export interface MetasDoMesPainel {
  mes: string;
  /** Nulo quando o mês ainda não tem nota: "sem meta". */
  nota: { id: string; versao: number; atualizadoEm: string } | null;
  metas: MetaMedida[];
  semanas: MetasSemana[];
  avisos: string[];
  /** O catálogo, com `permitido` conforme as permissões de quem pediu. */
  catalogo: Array<IndicadorDeMeta & { permitido: boolean }>;
  /** As metas escritas na estratégia do mês, quando quem pediu pode ler a Pauta. */
  estrategia: { notaId: string; versao: number; linhas: MetasLinhaDaEstrategia[] } | null;
  meses: string[];
  geradoEm: string;
}
