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

// 20/10/2026 (rodada da interface U2): a Implantação e o Funil vivo ganham vistas
// próprias. A Implantação guarda a mesma forma do quadro (é o TrabalhoView); o
// Funil guarda a visão (quadro ou lista) e os filtros dele. Entram no FIM da lista.
export const TELAS_DE_VISTA = ['minhas-tarefas', 'quadro', 'implantacao', 'funil'] as const;
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
/*
 * Layout 26/10 (Lucas): `datas` é o "POR PRAZO" no estilo do ClickUp, o padrão das listas
 * de tarefa: Atrasadas · Hoje · Amanhã · os dias que sobram da semana pelo nome · Próxima
 * semana · Mais tarde · Sem prazo · Concluídas (`grupoPorPrazo`). Também entrou no fim.
 */
export const AGRUPAMENTOS = ['nenhum', 'vencimento', 'status', 'cliente', 'lista', 'prazo', 'datas', 'responsavel'] as const;
export type Agrupamento = (typeof AGRUPAMENTOS)[number];
export const ROTULO_DO_AGRUPAMENTO: Record<Agrupamento, string> = {
  nenhum: 'Sem grupos', vencimento: 'Vencimento', status: 'Status', cliente: 'Cliente', lista: 'Lista', prazo: 'Régua de prazo', datas: 'Por prazo', responsavel: 'Por responsável',
};
/** Layout 26/10: o agrupamento de saída das listas de tarefa (o Trabalho e Minhas tarefas sem vista salva). */
export const AGRUPAMENTO_PADRAO_DAS_TAREFAS: Agrupamento = 'datas';

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
    // Layout 26/10 (Lucas): também uma pessoa da equipe pelo id da conta; as vistas antigas ("eu", "qualquer") seguem valendo.
    responsavel: z.union([z.enum(['eu', 'qualquer']), z.string().uuid()]),
    cliente: z.string().max(80),
  }),
}).strict();
export type VistaMinhasTarefas = z.infer<typeof VistaMinhasTarefasSchema>;

export const VISTA_PADRAO_DE_MINHAS_TAREFAS: VistaMinhasTarefas = {
  ordenacao: { campo: 'vencimento', direcao: 'asc' },
  // Layout 26/10 (Lucas): por prazo, no estilo do ClickUp; a vista salva guarda o dela.
  agrupamento: 'datas',
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
  /**
   * Ocultar as colunas sem cartão no quadro (rodada de produção 1, P4, 21/10/2026),
   * o `?vazios=ocultar`. Opcional: sem a chave, mostra todas.
   */
  vazios: z.enum(['mostrar', 'ocultar']).optional(),
  filtros: z.object({
    assignee: z.string().max(120),
    agente: z.string().max(80),
    statusId: z.string().max(80),
    cliente: z.string().max(80),
    escopo: z.enum(['todos', 'meus', 'atrasados']),
    q: z.string().max(120),
    /*
     * Os filtros que foram para o painel "Filtros" (rodada da interface U2, 20/10/2026).
     * Todos opcionais: a vista salva antes deles continua valendo como está, e a tela
     * só grava a chave quando o filtro está ligado.
     */
    /** O responsável pela conta (`assigneeUserId`) ou `sem-vinculo`. */
    pessoa: z.string().max(120).optional(),
    /** O recorte da régua de prazo (`?prazo=`). */
    prazo: z.string().max(20).optional(),
    /** A etiqueta (`?tagId=`). */
    etiqueta: z.string().max(80).optional(),
    /** A opção de um campo da lista (`?opcao=`). */
    opcao: z.string().max(80).optional(),
    /** Incluir as arquivadas (`?arquivadas=1`). */
    arquivadas: z.boolean().optional(),
  }),
}).strict();
export type VistaQuadro = z.infer<typeof VistaQuadroSchema>;

/**
 * A vista do Funil vivo (rodada da interface U2/U4, 20/10/2026): a visão e os
 * filtros do painel "Filtros", os mesmos que o endereço carrega. Cada filtro é
 * texto curto; vazio = sem filtro. A forma é estrita: chave nova entra aqui.
 */
