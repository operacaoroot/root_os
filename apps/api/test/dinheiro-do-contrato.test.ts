import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

import { ContratoVivoService } from '../src/comercial/contrato-vivo.service';
import {
  aplicarDinheiro, idDaParcelaDoContrato, idDoAcordoDoContrato, planejarDinheiro, type EntradaDoDinheiro,
} from '../src/comercial/dinheiro-do-contrato';
import { DinheiroService, type AceiteDoLead } from '../src/comercial/dinheiro.service';
import { eventoIdComercial, uuidDe } from '../src/comercial/eventos';
import { FechamentoService } from '../src/comercial/fechamento.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { AprService, CONTRATO_DO_FECHAMENTO } from '../src/finance/apr.service';
import { prepararVestir, vestirCobranca } from '../src/finance/parcelas.service';
import { planejarBackfill, sqlDoDesfazer, tabelaDoEnsaio, temTrabalho } from '../src/scripts/ligar-dinheiro-dos-contratos';
import type { AsaasPayment } from '../src/finance/asaas.service';

/*
 * O DINHEIRO APARECE SOZINHO (etapa 4, 03/11/2026), sem banco.
 *
 *  F-03 o fechamento leva o dinheiro do contrato a um acordo: o já ligado, o da cobrança, o único
 *       pagante do cliente, ou um novo; ambíguo não liga nada e deixa o aviso. Parcelas idempotentes.
 *  F-04 o contrato do Financeiro aponta o registro, com conta e plano; os leitores o pulam e o
 *       "gerar lançamento" o recusa.
 *  F-05 a parcela paga no Financeiro avisa o Comercial (relógio idempotente); o contrato vivo lê as
 *       parcelas do acordo quando o lead não tem cobrança.
 *  F-06 o sync acha a parcela pelo id do Asaas antes de qualquer nome.
 *  O ensaio do backfill numa base de mentira.
 *
 * O banco é um dublê em memória: filtros por igualdade, `in`, `not`, nulo, datas, relação simples
 * (`lead: { orgId }`, `contract: {...}`), únicos de verdade no `createMany` e o cadeado anotado.
 */

const CASA = 'org-casa';
type Linha = Record<string, unknown>;

const RELACOES: Record<string, { tabela: string; fk: string }> = {
  lead: { tabela: 'lead', fk: 'leadId' },
  contract: { tabela: 'contract', fk: 'contractId' },
  acordo: { tabela: 'acordoComercial', fk: 'acordoId' },
};
const UNICOS: Record<string, string[][]> = {
  acordoParcela: [['acordoId', 'numero'], ['orgId', 'asaasPaymentId']],
  acordoComercial: [['comercialContratoId']],
  comercialContrato: [['documentoId']],
  comercialDocumento: [['provedor', 'externoId']],
  comercialFechamento: [['chave']],
};
const OPERADORES = ['in', 'not', 'gte', 'lte', 'gt', 'lt', 'startsWith', 'path', 'equals'];

