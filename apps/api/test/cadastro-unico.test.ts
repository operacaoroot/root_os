import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';

import { acharOuCriarClienteDoFechamento, acharOuCriarClienteDoLead } from '../src/comercial/cliente-do-lead';
import { FichaService } from '../src/comercial/ficha.service';
import { AprService } from '../src/finance/apr.service';
import { acharClientePorNome } from '../src/work/clientes-da-casa';
import type { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * CADASTRO ÚNICO (03/11/2026), sem banco: o mesmo cliente não vira dois `Partner`.
 *
 *  F-01 achar ou criar o cliente pela mesma régua: o repetido (`principalId`) devolve o
 *       principal; o fechamento sem CNPJ que case acha pelo nome e preenche só o vazio;
 *       sem nada que case, nasce o cliente como antes. O "criar parceiro" do Financeiro
 *       devolve o cliente que já existe.
 *  F-02 a empresa renomeada na ficha vira o `nomeFantasia` do cadastro; a razão social e
 *       o `AcordoComercial.cliente` ficam; o nome antigo entra nos apelidos uma vez.
 *
 * O banco é um dublê em memória com só o que estas funções usam (filtro por igualdade,
 * `in`, `not`); cada escrita fica anotada, e os cadeados também.
 */

const CASA = 'org-casa';
const VIZINHA = 'org-vizinha';

interface LinhaPartner {
  id: string; orgId: string; razaoSocial: string; nomeFantasia: string | null; cnpjCpf: string | null; email: string | null; phone: string | null;
  isCliente: boolean; isFornecedor: boolean; interno: boolean; ativo: boolean; principalId: string | null; createdAt: Date;
}
type Linha = Record<string, unknown>;

let relogio = 0;
const partner = (id: string, razaoSocial: string, extra: Partial<LinhaPartner> = {}): LinhaPartner => ({
  id, orgId: CASA, razaoSocial, nomeFantasia: null, cnpjCpf: null, email: null, phone: null,
  isCliente: true, isFornecedor: false, interno: false, ativo: true, principalId: null, createdAt: new Date(2026, 0, 1, 0, 0, ++relogio), ...extra,
});

function confere(l: Linha, where: Linha = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const o = v as { in?: unknown[]; not?: unknown };
      if ('in' in o) return o.in!.includes(l[k]);
      if ('not' in o) return l[k] !== o.not;
    }
    return l[k] === v;
  });
}

function bancoEmMemoria(tabelas: { partners?: LinhaPartner[]; fichas?: Linha[]; acordos?: Linha[]; leads?: Linha[] }) {
  const t: Record<string, Linha[]> = {
    partner: [...(tabelas.partners ?? [])] as unknown as Linha[],
    comercialFicha: [...(tabelas.fichas ?? [])],
    acordoComercial: [...(tabelas.acordos ?? [])],
    lead: [...(tabelas.leads ?? [])],
  };
  const escritas: Array<{ tabela: string; op: string; where?: Linha; data: Linha }> = [];
  const cadeados: string[] = [];
  let seq = 0;
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
  const tabela = (nome: string) => ({
    findFirst: async (a: { where?: Linha; orderBy?: unknown }) => {
      const r = ordenar(t[nome].filter((l) => confere(l, a.where)), a.orderBy)[0];
      return r ? { ...r } : null;
    },
    findMany: async (a: { where?: Linha; orderBy?: unknown } = {}) => ordenar(t[nome].filter((l) => confere(l, a.where)), a.orderBy).map((l) => ({ ...l })),
    create: async (a: { data: Linha }) => {
      const l = { id: `${nome}-novo-${++seq}`, createdAt: new Date(2027, 0, 1, 0, 0, seq), ...a.data };
      t[nome].push(l);
      escritas.push({ tabela: nome, op: 'create', data: a.data });
      return { ...l };
    },
    createMany: async () => ({ count: 0 }),
    update: async (a: { where: Linha; data: Linha }) => {
      const l = t[nome].find((x) => confere(x, a.where))!;
      Object.assign(l, a.data);
      escritas.push({ tabela: nome, op: 'update', where: a.where, data: a.data });
      return { ...l };
    },
    updateMany: async (a: { where: Linha; data: Linha }) => {
      const ls = t[nome].filter((x) => confere(x, a.where));
      for (const l of ls) Object.assign(l, a.data);
      escritas.push({ tabela: nome, op: 'updateMany', where: a.where, data: a.data });
      return { count: ls.length };
    },
  });
  const db: Record<string, unknown> = {
    partner: tabela('partner'),
    comercialFicha: tabela('comercialFicha'),
    acordoComercial: tabela('acordoComercial'),
    lead: tabela('lead'),
    auditLog: { create: async (a: { data: Linha }) => { escritas.push({ tabela: 'auditLog', op: 'create', data: a.data }); return { id: `audit-${++seq}` }; } },
    leadEvent: { createMany: async () => ({ count: 1 }) },
    $executeRaw: async (_partes: TemplateStringsArray, ...valores: unknown[]) => { cadeados.push(String(valores[0])); return 1; },
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db, tx: db as unknown as Prisma.TransactionClient, t, escritas, cadeados, partnerDe: (id: string) => t.partner.find((p) => p.id === id) as unknown as LinhaPartner };
}

