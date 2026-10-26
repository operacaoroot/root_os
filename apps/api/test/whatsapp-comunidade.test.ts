import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { FILTROS_DA_CAIXA, ROTULO_DO_FILTRO, type FiltroDaCaixa } from '@mktos/shared';

// Quem age é gente ativa com a permissão: a releitura no banco é coberta pelas suítes com Postgres.
vi.mock('../src/auth/aprovador', () => ({ lerAprovador: vi.fn(async () => ({ ativo: true, papeis: ['admin_master'] })) }));
vi.mock('../src/memory/acesso-memoria', () => ({ exigirAcessoAtual: vi.fn(async () => undefined) }));

import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import type { RespostaDeGentePelaEvolution } from '../src/gateway/canais/evolution.port';
import type { PrismaService } from '../src/prisma/prisma.service';
import { CaixaDoWhatsappService, ondeDoFiltro } from '../src/whatsapp/caixa.service';
import { ResumoDoWhatsappService } from '../src/whatsapp/resumo.service';
import type { SincronizacaoDoWhatsappService } from '../src/whatsapp/sincronizacao.service';
import { ACAO_DE_AUDITORIA, FRASE } from '../src/whatsapp/vinculo';
import { SoGenteNoVinculoGuard, VinculoDoWhatsappController } from '../src/whatsapp/vinculo.controller';
import { VinculoDoWhatsappService } from '../src/whatsapp/vinculo.service';

/*
 * Layout 26/10: COMUNIDADE, o quarto tipo de conversa do WhatsApp (ao lado de
 * lead, cliente e equipe), e a mensagem que sai como ROOT. Sem banco: um dublê
 * em memória do Prisma, só com o que estes caminhos leem e escrevem.
 *
 *  1. a rota: `leads.editar` e só de gente, como a equipe;
 *  2. o filtro da caixa e o resumo do Dia a dia: comunidade é faixa própria,
 *     fora de leads, clientes e sem vínculo, e entra no total como a equipe;
 *  3. marcar e tirar: tira da equipe, 409 com lead ou cliente, auditado, e o
 *     casamento automático não a devolve à equipe;
 *  4. responder pela caixa: vai à porta SÓ o texto digitado (sem nome de
 *     pessoa); quem enviou fica gravado dentro do OS.
 *
 * Tudo fictício.
 */

type Linha = {
  id: string;
  orgId: string;
  instancia: string;
  chatJid: string;
  grupo: boolean;
  nome: string | null;
  fotoUrl: string | null;
  participantes: number | null;
  participantesLista: unknown;
  equipe: boolean;
  comunidade: boolean;
  ultimaMensagemEm: Date | null;
  naoLidas: number;
  leadId: string | null;
  clienteId: string | null;
  vinculoSugerido: unknown;
  vinculadoPorId: string | null;
  vinculadoEm: Date | null;
  arquivadaEm: Date | null;
  atualizadoEm: Date;
  lead: { id: string; name: string } | null;
  cliente: { id: string; razaoSocial: string; nomeFantasia: string | null } | null;
};

function linha(id: string, o: Partial<Linha> = {}): Linha {
  return {
    id,
    orgId: 'org-a',
    instancia: 'instancia-ficticia',
    chatJid: '120363000000000001@g.us',
    grupo: true,
    nome: 'Grupo Fictício',
    fotoUrl: null,
    participantes: 5,
    participantesLista: null,
    equipe: false,
    comunidade: false,
    ultimaMensagemEm: null,
    naoLidas: 0,
    leadId: null,
    clienteId: null,
    vinculoSugerido: null,
    vinculadoPorId: null,
    vinculadoEm: null,
    arquivadaEm: null,
    atualizadoEm: new Date('2026-10-26T12:00:00.000Z'),
    lead: null,
    cliente: null,
    ...o,
  };
}

/** O `where` do Prisma que estes caminhos usam, avaliado numa linha em memória. */
function casa(l: Record<string, unknown>, w: Record<string, unknown> | undefined): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]) => {
    if (k === 'AND') return (v as Record<string, unknown>[]).every((x) => casa(l, x));
    if (k === 'OR') return (v as Record<string, unknown>[]).some((x) => casa(l, x));
    const atual = l[k] instanceof Date ? (l[k] as Date).getTime() : l[k];
    if (v === null) return atual === null || atual === undefined;
    if (v instanceof Date) return atual === v.getTime();
    if (typeof v === 'object' && v && 'not' in v) return (v as { not: unknown }).not === null ? atual != null : atual !== (v as { not: unknown }).not;
    if (typeof v === 'object' && v && 'in' in v) return (v as { in: unknown[] }).in.includes(atual);
    return atual === v;
  });
}