export const VistaFunilSchema = z.object({
  visao: z.enum(['quadro', 'lista']),
  filtros: z.object({
    dono: z.string().max(120),
    produto: z.string().max(80),
    perfil: z.string().max(40),
    etapa: z.string().max(40),
    parado: z.string().max(20),
    decisao: z.string().max(20),
    q: z.string().max(120),
  }),
  /**
   * Produção 22B (I5): as colunas visíveis do formato Lista, na ordem da tela
   * (`?colunas=`), e a ordenação (`?ordem=coluna:asc|desc`). Opcionais: a vista
   * salva antes delas continua valendo, e a tela só grava quando fogem do padrão.
   */
  colunas: z.array(z.string().max(30)).max(20).optional(),
  ordem: z.string().max(40).optional(),
}).strict();
export type VistaFunil = z.infer<typeof VistaFunilSchema>;

export const VISTA_PADRAO_DO_FUNIL: VistaFunil = {
  visao: 'quadro',
  filtros: { dono: '', produto: '', perfil: '', etapa: '', parado: '', decisao: '', q: '' },
};

const NomeDaVista = z.string().trim().min(1, 'Dê um nome à vista.').max(60, 'O nome da vista tem até 60 caracteres.');

export const VistaCriarSchema = z.discriminatedUnion('tela', [
  z.object({ tela: z.literal('minhas-tarefas'), nome: NomeDaVista, padrao: z.boolean().optional(), config: VistaMinhasTarefasSchema }),
  z.object({ tela: z.literal('quadro'), nome: NomeDaVista, padrao: z.boolean().optional(), config: VistaQuadroSchema }),
  z.object({ tela: z.literal('implantacao'), nome: NomeDaVista, padrao: z.boolean().optional(), config: VistaQuadroSchema }),
  z.object({ tela: z.literal('funil'), nome: NomeDaVista, padrao: z.boolean().optional(), config: VistaFunilSchema }),
]);
export type VistaCriarInput = z.infer<typeof VistaCriarSchema>;

/** Renomear, trocar a configuração ou marcar como padrão. A config é conferida pela tela da vista. */
export const VistaAlterarSchema = z.object({
  nome: NomeDaVista.optional(),
  padrao: z.boolean().optional(),
  config: z.unknown().optional(),
}).strict();
export type VistaAlterarInput = z.infer<typeof VistaAlterarSchema>;

export function conferirConfigDaVista(tela: TelaDeVista, config: unknown): VistaMinhasTarefas | VistaQuadro | VistaFunil {
  if (tela === 'minhas-tarefas') return VistaMinhasTarefasSchema.parse(config);
  if (tela === 'funil') return VistaFunilSchema.parse(config);
  return VistaQuadroSchema.parse(config);
}

