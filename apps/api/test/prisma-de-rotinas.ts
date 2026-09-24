import { AgentEstado } from '@prisma/client';
import { MODULOS } from '@mktos/shared';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * UM PRISMA DE MENTIRA PARA O AGENDADOR DE ROTINAS.
 *
 * Mora aqui, e não dentro de um `.test.ts`, porque DUAS suítes precisam dele —
 * `rotinas.test.ts` e `teto-custo-ia.test.ts`, que continua cobrando que a
 * chamada de modelo que NÃO nasce de requisição aconteça dentro do contexto da
 * empresa. Duas cópias de um dublê é a forma mais barata de as duas suítes
 * passarem a testar coisas diferentes achando que testam a mesma.
 *
 * POR QUE DUBLÊ E NÃO BANCO. O que estas suítes provam é ORDEM e CONTEXTO: quem
 * é chamado, em que empresa, com qual origem, e o que vira linha de histórico.
 * Um banco de verdade responderia as mesmas perguntas mais devagar e ainda
 * exigiria `TEST_DATABASE_URL` — e o caso do teto de custo, que é o mais
 * importante dos dois, roda hoje sem banco nenhum.
 *
 * O ISOLAMENTO POR LINHA NÃO É TESTADO AQUI, e não pode ser: policy é coisa do
 * PostgreSQL. Quem prova isolamento é `tenant-isolation.test.ts`, contra banco,
 * com o papel restrito. O que ESTE dublê prova é que o código ABRE o contexto —
 * que é a metade que depende de nós.
 */

export interface RotinaFalsa {
  id: string;
  orgId: string;
  slug: string;
  nome: string;
  tipo: string;
  config: Record<string, unknown>;
  cron: string;
  tz: string;
  ativo: boolean;
  estado: AgentEstado;
  origem: string;
  refExterna: string | null;
  agenteSlug: string | null;
  execucoes: number;
  falhas: number;
  ultimaExecucaoEm: Date | null;
  ultimoStatus: string | null;
  proximaExecucaoEm: Date | null;
  minutosPorExecucao: number;
  baselinePorId: string | null;
  baselineEm: Date | null;
  /**
   * A RESERVA COM PRAZO — `20260911200000_reserva_de_rotina_com_prazo`.
   *
   * `reservadoEm` é o minuto que o tique já tomou; `reservadoAte` é o prazo do
   * arrendamento. No banco as duas são NOT NULL com a época (`1970-01-01`) como
   * DEFAULT, e "livre" é `< agora` em vez de `IS NULL OR <` — ver o cabeçalho da
   * migration. O dublê precisa saber disso: linha nascida com `undefined` faz o
   * `UPDATE` condicional não casar nada, e a suíte inteira passa a provar que
   * nada dispara, verde.
   */
  reservadoEm: Date;
  reservadoAte: Date;
  criadaEm: Date;
  atualizadaEm: Date;
}

/** O valor de "livre" das colunas de reserva: a época, como no banco. */
export const RESERVA_LIVRE = () => new Date(0);

export interface PautaRotinaFalsa {
  id: string;
  orgId: string;
  slug: string;
  nome: string;
  cron: string;
  tz: string;
  ativo: boolean;
  config: Record<string, unknown>;
  ultimoRun: Date | null;
  ultimoStatus: string | null;
  proximoRun: Date | null;
  criadaEm: Date;
}

export interface ExecucaoFalsa {
  id: string;
  orgId: string;
  rotinaId: string;
  status: string;
  origem: string;
  inicioEm: Date;
  fimEm: Date | null;
  duracaoMs: number | null;
  resumo: string | null;
  erro: string | null;
  correlationId: string | null;
}

export interface EstadoDoBancoFalso {
  rotinas: RotinaFalsa[];
  pautaRotinas: PautaRotinaFalsa[];
  execucoes: ExecucaoFalsa[];
  /** `Org.modulos` por empresa. Empresa fora daqui contrata todos. */
  modulos?: Record<string, string[]>;
}