describe('F-01: o repetido devolve o principal', () => {
  it('acharClientePorNome: o nome do repetido leva ao principal, com o nome do principal', async () => {
    const b = bancoEmMemoria({ partners: [
      partner('p-curral', 'Curral Agropecuária Ltda'),
      partner('p-curral-2', 'Curral (Marcelo Alves Meroto)', { nomeFantasia: 'Curral', principalId: 'p-curral' }),
    ] });
    expect(await acharClientePorNome(b.tx, CASA, 'curral')).toEqual({ id: 'p-curral', nome: 'Curral Agropecuária Ltda' });
  });

  it('acharClientePorNome: o principal vence o repetido de mesmo nome, mesmo mais novo', async () => {
    const b = bancoEmMemoria({ partners: [
      partner('p-velho-2', 'ProMedical', { principalId: 'p-outro' }),
      partner('p-outro', 'Pro Medical Serviços'),
      partner('p-promedical', 'ProMedical'),
    ] });
    expect((await acharClientePorNome(b.tx, CASA, 'ProMedical'))?.id).toBe('p-promedical');
  });

  it('acharClientePorNome: principal fora desta empresa (ou que não é cliente) não vale; fica o achado', async () => {
    const b = bancoEmMemoria({ partners: [
      partner('p-vizinha', 'Custeio Matriz', { orgId: VIZINHA }),
      partner('p-fornecedor', 'Custeio Fornecedor', { isCliente: false, isFornecedor: true }),
      partner('p-custeio-a', 'Custeio', { principalId: 'p-vizinha' }),
    ] });
    expect((await acharClientePorNome(b.tx, CASA, 'Custeio'))?.id).toBe('p-custeio-a');
    b.partnerDe('p-custeio-a').principalId = 'p-fornecedor';
    expect((await acharClientePorNome(b.tx, CASA, 'Custeio'))?.id).toBe('p-custeio-a');
  });

  it('acharOuCriarClienteDoLead: ficha, CNPJ e nome apontando o repetido devolvem o principal, sob o cadeado do nome', async () => {
    const b = bancoEmMemoria({ partners: [
      partner('p-curral', 'Curral'),
      partner('p-curral-2', 'Curral (Marcelo Alves Meroto)', { cnpjCpf: '12345678000190', principalId: 'p-curral' }),
    ] });
    const base = { nome: 'Curral (Marcelo Alves Meroto)', cnpj: null, telefone: null, email: null };
    expect(await acharOuCriarClienteDoLead(b.tx, CASA, { ...base, partnerIdDaFicha: 'p-curral-2' })).toEqual({ id: 'p-curral', como: 'ficha' });
    expect(await acharOuCriarClienteDoLead(b.tx, CASA, { ...base, partnerIdDaFicha: null, cnpj: '12.345.678/0001-90' })).toEqual({ id: 'p-curral', como: 'cnpj' });
    expect(await acharOuCriarClienteDoLead(b.tx, CASA, { ...base, partnerIdDaFicha: null })).toEqual({ id: 'p-curral', como: 'nome' });
    expect(b.cadeados).toEqual(Array(3).fill(`cliente-por-nome:${CASA}:curral marcelo alves meroto`));
    expect(b.escritas.filter((e) => e.op === 'create')).toEqual([]);
  });
});

