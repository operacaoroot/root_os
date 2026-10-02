import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ZodError } from 'zod';
import {
  METAS_CATALOGO,
  MetasDoMesSalvarSchema,
  chaveDaEstrategia,
  chaveDaPerformance,
  chaveDasMetasDoMes,
  lerOrigemDaEstrategia,
  mesDaChaveDasMetas,
  origemDaEstrategia,
  type MetasDoMesPainel,
} from '@mktos/shared';
import {
  ehLeadDeSemente,
  estadoDaSemana,
  hashDaLinhaDaMeta,
  janelaDoInstante,
  janelasDoMes,
  lerMetasDaNota,
  linhasDeMetaDaEstrategia,
  medirSemanas,
  resumirSemanas,
  semanaIso,
} from '../src/goals/metas-do-mes';
import { GoalsService } from '../src/goals/goals.service';
import { GoalsController } from '../src/goals/goals.controller';
import { GoalsModule } from '../src/goals/goals.module';
import { MemoryModule } from '../src/memory/memoria.module';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { ZodExceptionFilter } from '../src/common/zod-exception.filter';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuditService } from '../src/audit/audit.service';
import type { MetaService } from '../src/meta/meta.service';
import type { MemoriaService } from '../src/memory/memoria.service';

/*
 * ROOT-53a — metas do mês com fixtures. O que esta suíte guarda:
 *  - o alvo é UMA nota por mês, revisada por versão, e não vaza entre empresas;
 *  - o número é calculado por semana ISO no relógio de São Paulo, e a soma das
 *    semanas é o total do mês;
 *  - "sem dado" nunca vira zero, e a permissão da fonte vale para o número.
 * Os dados são fixtures em memória: nenhum banco, nenhuma escrita em produção.
 */

const A = 'org-a';
const B = 'org-b';
const MES = '2026-10';
const AGORA_DEPOIS_DO_MES = new Date('2026-11-02T12:00:00.000Z');
const TUDO = ['dashboard.ver', 'relatorios.gerar', 'leads.ver', 'bio.ver', 'pauta.ver'];

// ---------------------------------------------------------------------------
// O banco falso. Avalia o subconjunto de `where` que o serviço usa, em lógica de
// TRÊS valores como o SQL: `NOT (email LIKE ...)` com e-mail nulo dá NULL e some
// com a linha — a armadilha que `ondeLeadNaoESemente` existe para desarmar.

type Linha = Record<string, unknown> & { orgId: string };
type Tri = boolean | null;

const tempo = (v: unknown) => (v instanceof Date ? v.getTime() : v);

function condicao(valor: unknown, cond: unknown): Tri {
  if (cond === null) return valor === null || valor === undefined;
  if (cond instanceof Date || typeof cond !== 'object') {
    if (valor === null || valor === undefined) return null;
    return tempo(valor) === tempo(cond);
  }
  const ops = cond as Record<string, unknown>;
  const resultados: Tri[] = [];
  for (const [op, arg] of Object.entries(ops)) {
    if (op === 'not' && arg === null) {
      resultados.push(valor !== null && valor !== undefined);
      continue;
    }
    if (valor === null || valor === undefined) {
      resultados.push(null);
      continue;
    }
    if (op === 'gte') resultados.push((tempo(valor) as number) >= (tempo(arg) as number));
    else if (op === 'lt') resultados.push((tempo(valor) as number) < (tempo(arg) as number));
    else if (op === 'in') resultados.push((arg as unknown[]).includes(valor));
    else if (op === 'endsWith') resultados.push(String(valor).endsWith(String(arg)));
    else if (op === 'not') resultados.push(tempo(valor) !== tempo(arg));
    else throw new Error(`operador não suportado no banco falso: ${op}`);
  }
  return e(resultados);
}
const e = (l: Tri[]): Tri => (l.includes(false) ? false : l.includes(null) ? null : true);
const ou = (l: Tri[]): Tri => (l.includes(true) ? true : l.includes(null) ? null : false);

function avaliar(linha: Linha, where: Record<string, unknown>): Tri {
  const partes: Tri[] = [];
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND') partes.push(e((Array.isArray(v) ? v : [v]).map((w) => avaliar(linha, w as Record<string, unknown>))));
    else if (k === 'OR') partes.push(ou((v as Record<string, unknown>[]).map((w) => avaliar(linha, w))));
    else if (k === 'NOT') {
      const r = avaliar(linha, v as Record<string, unknown>);
      partes.push(r === null ? null : !r);
    } else partes.push(condicao(linha[k], v));
  }
  return e(partes);
}

function tabela(linhas: Linha[], chamadas: string[], nome: string) {
  const filtra = (where: Record<string, unknown>) => linhas.filter((l) => avaliar(l, where) === true);
  return {
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      chamadas.push(`${nome}.count`);
      return filtra(where).length;
    }),
    findFirst: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'> }) => {
      chamadas.push(`${nome}.findFirst`);
      const achadas = filtra(where);
      if (orderBy) {
        const [campo, dir] = Object.entries(orderBy)[0];
        achadas.sort((x, y) => ((tempo(x[campo]) as number) - (tempo(y[campo]) as number)) * (dir === 'asc' ? 1 : -1));
      }
      return achadas[0] ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      chamadas.push(`${nome}.findMany`);
      return filtra(where);
    }),
  };
}

interface Dados {
  leads?: Linha[];
  campanhas?: Linha[];
  bio?: Linha[];
  pecas?: Linha[];
}

function banco(d: Dados = {}) {
  const chamadas: string[] = [];
  const prisma = {
    lead: tabela(d.leads ?? [], chamadas, 'lead'),
    campaign: tabela(d.campanhas ?? [], chamadas, 'campaign'),
    bioEvent: tabela(d.bio ?? [], chamadas, 'bioEvent'),
    pautaPeca: tabela(d.pecas ?? [], chamadas, 'pautaPeca'),
  } as unknown as PrismaService;
  return { prisma, chamadas };
}

// ---------------------------------------------------------------------------
// A memória falsa: versão por nota, `versaoEsperada` conferida, empresa na chave.