export function rotinaFalsa(p: Partial<RotinaFalsa> & { id: string; orgId: string }): RotinaFalsa {
  return {
    slug: p.slug ?? p.id,
    nome: p.nome ?? p.id,
    tipo: 'pauta.rodada',
    config: {},
    cron: '* * * * *',
    tz: 'America/Sao_Paulo',
    ativo: true,
    estado: AgentEstado.rodando,
    origem: 'manual',
    refExterna: null,
    agenteSlug: null,
    execucoes: 0,
    falhas: 0,
    ultimaExecucaoEm: null,
    ultimoStatus: null,
    proximaExecucaoEm: null,
    minutosPorExecucao: 0,
    baselinePorId: null,
    baselineEm: null,
    reservadoEm: RESERVA_LIVRE(),
    reservadoAte: RESERVA_LIVRE(),
    criadaEm: new Date('2026-09-01T00:00:00Z'),
    atualizadaEm: new Date('2026-09-01T00:00:00Z'),
    ...p,
  };
}

export function pautaRotinaFalsa(
  p: Partial<PautaRotinaFalsa> & { id: string; orgId: string },
): PautaRotinaFalsa {
  return {
    slug: p.slug ?? p.id,
    nome: p.nome ?? p.id,
    cron: '* * * * *',
    tz: 'America/Sao_Paulo',
    ativo: true,
    config: {},
    ultimoRun: null,
    ultimoStatus: null,
    proximoRun: null,
    criadaEm: new Date('2026-09-01T00:00:00Z'),
    ...p,
  };
}

/** `{ increment: n }` do Prisma, aplicado à mão. */
function aplicar<T extends Record<string, unknown>>(alvo: T, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in (v as Record<string, unknown>)) {
      (alvo as Record<string, unknown>)[k] =
        Number((alvo as Record<string, unknown>)[k] ?? 0) +
        Number((v as { increment: number }).increment);
      continue;
    }
    (alvo as Record<string, unknown>)[k] = v;
  }
}

/** Só os operadores que o código desta fatia usa: igualdade, `in` e `lt`. */
function casa(linha: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [campo, cond] of Object.entries(where)) {
    if (campo === 'OR') {
      const alternativas = cond as Record<string, unknown>[];
      if (!alternativas.some((a) => casa(linha, a))) return false;
      continue;
    }
    const valor = linha[campo];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('in' in c && !(c.in as unknown[]).includes(valor)) return false;
      if ('lt' in c) {
        if (valor == null) return false;
        if (!((valor as Date).getTime() < (c.lt as Date).getTime())) return false;
      }
      if ('not' in c && valor === c.not) return false;
      continue;
    }
    if (valor !== cond) return false;
  }
  return true;
}

function distintos<T extends Record<string, unknown>>(linhas: T[], por: string): T[] {
  const vistos = new Set<unknown>();
  const saida: T[] = [];
  for (const l of linhas) {
    if (vistos.has(l[por])) continue;
    vistos.add(l[por]);
    saida.push(l);
  }
  return saida;
}

function ordenar<T extends Record<string, unknown>>(linhas: T[], orderBy: unknown): T[] {
  const regras = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<
    string,
    'asc' | 'desc'
  >[];
  const copia = [...linhas];
  for (const regra of [...regras].reverse()) {
    const [campo, dir] = Object.entries(regra)[0];
    copia.sort((a, b) => {
      const x = a[campo] as never;
      const y = b[campo] as never;
      const cmp = x === y ? 0 : x == null ? -1 : y == null ? 1 : x < y ? -1 : 1;
      return dir === 'desc' ? -cmp : cmp;
    });
  }
  return copia;
}

let sequencia = 0;

/** O erro que o PostgreSQL devolve quando um índice único recusa a linha. */
function p2002(target: string[]): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
}

/*
 * OS DOIS ÍNDICES ÚNICOS DE `Rotina`, aplicados à mão.
 *
 * `(orgId, slug)` e `(orgId, origem, refExterna)`. O segundo impede espelho
 * duplicado da mesma rotina de pauta; o PRIMEIRO é o que derrubou a fatia na
 * revisão — apagar e recriar a mesma rotina na tela de Pauta fazia a criação
 * seguinte colidir com a órfã, o erro saía como aviso no log, e a rotina nova
 * nunca mais disparava.
 *
 * Mora no dublê, e não em cada suíte, porque dublê que aceita o que o banco
 * recusa testa um sistema que não existe.
 */