describe('F-01: o fechamento acha pelo nome antes de criar', () => {
  const aceite = { razaoSocial: 'Curral', email: 'financeiro@curral.com.br', telefone: '5511999990000', apontarFicha: true };
  const ficha = { id: 'f-1', leadId: 'l-1', orgId: CASA, partnerId: null };

  it('sem cliente com o CNPJ, reaproveita o de mesmo nome e preenche só o CNPJ e o e-mail vazios', async () => {
    const b = bancoEmMemoria({ partners: [partner('p-curral', 'Curral', { phone: '5511888880000' })], fichas: [{ ...ficha }] });
    const r = await acharOuCriarClienteDoFechamento(b.tx, CASA, 'l-1', { ...aceite, doc: '12345678000190' });
    expect(r).toEqual({ estado: 'reaproveitado', detalhe: 'cliente já existia com este nome', ref: 'p-curral' });
    expect(b.partnerDe('p-curral')).toMatchObject({ cnpjCpf: '12345678000190', email: 'financeiro@curral.com.br', phone: '5511888880000', razaoSocial: 'Curral' });
    expect(b.t.comercialFicha[0].partnerId).toBe('p-curral');
    expect(b.t.partner).toHaveLength(1);
    expect(b.cadeados).toEqual([`cliente-por-nome:${CASA}:curral`]);
  });

  it('o e-mail que o cadastro já tem não é trocado; a ficha que já valia não troca de ponteiro', async () => {
    const b = bancoEmMemoria({ partners: [partner('p-curral', 'Curral', { email: 'contato@curral.com.br' })], fichas: [{ ...ficha, partnerId: 'p-outro' }] });
    await acharOuCriarClienteDoFechamento(b.tx, CASA, 'l-1', { ...aceite, doc: '', apontarFicha: false });
    expect(b.partnerDe('p-curral')).toMatchObject({ email: 'contato@curral.com.br', cnpjCpf: null });
    expect(b.escritas).toEqual([]);
    expect(b.t.comercialFicha[0].partnerId).toBe('p-outro');
  });

  it('pelo nome do repetido, reaproveita o principal', async () => {
    const b = bancoEmMemoria({ partners: [partner('p-curral', 'Curral Agropecuária'), partner('p-curral-2', 'Curral', { principalId: 'p-curral' })], fichas: [{ ...ficha }] });
    const r = await acharOuCriarClienteDoFechamento(b.tx, CASA, 'l-1', { ...aceite, doc: '' });
    expect(r.ref).toBe('p-curral');
    expect(b.t.comercialFicha[0].partnerId).toBe('p-curral');
  });

  it('o CNPJ que casa num repetido devolve o principal', async () => {
    const b = bancoEmMemoria({ partners: [partner('p-curral', 'Curral'), partner('p-curral-2', 'Curral (Marcelo)', { cnpjCpf: '12345678000190', principalId: 'p-curral' })], fichas: [{ ...ficha }] });
    const r = await acharOuCriarClienteDoFechamento(b.tx, CASA, 'l-1', { ...aceite, doc: '12345678000190' });
    expect(r).toEqual({ estado: 'reaproveitado', detalhe: 'cliente já existia com este CNPJ', ref: 'p-curral' });
    expect(b.t.comercialFicha[0].partnerId).toBe('p-curral');
  });

  it('sem CNPJ nem nome que case, nasce o cliente como antes (fornecedor de nome igual não conta)', async () => {
    const b = bancoEmMemoria({ partners: [partner('p-forn', 'Curral', { isCliente: false, isFornecedor: true, cnpjCpf: '12345678000190' })], fichas: [{ ...ficha }] });
    const r = await acharOuCriarClienteDoFechamento(b.tx, CASA, 'l-1', { ...aceite, doc: '12345678000190' });
    expect(r.estado).toBe('criado');
    expect(r.detalhe).toBe('Curral');
    expect(b.partnerDe(r.ref)).toMatchObject({ orgId: CASA, isCliente: true, razaoSocial: 'Curral', cnpjCpf: '12345678000190', email: 'financeiro@curral.com.br', phone: '5511999990000' });
    expect(b.partnerDe('p-forn')).toMatchObject({ isCliente: false });
    expect(b.t.comercialFicha[0].partnerId).toBe(r.ref);
  });

  it('o de nome igual com OUTRO CNPJ não é o mesmo cliente: nasce outro', async () => {
    const b = bancoEmMemoria({ partners: [partner('p-curral', 'Curral', { cnpjCpf: '99999999000199' })], fichas: [{ ...ficha }] });
    const r = await acharOuCriarClienteDoFechamento(b.tx, CASA, 'l-1', { ...aceite, doc: '12345678000190' });
    expect(r.estado).toBe('criado');
    expect(b.partnerDe('p-curral').cnpjCpf).toBe('99999999000199');
  });

  it('o fechamento usa esta régua depois do cliente da ficha, com o aviso "a conciliar" intacto', () => {
    const fonte = readFileSync(join(__dirname, '..', 'src', 'comercial', 'fechamento.service.ts'), 'utf8');
    expect(fonte).toMatch(/acharOuCriarClienteDoFechamento\(tx, orgId, leadId, \{[\s\S]*?apontarFicha: !fichaAgora\?\.partnerId \|\| !!aviso/);
    expect(fonte).toMatch(/detalhe: comAviso\(c\.detalhe\)/);
    expect(fonte).not.toMatch(/tx\.partner\.create\(/);
  });
});

describe('F-01: o "criar parceiro" do Financeiro não duplica cliente', () => {
  const audit = (b: ReturnType<typeof bancoEmMemoria>) => ({ log: async (i: Linha, db: { auditLog: { create: (a: unknown) => Promise<unknown> } } = b.db as never) => { await db.auditLog.create({ data: i }); } }) as unknown as AuditService;

  it('cliente com o mesmo documento (com máscara) devolve o principal e diz por quê', async () => {
    const b = bancoEmMemoria({ partners: [partner('p-curral', 'Curral'), partner('p-curral-2', 'Curral (Marcelo)', { cnpjCpf: '12.345.678/0001-90', principalId: 'p-curral' })] });
    const r = await new AprService(b.db as unknown as PrismaService, audit(b)).createPartner(CASA, { razaoSocial: 'Curral Ltda', cnpjCpf: '12345678000190', isCliente: true }, 'u-1');
    expect(r).toMatchObject({ ok: true, id: 'p-curral', jaExistia: true, como: 'cnpj' });
    expect(r).toHaveProperty('mensagem', expect.stringMatching(/já existia com este documento/));
    expect(b.t.partner).toHaveLength(2);
  });

  it('cliente com o mesmo nome devolve o existente e ganha só o que estava vazio', async () => {
    const b = bancoEmMemoria({ partners: [partner('p-custeio', 'Custeio', { email: 'a@custeio.com' })] });
    const r = await new AprService(b.db as unknown as PrismaService, audit(b)).createPartner(CASA, { razaoSocial: 'CUSTEIO', cnpjCpf: '11222333000144', email: 'b@custeio.com', isCliente: true }, 'u-1');
    expect(r).toMatchObject({ id: 'p-custeio', jaExistia: true, como: 'nome' });
    expect(b.partnerDe('p-custeio')).toMatchObject({ cnpjCpf: '11222333000144', email: 'a@custeio.com' });
    expect(b.cadeados).toEqual([`cliente-por-nome:${CASA}:custeio`]);
  });

  it('sem cliente que case, ou fornecedor, cria como antes', async () => {
    const b = bancoEmMemoria({ partners: [partner('p-forn', 'Papeleira', { isCliente: false, isFornecedor: true })] });
    const apr = new AprService(b.db as unknown as PrismaService, audit(b));
    const r = await apr.createPartner(CASA, { razaoSocial: 'Papeleira', isCliente: true }, 'u-1');
    expect(r).toEqual({ ok: true, id: expect.stringMatching(/^partner-novo-/) });
    const f = await apr.createPartner(CASA, { razaoSocial: 'Papeleira', isFornecedor: true }, 'u-1');
    expect(f.id).not.toBe(r.id);
    expect(b.t.partner).toHaveLength(3);
  });
});

describe('F-02: a empresa renomeada na ficha muda o nome do cadastro', () => {
  afterEach(() => vi.restoreAllMocks());

  const montar = (acordo: Linha) => {
    const b = bancoEmMemoria({
      partners: [partner('p-curral', 'Curral Agropecuária Ltda', { nomeFantasia: 'Curral' }), partner('p-curral-2', 'Curral (Marcelo)', { principalId: 'p-curral' })],
      fichas: [{ id: 'f-1', leadId: 'l-1', orgId: CASA, partnerId: 'p-curral-2', empresa: 'Curral' }],
      acordos: [{ id: 'a-1', orgId: CASA, partnerId: 'p-curral', ...acordo }],
      leads: [{ id: 'l-1', orgId: CASA, name: 'Marcelo', enteredAt: new Date(2026, 9, 1) }],
    });
    vi.spyOn(FichaService.prototype as unknown as { projecao: () => Promise<unknown> }, 'projecao').mockResolvedValue({});
    const fio = { gravarNaTransacao: vi.fn(async () => ({ novo: true, evento: {} })) };
    const svc = new FichaService(b.db as unknown as PrismaService, fio as never, {} as never);
    return { b, svc, fio };
  };

  it('o principal ganha o nome fantasia novo; razão social e cliente do acordo ficam; o nome antigo entra nos apelidos', async () => {
    const { b, svc, fio } = montar({ cliente: 'Curral Agropecuária', apelidos: 'MARCELO A MEROTO' });
    await svc.editarIdentidade(CASA, 'l-1', { empresa: 'Curral do Marcelo' }, { id: 'u-1', nome: 'Lucas' });
    expect(b.partnerDe('p-curral')).toMatchObject({ nomeFantasia: 'Curral do Marcelo', razaoSocial: 'Curral Agropecuária Ltda' });
    expect(b.partnerDe('p-curral-2')).toMatchObject({ nomeFantasia: null, razaoSocial: 'Curral (Marcelo)' });
    expect(b.t.acordoComercial[0]).toMatchObject({ cliente: 'Curral Agropecuária', apelidos: 'MARCELO A MEROTO, Curral' });
    expect(b.t.comercialFicha[0].empresa).toBe('Curral do Marcelo');
    expect(fio.gravarNaTransacao).toHaveBeenCalledTimes(1);

    // Ida e volta: cada nome antigo entra uma vez só.
    await svc.editarIdentidade(CASA, 'l-1', { empresa: 'Curral' }, null);
    await svc.editarIdentidade(CASA, 'l-1', { empresa: 'Curral do Marcelo' }, null);
    expect(b.t.acordoComercial[0].apelidos).toBe('MARCELO A MEROTO, Curral, Curral do Marcelo');
  });

  it('o nome antigo que já é apelido (ou o cliente do acordo) não se repete', async () => {
    const { b, svc } = montar({ cliente: 'Curral', apelidos: null });
    await svc.editarIdentidade(CASA, 'l-1', { empresa: 'Curral do Marcelo' }, null);
    expect(b.t.acordoComercial[0].apelidos).toBeNull();
    expect(b.escritas.some((e) => e.tabela === 'acordoComercial')).toBe(false);
  });

  it('só o nome do contato mudou: o cadastro não é tocado', async () => {
    const { b, svc } = montar({ cliente: 'Curral', apelidos: null });
    await svc.editarIdentidade(CASA, 'l-1', { nome: 'Marcelo Meroto' }, null);
    expect(b.escritas.filter((e) => e.tabela === 'partner' || e.tabela === 'acordoComercial')).toEqual([]);
  });
});