interface NotaFalsa {
  id: string;
  orgId: string;
  chave: string;
  body: string;
  versao: number;
  arquivadoEm: string | null;
  atualizadoEm: string;
}

class MemoriaFalsa {
  notas: NotaFalsa[] = [];
  historicos = new Map<string, Array<{ versao: number; body: string }>>();
  private seq = 0;

  async porChave(orgId: string, chave: string) {
    return this.notas.find((n) => n.orgId === orgId && n.chave === chave) ?? null;
  }
  async obter(orgId: string, id: string) {
    return this.notas.find((n) => n.orgId === orgId && n.id === id) ?? null;
  }
  async historico(orgId: string, id: string) {
    if (!this.notas.some((n) => n.orgId === orgId && n.id === id)) throw new NotFoundException('Nota não encontrada nesta empresa.');
    return [...(this.historicos.get(id) ?? [])].reverse();
  }
  async listar(orgId: string) {
    const itens = this.notas.filter((n) => n.orgId === orgId);
    return { itens, total: itens.length, comVetor: 0 };
  }
  async criar(orgId: string, e: { chave: string; body: string }) {
    if (this.notas.some((n) => n.orgId === orgId && n.chave === e.chave)) throw new ConflictException('chave repetida');
    const n: NotaFalsa = {
      id: `nota-${++this.seq}-${'0'.repeat(8)}`,
      orgId,
      chave: e.chave,
      body: e.body,
      versao: 1,
      arquivadoEm: null,
      atualizadoEm: new Date().toISOString(),
    };
    this.notas.push(n);
    this.historicos.set(n.id, [{ versao: 1, body: e.body }]);
    return n;
  }
  async alterar(orgId: string, id: string, m: { body?: string; versaoEsperada?: number }) {
    const n = await this.obter(orgId, id);
    if (!n) throw new NotFoundException('Nota não encontrada nesta empresa.');
    if (m.versaoEsperada !== undefined && m.versaoEsperada !== n.versao) {
      throw new ConflictException(`A nota mudou desde a leitura (versão ${m.versaoEsperada}, agora ${n.versao}).`);
    }
    n.body = m.body ?? n.body;
    n.versao += 1;
    this.historicos.get(id)!.push({ versao: n.versao, body: n.body });
    return n;
  }
  async restaurar(orgId: string, id: string) {
    const n = (await this.obter(orgId, id))!;
    n.arquivadoEm = null;
    return n;
  }
}

function servico(d: Dados = {}, memoria = new MemoriaFalsa()) {
  const { prisma, chamadas } = banco(d);
  const audit = { log: vi.fn(async () => undefined) } as unknown as AuditService;
  const svc = new GoalsService(prisma, audit, {} as MetaService, memoria as unknown as MemoriaService);
  return { svc, memoria, chamadas, audit };
}

const lead = (orgId: string, enteredAt: string, extra: Partial<Linha> = {}): Linha => ({
  orgId,
  enteredAt: new Date(enteredAt),
  email: 'real@cliente.com.br',
  phone: '+55 11 90000-0000',
  campaignId: null,
  ...extra,
});

const LEADS_DE_OUTUBRO: Linha[] = [
  lead(A, '2026-10-01T02:59:00.000Z'), // 30/09 23:59 em São Paulo: é de setembro
  lead(A, '2026-10-01T03:00:00.000Z'), // 01/10 00:00 SP: W40
  lead(A, '2026-10-05T02:30:00.000Z'), // domingo 04/10 23:30 SP: W40, NÃO W41
  lead(A, '2026-10-05T03:00:00.000Z'), // segunda 05/10 00:00 SP: W41
  lead(A, '2026-11-01T02:30:00.000Z'), // sábado 31/10 23:30 SP: W44
  lead(A, '2026-11-01T03:00:00.000Z'), // 01/11 00:00 SP: é de novembro
];

const novos = (p: MetasDoMesPainel) => p.metas.find((m) => m.indicador === 'leads.novos')!;
const salvar = (svc: GoalsService, org: string, metas: unknown[], extra: Record<string, unknown> = {}, perms = TUDO, mes = MES) =>
  svc.salvarMetasDoMes(org, 'user-1', mes, { metas, ...extra } as never, perms);

// ===========================================================================

