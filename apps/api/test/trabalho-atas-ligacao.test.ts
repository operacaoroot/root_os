import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { TrabAtaLigarSchema, type TrabAtaResumo } from '@mktos/shared';

import { PermissionsGuard } from '../src/auth/permissions.guard';
import { AtasController } from '../src/work/atas/atas.controller';
import type { AtasService, QuemDecide } from '../src/work/atas/atas.service';
import { LigacoesDasAtasService } from '../src/work/atas/ligacoes-das-atas.service';
import { SoGenteNasAtasGuard } from '../src/work/atas/so-gente-nas-atas.guard';

/*
 * Layout 26/10: A ATA LIGADA A UM LEAD OU A UM CLIENTE (sem banco).
 *
 * O que esta suíte cobra:
 *  1. as rotas novas: `ligadas` e `alvos` antes de `:ref`; ligar pede
 *     `tarefas.editar` e é de gente (conta de máquina não liga);
 *  2. ligar grava SÓ a linha da ligação e a auditoria: nada do comercial (o
 *     `ata.chegou` e as reações dele) é chamado;
 *  3. lead pede `leads.ver`; vault e Drive pedem a leitura da fonte (PA-2);
 *     cliente só o principal, ativo e cliente;
 *  4. ausente não mexe, `null` desliga, sem lead e sem cliente a linha some;
 *  5. a ata da memória é relida (título e data da ata); a do Drive e a do
 *     Granola guardam o título e a data da lista;
 *  6. `ligadas` esconde vault e Drive de quem não os lê, a mais nova primeiro.
 */

const ORG = 'org-1';
const GENTE: QuemDecide = { id: 'u-1', papeis: [] };
const LEAD = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const REPETIDO = '33333333-3333-4333-8333-333333333333';
const TUDO = { vault: true, drive: true, actorId: 'u-1', leads: true };

type Linha = {
  id: string; orgId: string; ataRef: string; leadId: string | null; clienteId: string | null;
  titulo: string; data: string | null; tipo: string; ligadaPor: string | null; criadaEm: Date; atualizadaEm: Date;
};

/** O Prisma de mentira: só o que a ligação toca. Qualquer outra tabela não existe aqui (e explodiria). */
function montar() {
  const linhas = new Map<string, Linha>();
  let relogio = Date.parse('2026-10-26T12:00:00Z');
  const auditoria: Array<Record<string, unknown>> = [];
  const prisma = {
    ataLigacao: {
      findUnique: vi.fn(async ({ where }: { where: { orgId_ataRef: { orgId: string; ataRef: string } } }) => linhas.get(where.orgId_ataRef.ataRef) ?? null),
      findMany: vi.fn(async ({ where }: { where: { orgId: string; ataRef?: { in: string[] }; leadId?: string; clienteId?: string } }) =>
        [...linhas.values()].filter((l) =>
          l.orgId === where.orgId
          && (!where.ataRef || where.ataRef.in.includes(l.ataRef))
          && (where.leadId === undefined || l.leadId === where.leadId)
          && (where.clienteId === undefined || l.clienteId === where.clienteId))),
      upsert: vi.fn(async ({ create, update, where }: { create: Omit<Linha, 'id' | 'criadaEm' | 'atualizadaEm'>; update: Partial<Linha>; where: { orgId_ataRef: { ataRef: string } } }) => {
        const antes = linhas.get(where.orgId_ataRef.ataRef);
        const em = new Date((relogio += 1000));
        const nova: Linha = antes ? { ...antes, ...update, atualizadaEm: em } : { id: `l-${linhas.size + 1}`, ...create, criadaEm: em, atualizadaEm: em } as Linha;
        linhas.set(nova.ataRef, nova);
        return nova;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { ataRef: string } }) => ({ count: linhas.delete(where.ataRef) ? 1 : 0 })),
    },
    lead: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === LEAD ? { id: LEAD } : null)),
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] } } }) =>
        [{ id: LEAD, name: 'Ana Souza', ficha: { empresa: 'Padaria Exemplo' } }].filter((l) => !where.id || where.id.in.includes(l.id))),
    },
    partner: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; principalId?: null } }) =>
        // O cadastro repetido (aponta para o principal) não vale como alvo.
        where.id === CLIENTE ? { id: CLIENTE } : where.id === REPETIDO && where.principalId !== null ? { id: REPETIDO } : null),
      findMany: vi.fn(async () => [{ id: CLIENTE, razaoSocial: 'Exemplo Comércio Ltda', nomeFantasia: 'Exemplo' }]),
    },
    user: { findMany: vi.fn(async () => [{ id: 'u-1', name: 'Lucas' }]) },
  };
  const atas = {
    exigirGente: vi.fn(async (_o: string, q: QuemDecide) => {
      if (q.papeis.includes('ia_servico')) throw new ForbiddenException('máquina');
    }),
    exigirAta: vi.fn(async (_o: string, ref: string) => {
      if (ref !== 'memoria:nota1') throw new NotFoundException('Ata não encontrada.');
      return { ref, fonte: 'colada', tipo: 'ata', titulo: 'Kickoff Padaria', texto: '# Kickoff\nData: 2026-10-20\n\nfala', caminho: null, procedencia: '', atualizadaEm: new Date() };
    }),
  };
  const audit = { log: vi.fn(async (e: Record<string, unknown>) => { auditoria.push(e); }) };
  const svc = new LigacoesDasAtasService(prisma as never, atas as unknown as AtasService, audit as never);
  return { svc, prisma, atas, audit, auditoria, linhas };
}