export interface VistaSalvaDto {
  id: string;
  tela: TelaDeVista;
  nome: string;
  padrao: boolean;
  config: VistaMinhasTarefas | VistaQuadro | VistaFunil;
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
  /** Layout 26/10: o nome do responsável principal (o "Por responsável"); ausente = sem. */
  responsavel?: string | null;
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

const NOMES_DOS_DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Um grupo do "Por prazo": a chave (estável de um dia para o outro), o rótulo e o dia que a tarefa nova nele recebe. */
export interface GrupoPorPrazo { chave: string; rotulo: string; dia: string | null; ordem: number }

/**
 * Layout 26/10 (Lucas): OS GRUPOS "POR PRAZO", no estilo do ClickUp, por DIA no relógio de
 * São Paulo (semana de segunda a domingo): Atrasadas · Hoje · Amanhã · cada dia que sobra
 * desta semana pelo nome ("quinta-feira") · Próxima semana · Mais tarde · Sem prazo, e as
 * concluídas num grupo à parte no fim. `dia` é o prazo da tarefa criada no grupo: o próprio
 * dia; a segunda da próxima semana; a segunda da outra; nenhum em Sem prazo e Concluídas.
 */
export function gruposPorPrazoDaSemana(agora: Date): GrupoPorPrazo[] {
  const hoje = diaEmSaoPaulo(agora);
  const [a, m, d] = hoje.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  const ateDomingo = dow === 0 ? 0 : 7 - dow;
  const proximaSegunda = somarDias(hoje, ateDomingo + 1);
  const grupos: GrupoPorPrazo[] = [
    // Atrasadas e Concluídas não recebem tarefa nova (`GRUPOS_POR_PRAZO_SEM_NOVA`).
    { chave: 'atrasadas', rotulo: 'Atrasadas', dia: null, ordem: 0 },
    { chave: 'hoje', rotulo: 'Hoje', dia: hoje, ordem: 1 },
  ];
  if (ateDomingo >= 1) grupos.push({ chave: 'amanha', rotulo: 'Amanhã', dia: somarDias(hoje, 1), ordem: 2 });
  for (let n = 2; n <= ateDomingo; n++) {
    const dia = somarDias(hoje, n);
    const [ya, ym, yd] = dia.split('-').map(Number);
    const semana = new Date(Date.UTC(ya, ym - 1, yd)).getUTCDay();
    grupos.push({ chave: `semana-${semana}`, rotulo: NOMES_DOS_DIAS[semana], dia, ordem: 2 + n });
  }
  grupos.push(
    { chave: 'proxima-semana', rotulo: 'Próxima semana', dia: proximaSegunda, ordem: 20 },
    { chave: 'mais-tarde', rotulo: 'Mais tarde', dia: somarDias(proximaSegunda, 7), ordem: 21 },
    { chave: 'sem-prazo', rotulo: 'Sem prazo', dia: null, ordem: 22 },
    { chave: 'concluidas', rotulo: 'Concluídas', dia: null, ordem: 23 },
  );
  return grupos;
}

/** Os grupos "Por prazo" sem a linha "+ Adicionar tarefa": criar atrasada ou já concluída não faz sentido. */
export const GRUPOS_POR_PRAZO_SEM_NOVA: readonly string[] = ['atrasadas', 'concluidas'];

/** O grupo "Por prazo" de uma tarefa (a chave de `gruposPorPrazoDaSemana`). Concluída vai para Concluídas. */
export function grupoPorPrazo(prazo: string | null, statusTipo: string | undefined, agora: Date): string {
  if (statusTipo === 'closed') return 'concluidas';
  const p = prazo ? new Date(prazo) : null;
  if (!p || Number.isNaN(p.getTime())) return 'sem-prazo';
  const hoje = diaEmSaoPaulo(agora);
  const dia = diaEmSaoPaulo(p);
  if (dia < hoje) return 'atrasadas';
  if (dia === hoje) return 'hoje';
  const [a, m, d] = hoje.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  const domingo = somarDias(hoje, dow === 0 ? 0 : 7 - dow);
  if (dia === somarDias(hoje, 1) && dia <= domingo) return 'amanha';
  if (dia <= domingo) {
    const [ya, ym, yd] = dia.split('-').map(Number);
    return `semana-${new Date(Date.UTC(ya, ym - 1, yd)).getUTCDay()}`;
  }
  return dia <= somarDias(domingo, 7) ? 'proxima-semana' : 'mais-tarde';
}

export interface GrupoDeTarefas<T> {
  chave: string; rotulo: string; itens: T[];
  /** Layout 26/10 ("Por prazo"): o dia que a tarefa criada no grupo recebe (nulo = sem prazo). */
  dia?: string | null;
}

/** Agrupa preservando a ordem de dentro de cada grupo. Vencimento segue a ordem fixa; os outros, a alfabética, com o vazio no fim. */
export function agruparTarefas<T extends TarefaParaVista>(itens: readonly T[], agrupamento: Agrupamento, agora: Date): GrupoDeTarefas<T>[] {
  if (agrupamento === 'nenhum') return [{ chave: 'todas', rotulo: 'Todas', itens: [...itens] }];
  // Layout 26/10: "Por prazo". Grupo vazio some, menos Hoje (sempre há onde criar a de hoje).
  if (agrupamento === 'datas') {
    const por = new Map<string, T[]>();
    for (const t of itens) {
      const g = grupoPorPrazo(t.prazo, t.statusTipo, agora);
      por.set(g, [...(por.get(g) ?? []), t]);
    }
    return gruposPorPrazoDaSemana(agora)
      .filter((g) => por.has(g.chave) || g.chave === 'hoje')
      .map((g) => ({ chave: g.chave, rotulo: g.rotulo, dia: g.dia, itens: por.get(g.chave) ?? [] }));
  }
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
    agrupamento === 'status' ? t.status : agrupamento === 'cliente' ? t.cliente : agrupamento === 'responsavel' ? t.responsavel ?? null : t.pasta ? `${t.pasta} / ${t.lista}` : t.lista;
  const por = new Map<string, T[]>();
  for (const t of itens) {
    const r = rotuloDe(t) ?? '';
    por.set(r, [...(por.get(r) ?? []), t]);
  }
  const vazio = agrupamento === 'cliente' ? 'Sem cliente' : agrupamento === 'responsavel' ? 'Sem responsável' : 'Sem valor';
  return [...por.keys()]
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt-BR')))
    .map((r) => ({ chave: r || '__vazio__', rotulo: r || vazio, itens: por.get(r)! }));
}
