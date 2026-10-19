import { z } from 'zod';
import { situacaoDoPrazo, type SituacaoDoPrazo } from './tarefas-do-dia.js';

/*
 * AS VISTAS SALVAS (rodada do trabalho T3, 19/10/2026).
 *
 * O Rodrigo decidiu: a ordenação é escolha de quem usa, que depois SALVA a
 * configuração de visualização. Minhas tarefas guarda ordenação (qualquer
 * coluna, crescente ou decrescente), agrupamento (nenhum, vencimento no estilo
 * ClickUp, status, cliente, lista), colunas e filtros; o quadro guarda filtros,
 * densidade e visão. Tudo no servidor e por pessoa (`VistaSalva`), com uma
 * vista padrão por tela.
 *
 * A tela, a API e o teste leem a MESMA regra daqui: o schema de cada tela, a
 * ordenação e os grupos de vencimento (no relógio de São Paulo).
 */

export const TELAS_DE_VISTA = ['minhas-tarefas', 'quadro'] as const;
export type TelaDeVista = (typeof TELAS_DE_VISTA)[number];

export const CAMPOS_DE_ORDEM = ['vencimento', 'status', 'cliente', 'lista', 'prioridade', 'criadaEm', 'titulo'] as const;
export type CampoDeOrdem = (typeof CAMPOS_DE_ORDEM)[number];
export const ROTULO_DO_CAMPO_DE_ORDEM: Record<CampoDeOrdem, string> = {
  vencimento: 'Vencimento', status: 'Status', cliente: 'Cliente', lista: 'Lista',
  prioridade: 'Prioridade', criadaEm: 'Criada em', titulo: 'Nome',
};

/*
 * `prazo` é a RÉGUA DE PRAZO do Lucas (versão final, 19/10/2026): Atrasadas · Hoje ·
 * Próximos 7 dias · Mais tarde · Sem prazo · Concluídas, a mesma `situacaoDoPrazo` do
 * Dia a dia. Entrou NO FIM da lista: as vistas salvas antes continuam valendo como estão.
 */
export const AGRUPAMENTOS = ['nenhum', 'vencimento', 'status', 'cliente', 'lista', 'prazo'] as const;
export type Agrupamento = (typeof AGRUPAMENTOS)[number];
export const ROTULO_DO_AGRUPAMENTO: Record<Agrupamento, string> = {
  nenhum: 'Sem grupos', vencimento: 'Vencimento', status: 'Status', cliente: 'Cliente', lista: 'Lista', prazo: 'Régua de prazo',
};

export const COLUNAS_DE_MINHAS_TAREFAS = ['cliente', 'lista', 'status', 'vencimento', 'prioridade', 'responsaveis', 'criadaEm', 'comentarios'] as const;
export type ColunaDeMinhasTarefas = (typeof COLUNAS_DE_MINHAS_TAREFAS)[number];

export const VistaMinhasTarefasSchema = z.object({
  ordenacao: z.object({
    campo: z.enum(CAMPOS_DE_ORDEM),
    direcao: z.enum(['asc', 'desc']),
  }),
  agrupamento: z.enum(AGRUPAMENTOS),
  colunas: z.array(z.enum(COLUNAS_DE_MINHAS_TAREFAS)).max(COLUNAS_DE_MINHAS_TAREFAS.length),
  filtros: z.object({
    lista: z.string().max(80),
    status: z.string().max(120),
    vencimento: z.enum(['', 'vencidas', 'hoje', 'semana']),
    responsavel: z.enum(['eu', 'qualquer']),
    cliente: z.string().max(80),
  }),
}).strict();
export type VistaMinhasTarefas = z.infer<typeof VistaMinhasTarefasSchema>;

export const VISTA_PADRAO_DE_MINHAS_TAREFAS: VistaMinhasTarefas = {
  ordenacao: { campo: 'vencimento', direcao: 'asc' },
  agrupamento: 'nenhum',
  colunas: ['cliente', 'lista', 'status', 'vencimento', 'responsaveis', 'comentarios'],
  filtros: { lista: '', status: '', vencimento: '', responsavel: 'eu', cliente: '' },
};

export const VistaQuadroSchema = z.object({
  densidade: z.enum(['compacto', 'medio', 'cheio']),
  visao: z.enum(['board', 'tabela', 'calendario']),
  /** Agrupamento da Lista (versão final). Opcional: a vista salva antes não tem e vale "sem grupos". */
  agrupamento: z.enum(AGRUPAMENTOS).optional(),
  /** Mostrar ou ocultar as concluídas (versão final). Opcional: sem a chave, mostra. */
  concluidas: z.enum(['mostrar', 'ocultar']).optional(),
  filtros: z.object({
    assignee: z.string().max(120),
    agente: z.string().max(80),
    statusId: z.string().max(80),
    cliente: z.string().max(80),
    escopo: z.enum(['todos', 'meus', 'atrasados']),
    q: z.string().max(120),
  }),
}).strict();
export type VistaQuadro = z.infer<typeof VistaQuadroSchema>;