function banco(inicial: Record<string, Linha[]> = {}) {
  const t: Record<string, Linha[]> = {};
  for (const [k, v] of Object.entries(inicial)) t[k] = v.map((l) => ({ ...l }));
  const de = (nome: string) => (t[nome] ??= []);
  const escritas: Array<{ tabela: string; op: string; where?: Linha; data: unknown }> = [];
  const cadeados: string[] = [];
  let seq = 0;

  const vale = (l: Linha, k: string, v: unknown): boolean => {
    const x = l[k];
    if (v === null) return x == null;
    if (v instanceof Date) return x instanceof Date && x.getTime() === v.getTime();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (Object.keys(o).some((c) => OPERADORES.includes(c))) {
        if ('path' in o) return ((x ?? {}) as Linha)[(o.path as string[])[0]] === o.equals;
        if ('in' in o && !(o.in as unknown[]).some((y) => (y instanceof Date && x instanceof Date ? y.getTime() === x.getTime() : y === x))) return false;
        if ('not' in o && (o.not === null ? x == null : x === o.not)) return false;
        const n = (y: unknown) => (y instanceof Date ? y.getTime() : (y as number));
        if ('gte' in o && !(x != null && n(x) >= n(o.gte))) return false;
        if ('lte' in o && !(x != null && n(x) <= n(o.lte))) return false;
        if ('gt' in o && !(x != null && n(x) > n(o.gt))) return false;
        if ('lt' in o && !(x != null && n(x) < n(o.lt))) return false;
        if ('startsWith' in o && !String(x ?? '').startsWith(String(o.startsWith))) return false;
        return true;
      }
      const rel = RELACOES[k];
      if (rel) {
        if (k === 'lead' && 'orgId' in o && Object.keys(o).length === 1) return l.orgId === o.orgId;
        const pai = de(rel.tabela).find((p) => p.id === l[rel.fk]);
        return !!pai && confere(pai, o);
      }
      return true;
    }
    return x === v;
  };
  const confere = (l: Linha, where: Linha = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      if (k === 'OR') return (v as Linha[]).some((w) => confere(l, w));
      if (k === 'AND') return (v as Linha[]).every((w) => confere(l, w));
      return vale(l, k, v);
    });
  const ordenar = (rows: Linha[], orderBy: unknown) => {
    const ordens = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, 'asc' | 'desc'>>;
    return [...rows].sort((a, b) => {
      for (const o of ordens) {
        const [k, dir] = Object.entries(o)[0];
        const x = a[k] as number | Date, y = b[k] as number | Date;
        if (x < y) return dir === 'asc' ? -1 : 1;
        if (x > y) return dir === 'asc' ? 1 : -1;
      }
      return 0;
    });
  };
  const comInclude = (nome: string, l: Linha, include?: Record<string, unknown>) => {
    const r = { ...l };
    for (const k of Object.keys(include ?? {})) {
      const rel = RELACOES[k];
      if (rel) r[k] = de(rel.tabela).find((p) => p.id === l[rel.fk]) ?? null;
      if (nome === 'comercialContrato' && k === 'signatarios') r[k] = [];
    }
    return r;
  };
  const conflito = (nome: string, l: Linha) =>
    de(nome).some((x) => x.id === l.id) ||
    (UNICOS[nome] ?? []).some((cols) => cols.every((c) => l[c] != null) && de(nome).some((x) => cols.every((c) => x[c] === l[c])));
  // O gatilho `mktos_orgid_do_pai`: a filha sem empresa herda a do lead.
  const nova = (nome: string, data: Linha): Linha => ({
    id: `${nome}-${++seq}`, createdAt: new Date(), criadoEm: new Date(), updatedAt: new Date(), atualizadoEm: new Date(), ...data,
    ...(!data.orgId && data.leadId ? { orgId: de('lead').find((l) => l.id === data.leadId)?.orgId ?? '' } : {}),
  });

  const tabela = (nome: string) => ({
    findMany: async (a: { where?: Linha; orderBy?: unknown; take?: number; include?: Record<string, unknown> } = {}) => {
      const rows = ordenar(de(nome).filter((l) => confere(l, a.where)), a.orderBy).map((l) => comInclude(nome, l, a.include));
      return a.take ? rows.slice(0, a.take) : rows;
    },
    findFirst: async (a: { where?: Linha; orderBy?: unknown; include?: Record<string, unknown> } = {}) => {
      const r = ordenar(de(nome).filter((l) => confere(l, a.where)), a.orderBy)[0];
      return r ? comInclude(nome, r, a.include) : null;
    },
    findUnique: async (a: { where: Linha; include?: Record<string, unknown> }) => {
      const r = de(nome).find((l) => confere(l, a.where));
      return r ? comInclude(nome, r, a.include) : null;
    },
    findFirstOrThrow: async (a: { where?: Linha }) => {
      const r = de(nome).find((l) => confere(l, a.where));
      if (!r) throw new Error(`${nome} não encontrado`);
      return { ...r };
    },
    findUniqueOrThrow: async (a: { where: Linha; include?: Record<string, unknown> }) => {
      const r = de(nome).find((l) => confere(l, a.where));
      if (!r) throw new Error(`${nome} não encontrado`);
      return comInclude(nome, r, a.include);
    },
    count: async (a: { where?: Linha } = {}) => de(nome).filter((l) => confere(l, a.where)).length,
    create: async (a: { data: Linha }) => {
      const l = nova(nome, a.data);
      if (conflito(nome, l)) throw new Error(`único violado em ${nome}`);
      de(nome).push(l);
      escritas.push({ tabela: nome, op: 'create', data: a.data });
      return { ...l };
    },
    createMany: async (a: { data: Linha[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const d of a.data) {
        const l = nova(nome, d);
        if (conflito(nome, l)) {
          if (a.skipDuplicates) continue;
          throw new Error(`único violado em ${nome}`);
        }
        de(nome).push(l);
        count++;
        escritas.push({ tabela: nome, op: 'createMany', data: d });
      }
      return { count };
    },
    update: async (a: { where: Linha; data: Linha }) => {
      const l = de(nome).find((x) => confere(x, a.where));
      if (!l) throw new Error(`${nome} não encontrado para update`);
      Object.assign(l, a.data);
      escritas.push({ tabela: nome, op: 'update', where: a.where, data: a.data });
      return { ...l };
    },
    updateMany: async (a: { where: Linha; data: Linha }) => {
      const ls = de(nome).filter((x) => confere(x, a.where));
      for (const l of ls) Object.assign(l, a.data);
      if (ls.length) escritas.push({ tabela: nome, op: 'updateMany', where: a.where, data: a.data });
      return { count: ls.length };
    },
    deleteMany: async (a: { where?: Linha } = {}) => {
      const antes = de(nome).length;
      t[nome] = de(nome).filter((x) => !confere(x, a.where));
      return { count: antes - t[nome].length };
    },
  });
  const db = new Proxy({} as Record<string, unknown>, {
    get(_alvo, prop: string) {
      if (prop === 'then') return undefined;
      if (prop === '$transaction') return async (fn: unknown) => (typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(db) : Promise.all(fn as Promise<unknown>[]));
      if (prop === '$executeRaw') return async (_p: TemplateStringsArray, ...v: unknown[]) => { cadeados.push(String(v[0])); return 1; };
      if (prop === '$executeRawUnsafe') return async () => 0;
      if (prop === '$queryRawUnsafe') return async () => [];
      return tabela(prop);
    },
  });
  return { db: db as never, t, de, escritas, cadeados };
}