function conferirUnicos(
  linhas: Record<string, unknown>[],
  d: Record<string, unknown>,
  exceto?: Record<string, unknown>,
): void {
  if (linhas.some((r) => r !== exceto && r.orgId === d.orgId && r.slug === d.slug)) {
    throw p2002(['orgId', 'slug']);
  }
  if (
    d.refExterna &&
    linhas.some(
      (r) =>
        r !== exceto &&
        r.orgId === d.orgId &&
        r.origem === d.origem &&
        r.refExterna === d.refExterna,
    )
  ) {
    throw p2002(['orgId', 'origem', 'refExterna']);
  }
}

/**
 * Monta o dublê. `estado` é o banco: quem chama inspeciona depois da execução e
 * vê exatamente as linhas que o código escreveu.
 */
export function prismaDeRotinas(estado: EstadoDoBancoFalso): PrismaService {
  const tabela = <T extends Record<string, unknown>>(linhas: () => T[]) => ({
    findMany: async (args?: {
      where?: Record<string, unknown>;
      distinct?: string[];
      orderBy?: unknown;
      take?: number;
    }) => {
      let r = linhas().filter((l) => casa(l, args?.where));
      if (args?.orderBy) r = ordenar(r, args.orderBy);
      if (args?.distinct?.length) r = distintos(r, args.distinct[0]);
      if (args?.take) r = r.slice(0, args.take);
      return r.map((l) => ({ ...l }));
    },
    findFirst: async (args?: { where?: Record<string, unknown> }) => {
      const l = linhas().find((x) => casa(x, args?.where));
      return l ? { ...l } : null;
    },
    findUnique: async (args?: { where?: Record<string, unknown> }) => {
      const l = linhas().find((x) => casa(x, args?.where));
      return l ? { ...l } : null;
    },
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const l = linhas().find((x) => casa(x, args.where));
      if (!l) throw new Error('linha não encontrada no dublê');
      aplicar(l, args.data);
      return { ...l };
    },
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const alvos = linhas().filter((x) => casa(x, args.where));
      for (const l of alvos) aplicar(l, args.data);
      return { count: alvos.length };
    },
  });

  return {
    rotina: {
      ...tabela(() => estado.rotinas as unknown as Record<string, unknown>[]),
      create: async (args: { data: Record<string, unknown> }) => {
        const linhas = estado.rotinas as unknown as Record<string, unknown>[];
        conferirUnicos(linhas, args.data);
        // `rotinaFalsa` aplica os DEFAULTs, inclusive os das duas colunas de
        // reserva — o dublê não tem DDL, então é aqui que eles existem.
        const nova = rotinaFalsa({
          id: `rotina-${++sequencia}`,
          orgId: String(args.data.orgId),
          ...(args.data as Partial<RotinaFalsa>),
        });
        estado.rotinas.push(nova);
        return { ...nova };
      },
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const linhas = estado.rotinas as unknown as Record<string, unknown>[];
        const l = linhas.find((x) => casa(x, args.where));
        if (!l) throw new Error('linha não encontrada no dublê');
        // O único que um UPDATE pode violar: trocar o slug para um já usado.
        if (args.data.slug !== undefined) conferirUnicos(linhas, { ...l, ...args.data }, l);
        aplicar(l, args.data);
        return { ...l };
      },
    },
    rotinaExecucao: {
      ...tabela(() => estado.execucoes as unknown as Record<string, unknown>[]),
      create: async (args: { data: Record<string, unknown> }) => {
        const nova = { id: `exec-${++sequencia}`, ...(args.data as object) } as ExecucaoFalsa;
        estado.execucoes.push(nova);
        return { ...nova };
      },
    },
    pautaRotina: tabela(() => estado.pautaRotinas as unknown as Record<string, unknown>[]),
    org: {
      findUnique: async (args: { where: { id: string } }) => ({
        modulos: estado.modulos?.[args.where.id] ?? [...MODULOS],
      }),
    },
    $queryRaw: async () => [{ atravessa: true, papel: 'mkt', forcado: false }],
  } as unknown as PrismaService;
}

/** O `AuditService` de mentira: guarda o que foi registrado, para a suíte olhar. */
export function auditoriaFalsa() {
  const linhas: Record<string, unknown>[] = [];
  return {
    linhas,
    servico: { log: async (i: Record<string, unknown>) => void linhas.push(i) } as never,
  };
}