const NomeDaVista = z.string().trim().min(1, 'Dê um nome à vista.').max(60, 'O nome da vista tem até 60 caracteres.');

export const VistaCriarSchema = z.discriminatedUnion('tela', [
  z.object({ tela: z.literal('minhas-tarefas'), nome: NomeDaVista, padrao: z.boolean().optional(), config: VistaMinhasTarefasSchema }),
  z.object({ tela: z.literal('quadro'), nome: NomeDaVista, padrao: z.boolean().optional(), config: VistaQuadroSchema }),
]);
export type VistaCriarInput = z.infer<typeof VistaCriarSchema>;

/** Renomear, trocar a configuração ou marcar como padrão. A config é conferida pela tela da vista. */
export const VistaAlterarSchema = z.object({
  nome: NomeDaVista.optional(),
  padrao: z.boolean().optional(),
  config: z.unknown().optional(),
}).strict();
export type VistaAlterarInput = z.infer<typeof VistaAlterarSchema>;

export function conferirConfigDaVista(tela: TelaDeVista, config: unknown): VistaMinhasTarefas | VistaQuadro {
  return tela === 'minhas-tarefas' ? VistaMinhasTarefasSchema.parse(config) : VistaQuadroSchema.parse(config);
}

export interface VistaSalvaDto {
  id: string;
  tela: TelaDeVista;
  nome: string;
  padrao: boolean;
  config: VistaMinhasTarefas | VistaQuadro;
  atualizadaEm: string;
}

/* ------------------------------------------------------------------------
 * Ordenar e agrupar (Minhas tarefas). Funções puras: a tela e o teste usam.
 * ---------------------------------------------------------------------- */

export interface TarefaParaVista {
  titulo: string;
  status: string;
  statusTipo?: string;
  lista: string;
  pasta?: string | null;
  cliente: string | null;
  prioridade: string;
  prazo: string | null;
  criadaEm: string;
}

const ORDEM_DA_PRIORIDADE: Record<string, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

function chaveDeOrdem(t: TarefaParaVista, campo: CampoDeOrdem): string | number | null {
  switch (campo) {
    case 'vencimento': return t.prazo ? Date.parse(t.prazo) : null;
    case 'criadaEm': return Date.parse(t.criadaEm);
    case 'prioridade': return ORDEM_DA_PRIORIDADE[t.prioridade] ?? 9;
    case 'cliente': return t.cliente ? t.cliente.toLocaleLowerCase('pt-BR') : null;
    case 'lista': return `${t.pasta ?? ''} / ${t.lista}`.toLocaleLowerCase('pt-BR');
    case 'status': return t.status.toLocaleLowerCase('pt-BR');
    case 'titulo': return t.titulo.toLocaleLowerCase('pt-BR');
  }
}

/** Ordena sem mexer no original. O vazio (sem prazo, sem cliente) vai sempre para o fim, nas duas direções. */
export function ordenarTarefas<T extends TarefaParaVista>(itens: readonly T[], ordem: { campo: CampoDeOrdem; direcao: 'asc' | 'desc' }): T[] {
  const fator = ordem.direcao === 'asc' ? 1 : -1;
  return itens
    .map((t, i) => ({ t, i, k: chaveDeOrdem(t, ordem.campo) }))
    .sort((a, b) => {
      if (a.k === null && b.k === null) return a.i - b.i;
      if (a.k === null) return 1;
      if (b.k === null) return -1;
      const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), 'pt-BR');
      return c !== 0 ? c * fator : a.i - b.i;
    })
    .map((x) => x.t);
}

export const GRUPOS_DE_VENCIMENTO = ['atrasadas', 'hoje', 'amanha', 'semana', 'depois', 'sem-data'] as const;
export type GrupoDeVencimento = (typeof GRUPOS_DE_VENCIMENTO)[number];
export const ROTULO_DO_GRUPO_DE_VENCIMENTO: Record<GrupoDeVencimento, string> = {
  atrasadas: 'Atrasadas', hoje: 'Hoje', amanha: 'Amanhã', semana: 'Esta semana', depois: 'Depois', 'sem-data': 'Sem data',
};

const FUSO = 'America/Sao_Paulo';