function dubleDoPrisma(linhas: Linha[]) {
  const auditoria: Array<{ action: string; before: unknown; after: unknown }> = [];
  const escritas: Array<Record<string, unknown>> = [];
  const db = {
    whatsAppConversa: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const l = linhas.find((x) => casa(x, where));
        return l ? { ...l } : null; // cópia, como o banco: a escrita depois não muda o que já foi lido
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => linhas.filter((l) => casa(l, where)).length),
      aggregate: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const achadas = linhas.filter((l) => casa(l, where));
        return { _sum: { naoLidas: achadas.reduce((s, l) => s + l.naoLidas, 0) }, _count: { _all: achadas.length } };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const achadas = linhas.filter((l) => casa(l, where));
        for (const l of achadas) Object.assign(l, data, { atualizadoEm: new Date(l.atualizadoEm.getTime() + 1000) });
        if (achadas.length) escritas.push(data);
        return { count: achadas.length };
      }),
    },
    whatsAppMensagem: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => ({ id: 'msg-1', timestamp: new Date('2026-10-26T12:00:00.000Z') })),
      findFirstOrThrow: vi.fn(async () => ({
        id: 'msg-1',
        conversaId: 'conv-1',
        mensagemExternaId: 'EVO-1',
        deMim: true,
        tipo: 'conversation',
        texto: 'Bom dia, segue o material.',
        midia: null,
        remetenteNome: null,
        remetenteNumero: null,
        timestamp: new Date('2026-10-26T12:00:00.000Z'),
        citaMensagemExternaId: null,
        enviadaPorId: 'pessoa-1',
        lidaEm: null,
      })),
      findMany: vi.fn(async () => []),
    },
    comercialMensagem: { createMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: {
      create: vi.fn(async ({ data }: { data: { action: string; before?: unknown; after?: unknown } }) => {
        auditoria.push({ action: data.action, before: data.before, after: data.after });
        return {};
      }),
    },
    user: { findMany: vi.fn(async () => [{ id: 'pessoa-1', name: 'Pessoa Fictícia da Silva' }]) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  return { prisma: db as unknown as PrismaService, auditoria, escritas, db };
}

const GENTE = { id: 'pessoa-1', papeis: ['admin_master'] };

describe('comunidade: a rota', () => {
  it('marcar ou tirar da comunidade é leads.editar e só de gente, como a equipe', () => {
    const h = VinculoDoWhatsappController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, h.comunidade)).toEqual(['leads.editar']);
    expect(Reflect.getMetadata('__guards__', h.comunidade)).toEqual([SoGenteNoVinculoGuard]);
    expect(Reflect.getMetadata('path', h.comunidade)).toBe(':conversaId/comunidade');
  });

  it('o chip existe, chama "Comunidade" e vem depois de Equipe, antes de Arquivadas', () => {
    expect(ROTULO_DO_FILTRO.comunidade).toBe('Comunidade');
    expect(FILTROS_DA_CAIXA.indexOf('comunidade')).toBe(FILTROS_DA_CAIXA.indexOf('equipe') + 1);
    expect(FILTROS_DA_CAIXA.at(-1)).toBe('arquivadas');
  });
});