describe('a ata ligada: rotas e permissões (sem banco)', () => {
  const guarda = new PermissionsGuard(new Reflector());
  const soGente = new SoGenteNasAtasGuard();
  function contexto(metodo: keyof AtasController, permissions: string[], roles: string[] = []) {
    const handler = (AtasController.prototype as unknown as Record<string, unknown>)[metodo] as () => void;
    return {
      getHandler: () => handler,
      getClass: () => AtasController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', orgId: 'o', permissions, roles } }) }),
    } as never;
  }

  it('ler as ligadas e buscar é tarefas.ver; ligar é tarefas.editar e só gente', () => {
    expect(guarda.canActivate(contexto('ligadas', ['tarefas.ver']))).toBe(true);
    expect(guarda.canActivate(contexto('alvos', ['tarefas.ver']))).toBe(true);
    expect(() => guarda.canActivate(contexto('ligar', ['tarefas.ver']))).toThrow(ForbiddenException);
    expect(guarda.canActivate(contexto('ligar', ['tarefas.editar']))).toBe(true);
    expect(() => soGente.canActivate(contexto('ligar', ['tarefas.editar'], ['ia_servico']))).toThrow(ForbiddenException);
  });

  it('as rotas literais vêm antes de :ref', () => {
    const nomes = Object.getOwnPropertyNames(AtasController.prototype);
    for (const m of ['ligadas', 'alvos']) expect(nomes.indexOf(m)).toBeLessThan(nomes.indexOf('ler'));
  });

  it('o corpo: ausente não mexe, null desliga, e pedir nada é recusado', () => {
    expect(TrabAtaLigarSchema.safeParse({}).success).toBe(false);
    expect(TrabAtaLigarSchema.safeParse({ leadId: null }).success).toBe(true);
    expect(TrabAtaLigarSchema.safeParse({ clienteId: 'nao-e-uuid' }).success).toBe(false);
    expect(TrabAtaLigarSchema.safeParse({ leadId: LEAD, data: '26/10/2026' }).success).toBe(false);
  });
});