/** O fio de mentira: grava no `leadEvent` com o id de verdade e não repete o fato. */
function fioDe(b: ReturnType<typeof banco>) {
  return {
    registrar: vi.fn(async (orgId: string, leadId: string, type: string, chave: string, payload: unknown, op: { em?: Date } = {}) => {
      const id = eventoIdComercial(orgId, leadId, type as never, chave);
      if (b.de('leadEvent').some((e) => e.id === id)) return { eventoId: id, novo: false };
      b.de('leadEvent').push({ id, orgId, leadId, type, chave, payload, occurredAt: op.em ?? new Date() });
      return { eventoId: id, novo: true };
    }),
  };
}

const dia = (s: string) => new Date(`${s}T00:00:00Z`);
const meioDia = (s: string) => new Date(`${s}T12:00:00-03:00`);

function base(extra: Record<string, Linha[]> = {}) {
  return banco({
    partner: [
      { id: 'p-cliente', orgId: CASA, razaoSocial: 'Papeleira Ltda', nomeFantasia: 'Papeleira', cnpjCpf: '11222333000181', isCliente: true, interno: false, principalId: null, email: null },
      { id: 'p-repetido', orgId: CASA, razaoSocial: 'Papeleira (Ana)', nomeFantasia: null, cnpjCpf: null, isCliente: true, interno: false, principalId: 'p-cliente', email: null },
    ],
    comercialContrato: [{ id: 'cc-1', orgId: CASA, leadId: 'lead-1', tipo: 'contrato', estado: 'assinado', partnerId: null, documentoId: 'doc-1', criadoEm: dia('2026-10-01') }],
    ...extra,
  });
}

const cobrancas = [
  { numero: 1, valorCentavos: 100000, vence: meioDia('2026-11-05'), pagaEm: meioDia('2026-11-04'), asaasPaymentId: 'pay_1' },
  { numero: 2, valorCentavos: 100000, vence: meioDia('2026-12-05'), pagaEm: null, asaasPaymentId: 'pay_2' },
  { numero: 3, valorCentavos: 100100, vence: meioDia('2027-01-05'), pagaEm: null, asaasPaymentId: 'pay_3' },
];
const entrada = (extra: Partial<EntradaDoDinheiro> = {}): EntradaDoDinheiro => ({
  orgId: CASA, leadId: 'lead-1', partnerId: 'p-cliente', cliente: 'Papeleira Ltda', produto: 'Imersão', valorCentavos: 300100,
  fechadoEm: meioDia('2026-11-04'), parcelas: cobrancas, ...extra,
});