describe('as semanas do mês (funções puras)', () => {
  it('outubro de 2026: cinco semanas ISO, a primeira e a última recortadas pelo mês', () => {
    const j = janelasDoMes(MES);
    expect(j.map((x) => x.semana)).toEqual(['2026-W40', '2026-W41', '2026-W42', '2026-W43', '2026-W44']);
    expect(j[0]).toMatchObject({ segunda: '2026-09-28', domingo: '2026-10-04', primeiroDia: '2026-10-01', ultimoDia: '2026-10-04', diasNoMes: 4 });
    expect(j[4]).toMatchObject({ segunda: '2026-10-26', domingo: '2026-11-01', primeiroDia: '2026-10-26', ultimoDia: '2026-10-31', diasNoMes: 6 });
    // A semana que cruza o mês conta por dia: nada contado duas vezes, nada perdido.
    expect(j.reduce((a, x) => a + x.diasNoMes, 0)).toBe(31);
  });

  it('as janelas se encaixam sem buraco nem sobreposição, em meia-noite de São Paulo', () => {
    const j = janelasDoMes(MES);
    expect(j[0].de.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    for (let i = 1; i < j.length; i++) expect(j[i].de.getTime()).toBe(j[i - 1].ate.getTime());
    expect(j[4].ate.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('evento de domingo às 23:30 em São Paulo (segunda 02:30 em UTC) cai na semana do domingo', () => {
    const j = janelasDoMes(MES);
    expect(janelaDoInstante(j, new Date('2026-10-05T02:30:00.000Z'))?.semana).toBe('2026-W40');
    expect(janelaDoInstante(j, new Date('2026-10-05T03:00:00.000Z'))?.semana).toBe('2026-W41');
  });

  it('as pontas do mês: 30/09 23:59 e 01/11 00:00 em São Paulo ficam de fora; 31/10 23:59 fica', () => {
    const j = janelasDoMes(MES);
    expect(janelaDoInstante(j, new Date('2026-10-01T02:59:59.000Z'))).toBeNull();
    expect(janelaDoInstante(j, new Date('2026-11-01T02:59:59.000Z'))?.semana).toBe('2026-W44');
    expect(janelaDoInstante(j, new Date('2026-11-01T03:00:00.000Z'))).toBeNull();
  });

  it('a semana ISO segue a quinta-feira: 01/01/2027 é da semana 53 de 2026', () => {
    expect(semanaIso('2026-01-01')).toBe('2026-W01');
    expect(semanaIso('2027-01-01')).toBe('2026-W53');
    expect(semanaIso('2024-12-30')).toBe('2025-W01');
    const jan = janelasDoMes('2027-01');
    expect(jan[0]).toMatchObject({ semana: '2026-W53', primeiroDia: '2027-01-01', diasNoMes: 3 });
  });

  it('um mês começando na segunda-feira não ganha semana fantasma antes dele', () => {
    const j = janelasDoMes('2026-06'); // 01/06/2026 é segunda
    expect(j[0]).toMatchObject({ segunda: '2026-06-01', primeiroDia: '2026-06-01', diasNoMes: 7 });
    expect(j.reduce((a, x) => a + x.diasNoMes, 0)).toBe(30);
  });
});

describe('sem dado nunca vira zero (funções puras)', () => {
  const j = janelasDoMes(MES);

  it('sem registro nenhum na fonte, toda semana decorrida é sem dado e o valor é nulo — mesmo que alguém conte 0', () => {
    const semanas = medirSemanas(j, [0, 0, 0, 0, 0], null, AGORA_DEPOIS_DO_MES);
    expect(semanas.every((s) => s.estado === 'sem_dado' && s.valor === null)).toBe(true);
    expect(resumirSemanas(semanas)).toEqual({ estado: 'sem_dado', valor: null });
  });

  it('a fonte que começou no meio do mês deixa as semanas anteriores sem dado e a soma parcial', () => {
    const primeiro = new Date('2026-10-14T15:00:00.000Z');
    const semanas = medirSemanas(j, [9, 9, 3, 0, 2], primeiro, AGORA_DEPOIS_DO_MES);
    expect(semanas.map((s) => s.estado)).toEqual(['sem_dado', 'sem_dado', 'com_dado', 'com_dado', 'com_dado']);
    expect(semanas.map((s) => s.valor)).toEqual([null, null, 3, 0, 2]);
    expect(resumirSemanas(semanas)).toEqual({ estado: 'parcial', valor: 5 });
  });

  it('semana futura não é falta de dado: o mês em curso, coberto até hoje, está com dado', () => {
    const agora = new Date('2026-10-12T15:00:00.000Z'); // meio da W42
    const semanas = medirSemanas(j, [2, 1, 4, 7, 7], new Date('2026-09-01T00:00:00.000Z'), agora);
    expect(semanas.map((s) => s.estado)).toEqual(['com_dado', 'com_dado', 'com_dado', 'futura', 'futura']);
    expect(semanas[3].valor).toBeNull();
    expect(resumirSemanas(semanas)).toEqual({ estado: 'com_dado', valor: 7 });
  });

  it('o zero de uma fonte que estava de pé é zero de verdade', () => {
    const semanas = medirSemanas(j, [0, 0, 0, 0, 0], new Date('2026-01-01T00:00:00.000Z'), AGORA_DEPOIS_DO_MES);
    expect(semanas.every((s) => s.estado === 'com_dado' && s.valor === 0)).toBe(true);
    expect(resumirSemanas(semanas)).toEqual({ estado: 'com_dado', valor: 0 });
  });

  it('um mês inteiramente no futuro não tem dado', () => {
    expect(estadoDaSemana(janelasDoMes('2027-03')[0], new Date('2026-01-01T00:00:00.000Z'), AGORA_DEPOIS_DO_MES)).toBe('futura');
    expect(resumirSemanas(medirSemanas(janelasDoMes('2027-03'), [], null, AGORA_DEPOIS_DO_MES))).toEqual({ estado: 'sem_dado', valor: null });
  });
});

describe('a nota é lida sem derrubar a tela', () => {
  it('corpo vazio: nenhuma meta, nenhum aviso', () => {
    expect(lerMetasDaNota('')).toEqual({ metas: [], avisos: [] });
    expect(lerMetasDaNota(null)).toEqual({ metas: [], avisos: [] });
  });

  it('JSON torto e forma errada voltam aviso e lista vazia', () => {
    const a = lerMetasDaNota('isto foi editado à mão');
    expect(a.metas).toEqual([]);
    expect(a.avisos[0]).toContain('não é um JSON válido');
    const b = lerMetasDaNota('{"outra":1}');
    expect(b.metas).toEqual([]);
    expect(b.avisos[0]).toContain('"metas"');
    expect(lerMetasDaNota('[1,2]').metas).toEqual([]);
  });

  it('item torto sai com aviso e o resto da nota continua valendo', () => {
    const r = lerMetasDaNota(
      JSON.stringify({
        metas: [
          { indicador: 'leads.novos', alvo: 30 },
          { indicador: 'inventado.agora', alvo: 5 },
          { indicador: 'bio.cliques', alvo: -4 },
          { indicador: 'leads.por_campanha', alvo: 8 },
          { indicador: 'leads.novos', alvo: 99 },
          'texto solto',
          { indicador: 'pauta.publicadas', alvo: 12, origem: 'qualquer-coisa', observacao: '  ritmo de três por semana ' },
        ],
      }),
    );
    expect(r.metas.map((m) => [m.indicador, m.alvo])).toEqual([
      ['leads.novos', 30],
      ['pauta.publicadas', 12],
    ]);
    expect(r.metas[1]).toMatchObject({ origem: null, observacao: 'ritmo de três por semana', unidade: 'peças' });
    expect(r.avisos).toHaveLength(6);
  });
});

describe('a linha da estratégia', () => {
  const DOC = ['# Estratégia de 2026-10', '', '## Pilares da vez', '- Bastidores', '', '## Metas', '- 30 leads até 31/10', '-   Publicar  12 peças ', '', '## Apostas', '- testar corte de 40 s', ''].join('\n');

  it('lê só a seção Metas, ignora "—" e linha repetida', () => {
    expect(linhasDeMetaDaEstrategia(DOC).map((l) => l.texto)).toEqual(['30 leads até 31/10', 'Publicar 12 peças']);
    expect(linhasDeMetaDaEstrategia('## Metas\n—\n')).toEqual([]);
    expect(linhasDeMetaDaEstrategia('## METAS\n- a\n- a\n')).toHaveLength(1);
  });

  it('o hash não muda com marcador nem com espaço, e muda com o texto', () => {
    expect(hashDaLinhaDaMeta('- Publicar   12 peças')).toBe(hashDaLinhaDaMeta('Publicar 12 peças'));
    expect(hashDaLinhaDaMeta('Publicar 13 peças')).not.toBe(hashDaLinhaDaMeta('Publicar 12 peças'));
    expect(hashDaLinhaDaMeta('x')).toMatch(/^[0-9a-f]{12}$/);
  });

  it('a origem vai e volta, e texto torto não é origem', () => {
    const o = { notaId: 'nota-1-00000000', hash: 'abcdef012345', versao: 3 };
    expect(origemDaEstrategia(o)).toBe('estrategia:nota-1-00000000:abcdef012345@v3');
    expect(lerOrigemDaEstrategia(origemDaEstrategia(o))).toEqual(o);
    expect(lerOrigemDaEstrategia('estrategia:x@v1')).toBeNull();
    expect(lerOrigemDaEstrategia('clickup:123')).toBeNull();
    expect(lerOrigemDaEstrategia('estrategia:nota-1-00000000:abcdef012345@v0')).toBeNull();
  });
});

describe('a assinatura da semente', () => {
  it('só é semente com o e-mail de exemplo E o telefone da semente juntos', () => {
    const FONE = '+55 21 99999-0000';
    expect(ehLeadDeSemente({ email: 'ana.prado@exemplo.com', phone: FONE })).toBe(true);
    expect(ehLeadDeSemente({ email: 'ana.prado@exemplo.com', phone: '+55 11 90000-0000' })).toBe(false);
    expect(ehLeadDeSemente({ email: 'ana@cliente.com.br', phone: FONE })).toBe(false);
    expect(ehLeadDeSemente({ email: null, phone: FONE })).toBe(false);
  });
});

// ===========================================================================

describe('metas do mês no serviço', () => {
  it('sem nota, o mês está "sem meta": lista vazia, nenhuma fonte consultada', async () => {
    const { svc, chamadas } = servico({ leads: LEADS_DE_OUTUBRO });
    const p = await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES);
    expect(p.nota).toBeNull();
    expect(p.metas).toEqual([]);
    expect(p.semanas).toHaveLength(5);
    expect(chamadas).toEqual([]);
  });

  it('o número é calculado por semana e a soma das semanas é o total do mês', async () => {
    const { svc } = servico({ leads: LEADS_DE_OUTUBRO });
    await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }]);
    const m = novos(await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES));
    expect(m.semanas.map((s) => [s.semana, s.valor])).toEqual([
      ['2026-W40', 2], // 01/10 00:00 e domingo 04/10 23:30 — o de 30/09 23:59 SP é de setembro
      ['2026-W41', 1],
      ['2026-W42', 0],
      ['2026-W43', 0],
      ['2026-W44', 1], // 31/10 23:30 SP; o de 01/11 00:00 SP é de novembro
    ]);
    expect(m.valor).toBe(4);
    expect(m.valor).toBe(m.semanas.reduce((a, s) => a + (s.valor ?? 0), 0));
    expect(m).toMatchObject({ estado: 'com_dado', alvo: 10, pct: 40, unidade: 'leads', motivo: null });
  });

  it('a mesma consulta com o mês ainda em curso: semana futura sem número e o mês segue "com dado"', async () => {
    const { svc } = servico({ leads: LEADS_DE_OUTUBRO });
    await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }]);
    const m = novos(await svc.metasDoMes(A, MES, TUDO, new Date('2026-10-07T12:00:00.000Z')));
    expect(m.semanas.map((s) => s.estado)).toEqual(['com_dado', 'com_dado', 'futura', 'futura', 'futura']);
    expect(m.valor).toBe(3);
    expect(m.estado).toBe('com_dado');
  });

  it('cliques da bio e peças publicadas contam na mesma régua de semana', async () => {
    const { svc } = servico({
      bio: [
        { orgId: A, nome: 'link_click', ocorridoEm: new Date('2026-10-05T02:30:00.000Z') },
        { orgId: A, nome: 'whatsapp_click', ocorridoEm: new Date('2026-10-06T12:00:00.000Z') },
        { orgId: A, nome: 'page_view', ocorridoEm: new Date('2026-10-06T12:00:00.000Z') }, // visita não é clique
        { orgId: B, nome: 'link_click', ocorridoEm: new Date('2026-10-06T12:00:00.000Z') }, // de outra empresa
      ],
      pecas: [
        { orgId: A, status: 'publicada', publicadaEm: new Date('2026-10-08T12:00:00.000Z') },
        { orgId: A, status: 'rascunho', publicadaEm: null },
        { orgId: A, status: 'publicada', publicadaEm: null },
      ],
    });
    await salvar(svc, A, [
      { indicador: 'bio.cliques', alvo: 100 },
      { indicador: 'pauta.publicadas', alvo: 12 },
    ]);
    const p = await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES);
    const bio = p.metas.find((m) => m.indicador === 'bio.cliques')!;
    expect(bio.semanas.map((s) => s.valor)).toEqual([1, 1, 0, 0, 0]); // o de domingo 23:30 SP é da W40
    expect(bio.valor).toBe(2);
    const pauta = p.metas.find((m) => m.indicador === 'pauta.publicadas')!;
    expect(pauta.valor).toBe(1);
    // O primeiro registro da pauta foi em 08/10: as duas primeiras semanas não tinham fonte.
    expect(pauta.semanas.map((s) => s.estado)).toEqual(['sem_dado', 'com_dado', 'com_dado', 'com_dado', 'com_dado']);
    expect(pauta.estado).toBe('parcial');
  });

  describe('duas empresas', () => {
    it('a nota e os números de uma não aparecem na outra', async () => {
      const memoria = new MemoriaFalsa();
      const a = servico({ leads: LEADS_DE_OUTUBRO, campanhas: [{ orgId: A, id: 'camp-a', name: 'Campanha da A' }] }, memoria);
      const b = servico({ leads: [lead(B, '2026-10-06T12:00:00.000Z')] }, memoria);

      await salvar(a.svc, A, [{ indicador: 'leads.novos', alvo: 10, observacao: 'só da A' }]);

      const deB = await b.svc.metasDoMes(B, MES, TUDO, AGORA_DEPOIS_DO_MES);
      expect(deB.nota).toBeNull();
      expect(deB.metas).toEqual([]);
      expect(deB.meses).toEqual([]);

      await salvar(b.svc, B, [{ indicador: 'leads.novos', alvo: 50 }]);
      const novaB = novos(await b.svc.metasDoMes(B, MES, TUDO, AGORA_DEPOIS_DO_MES));
      expect(novaB).toMatchObject({ alvo: 50, valor: 1, observacao: null });
      const novaA = novos(await a.svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES));
      expect(novaA).toMatchObject({ alvo: 10, valor: 4, observacao: 'só da A' });
      expect(memoria.notas.filter((n) => n.chave === chaveDasMetasDoMes(MES))).toHaveLength(2);
    });

    it('campanha de outra empresa responde como campanha que não existe (404) e nada é gravado', async () => {
      const memoria = new MemoriaFalsa();
      const b = servico({ campanhas: [] }, memoria);
      const a = servico({ campanhas: [{ orgId: A, id: 'camp-a', name: 'Campanha da A' }] }, memoria);
      await expect(salvar(b.svc, B, [{ indicador: 'leads.por_campanha', alvo: 5, campanhaId: 'camp-a' }])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(salvar(b.svc, B, [{ indicador: 'leads.por_campanha', alvo: 5, campanhaId: 'nao-existe' }])).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(memoria.notas).toEqual([]);
      await expect(salvar(a.svc, A, [{ indicador: 'leads.por_campanha', alvo: 5, campanhaId: 'camp-a' }])).resolves.toBeTruthy();
    });
  });

  describe('revisar o mês', () => {
    it('duas vezes: uma nota só, versão 2, nenhuma meta duplicada', async () => {
      const { svc, memoria, audit } = servico({ leads: LEADS_DE_OUTUBRO });
      const p1 = await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }]);
      expect(p1.nota?.versao).toBe(1);

      const p2 = await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 12 }, { indicador: 'bio.cliques', alvo: 80 }], { versao: 1 });
      expect(p2.nota?.versao).toBe(2);
      expect(memoria.notas.filter((n) => n.chave === chaveDasMetasDoMes(MES))).toHaveLength(1);
      expect(p2.metas.map((m) => [m.indicador, m.alvo])).toEqual([['leads.novos', 12], ['bio.cliques', 80]]);
      expect(audit.log).toHaveBeenCalledTimes(2);

      // A revisão substitui a lista: repetir o mesmo pedido não acumula meta.
      const p3 = await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 12 }, { indicador: 'bio.cliques', alvo: 80 }]);
      expect(p3.nota?.versao).toBe(3);
      expect(p3.metas).toHaveLength(2);
    });

    it('versão velha da tela é recusada (409) e a nota não muda', async () => {
      const { svc, memoria } = servico();
      await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }]);
      await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 11 }]);
      await expect(salvar(svc, A, [{ indicador: 'leads.novos', alvo: 99 }], { versao: 1 })).rejects.toBeInstanceOf(ConflictException);
      expect(memoria.notas[0].versao).toBe(2);
      expect(JSON.parse(memoria.notas[0].body).metas[0].alvo).toBe(11);
    });

    it('o histórico guarda cada versão, e a unidade vem do catálogo, não da tela', async () => {
      const { svc, memoria } = servico();
      await salvar(svc, A, [{ indicador: 'pauta.publicadas', alvo: 12, unidade: 'bananas' }]);
      const corpo = JSON.parse(memoria.notas[0].body);
      expect(corpo.metas[0]).toEqual({ indicador: 'pauta.publicadas', alvo: 12, unidade: 'peças', campanhaId: null, origem: null, observacao: null });
      expect(memoria.historicos.get(memoria.notas[0].id)).toHaveLength(1);
    });
  });

  describe('o que a revisão recusa (400)', () => {
    const recusa = async (corpo: unknown) => {
      const { svc, memoria } = servico();
      const erro = await salvar(svc, A, corpo as unknown[]).catch((e) => e);
      expect(memoria.notas).toEqual([]);
      return erro;
    };

    it('indicador desconhecido', async () => {
      const erro = await recusa([{ indicador: 'vendas.fechadas', alvo: 5 }]);
      expect(erro).toBeInstanceOf(ZodError);
      expect((erro as ZodError).issues[0].message).toBe('Indicador desconhecido.');
      // E o filtro do app transforma o ZodError em 400.
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      new ZodExceptionFilter().catch(erro, { switchToHttp: () => ({ getResponse: () => res }) } as never);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it.each([
      ['alvo zero', [{ indicador: 'leads.novos', alvo: 0 }]],
      ['alvo negativo', [{ indicador: 'leads.novos', alvo: -3 }]],
      ['alvo em texto', [{ indicador: 'leads.novos', alvo: '30' }]],
      ['indicador repetido', [{ indicador: 'leads.novos', alvo: 3 }, { indicador: 'leads.novos', alvo: 4 }]],
      ['campanha num indicador que não usa', [{ indicador: 'leads.novos', alvo: 3, campanhaId: 'c1' }]],
      ['indicador de campanha sem campanha', [{ indicador: 'leads.por_campanha', alvo: 3 }]],
      ['origem que não é da estratégia', [{ indicador: 'leads.novos', alvo: 3, origem: 'clickup:9' }]],
    ])('%s', async (_nome, corpo) => {
      expect(await recusa(corpo)).toBeInstanceOf(ZodError);
    });

    it('o mesmo indicador em campanhas diferentes é permitido', () => {
      const r = MetasDoMesSalvarSchema.safeParse({
        metas: [
          { indicador: 'leads.por_campanha', alvo: 5, campanhaId: 'c1' },
          { indicador: 'leads.por_campanha', alvo: 7, campanhaId: 'c2' },
        ],
      });
      expect(r.success).toBe(true);
    });
  });

  describe('fonte sem dado, bloqueada e sem acesso', () => {
    it('empresa sem nenhum registro: "sem dado" e valor nulo em toda semana, nunca 0', async () => {
      const { svc } = servico({ leads: [] });
      await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }]);
      const m = novos(await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES));
      expect(m.estado).toBe('sem_dado');
      expect(m.valor).toBeNull();
      expect(m.pct).toBeNull();
      expect(m.semanas.every((s) => s.valor === null && s.estado === 'sem_dado')).toBe(true);
      expect(m.motivo).toContain('nenhum número foi contado');
    });

    it('só linha de semente na fonte também é "sem dado"', async () => {
      const { svc } = servico({
        leads: [lead(A, '2026-10-02T12:00:00.000Z', { email: 'ana.prado@exemplo.com', phone: '+55 21 99999-0000' })],
      });
      await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }]);
      const m = novos(await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES));
      expect(m.estado).toBe('sem_dado');
      expect(m.valor).toBeNull();
    });

    it('Instagram sem a foto do mês: fonte bloqueada, com o motivo e nenhum número', async () => {
      const { svc } = servico();
      await salvar(svc, A, [{ indicador: 'instagram.visualizacoes', alvo: 50_000 }]);
      const m = (await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES)).metas[0];
      expect(m.estado).toBe('bloqueada');
      expect(m.motivo).toContain('foto de performance');
      expect(m.valor).toBeNull();
      expect(m.semanas.every((s) => s.valor === null)).toBe(true);
    });

    it('Instagram com a foto do mês: soma os posts pela semana em que foram publicados', async () => {
      const memoria = new MemoriaFalsa();
      const foto = {
        mes: MES,
        coletadoEm: '2026-11-01T09:00:00.000Z',
        posts: [
          { publicadaEm: '2026-10-05T02:30:00.000Z', numeros: { visualizacoes: 1000 } }, // domingo 23:30 SP: W40
          { publicadaEm: '2026-10-02T15:00:00.000Z', numeros: { visualizacoes: 500 } }, // W40
          { publicadaEm: '2026-10-14T15:00:00.000Z', numeros: { visualizacoes: null } }, // W42, sem número
        ],
      };
      await memoria.criar(A, { chave: chaveDaPerformance(MES), body: JSON.stringify(foto) });
      const { svc } = servico({}, memoria);
      await salvar(svc, A, [{ indicador: 'instagram.visualizacoes', alvo: 5000 }]);
      const m = (await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES)).metas[0];
      expect(m.semanas.map((s) => [s.estado, s.valor])).toEqual([
        ['com_dado', 1500],
        ['com_dado', 0], // nenhum post publicado: a foto cobre o mês, então é zero de fato
        ['sem_dado', null], // só post sem número: não vira zero
        ['com_dado', 0],
        ['com_dado', 0],
      ]);
      expect(m).toMatchObject({ estado: 'parcial', valor: 1500, pct: 30 });
    });

    it('sem a permissão da fonte: "sem acesso", nenhum número e NENHUMA consulta à fonte', async () => {
      const { svc, chamadas } = servico({ leads: LEADS_DE_OUTUBRO, bio: [{ orgId: A, nome: 'link_click', ocorridoEm: new Date('2026-10-06T12:00:00.000Z') }] });
      await salvar(svc, A, [
        { indicador: 'leads.novos', alvo: 10 },
        { indicador: 'bio.cliques', alvo: 100 },
      ]);
      chamadas.length = 0;
      const semLeads = TUDO.filter((p) => p !== 'leads.ver');
      const p = await svc.metasDoMes(A, MES, semLeads, AGORA_DEPOIS_DO_MES);
      const leads = novos(p);
      expect(leads).toMatchObject({ estado: 'sem_acesso', valor: null, pct: null, alvo: 10 });
      expect(leads.semanas.every((s) => s.valor === null)).toBe(true);
      expect(leads.motivo).toContain('leads.ver');
      // O primeiro clique da bio foi em 06/10: a W40 não tinha fonte, então o mês é parcial.
      expect(p.metas.find((m) => m.indicador === 'bio.cliques')).toMatchObject({ estado: 'parcial', valor: 1 });
      expect(chamadas.some((c) => c.startsWith('lead.'))).toBe(false);
      expect(p.catalogo.find((i) => i.chave === 'leads.novos')?.permitido).toBe(false);
      expect(p.catalogo.find((i) => i.chave === 'bio.cliques')?.permitido).toBe(true);
    });
  });

  describe('a semente fica fora', () => {
    const SEMENTE = { email: 'ana.prado@exemplo.com', phone: '+55 21 99999-0000' };

    it('lead de demonstração não entra em leads.novos; o real com e-mail de exemplo entra', async () => {
      const { svc } = servico({
        leads: [
          lead(A, '2026-10-02T12:00:00.000Z'),
          lead(A, '2026-10-02T12:00:00.000Z', SEMENTE),
          lead(A, '2026-10-03T12:00:00.000Z', SEMENTE),
          lead(A, '2026-10-06T12:00:00.000Z', { email: 'real@exemplo.com' }), // só o e-mail não basta
          lead(A, '2026-10-06T13:00:00.000Z', { email: null, phone: SEMENTE.phone }), // e-mail nulo + telefone da semente
          lead(A, '2026-10-06T14:00:00.000Z', { email: 'x@cliente.com', phone: null }),
        ],
      });
      await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }]);
      const m = novos(await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES));
      expect(m.valor).toBe(4);
      expect(m.semanas.map((s) => s.valor)).toEqual([1, 3, 0, 0, 0]);
    });

    it('campanha de demonstração não aceita meta (400) e não conta como métrica', async () => {
      const { svc, memoria } = servico({
        campanhas: [{ orgId: A, id: 'camp-seed', name: 'Black Friday — Tráfego' }],
        leads: [lead(A, '2026-10-02T12:00:00.000Z', { ...SEMENTE, campaignId: 'camp-seed' })],
      });
      await expect(salvar(svc, A, [{ indicador: 'leads.por_campanha', alvo: 5, campanhaId: 'camp-seed' }])).rejects.toBeInstanceOf(BadRequestException);
      expect(memoria.notas).toEqual([]);
    });

    it('uma nota editada por fora que aponta a campanha da semente mostra a fonte bloqueada, sem número', async () => {
      const memoria = new MemoriaFalsa();
      await memoria.criar(A, {
        chave: chaveDasMetasDoMes(MES),
        body: JSON.stringify({ metas: [{ indicador: 'leads.por_campanha', alvo: 5, campanhaId: 'camp-seed' }] }),
      });
      const { svc } = servico({ campanhas: [{ orgId: A, id: 'camp-seed', name: 'Lançamento Curso' }] }, memoria);
      const m = (await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES)).metas[0];
      expect(m).toMatchObject({ estado: 'bloqueada', valor: null });
      expect(m.motivo).toContain('demonstração');
    });

    it('campanha real com o nome da semente, mas com lead real, continua valendo', async () => {
      const { svc } = servico({
        campanhas: [{ orgId: A, id: 'camp-1', name: 'Remarketing Q3' }],
        leads: [lead(A, '2026-10-06T12:00:00.000Z', { campaignId: 'camp-1' }), lead(A, '2026-10-01T12:00:00.000Z', { campaignId: 'camp-2' })],
      });
      await salvar(svc, A, [{ indicador: 'leads.por_campanha', alvo: 5, campanhaId: 'camp-1' }]);
      const m = (await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES)).metas[0];
      expect(m).toMatchObject({ estado: 'com_dado', valor: 1, campanhaNome: 'Remarketing Q3' });
    });
  });

  describe('a meta que veio da estratégia', () => {
    const DOC = (linhas: string[]) => ['# Estratégia de 2026-10', '', '## Metas', ...linhas.map((l) => `- ${l}`), '', '## Apostas', '- testar corte', ''].join('\n');

    async function comEstrategia(linhas = ['Chegar a 40 leads até 31/10', 'Publicar 12 peças']) {
      const memoria = new MemoriaFalsa();
      const nota = await memoria.criar(A, { chave: chaveDaEstrategia(MES), body: DOC(linhas) });
      return { nota, ...servico({ leads: LEADS_DE_OUTUBRO }, memoria) };
    }

    it('a tela recebe as linhas da seção Metas, com a origem pronta, e nenhuma delas vira meta sozinha', async () => {
      const { svc } = await comEstrategia();
      const p = await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES);
      expect(p.metas).toEqual([]);
      expect(p.estrategia?.linhas.map((l) => l.texto)).toEqual(['Chegar a 40 leads até 31/10', 'Publicar 12 peças']);
      expect(p.estrategia?.linhas[0].origem).toMatch(/^estrategia:nota-1-00000000:[0-9a-f]{12}@v1$/);
      expect(p.estrategia?.linhas.every((l) => !l.jaViraMeta)).toBe(true);
    });

    it('guarda origem estrategia:<itemId>@v<versao> e o alvo é o que a pessoa escolheu, não o número do texto', async () => {
      const { svc, memoria } = await comEstrategia();
      const linha = (await svc.metasDoMes(A, MES, TUDO)).estrategia!.linhas[0];
      expect(linha.texto).toContain('40 leads');
      const p = await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 25, origem: linha.origem }]);
      const gravada = JSON.parse(memoria.notas.find((n) => n.chave === chaveDasMetasDoMes(MES))!.body).metas[0];
      expect(gravada.origem).toBe(linha.origem);
      expect(gravada.alvo).toBe(25);
      expect(lerOrigemDaEstrategia(gravada.origem)).toMatchObject({ versao: 1 });
      expect(p.metas[0].origem).toBe(linha.origem);
      expect(p.estrategia?.linhas[0].jaViraMeta).toBe(true);
      expect(p.estrategia?.linhas[1].jaViraMeta).toBe(false);
    });

    it('origem sem indicador e alvo não vira meta: o texto não é convertido sozinho', async () => {
      const { svc, memoria } = await comEstrategia();
      const linha = (await svc.metasDoMes(A, MES, TUDO)).estrategia!.linhas[0];
      await expect(salvar(svc, A, [{ origem: linha.origem }])).rejects.toBeInstanceOf(ZodError);
      await expect(salvar(svc, A, [{ indicador: 'leads.novos', origem: linha.origem }])).rejects.toBeInstanceOf(ZodError);
      expect(memoria.notas.some((n) => n.chave === chaveDasMetasDoMes(MES))).toBe(false);
    });

    it('a origem presa à versão continua valendo depois que a estratégia muda — e a linha nova ganha outra origem', async () => {
      const { svc, memoria, nota } = await comEstrategia();
      const v1 = (await svc.metasDoMes(A, MES, TUDO)).estrategia!.linhas[1];
      await memoria.alterar(A, nota.id, { body: DOC(['Publicar 15 peças', 'Chegar a 40 leads até 31/10']) });
      await expect(salvar(svc, A, [{ indicador: 'pauta.publicadas', alvo: 12, origem: v1.origem }])).resolves.toBeTruthy();
      const agora = (await svc.metasDoMes(A, MES, TUDO)).estrategia!;
      expect(agora.versao).toBe(2);
      expect(agora.linhas.map((l) => l.texto)).toEqual(['Publicar 15 peças', 'Chegar a 40 leads até 31/10']);
      // A linha "Publicar 12 peças" saiu do texto: a origem antiga ainda aponta a versão 1, onde ela estava.
      const velha = agora.linhas.find((l) => l.texto.includes('40 leads'))!;
      expect(velha.itemId.endsWith(v1.itemId.split(':')[1])).toBe(false);
    });

    it.each([
      ['hash que não está na versão', (o: ReturnType<typeof lerOrigemDaEstrategia>) => origemDaEstrategia({ ...o!, hash: '0123456789ab' })],
      ['versão que não existe', (o: ReturnType<typeof lerOrigemDaEstrategia>) => origemDaEstrategia({ ...o!, versao: 9 })],
      ['nota que não existe', (o: ReturnType<typeof lerOrigemDaEstrategia>) => origemDaEstrategia({ ...o!, notaId: 'nota-99-00000000' })],
    ])('origem com %s: 400 e nada gravado', async (_nome, torta) => {
      const { svc, memoria } = await comEstrategia();
      const linha = (await svc.metasDoMes(A, MES, TUDO)).estrategia!.linhas[0];
      const origem = torta(lerOrigemDaEstrategia(linha.origem));
      await expect(salvar(svc, A, [{ indicador: 'leads.novos', alvo: 5, origem }])).rejects.toBeInstanceOf(BadRequestException);
      expect(memoria.notas.some((n) => n.chave === chaveDasMetasDoMes(MES))).toBe(false);
    });

    it('a estratégia de outro mês não serve de origem para este', async () => {
      const { svc, memoria } = await comEstrategia();
      const outra = await memoria.criar(A, { chave: chaveDaEstrategia('2026-09'), body: DOC(['Algo de setembro']) });
      const hash = hashDaLinhaDaMeta('Algo de setembro');
      const origem = origemDaEstrategia({ notaId: outra.id, hash, versao: 1 });
      await expect(salvar(svc, A, [{ indicador: 'leads.novos', alvo: 5, origem }])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a estratégia de outra empresa não serve de origem', async () => {
      const memoria = new MemoriaFalsa();
      const deB = await memoria.criar(B, { chave: chaveDaEstrategia(MES), body: DOC(['Meta da B']) });
      const { svc } = servico({}, memoria);
      const origem = origemDaEstrategia({ notaId: deB.id, hash: hashDaLinhaDaMeta('Meta da B'), versao: 1 });
      await expect(salvar(svc, A, [{ indicador: 'leads.novos', alvo: 5, origem }])).rejects.toBeInstanceOf(BadRequestException);
    });

    it('quem não pode ver a Pauta não liga meta à estratégia (403) nem recebe as linhas dela', async () => {
      const { svc } = await comEstrategia();
      const semPauta = TUDO.filter((p) => p !== 'pauta.ver');
      expect((await svc.metasDoMes(A, MES, semPauta)).estrategia).toBeNull();
      const linha = (await svc.metasDoMes(A, MES, TUDO)).estrategia!.linhas[0];
      await expect(salvar(svc, A, [{ indicador: 'leads.novos', alvo: 5, origem: linha.origem }], {}, semPauta)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('nota editada fora da tela', () => {
    it('corpo malformado não derruba o painel: lista vazia e aviso', async () => {
      const memoria = new MemoriaFalsa();
      await memoria.criar(A, { chave: chaveDasMetasDoMes(MES), body: '{ isto não fecha' });
      const { svc } = servico({}, memoria);
      const p = await svc.metasDoMes(A, MES, TUDO, AGORA_DEPOIS_DO_MES);
      expect(p.metas).toEqual([]);
      expect(p.avisos[0]).toContain('não é um JSON válido');
      expect(p.nota?.versao).toBe(1);
    });

    it('a próxima revisão pela tela conserta a nota, em versão nova', async () => {
      const memoria = new MemoriaFalsa();
      await memoria.criar(A, { chave: chaveDasMetasDoMes(MES), body: 'lixo' });
      const { svc } = servico({ leads: LEADS_DE_OUTUBRO }, memoria);
      const p = await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }]);
      expect(p.avisos).toEqual([]);
      expect(p.nota?.versao).toBe(2);
    });

    it('nota arquivada vale como mês sem meta, e a revisão a restaura', async () => {
      const memoria = new MemoriaFalsa();
      const n = await memoria.criar(A, { chave: chaveDasMetasDoMes(MES), body: JSON.stringify({ metas: [{ indicador: 'leads.novos', alvo: 9 }] }) });
      n.arquivadoEm = '2026-10-01T00:00:00.000Z';
      const { svc } = servico({}, memoria);
      expect((await svc.metasDoMes(A, MES, TUDO)).metas).toEqual([]);
      await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }]);
      expect(n.arquivadoEm).toBeNull();
    });
  });

  it('lista os meses que já têm nota de metas, do mais novo ao mais velho', async () => {
    const { svc } = servico();
    await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }], {}, TUDO, '2026-09');
    await salvar(svc, A, [{ indicador: 'leads.novos', alvo: 10 }], {}, TUDO, '2026-10');
    expect((await svc.metasDoMes(A, '2026-11', TUDO)).meses).toEqual(['2026-10', '2026-09']);
    expect(mesDaChaveDasMetas(chaveDasMetasDoMes('2026-10'))).toBe('2026-10');
    expect(mesDaChaveDasMetas('pauta.estrategia.2026-10')).toBeNull();
  });
});