describe('comunidade: o filtro da caixa e o resumo do Dia a dia', () => {
  const conversas = () => [
    linha('lead', { grupo: false, leadId: 'l1', naoLidas: 3 }),
    linha('cliente', { clienteId: 'c1', naoLidas: 4 }),
    linha('solta', { grupo: false, naoLidas: 2 }),
    linha('equipe', { equipe: true, naoLidas: 7 }),
    linha('comunidade', { nome: 'Operação Root | IA para Negócios', participantes: 55, comunidade: true, naoLidas: 40 }),
    linha('comunidade-arquivada', { comunidade: true, naoLidas: 9, arquivadaEm: new Date('2026-10-20T00:00:00.000Z') }),
  ];

  it('o where de cada chip: comunidade só no seu chip (e em Grupos e Todas); leads, clientes e sem vínculo a excluem', () => {
    expect(ondeDoFiltro('o', 'comunidade')).toEqual({ orgId: 'o', arquivadaEm: null, equipe: false, comunidade: true });
    expect(ondeDoFiltro('o', 'leads')).toMatchObject({ comunidade: false, equipe: false });
    expect(ondeDoFiltro('o', 'clientes')).toMatchObject({ comunidade: false, equipe: false });
    expect(ondeDoFiltro('o', 'sem_vinculo')).toMatchObject({ comunidade: false, equipe: false, leadId: null, clienteId: null });
    const linhas = conversas();
    const em = (f: FiltroDaCaixa) => linhas.filter((l) => casa(l, ondeDoFiltro('org-a', f) as Record<string, unknown>)).map((l) => l.id);
    expect(em('comunidade')).toEqual(['comunidade']);
    expect(em('sem_vinculo')).toEqual(['solta']);
    expect(em('equipe')).toEqual(['equipe']);
    expect(em('grupos')).toContain('comunidade');
    expect(em('todas')).toContain('comunidade');
    expect(em('arquivadas')).toEqual(['comunidade-arquivada']);
  });

  it('o resumo: comunidade é a quinta faixa, fora de leads, clientes e sem vínculo, e FORA do total (não é trabalho)', async () => {
    const { prisma } = dubleDoPrisma(conversas());
    const r = await new ResumoDoWhatsappService(prisma).doResumo('org-a');
    expect(r.naoLidas).toEqual({ leads: 3, clientes: 4, semVinculo: 2, equipe: 7, comunidade: 40, total: 16 });
    // A conversa da comunidade não é "sem vínculo" esperando um clique.
    expect(r.conversasSemVinculo).toBe(1);
  });

  it('equipe e comunidade na mesma linha (dado antigo): conta uma vez só, na equipe', async () => {
    const { prisma } = dubleDoPrisma([linha('as-duas', { equipe: true, comunidade: true, naoLidas: 5 })]);
    const r = await new ResumoDoWhatsappService(prisma).doResumo('org-a');
    expect(r.naoLidas).toMatchObject({ equipe: 5, comunidade: 0, total: 5 });
  });
});