describe('F-03: o acordo do contrato', () => {
  it('sem acordo do cliente: cria um com id derivado do contrato, as parcelas das cobranças e o cliente no registro', async () => {
    const b = base();
    const plano = await planejarDinheiro(b.db, entrada());
    expect(plano.acordo).toMatchObject({ acao: 'criar', id: idDoAcordoDoContrato(CASA, 'cc-1') });
    const r = await aplicarDinheiro(b.db, entrada(), plano);
    expect(r).toMatchObject({ contratoId: 'cc-1', criadas: 3, acao: 'criar' });
    const acordo = b.de('acordoComercial')[0];
    expect(acordo).toMatchObject({ id: idDoAcordoDoContrato(CASA, 'cc-1'), cliente: 'Papeleira Ltda', produto: 'Imersão', tipo: 'pagante', partnerId: 'p-cliente', comercialContratoId: 'cc-1' });
    expect(Number(acordo.valor)).toBe(3001);
    expect((acordo.fechadoEm as Date).toISOString().slice(0, 10)).toBe('2026-11-04');
    const ps = b.de('acordoParcela');
    expect(ps.map((p) => [p.numero, Number(p.valor), (p.vencimento as Date).toISOString().slice(0, 10), p.asaasPaymentId, p.pagaEm ? (p.pagaEm as Date).toISOString().slice(0, 10) : null]))
      .toEqual([[1, 1000, '2026-11-05', 'pay_1', '2026-11-04'], [2, 1000, '2026-12-05', 'pay_2', null], [3, 1001, '2027-01-05', 'pay_3', null]]);
    expect(ps[0].id).toBe(idDaParcelaDoContrato(CASA, acordo.id as string, 1));
    expect(b.de('comercialContrato')[0].partnerId).toBe('p-cliente');
  });

  it('rodar de novo cai no acordo ligado: nenhuma parcela nova, nenhuma escrita', async () => {
    const b = base();
    await aplicarDinheiro(b.db, entrada(), await planejarDinheiro(b.db, entrada()));
    const antes = b.escritas.length;
    const plano = await planejarDinheiro(b.db, entrada());
    expect(plano.acordo?.acao).toBe('ligado');
    expect(plano.criar).toHaveLength(0);
    expect(plano.adotar).toHaveLength(3);
    const r = await aplicarDinheiro(b.db, entrada(), plano);
    expect(r.criadas).toBe(0);
    expect(b.escritas.length).toBe(antes);
    expect(b.de('acordoParcela')).toHaveLength(3);
  });

  it('adota o único acordo pagante do cliente (no cadastro repetido): só as colunas de ligação mudam', async () => {
    const b = base({
      acordoComercial: [{ id: 'ac-mao', orgId: CASA, cliente: 'Papeleira', produto: 'Imersão (à mão)', valor: new Prisma.Decimal(2970), tipo: 'pagante', partnerId: 'p-repetido', comercialContratoId: null, observacao: 'digitado pelo Pedro' }],
      acordoParcela: [
        { id: 'ap-1', orgId: CASA, acordoId: 'ac-mao', numero: 1, valor: new Prisma.Decimal(990), vencimento: dia('2026-11-05'), asaasPaymentId: null, pagaEm: dia('2026-11-04'), notaFiscal: 'NF-7' },
      ],
    });
    const plano = await planejarDinheiro(b.db, entrada());
    expect(plano.acordo).toMatchObject({ acao: 'adotar', id: 'ac-mao' });
    expect(plano.vestir).toEqual([{ id: 'ap-1', numero: 1, asaasPaymentId: 'pay_1' }]);
    expect(plano.criar.map((p) => p.numero)).toEqual([2, 3]);
    await aplicarDinheiro(b.db, entrada(), plano);
    const acordo = b.de('acordoComercial')[0];
    expect(acordo).toMatchObject({ cliente: 'Papeleira', produto: 'Imersão (à mão)', observacao: 'digitado pelo Pedro', partnerId: 'p-repetido', comercialContratoId: 'cc-1' });
    expect(Number(acordo.valor)).toBe(2970);
    // A parcela digitada guarda o valor, a NF e o pagamento; só ganha o id da cobrança.
    expect(b.de('acordoParcela').find((p) => p.id === 'ap-1')).toMatchObject({ asaasPaymentId: 'pay_1', notaFiscal: 'NF-7' });
    expect(Number(b.de('acordoParcela').find((p) => p.id === 'ap-1')!.valor)).toBe(990);
    expect(b.de('acordoParcela')).toHaveLength(3);
  });

  it('adota o acordo de uma parcela que o sync do Asaas já vestiu, mesmo de outro cliente no cadastro', async () => {
    const b = base({
      acordoComercial: [{ id: 'ac-sync', orgId: CASA, cliente: 'Papeleira', produto: 'Imersão', valor: new Prisma.Decimal(3001), tipo: 'pagante', partnerId: null, comercialContratoId: null }],
      acordoParcela: [{ id: 'ap-sync', orgId: CASA, acordoId: 'ac-sync', numero: 7, valor: new Prisma.Decimal(1000), vencimento: dia('2026-11-05'), asaasPaymentId: 'pay_1', pagaEm: null }],
    });
    const plano = await planejarDinheiro(b.db, entrada());
    expect(plano.acordo).toMatchObject({ acao: 'adotar', id: 'ac-sync' });
    expect(plano.adotar).toEqual([{ id: 'ap-sync', numero: 7 }]);
    await aplicarDinheiro(b.db, entrada(), plano);
    // O acordo sem cliente ganha o cliente do fechamento (era vazio).
    expect(b.de('acordoComercial')[0]).toMatchObject({ partnerId: 'p-cliente', comercialContratoId: 'cc-1' });
    expect(b.de('acordoParcela').filter((p) => p.asaasPaymentId === 'pay_1')).toHaveLength(1);
  });

  it('dois acordos pagantes do cliente: ambíguo, nada escrito, os dois nos candidatos', async () => {
    const b = base({
      acordoComercial: [
        { id: 'ac-a', orgId: CASA, cliente: 'Papeleira', produto: 'Imersão', valor: 1, tipo: 'pagante', partnerId: 'p-cliente', comercialContratoId: null },
        { id: 'ac-b', orgId: CASA, cliente: 'Papeleira', produto: 'Operação', valor: 1, tipo: 'pagante', partnerId: 'p-repetido', comercialContratoId: null },
      ],
    });
    const plano = await planejarDinheiro(b.db, entrada());
    expect(plano.acordo).toBeNull();
    expect(plano.ambiguo[0]).toMatch(/2 acordos pagantes/);
    expect(plano.candidatos.sort()).toEqual(['ac-a', 'ac-b']);
    await expect(aplicarDinheiro(b.db, entrada(), plano)).rejects.toThrow(/nada a aplicar/);
    expect(b.escritas).toHaveLength(0);
  });

  it('acordo com o nome do cliente e sem cliente ligado: ambíguo (criar outro contaria duas vezes)', async () => {
    const b = base({ acordoComercial: [{ id: 'ac-nome', orgId: CASA, cliente: 'PAPELEIRA', produto: 'x', valor: 1, tipo: 'permuta', partnerId: null, comercialContratoId: null }] });
    const plano = await planejarDinheiro(b.db, entrada());
    expect(plano.ambiguo[0]).toMatch(/nome do cliente/);
    expect(plano.candidatos).toEqual(['ac-nome']);
  });

  it('sem registro assinado: não liga (o dinheiro segue no contrato do Financeiro)', async () => {
    const b = base();
    b.de('comercialContrato')[0].estado = 'em_assinatura';
    const plano = await planejarDinheiro(b.db, entrada());
    expect(plano.semRegistro).toMatch(/não tem contrato assinado/);
    expect(plano.contrato).toBeNull();
  });

  it('o fechamento: ambíguo deixa o aviso `dinheiro.a_conciliar`, liga o cliente no registro e não liga acordo', async () => {
    const b = base({
      acordoComercial: [
        { id: 'ac-a', orgId: CASA, cliente: 'Papeleira', produto: 'Imersão', valor: 1, tipo: 'pagante', partnerId: 'p-cliente', comercialContratoId: null },
        { id: 'ac-b', orgId: CASA, cliente: 'Papeleira', produto: 'Operação', valor: 1, tipo: 'pagante', partnerId: 'p-cliente', comercialContratoId: null },
      ],
    });
    const fio = fioDe(b);
    const svc = new FechamentoService(b.db, fio as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const r = await (svc as unknown as { dinheiroDoContrato: (o: string, l: string, c: string, e: EntradaDoDinheiro) => Promise<{ contratoId: string | null; detalhe: string }> })
      .dinheiroDoContrato(CASA, 'lead-1', 'fech-lead-1-v1', entrada());
    expect(r.contratoId).toBeNull();
    expect(r.detalhe).toMatch(/dinheiro a conciliar/);
    expect(b.cadeados).toEqual([`comercial-contrato:${CASA}:lead-1`]);
    expect(fio.registrar).toHaveBeenCalledWith(CASA, 'lead-1', 'dinheiro.a_conciliar', 'fech-lead-1-v1:cc-1', expect.objectContaining({ contratoId: 'cc-1', acordos: ['ac-a', 'ac-b'] }));
    expect(b.de('comercialContrato')[0].partnerId).toBe('p-cliente');
    expect(b.de('acordoComercial').every((a) => a.comercialContratoId === null)).toBe(true);
  });

  it('o fechamento de quem fechou fora: o Contract nasce ligado ao registro, com a conta do Asaas e "Serviços Prestados"; o acordo com as parcelas declaradas', async () => {
    const sha = 'a'.repeat(64);
    const docId = uuidDe([CASA, 'comercial-documento', 'anexo', 'lead-1', sha]);
    const b = banco({
      partner: [{ id: 'p-cliente', orgId: CASA, razaoSocial: 'Papeleira Ltda', cnpjCpf: '11222333000181', isCliente: true, interno: false, principalId: null, email: 'a@b.c', nomeFantasia: null }],
      lead: [{ id: 'lead-1', orgId: CASA, name: 'Papeleira', phone: null, email: null }],
      comercialFicha: [{ id: 'f-1', orgId: CASA, leadId: 'lead-1', partnerId: 'p-cliente', trilhoId: null }],
      financeAccount: [
        { id: 'conta-velha', orgId: CASA, provider: 'manual', createdAt: dia('2025-01-01') },
        { id: 'conta-asaas', orgId: CASA, provider: 'asaas', createdAt: dia('2026-01-01') },
      ],
      chartAccount: [{ id: 'plano-servicos', orgId: CASA, codigo: '1.1.02', nome: 'Serviços Prestados' }],
    });
    const fio = fioDe(b);
    const svc = new FechamentoService(b.db, fio as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const aceite: AceiteDoLead = {
      versao: 1, produto: 'imersao' as never, valorCentavos: 297000, parcelas: 3, forma: 'pix' as never, hash: 'h', em: new Date(),
      dados: { cnpj: '11.222.333/0001-81', razaoSocial: 'Papeleira Ltda', endereco: 'Rua 1', quemAssina: 'Ana', email: 'a@b.c' },
      fora: { assinadoEm: '2026-10-30', primeiroVencimento: '2026-11-10', criarCobranca: false, motivoSemCobranca: 'pago por fora', arquivoSha256: sha, porId: 'u-1', por: 'Rodrigo' },
    };
    const r = await svc.executar(CASA, 'lead-1', aceite);
    const contrato = r.escritas.find((e) => e.escrita === 'contrato')!;
    expect(contrato.estado).toBe('criado');
    expect(contrato.detalhe).toMatch(/acordo criado/);
    const registro = b.de('comercialContrato').find((c) => c.documentoId === docId)!;
    expect(registro).toMatchObject({ partnerId: 'p-cliente', estado: 'assinado' });
    expect(b.de('contract')[0]).toMatchObject({ comercialContratoId: registro.id, accountId: 'conta-asaas', chartAccountId: 'plano-servicos', partnerId: 'p-cliente' });
    const acordo = b.de('acordoComercial')[0];
    expect(acordo.comercialContratoId).toBe(registro.id);
    expect(b.de('acordoParcela').map((p) => [p.numero, Number(p.valor), (p.vencimento as Date).toISOString().slice(0, 10), p.asaasPaymentId]))
      .toEqual([[1, 990, '2026-11-10', null], [2, 990, '2026-12-10', null], [3, 990, '2027-01-10', null]]);
    // As parcelas sem cobrança viram os previstos `parc_<id>` na conta do Asaas.
    const previstos = b.de('financeTransaction').filter((x) => String(x.externalId).startsWith('parc_'));
    expect(previstos).toHaveLength(3);
    expect(previstos.every((x) => x.accountId === 'conta-asaas' && x.status === 'previsto')).toBe(true);
  });
});

describe('F-04: o contrato do fechamento sai das projeções', () => {
  it('gerar lançamento recusa o contrato ligado, com o motivo em português', async () => {
    const b = banco({ contract: [{ id: 'k-1', orgId: CASA, comercialContratoId: 'cc-1', status: 'ativo', accountId: 'c', proximoVencimento: dia('2026-12-05'), periodicidade: 'mensal', tipo: 'entrada', valor: 1 }] });
    const apr = new AprService(b.db, {} as never);
    await expect(apr.gerarContrato(CASA, 'k-1', { vencimento: '2026-12-05T00:00:00.000Z' } as never, 'u-1')).rejects.toThrow(CONTRATO_DO_FECHAMENTO);
  });

  it('a cobrança do Asaas não veste o contrato ligado: os contratos de entrada da passagem não o trazem', async () => {
    const b = banco({
      contract: [
        { id: 'k-ligado', orgId: CASA, tipo: 'entrada', status: 'ativo', valor: 1000, partnerId: null, comercialContratoId: 'cc-1' },
        { id: 'k-solto', orgId: CASA, tipo: 'entrada', status: 'ativo', valor: 500, partnerId: null, comercialContratoId: null },
      ],
    });
    const v = await prepararVestir(b.db, CASA);
    expect(v.contratosDeEntrada.map((c) => c.id)).toEqual(['k-solto']);
  });

  it('todo leitor do Financeiro que projeta `Contract` pula o contrato ligado (catraca no código)', () => {
    for (const arq of ['finance.service.ts', 'analise.service.ts', 'parcelas.service.ts']) {
      const fonte = readFileSync(join(__dirname, '..', 'src', 'finance', arq), 'utf8');
      const chamadas = fonte.split('contract.findMany(').slice(1).map((c) => c.slice(0, 220));
      expect(chamadas.length).toBeGreaterThan(0);
      for (const c of chamadas) expect(c, `${arq}: ${c.slice(0, 80)}`).toMatch(/comercialContratoId: null/);
    }
  });
});

describe('F-05: a parcela paga no Financeiro avisa o Comercial', () => {
  function cenario() {
    const b = banco({
      comercialContrato: [{ id: 'cc-1', orgId: CASA, leadId: 'lead-1', tipo: 'contrato', estado: 'ativo' }],
      acordoComercial: [{ id: 'ac-1', orgId: CASA, comercialContratoId: 'cc-1' }, { id: 'ac-mao', orgId: CASA, comercialContratoId: null }],
      acordoParcela: [
        { id: 'ap-2', orgId: CASA, acordoId: 'ac-1', numero: 2, valor: new Prisma.Decimal(1000), pagaEm: dia('2026-12-06'), asaasPaymentId: 'pay_2' },
        { id: 'ap-3', orgId: CASA, acordoId: 'ac-1', numero: 3, valor: new Prisma.Decimal(1001), pagaEm: dia('2027-01-04'), asaasPaymentId: null },
        { id: 'ap-4', orgId: CASA, acordoId: 'ac-1', numero: 4, valor: new Prisma.Decimal(1001), pagaEm: dia('2027-02-04'), asaasPaymentId: 'pay_4' },
        { id: 'ap-solta', orgId: CASA, acordoId: 'ac-mao', numero: 1, valor: new Prisma.Decimal(9), pagaEm: dia('2026-12-01'), asaasPaymentId: null },
      ],
      comercialCobranca: [
        { id: 'cob-2', orgId: CASA, leadId: 'lead-1', provedor: 'asaas', externoId: 'pay_2', parcela: 2, parcelas: 4, valorCentavos: 100000, forma: 'pix', estado: 'pendente', pagaEm: null },
        { id: 'cob-4', orgId: CASA, leadId: 'lead-1', provedor: 'asaas', externoId: 'pay_4', parcela: 4, parcelas: 4, valorCentavos: 100100, forma: 'pix', estado: 'estornada', pagaEm: null },
      ],
    });
    const fio = fioDe(b);
    const dinheiro = new DinheiroService(b.db, fio as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    return { b, fio, dinheiro };
  }

  it('cobrança aberta: a rotina do webhook (mesma chave); à mão: chave do id da parcela; estornada e acordo solto ficam', async () => {
    const { b, fio, dinheiro } = cenario();
    expect(await dinheiro.pagasNoFinanceiro(CASA)).toEqual({ daCobranca: 1, aMao: 1 });
    expect(b.de('comercialCobranca').find((c) => c.id === 'cob-2')).toMatchObject({ estado: 'paga' });
    expect((b.de('comercialCobranca').find((c) => c.id === 'cob-2')!.pagaEm as Date).toISOString()).toBe('2026-12-06T15:00:00.000Z');
    expect(b.de('comercialCobranca').find((c) => c.id === 'cob-4')).toMatchObject({ estado: 'estornada', pagaEm: null });
    const fatos = fio.registrar.mock.calls.map((c) => [c[2], c[3]]);
    expect(fatos).toEqual([['parcela.paga', 'pay_2'], ['parcela.paga', 'ap-3']]);
    expect(fio.registrar.mock.calls[1][4]).toEqual({ parcela: 3, pagoEm: '2027-01-04T15:00:00.000Z', valorCentavos: 100100 });
  });

  it('a passagem seguinte não grava nada (idempotente)', async () => {
    const { fio, dinheiro } = cenario();
    await dinheiro.pagasNoFinanceiro(CASA);
    const chamadas = fio.registrar.mock.calls.length;
    expect(await dinheiro.pagasNoFinanceiro(CASA)).toEqual({ daCobranca: 0, aMao: 0 });
    expect(fio.registrar.mock.calls.length).toBe(chamadas);
  });

  it('o relógio tem a tarefa inscrita pelo fechamento', () => {
    const relogio = new RelogioComercialRegistry();
    const svc = new FechamentoService({} as never, {} as never, { inscrever: () => undefined } as never, { registrar: () => undefined } as never, {} as never, { pagasNoFinanceiro: async () => ({}) } as never, {} as never, {} as never, { aoDecidir: () => undefined } as never, undefined, undefined, relogio);
    svc.onModuleInit();
    expect(relogio.inscritas().map(([n]) => n)).toContain('dinheiro.pagas_no_financeiro');
  });

  it('contrato vivo: sem cobrança no lead, as parcelas vêm do acordo ligado ao registro', async () => {
    const b = banco({
      lead: [{ id: 'lead-1', orgId: CASA, name: 'Papeleira' }],
      comercialFicha: [{ id: 'f-1', orgId: CASA, leadId: 'lead-1', empresa: 'Papeleira Ltda', produto: 'imersao', valorCentavos: null }],
      comercialContrato: [{ id: 'cc-1', orgId: CASA, leadId: 'lead-1', tipo: 'contrato', estado: 'ativo', criadoEm: dia('2026-10-01') }],
      acordoComercial: [{ id: 'ac-1', orgId: CASA, comercialContratoId: 'cc-1' }],
      acordoParcela: [
        { id: 'ap-2', orgId: CASA, acordoId: 'ac-1', numero: 2, valor: new Prisma.Decimal(990), vencimento: dia('2026-12-10'), pagaEm: null },
        { id: 'ap-1', orgId: CASA, acordoId: 'ac-1', numero: 1, valor: new Prisma.Decimal(990), vencimento: dia('2026-11-10'), pagaEm: dia('2026-11-09') },
      ],
    });
    const vivo = new ContratoVivoService(b.db, {} as never, new RelogioComercialRegistry(), {} as never);
    const c = await vivo.doLead(CASA, 'lead-1', new Date('2026-12-15T15:00:00Z'));
    expect(c.parcelas).toEqual([
      { n: 1, total: 2, valorCentavos: 99000, vence: '2026-11-10', estado: 'paga', pagaEm: '2026-11-09T00:00:00.000Z', aviso: null },
      { n: 2, total: 2, valorCentavos: 99000, vence: '2026-12-10', estado: 'atrasada', pagaEm: null, aviso: null },
    ]);
    expect(c.valorCentavos).toBe(198000);
  });
});

describe('F-06: o sync acha a parcela pelo id do Asaas primeiro', () => {
  it('a cobrança já vestida não casa por nome com outra parcela livre', async () => {
    const b = banco({
      acordoComercial: [{ id: 'ac-1', orgId: CASA, cliente: 'Papeleira', apelidos: null, tipo: 'pagante', partnerId: 'p-1', partner: null }],
    });
    const v = {
      porPagamento: new Map([['pay_2', { id: 'ap-2', partnerId: 'p-1', pagaEm: null }]]),
      livres: [{ id: 'ap-livre', acordoId: 'ac-1', valor: 1000, vencimento: dia('2026-12-05'), chaves: ['papeleira'], partnerId: 'p-1' }],
      acordos: [], previstosDeContrato: [], contratosDeEntrada: [],
    };
    const r = await vestirCobranca(b.db, CASA, v, { id: 'pay_2', value: 1000, dueDate: '2026-12-05', description: 'Papeleira' } as AsaasPayment, 'Papeleira');
    expect(r.parcelaId).toBe('ap-2');
    expect(v.livres).toHaveLength(1);
  });
});

describe('o backfill: ensaio numa base de mentira', () => {
  it('lista por cliente: criar, adotar, ambíguo e fora; o ensaio não escreve nada', async () => {
    const b = banco({
      partner: [
        { id: 'p-a', orgId: CASA, razaoSocial: 'Alfa Ltda', nomeFantasia: null, principalId: null },
        { id: 'p-b', orgId: CASA, razaoSocial: 'Beta SA', nomeFantasia: null, principalId: null },
        { id: 'p-c', orgId: CASA, razaoSocial: 'Gama ME', nomeFantasia: null, principalId: null },
      ],
      lead: [{ id: 'lead-a', orgId: CASA }, { id: 'lead-b', orgId: CASA }, { id: 'lead-c', orgId: CASA }, { id: 'lead-d', orgId: CASA }],
      leadEvent: [
        { id: 'e-a', orgId: CASA, leadId: 'lead-a', type: 'cliente.ativo', payload: { chave: 'k', partnerId: 'p-a', contractId: 'k-a' }, occurredAt: dia('2026-10-10') },
        { id: 'e-b', orgId: CASA, leadId: 'lead-b', type: 'cliente.ativo', payload: { chave: 'k', partnerId: 'p-b', contractId: 'k-b' }, occurredAt: dia('2026-10-11') },
        { id: 'e-c', orgId: CASA, leadId: 'lead-c', type: 'cliente.ativo', payload: { chave: 'k', partnerId: 'p-c', contractId: 'k-c' }, occurredAt: dia('2026-10-12') },
        { id: 'e-d', orgId: CASA, leadId: 'lead-d', type: 'cliente.ativo', payload: { chave: 'k', importado: true }, occurredAt: dia('2026-10-13') },
      ],
      comercialFicha: [
        { id: 'f-a', orgId: CASA, leadId: 'lead-a', partnerId: 'p-a', contractId: 'k-a', produto: 'imersao', valorCentavos: 297000 },
        { id: 'f-b', orgId: CASA, leadId: 'lead-b', partnerId: 'p-b', contractId: 'k-b', produto: 'imersao', valorCentavos: 297000 },
        { id: 'f-c', orgId: CASA, leadId: 'lead-c', partnerId: 'p-c', contractId: 'k-c', produto: 'imersao', valorCentavos: 297000 },
      ],
      comercialContrato: [
        { id: 'cc-a', orgId: CASA, leadId: 'lead-a', tipo: 'contrato', estado: 'ativo', partnerId: 'p-a', criadoEm: dia('2026-10-01') },
        { id: 'cc-b', orgId: CASA, leadId: 'lead-b', tipo: 'contrato', estado: 'ativo', partnerId: null, criadoEm: dia('2026-10-01') },
        { id: 'cc-c', orgId: CASA, leadId: 'lead-c', tipo: 'contrato', estado: 'ativo', partnerId: 'p-c', criadoEm: dia('2026-10-01') },
      ],
      contract: [
        { id: 'k-a', orgId: CASA, comercialContratoId: null },
        { id: 'k-b', orgId: CASA, comercialContratoId: null },
        { id: 'k-c', orgId: CASA, comercialContratoId: null },
      ],
      comercialCobranca: ['a', 'b', 'c'].flatMap((x) => [1, 2].map((n) => ({
        id: `cob-${x}-${n}`, orgId: CASA, leadId: `lead-${x}`, provedor: 'asaas', externoId: `pay_${x}${n}`, parcela: n, parcelas: 2, valorCentavos: 148500, vence: meioDia(`2026-1${n}-05`), pagaEm: null,
      }))),
      acordoComercial: [
        { id: 'ac-b', orgId: CASA, cliente: 'Beta', tipo: 'pagante', partnerId: 'p-b', comercialContratoId: null },
        { id: 'ac-c1', orgId: CASA, cliente: 'Gama', tipo: 'pagante', partnerId: 'p-c', comercialContratoId: null },
        { id: 'ac-c2', orgId: CASA, cliente: 'Gama 2', tipo: 'pagante', partnerId: 'p-c', comercialContratoId: null },
      ],
      financeTransaction: [{ id: 'tx-c', orgId: CASA, contractId: 'k-c', status: 'previsto' }],
    });
    const linhas = await planejarBackfill(b.db, CASA, '2026-11-03');
    expect(b.escritas).toHaveLength(0);
    const por = new Map(linhas.map((l) => [l.leadId, l]));
    expect(por.get('lead-a')!.plano!.acordo).toMatchObject({ acao: 'criar' });
    expect(por.get('lead-a')!.plano!.criar).toHaveLength(2);
    expect(por.get('lead-b')!.plano!.acordo).toMatchObject({ acao: 'adotar', id: 'ac-b' });
    expect(por.get('lead-c')!.plano!.ambiguo[0]).toMatch(/2 acordos pagantes/);
    expect(por.get('lead-c')!.ambiguo[0]).toMatch(/1 lançamento\(s\) previsto/);
    expect(por.get('lead-d')!.fora).toMatch(/importado/);
    expect(linhas.filter(temTrabalho).map((l) => l.leadId)).toEqual(['lead-a', 'lead-b']);

    const tabela = tabelaDoEnsaio(linhas);
    expect(tabela).toContain('| lead | registro (estado) | contrato do Financeiro | acordo | parcelas | situação |');
    expect(tabela).toContain(`| ${'lead-a'.slice(0, 8)} | cc-a (ativo) | k-a → ligar | criar | criar 2 · adotar 0 · ligar cobrança 0 | aplicar |`);
    expect(tabela).toMatch(/lead-c .*\? ac-c1, ac-c2 .*AMBÍGUO: o cliente tem 2 acordos pagantes sem contrato; o contrato do Financeiro já gerou 1 lançamento\(s\) previsto\(s\)/);
    expect(tabela).toContain('fora: importado do CRM antigo');
    expect(tabela).toContain('4 cliente(s) ativo(s) · 2 a aplicar · 1 ambíguo(s) (ficam de fora) · 1 fora do backfill.');
    // Sem nome no console; o detalhe (fora do git) leva o nome.
    expect(tabela).not.toContain('Alfa');
    expect(tabelaDoEnsaio(linhas, true)).toContain('Alfa Ltda');
  });

  it('o SQL do desfazer: do último passo ao primeiro, só onde o valor ainda é o que o backfill gravou', () => {
    const sql = sqlDoDesfazer([
      { tabela: 'AcordoComercial', linha: 'ac-1', coluna: '*', antes: null, depois: 'criado' },
      { tabela: 'Contract', linha: 'k-1', coluna: 'comercialContratoId', antes: null, depois: 'cc-1' },
    ], CASA);
    expect(sql.split('\n')).toEqual([
      'BEGIN;',
      `UPDATE "Contract" SET "comercialContratoId" = NULL WHERE "id" = 'k-1' AND "comercialContratoId" IS NOT DISTINCT FROM 'cc-1';`,
      `DELETE FROM "AcordoComercial" WHERE "id" = 'ac-1';`,
      `DELETE FROM "_diario_dinheiro_20261103" WHERE "orgId" = 'org-casa';`,
      'COMMIT;',
    ]);
  });
});