describe('a ata ligada: o serviço (sem banco)', () => {
  it('liga a ata da memória a um lead: relê título e data, grava só a ligação e a auditoria', async () => {
    const { svc, linhas, auditoria, atas } = montar();
    const l = await svc.ligar(ORG, GENTE, 'memoria:nota1', { leadId: LEAD, titulo: 'título da tela', data: '2020-01-01' }, TUDO);
    expect(l?.lead).toEqual({ id: LEAD, nome: 'Ana Souza' });
    expect(l?.cliente).toBeNull();
    expect(l?.ligadaPor).toBe('Lucas');
    expect(atas.exigirGente).toHaveBeenCalledOnce();
    const linha = linhas.get('memoria:nota1')!;
    expect(linha).toMatchObject({ leadId: LEAD, clienteId: null, titulo: 'Kickoff Padaria', data: '2026-10-20', tipo: 'ata', ligadaPor: 'u-1' });
    expect(auditoria).toEqual([expect.objectContaining({ action: 'trabalho.ata.ligada', entityId: 'memoria:nota1', after: { leadId: LEAD, clienteId: null } })]);
  });

  it('ligar o cliente depois mantém o lead; desligar os dois apaga a linha', async () => {
    const { svc, linhas, auditoria } = montar();
    await svc.ligar(ORG, GENTE, 'memoria:nota1', { leadId: LEAD }, TUDO);
    const ambos = await svc.ligar(ORG, GENTE, 'memoria:nota1', { clienteId: CLIENTE }, TUDO);
    expect(ambos?.lead?.id).toBe(LEAD);
    expect(ambos?.cliente).toEqual({ id: CLIENTE, nome: 'Exemplo' });
    const soCliente = await svc.ligar(ORG, GENTE, 'memoria:nota1', { leadId: null }, TUDO);
    expect(soCliente?.lead).toBeNull();
    expect(linhas.get('memoria:nota1')?.clienteId).toBe(CLIENTE);
    expect(await svc.ligar(ORG, GENTE, 'memoria:nota1', { clienteId: null }, TUDO)).toBeNull();
    expect(linhas.size).toBe(0);
    expect(auditoria.at(-1)).toMatchObject({ action: 'trabalho.ata.desligada', before: { leadId: null, clienteId: CLIENTE } });
  });

  it('a transcrição do Granola e o arquivo do Drive guardam o título e a data da lista, sem reabrir a fonte', async () => {
    const { svc, linhas, atas } = montar();
    await svc.ligar(ORG, GENTE, 'granola:reuniao1', { clienteId: CLIENTE, titulo: 'Reunião com a Padaria', data: '2026-10-21' }, TUDO);
    await svc.ligar(ORG, GENTE, 'drive:arquivo1', { clienteId: CLIENTE, titulo: 'Transcrição kickoff', data: null }, TUDO);
    expect(atas.exigirAta).not.toHaveBeenCalled();
    expect(linhas.get('granola:reuniao1')).toMatchObject({ titulo: 'Reunião com a Padaria', data: '2026-10-21', tipo: 'transcricao' });
    expect(linhas.get('drive:arquivo1')).toMatchObject({ titulo: 'Transcrição kickoff', data: null, tipo: 'transcricao' });
  });

  it('recusas: lead sem leads.ver, vault sem obsidian.ver, Drive sem drive.ver, máquina, alvo que não existe, cadastro repetido', async () => {
    const { svc, linhas } = montar();
    await expect(svc.ligar(ORG, GENTE, 'memoria:nota1', { leadId: LEAD }, { ...TUDO, leads: false })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.ligar(ORG, GENTE, 'vault:nota9', { clienteId: CLIENTE }, { ...TUDO, vault: false })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.ligar(ORG, GENTE, 'drive:arq9', { clienteId: CLIENTE }, { ...TUDO, drive: false })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.ligar(ORG, { id: 'bot', papeis: ['ia_servico'] }, 'memoria:nota1', { clienteId: CLIENTE }, TUDO)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.ligar(ORG, GENTE, 'memoria:nota1', { leadId: '44444444-4444-4444-8444-444444444444' }, TUDO)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.ligar(ORG, GENTE, 'memoria:nota1', { clienteId: REPETIDO }, TUDO)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.ligar(ORG, GENTE, 'outra-coisa', { clienteId: CLIENTE }, TUDO)).rejects.toBeInstanceOf(NotFoundException);
    expect(linhas.size).toBe(0);
  });

  it('a lista ganha ligadaA; ligadas esconde vault e Drive de quem não os lê, a mais nova primeiro', async () => {
    const { svc } = montar();
    await svc.ligar(ORG, GENTE, 'memoria:nota1', { clienteId: CLIENTE }, TUDO);
    await svc.ligar(ORG, GENTE, 'granola:reuniao1', { clienteId: CLIENTE, titulo: 'Reunião nova', data: '2026-10-25' }, TUDO);
    await svc.ligar(ORG, GENTE, 'drive:arquivo1', { clienteId: CLIENTE, titulo: 'Ata do Drive', data: '2026-10-22' }, TUDO);

    const resumo = (id: string) => ({ id, titulo: id } as TrabAtaResumo);
    const anotadas = await svc.anotar(ORG, [resumo('memoria:nota1'), resumo('memoria:sem')]);
    expect(anotadas[0].ligadaA?.cliente?.nome).toBe('Exemplo');
    expect(anotadas[1].ligadaA).toBeNull();

    const todas = await svc.ligadas(ORG, { clienteId: CLIENTE }, TUDO);
    expect(todas.map((a) => a.ataRef)).toEqual(['granola:reuniao1', 'drive:arquivo1', 'memoria:nota1']);
    const semDrive = await svc.ligadas(ORG, { clienteId: CLIENTE }, { vault: true, drive: false });
    expect(semDrive.map((a) => a.ataRef)).toEqual(['granola:reuniao1', 'memoria:nota1']);
  });

  it('a busca de lead pede leads.ver; a de cliente lista só clientes', async () => {
    const { svc, prisma } = montar();
    await expect(svc.candidatos(ORG, 'lead', 'ana', false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await svc.candidatos(ORG, 'lead', 'padaria', true)).toEqual([{ tipo: 'lead', id: LEAD, nome: 'Ana Souza', detalhe: 'Padaria Exemplo' }]);
    expect(await svc.candidatos(ORG, 'cliente', 'exem', true)).toEqual([{ tipo: 'cliente', id: CLIENTE, nome: 'Exemplo', detalhe: 'Exemplo Comércio Ltda' }]);
    const onde = (prisma.partner.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(onde).toMatchObject({ orgId: ORG, isCliente: true, ativo: true, interno: false, principalId: null });
  });
});