describe('comunidade: marcar e tirar', () => {
  let linhas: Linha[];
  beforeEach(() => {
    linhas = [linha('conv-1', { nome: 'Operação Root | IA para Negócios', participantes: 55, equipe: true })];
  });

  it('o grupo que caiu em equipe pelo nome passa para comunidade: sai da equipe, fica como decisão de pessoa e é auditado', async () => {
    const { prisma, auditoria } = dubleDoPrisma(linhas);
    const svc = new VinculoDoWhatsappService(prisma);
    const r = await svc.marcarComunidade('org-a', 'conv-1', { comunidade: true }, GENTE);
    expect(r.mudou).toBe(true);
    expect(r.conversa).toMatchObject({ comunidade: true, equipe: false, vinculo: null, sugestao: null });
    expect(linhas[0]).toMatchObject({ comunidade: true, equipe: false, vinculadoPorId: 'pessoa-1' });
    expect(auditoria).toEqual([{ action: ACAO_DE_AUDITORIA.comunidade, before: { comunidade: false, equipe: true }, after: { comunidade: true, equipe: false } }]);
    expect(ACAO_DE_AUDITORIA.comunidade).toBe('whatsapp.conversa.comunidade');
  });

  it('dois cliques = uma marcação; tirar volta para sem tipo', async () => {
    const { prisma, auditoria } = dubleDoPrisma(linhas);
    const svc = new VinculoDoWhatsappService(prisma);
    await svc.marcarComunidade('org-a', 'conv-1', { comunidade: true }, GENTE);
    expect((await svc.marcarComunidade('org-a', 'conv-1', { comunidade: true }, GENTE)).mudou).toBe(false);
    expect(auditoria).toHaveLength(1);
    const tirada = await svc.marcarComunidade('org-a', 'conv-1', { comunidade: false }, GENTE);
    expect(tirada.mudou).toBe(true);
    expect(linhas[0]).toMatchObject({ comunidade: false, equipe: false });
  });

  it('ligada a lead ou cliente, marcar é 409 (desvincule antes), como a equipe', async () => {
    const { prisma } = dubleDoPrisma([linha('conv-2', { leadId: 'l1', lead: { id: 'l1', name: 'Lead Fictício' } })]);
    const svc = new VinculoDoWhatsappService(prisma);
    await expect(svc.marcarComunidade('org-a', 'conv-2', { comunidade: true }, GENTE)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.marcarComunidade('org-a', 'conv-2', { comunidade: true }, GENTE)).rejects.toThrow(FRASE.comunidadeLigada);
  });

  it('marcar como equipe tira da comunidade (os tipos se excluem)', async () => {
    linhas = [linha('conv-1', { comunidade: true, vinculadoPorId: 'pessoa-1' })];
    const { prisma, auditoria } = dubleDoPrisma(linhas);
    const r = await new VinculoDoWhatsappService(prisma).marcarEquipe('org-a', 'conv-1', { equipe: true }, GENTE);
    expect(r.conversa).toMatchObject({ equipe: true, comunidade: false });
    expect(auditoria[0]).toEqual({ action: ACAO_DE_AUDITORIA.equipe, before: { equipe: false, comunidade: true }, after: { equipe: true, comunidade: false } });
  });

  it('corpo errado é 400; conta de máquina é recusada antes do banco', async () => {
    const { prisma, db } = dubleDoPrisma(linhas);
    const svc = new VinculoDoWhatsappService(prisma);
    await expect(svc.marcarComunidade('org-a', 'conv-1', { comunidade: 'sim' }, GENTE)).rejects.toThrow();
    await expect(svc.marcarComunidade('org-a', 'conv-1', { comunidade: true }, { id: 'ia', papeis: ['ia_acao'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.whatsAppConversa.updateMany).not.toHaveBeenCalled();
  });

  it('o casamento automático não toca a comunidade (nem a devolve à equipe pelo nome)', async () => {
    linhas = [linha('conv-1', { nome: 'Operação Root | IA para Negócios', comunidade: true })];
    const { prisma, db } = dubleDoPrisma(linhas);
    const r = await new VinculoDoWhatsappService(prisma).casar('org-a', 'conv-1');
    expect(r).toMatchObject({ manual: true, mudou: false, equipe: false });
    expect(db.whatsAppConversa.updateMany).not.toHaveBeenCalled();
    expect(linhas[0]).toMatchObject({ comunidade: true, equipe: false });
  });

  it('vincular a lead tira da comunidade', async () => {
    linhas = [linha('conv-1', { comunidade: true, vinculadoPorId: 'pessoa-1' })];
    const { prisma, escritas } = dubleDoPrisma(linhas);
    await new VinculoDoWhatsappService(prisma).vincularNaTransacao(prisma as never, 'org-a', 'conv-1', { tipo: 'lead', id: 'l9' }, 'pessoa-1', 'manual');
    expect(escritas[0]).toMatchObject({ leadId: 'l9', equipe: false, comunidade: false });
  });
});

describe('a mensagem que sai pela caixa leva o nome de quem enviou', () => {
  it('à porta vai o texto com o nome de quem enviou em negrito no topo (o cliente vê quem fala); no OS fica só o texto', async () => {
    const conv = linha('conv-1', { grupo: false, chatJid: '5500000000001@s.whatsapp.net', nome: 'Contato Fictício', participantes: null });
    const { prisma, db } = dubleDoPrisma([conv]);
    const enviados: Array<{ chatJid: string; texto: string }> = [];
    const porta: RespostaDeGentePelaEvolution = {
      async responderComoPessoa(_orgId, chatJid, texto) {
        enviados.push({ chatJid, texto });
        return { id: 'EVO-1' };
      },
    };
    const svc = new CaixaDoWhatsappService(prisma, {} as SincronizacaoDoWhatsappService, porta);
    const quem = { id: 'pessoa-1', papeis: ['admin_master'], permissoes: ['whatsapp.conversar'] };
    const r = await svc.responder('org-a', 'conv-1', { texto: '  Bom dia, segue o material.  ' }, quem);

    // Layout 26/10 (Lucas): o cliente vê quem fala; no OS fica só o texto digitado.
    expect(enviados).toEqual([{ chatJid: '5500000000001@s.whatsapp.net', texto: '*Pessoa Fictícia da Silva*\nBom dia, segue o material.' }]);
    // Quem enviou fica no OS: na linha da mensagem e na volta para a tela.
    const gravada = (db.whatsAppMensagem.upsert.mock.calls[0] as unknown as [{ create: { enviadaPorId: string; texto: string } }])[0];
    expect(gravada.create).toMatchObject({ enviadaPorId: 'pessoa-1', texto: 'Bom dia, segue o material.' });
    expect(r.mensagem.enviadaPor).toEqual({ id: 'pessoa-1', nome: 'Pessoa Fictícia da Silva' });
  });
});