/** O dia (AAAA-MM-DD) de um instante no relógio de São Paulo. */
function diaEmSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * O grupo de vencimento no estilo ClickUp: Atrasadas · Hoje · Amanhã · Esta
 * semana (até o domingo desta semana) · Depois · Sem data. A conta é por DIA no
 * relógio de São Paulo, não por instante: vence hoje às 23h é "Hoje".
 */
export function grupoDeVencimento(prazo: string | null, agora: Date): GrupoDeVencimento {
  if (!prazo) return 'sem-data';
  const p = new Date(prazo);
  if (Number.isNaN(p.getTime())) return 'sem-data';
  const hoje = diaEmSaoPaulo(agora);
  const dia = diaEmSaoPaulo(p);
  if (dia < hoje) return 'atrasadas';
  if (dia === hoje) return 'hoje';
  if (dia === somarDias(hoje, 1)) return 'amanha';
  // Domingo desta semana (semana de segunda a domingo).
  const [a, m, d] = hoje.split('-').map(Number);
  const diaDaSemana = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  const domingo = somarDias(hoje, diaDaSemana === 0 ? 0 : 7 - diaDaSemana);
  return dia <= domingo ? 'semana' : 'depois';
}

export const GRUPOS_DA_REGUA_DE_PRAZO: readonly SituacaoDoPrazo[] = ['atrasada', 'hoje', 'proximos_7', 'mais_tarde', 'sem_prazo', 'feita'];
export const ROTULO_DA_REGUA_DE_PRAZO: Record<SituacaoDoPrazo, string> = {
  atrasada: 'Atrasadas', hoje: 'Hoje', proximos_7: 'Próximos 7 dias', mais_tarde: 'Mais tarde', sem_prazo: 'Sem prazo', feita: 'Concluídas',
};

/** A régua de prazo de uma tarefa da vista: o dia do prazo no relógio de São Paulo, concluída pelo tipo do status. */
export function reguaDePrazo(prazo: string | null, statusTipo: string | undefined, agora: Date): SituacaoDoPrazo {
  const p = prazo ? new Date(prazo) : null;
  const dia = p && !Number.isNaN(p.getTime()) ? diaEmSaoPaulo(p) : null;
  return situacaoDoPrazo(dia, diaEmSaoPaulo(agora), statusTipo === 'closed');
}

export interface GrupoDeTarefas<T> { chave: string; rotulo: string; itens: T[] }

/** Agrupa preservando a ordem de dentro de cada grupo. Vencimento segue a ordem fixa; os outros, a alfabética, com o vazio no fim. */
export function agruparTarefas<T extends TarefaParaVista>(itens: readonly T[], agrupamento: Agrupamento, agora: Date): GrupoDeTarefas<T>[] {
  if (agrupamento === 'nenhum') return [{ chave: 'todas', rotulo: 'Todas', itens: [...itens] }];
  if (agrupamento === 'prazo') {
    const por = new Map<SituacaoDoPrazo, T[]>();
    for (const t of itens) {
      const g = reguaDePrazo(t.prazo, t.statusTipo, agora);
      por.set(g, [...(por.get(g) ?? []), t]);
    }
    return GRUPOS_DA_REGUA_DE_PRAZO.filter((g) => por.has(g)).map((g) => ({ chave: g, rotulo: ROTULO_DA_REGUA_DE_PRAZO[g], itens: por.get(g)! }));
  }
  if (agrupamento === 'vencimento') {
    const por = new Map<GrupoDeVencimento, T[]>();
    for (const t of itens) {
      const g = grupoDeVencimento(t.prazo, agora);
      por.set(g, [...(por.get(g) ?? []), t]);
    }
    return GRUPOS_DE_VENCIMENTO.filter((g) => por.has(g)).map((g) => ({ chave: g, rotulo: ROTULO_DO_GRUPO_DE_VENCIMENTO[g], itens: por.get(g)! }));
  }
  const rotuloDe = (t: T): string | null =>
    agrupamento === 'status' ? t.status : agrupamento === 'cliente' ? t.cliente : t.pasta ? `${t.pasta} / ${t.lista}` : t.lista;
  const por = new Map<string, T[]>();
  for (const t of itens) {
    const r = rotuloDe(t) ?? '';
    por.set(r, [...(por.get(r) ?? []), t]);
  }
  const vazio = agrupamento === 'cliente' ? 'Sem cliente' : 'Sem valor';
  return [...por.keys()]
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt-BR')))
    .map((r) => ({ chave: r || '__vazio__', rotulo: r || vazio, itens: por.get(r)! }));
}