describe('o catálogo e a fiação', () => {
  it('cada indicador tem fonte, permissão e unidade; chaves únicas', () => {
    expect(new Set(METAS_CATALOGO.map((i) => i.chave)).size).toBe(METAS_CATALOGO.length);
    for (const i of METAS_CATALOGO) {
      expect(i.permissoes.length).toBeGreaterThan(0);
      expect(i.unidade).toBeTruthy();
      expect(i.calculo).toBeTruthy();
    }
    expect(METAS_CATALOGO.map((i) => i.chave)).toEqual([
      'leads.novos',
      'leads.por_campanha',
      'bio.cliques',
      'pauta.publicadas',
      'instagram.visualizacoes',
    ]);
  });

  it('as rotas do mês exigem as permissões do contrato C-12', () => {
    const ler = Reflect.getMetadata(PERMISSIONS_KEY, GoalsController.prototype.metasDoMes);
    const gravar = Reflect.getMetadata(PERMISSIONS_KEY, GoalsController.prototype.salvarMetasDoMes);
    expect(ler).toEqual(['dashboard.ver']);
    expect(gravar).toEqual(['relatorios.gerar']);
  });

  it('o módulo importa a memória: a nota é escrita só pelo MemoriaService', () => {
    expect(Reflect.getMetadata('imports', GoalsModule)).toContain(MemoryModule);
  });
});
