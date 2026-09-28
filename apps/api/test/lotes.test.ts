import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CAPACIDADE_DE_APROVAR_A_SEMANA, ITEM_DO_LOTE_ESTADOS, LOTE_ESTADOS } from '@mktos/shared';
import { JwtService } from '@nestjs/jwt';
import { ActorType, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { LotesService } from '../src/approvals/lotes.service';
import { AssinaturaDeLoteService, CAPACIDADES_DE_LOTE } from '../src/approvals/assinatura-de-lote.service';
import { hashDoLote, motivoDaRecusaDoItem, separarItemDeLote, type ItemParaOHash } from '../src/approvals/lotes';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway, type ExecCtx } from '../src/gateway/tool-gateway.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { AcoesService } from '../src/gateway/acoes.service';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { AuditService } from '../src/audit/audit.service';
import { ReauthService } from '../src/auth/reauth.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * MD7 — A APROVAÇÃO DE LOTE COM USO CONTADO.
 *
 * A parte pura (o hash da lista, o `loteItemId` fora do conteúdo, a frase da
 * recusa) roda sem banco. Com banco: a montagem recusa o que a porta recusaria;
 * o pedido de assinatura vai à fila como R4; quem montou não assina; a
 * titular assina com senha e motivo e o efeito ATIVA o lote; dois consumos
 * simultâneos do mesmo item deixam passar um só; editar uma peça derruba só o
 * item dela; e o teto por dia (a DM do MD11) vira o dia dentro da escrita.
 */

const itemPuro = (recursoId: string, janelaDe: string): ItemParaOHash => ({
  capabilityId: 'instagram.post.publicar',
  recursoId,
  hashItem: recursoId.repeat(4),
  janelaDe,
  janelaAte: '2026-09-30T00:00:00.000Z',
  usoMaximo: 1,
  tetoPorDia: null,
});

describe('o lote, sem banco', () => {
  it('o hash da lista não depende da ordem de quem montou, e muda com qualquer campo', () => {
    const a = itemPuro('peca-a', '2026-09-25T12:00:00.000Z');
    const b = itemPuro('peca-b', '2026-09-26T12:00:00.000Z');
    const base = { capabilityId: 'pauta.semana.aprovar', validaAte: '2026-10-01T00:00:00.000Z' };
    const h = hashDoLote({ ...base, itens: [a, b] });
    expect(hashDoLote({ ...base, itens: [b, a] })).toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoLote({ ...base, itens: [a] })).not.toBe(h);
    expect(hashDoLote({ ...base, itens: [a, { ...b, hashItem: 'outro' }] })).not.toBe(h);
    expect(hashDoLote({ ...base, itens: [a, { ...b, janelaAte: '2026-09-29T00:00:00.000Z' }] })).not.toBe(h);
    expect(hashDoLote({ ...base, validaAte: '2026-10-02T00:00:00.000Z', itens: [a, b] })).not.toBe(h);
  });

  it('o loteItemId sai do conteúdo; vazio ou fora do formato é marcado, nunca ignorado', () => {
    expect(separarItemDeLote({ legenda: 'x' })).toEqual({ presente: false, loteItemId: null, conteudo: { legenda: 'x' } });
    expect(separarItemDeLote({ legenda: 'x', loteItemId: 'item-1' })).toEqual({ presente: true, loteItemId: 'item-1', conteudo: { legenda: 'x' } });
    for (const ruim of ['', '   ', 42, null, 'x'.repeat(65)]) {
      const r = separarItemDeLote({ legenda: 'x', loteItemId: ruim });
      expect(r.presente).toBe(true);
      expect(r.loteItemId).toBeNull();
      expect(r.conteudo).toEqual({ legenda: 'x' });
    }
  });

  it('os enums do Prisma estão espelhados no shared, e o efeito é o da capacidade do catálogo', () => {
    const schema = readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const bloco = (nome: string) =>
      (new RegExp(`enum ${nome} \\{([^}]*)\\}`).exec(schema)?.[1] ?? '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, '').trim())
        .filter(Boolean);
    expect(bloco('LoteEstado')).toEqual([...LOTE_ESTADOS]);
    expect(bloco('ItemDoLoteEstado')).toEqual([...ITEM_DO_LOTE_ESTADOS]);
    expect([...CAPACIDADES_DE_LOTE]).toEqual([CAPACIDADE_DE_APROVAR_A_SEMANA]);
  });

  it('a frase da recusa diz o que falhou', () => {
    const agora = new Date('2026-09-25T15:00:00Z');
    const item = {
      capabilityId: 'instagram.post.publicar', recursoId: 'peca-a', estado: 'ativo',
      janelaDe: new Date('2026-09-25T14:00:00Z'), janelaAte: new Date('2026-09-25T16:00:00Z'),
      usos: 0, usoMaximo: 1, hashItem: 'h', tetoPorDia: null, usosNoDia: 0, diaDoContador: null,
      lote: { estado: 'ativo', validaAte: new Date('2026-09-30T00:00:00Z'), capabilityId: 'pauta.semana.aprovar' },
    };
    const pedido = { capabilityId: 'instagram.post.publicar', recursoId: 'peca-a', hashAtual: 'h', loteDaCapacidade: 'pauta.semana.aprovar', agora, hoje: '2026-09-25' };
    expect(motivoDaRecusaDoItem(null, pedido)).toMatch(/não existe nesta empresa/);
    expect(motivoDaRecusaDoItem({ ...item, capabilityId: 'youtube.video.publicar' }, pedido)).toMatch(/é de "youtube/);
    expect(motivoDaRecusaDoItem(item, { ...pedido, hashAtual: 'outro' })).toMatch(/difere/);
    expect(motivoDaRecusaDoItem({ ...item, usos: 1, estado: 'consumido', lote: { ...item.lote, estado: 'encerrado' } }, pedido)).toMatch(/já foi usado/);
    expect(motivoDaRecusaDoItem({ ...item, estado: 'revogado' }, pedido)).toMatch(/item está revogado/);
    expect(motivoDaRecusaDoItem({ ...item, tetoPorDia: 2, usosNoDia: 2, diaDoContador: '2026-09-25', usoMaximo: 99 }, pedido)).toMatch(/teto do dia/);
  });
});

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'ESCREVE nele (duas empresas, duas pessoas, lotes, aprovações e RASTRO)');

const ORG = 'org-md7-lotes';
const ORG_B = 'org-md7-lotes-b';
const CAP = 'instagram.post.publicar';
const LOTE = 'pauta.semana.aprovar';
const SENHA = 'senha-da-titular-md7';
const SUFIXO = `md7-${Date.now().toString(36)}`;

describe.skipIf(!URL)('o lote, com banco', () => {
  let prisma: PrismaClient;
  let lotes: LotesService;
  let approvals: ApprovalsService;
  let gateway: ToolGateway;
  let assinatura: AssinaturaDeLoteService;
  let acoes: AcoesService;
  const id = { proponente: '', titular: '' };
  let saidas: string[];

  const args = (pecaId: string, legenda = `Legenda ${pecaId}`) => ({
    pecaId,
    formato: 'carrossel',
    legenda,
    midias: [{ chave: `pauta/${pecaId}/1.jpg`, sha256: 'b'.repeat(64) }],
    igUserId: 'ig-md7',
  });

  const montar = (pecas: string[], extra: { orgId?: string; tetoPorDia?: number; usoMaximo?: number; capabilityId?: string } = {}) =>
    lotes.montar({
      orgId: extra.orgId ?? ORG,
      capabilityId: LOTE,
      recursoTipo: 'pauta_episodio',
      recursoId: `ep-${Math.random().toString(36).slice(2, 8)}`,
      propostoPorId: id.proponente,
      validaAte: new Date(Date.now() + 5 * 86_400_000),
      itens: pecas.map((p) => ({
        capabilityId: extra.capabilityId ?? CAP,
        recursoId: p,
        args: args(p),
        janelaDe: new Date(Date.now() - 3600_000),
        janelaAte: new Date(Date.now() + 4 * 86_400_000),
        ...(extra.tetoPorDia ? { tetoPorDia: extra.tetoPorDia } : {}),
        ...(extra.usoMaximo ? { usoMaximo: extra.usoMaximo } : {}),
      })),
    });

  /** Liga o lote à mão, para os casos que não são da assinatura. */
  const ativarAMao = (loteId: string) =>
    prisma.aprovacaoDeLote.update({
      where: { id: loteId },
      data: { estado: 'ativo', aprovadoPorId: id.titular, aprovadoEm: new Date(), motivo: 'ativado no teste' },
    });

  const ctx = (): ExecCtx => ({
    orgId: ORG,
    actorType: ActorType.system,
    actorId: 'rotina-md7',
    agentSlug: null,
    correlationId: `md7-${Math.random().toString(36).slice(2, 8)}`,
  });

  const publicar = (pecaId: string, loteItemId: string, conteudo = args(pecaId)) =>
    gateway.executar(
      { capabilityId: CAP, args: { ...conteudo, loteItemId }, ctx: ctx(), resource: { type: CAP, id: pecaId } },
      async (a) => {
        saidas.push(String(a.pecaId));
        return { publicado: true };
      },
    );

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const [org, slug] of [[ORG, 'md7-lotes'], [ORG_B, 'md7-lotes-b']]) {
      await prisma.org.upsert({ where: { id: org }, create: { id: org, name: slug, slug }, update: {} });
    }
    const papel = async (key: string) =>
      prisma.role.upsert({
        where: { orgId_key: { orgId: ORG, key } },
        create: { orgId: ORG, key, name: key },
        update: {},
        select: { id: true },
      });
    const admin = await papel('admin_master');
    const usuario = async (email: string) =>
      (
        await prisma.user.upsert({
          where: { email },
          create: { orgId: ORG, email, name: email, passwordHash: await bcrypt.hash(SENHA, 4), roles: { connect: { id: admin.id } } },
          update: {},
          select: { id: true },
        })
      ).id;
    id.proponente = await usuario(`proponente@${SUFIXO}`);
    id.titular = await usuario(`titular@${SUFIXO}`);

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const reauth = new ReauthService(p, new JwtService({ secret: 'segredo-md7' }), audit);
    approvals = new ApprovalsService(p, audit, reauth);
    lotes = new LotesService(p, policy, audit);
    const registro = new EfeitosRegistry();
    const eventos = new EventLogService(p);
    gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, undefined, registro, lotes);
    assinatura = new AssinaturaDeLoteService(p, lotes, registro, new PortaDoOperador(gateway, registro));
    assinatura.onModuleInit();
    acoes = new AcoesService(p, gateway, eventos, undefined, policy);
  });

  beforeEach(() => {
    saidas = [];
  });

  afterAll(async () => {
    for (const org of [ORG, ORG_B]) {
      await prisma.$transaction([
        prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
        prisma.eventLog.deleteMany({ where: { orgId: org } }),
        prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
      ]);
      await prisma.itemDoLote.deleteMany({ where: { orgId: org } });
      await prisma.aprovacaoDeLote.deleteMany({ where: { orgId: org } });
      await prisma.approval.deleteMany({ where: { orgId: org } });
      await prisma.toolCall.deleteMany({ where: { orgId: org } });
      await prisma.policyDecision.deleteMany({ where: { orgId: org } });
      await prisma.auditLog.deleteMany({ where: { orgId: org } });
      await prisma.user.deleteMany({ where: { orgId: org } });
      await prisma.role.deleteMany({ where: { orgId: org } });
      await prisma.org.deleteMany({ where: { id: org } });
    }
    await prisma.$disconnect();
  });

  it('a montagem recusa o que a porta recusaria, antes de existir assinatura', async () => {
    await expect(montar(['x'], { capabilityId: 'whatsapp.mensagem.enviar' })).rejects.toThrow(/não sai por lote/);
    await expect(
      lotes.montar({
        orgId: ORG, capabilityId: LOTE, recursoTipo: 'pauta_episodio', recursoId: 'ep', propostoPorId: id.proponente,
        validaAte: new Date(Date.now() + 9 * 86_400_000),
        itens: [{ capabilityId: CAP, recursoId: 'p', args: args('p'), janelaDe: new Date(), janelaAte: new Date(Date.now() + 3600_000) }],
      }),
    ).rejects.toThrow(/no máximo 8 dias/);
    await expect(
      lotes.montar({
        orgId: ORG, capabilityId: LOTE, recursoTipo: 'pauta_episodio', recursoId: 'ep', propostoPorId: id.proponente,
        validaAte: new Date(Date.now() + 86_400_000),
        itens: [{ capabilityId: CAP, recursoId: 'p', args: { ...args('p'), formato: 'banner' }, janelaDe: new Date(), janelaAte: new Date(Date.now() + 3600_000) }],
      }),
    ).rejects.toThrow(/formato valor inválido/);
    await expect(montar(Array.from({ length: 61 }, (_, n) => `p${n}`))).rejects.toThrow(/até 60 itens/);
    await expect(montar(['p', 'p'])).rejects.toThrow(/repetido/);
    await expect(
      lotes.montar({
        orgId: ORG, capabilityId: CAP, recursoTipo: 'x', recursoId: 'x', propostoPorId: id.proponente,
        validaAte: new Date(Date.now() + 86_400_000), itens: [],
      }),
    ).rejects.toThrow(/não aprova lote/);
    expect(await prisma.aprovacaoDeLote.count({ where: { orgId: ORG } })).toBe(0);
  });

  it('pedir a assinatura vai à fila como R4; quem montou não assina; a titular assina e o efeito ATIVA o lote', async () => {
    const m = await montar(['semana-1', 'semana-2']);

    await expect(assinatura.pedirAssinatura(ORG, m.loteId, id.titular)).rejects.toThrow(/quem o montou/);

    const r = (await assinatura.pedirAssinatura(ORG, m.loteId, id.proponente)) as { status: string; approvalId: string; nivel: string };
    expect(r).toMatchObject({ status: 'aguardando_aprovacao', nivel: 'R4' });
    const ap = await prisma.approval.findUnique({ where: { id: r.approvalId } });
    expect(ap).toMatchObject({ nivelExigido: 'R4', alcadaMinima: 'titular', exigeReauth: true, capabilityId: LOTE, resourceId: m.loteId });
    expect((await lotes.detalhe(ORG, m.loteId)).estado).toBe('aguardando');

    // Antes da assinatura, nenhum item vale.
    const antes = await publicar('semana-1', m.itens.find((i) => i.recursoId === 'semana-1')!.id);
    expect(antes.status === 'recusado' && antes.motivo).toMatch(/o lote está aguardando/);

    // Pedir de novo com o pedido vivo na fila é recusado.
    await expect(assinatura.pedirAssinatura(ORG, m.loteId, id.proponente)).rejects.toThrow(/já está na fila/);

    // Quem propôs não confirma (invariante 7), nem com senha e motivo.
    await expect(
      approvals.confirm(ORG, r.approvalId, { id: id.proponente, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'eu mesmo aprovo a semana'),
    ).rejects.toThrow(/Quem propôs/);

    // A titular: senha e motivo (R4).
    await approvals.confirm(ORG, r.approvalId, { id: id.titular, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi os dois posts e os horários');
    const exec = await acoes.executarAprovada(ORG, r.approvalId, id.titular);
    expect(exec.status).toBe('executado');

    const lote = await lotes.detalhe(ORG, m.loteId);
    expect(lote).toMatchObject({ estado: 'ativo', aprovadoPorId: id.titular, motivo: 'conferi os dois posts e os horários', hashConteudo: m.hashConteudo });

    // O RASTRO da ativação leva o antes e o depois (R4).
    const ev = await prisma.eventLog.findFirst({ where: { orgId: ORG, tipo: 'acao.executada', capabilityId: LOTE }, orderBy: { seq: 'desc' } });
    const payload = ev?.payload as { estadoAnterior: unknown; estadoNovo: unknown; rastro: { faltando: string[] } };
    expect(payload.estadoAnterior).toEqual({ estado: 'aguardando' });
    expect(payload.estadoNovo).toMatchObject({ estado: 'ativo', itens: 2 });
    expect(payload.rastro.faltando).not.toContain('estadoAnterior');

    // Agora os itens valem, um uso cada.
    const doItem = (p: string) => m.itens.find((i) => i.recursoId === p)!.id;
    expect((await publicar('semana-1', doItem('semana-1'))).status).toBe('executado');
    expect((await publicar('semana-2', doItem('semana-2'))).status).toBe('executado');
    expect(saidas).toEqual(['semana-1', 'semana-2']);
    expect((await lotes.detalhe(ORG, m.loteId)).estado).toBe('encerrado');
  });

  it('a assinatura de quem montou é recusada também no efeito, se chegar lá', async () => {
    const m = await montar(['dupla-checagem']);
    await prisma.aprovacaoDeLote.update({ where: { id: m.loteId }, data: { estado: 'aguardando', approvalId: 'ap-forjada' } });
    await prisma.approval.create({
      data: {
        id: 'ap-forjada', orgId: ORG, capabilityId: LOTE, propostoPorId: 'outra-conta', resourceType: LOTE, resourceId: m.loteId,
        contentHash: 'x', resumo: 'x', tokenHash: `forjada-${SUFIXO}`, expiraEm: new Date(Date.now() + 60_000),
        status: 'consumida', aprovadoPorId: id.proponente, aprovadoEm: new Date(),
      },
    });
    const a = await lotes.argsDaAssinatura(ORG, m.loteId);
    await expect(lotes.ativar(a.args, ORG, { approvalId: 'ap-forjada' })).rejects.toThrow(/Quem propôs o lote/);
    await expect(lotes.ativar(a.args, ORG, { approvalId: 'outra' })).rejects.toThrow(/pedido antigo/);
    await expect(lotes.ativar({ ...a.args, hashConteudo: 'f'.repeat(64) }, ORG, { approvalId: 'ap-forjada' })).rejects.toThrow(/hash difere/);
    expect((await lotes.detalhe(ORG, m.loteId)).estado).toBe('aguardando');
  });

  it('pedir de novo depois de vencer cria outra aprovação com o MESMO hash, sem remontar', async () => {
    const m = await montar(['refeita']);
    const r1 = (await assinatura.pedirAssinatura(ORG, m.loteId, id.proponente)) as { approvalId: string };
    await prisma.approval.update({ where: { id: r1.approvalId }, data: { status: 'expirada', expiraEm: new Date(Date.now() - 1000) } });
    const r2 = (await assinatura.pedirAssinatura(ORG, m.loteId, id.proponente)) as { approvalId: string };
    expect(r2.approvalId).not.toBe(r1.approvalId);
    const [a1, a2] = await Promise.all([r1, r2].map((r) => prisma.approval.findUnique({ where: { id: r.approvalId } })));
    expect(a2?.contentHash).toBe(a1?.contentHash);
    const lote = await lotes.detalhe(ORG, m.loteId);
    expect(lote).toMatchObject({ estado: 'aguardando', approvalId: r2.approvalId, hashConteudo: m.hashConteudo });
    expect(lote.itens.map((i) => i.id)).toEqual(m.itens.map((i) => i.id));
  });

  it('dois consumos simultâneos do mesmo item deixam passar UM só', async () => {
    const m = await montar(['corrida']);
    await ativarAMao(m.loteId);
    const itemId = m.itens[0].id;
    const r = await Promise.all(Array.from({ length: 6 }, () => publicar('corrida', itemId)));
    expect(r.filter((x) => x.status === 'executado')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'recusado')).toHaveLength(5);
    expect(saidas).toEqual(['corrida']);
    expect((await prisma.itemDoLote.findUnique({ where: { id: itemId } }))?.usos).toBe(1);
  });

  it('editar uma peça depois de ativo derruba só o item dela; o resto da semana sai', async () => {
    const m = await montar(['editada', 'intacta']);
    await ativarAMao(m.loteId);
    const doItem = (p: string) => m.itens.find((i) => i.recursoId === p)!.id;
    expect(await lotes.revogarItensDoRecurso(ORG, CAP, 'editada', 'a legenda mudou depois da assinatura', id.proponente)).toBe(1);

    const r = await publicar('editada', doItem('editada'));
    expect(r.status === 'recusado' && r.motivo).toMatch(/o item está revogado/);
    // Nem com o conteúdo antigo: o item caiu.
    expect((await publicar('intacta', doItem('intacta'))).status).toBe('executado');
    expect(saidas).toEqual(['intacta']);
    const lote = await lotes.detalhe(ORG, m.loteId);
    expect(lote.itens.find((i) => i.recursoId === 'editada')).toMatchObject({ estado: 'revogado', motivoDaRevogacao: 'a legenda mudou depois da assinatura' });
    expect(lote.estado).toBe('encerrado');
  });

  it('o teto por dia (a DM do MD11) conta em São Paulo e vira o dia dentro da mesma escrita', async () => {
    const m = await montar(['regra-agentes'], { tetoPorDia: 2, usoMaximo: 100 });
    await ativarAMao(m.loteId);
    const item = m.itens[0];
    const consumir = (agora: Date) =>
      lotes.consumirItem({ orgId: ORG, loteItemId: item.id, capabilityId: CAP, recursoId: 'regra-agentes', hashAtual: item.hashItem, loteDaCapacidade: LOTE, agora });

    // 23h50 de um dia em SP (02h50 UTC do seguinte): conta no dia de SP.
    const noite = new Date(Date.now() + 86_400_000);
    noite.setUTCHours(2, 50, 0, 0);
    const corrida = await Promise.all(Array.from({ length: 5 }, () => consumir(noite)));
    const passaram = corrida.filter((c) => c.ok);
    expect(passaram).toHaveLength(2);
    const recusa = corrida.find((c) => !c.ok);
    expect(recusa && !recusa.ok && recusa.motivo).toMatch(/teto do dia \(2\)/);

    // Meia-noite e dez em SP: outro dia, contador volta a 1 sem nova aprovação.
    const depois = new Date(noite.getTime() + 20 * 60_000);
    const virou = await consumir(depois);
    expect(virou.ok).toBe(true);
    if (virou.ok) {
      expect(virou.estadoNovo.usosNoDia).toBe(1);
      expect(virou.estadoNovo.usos).toBe(3);
      expect(virou.estadoNovo.dia).not.toBe((passaram[0] as { estadoNovo: { dia: string } }).estadoNovo.dia);
    }
  });

  it('o lote de outra empresa não é lido nem consumido daqui', async () => {
    const deLa = await montar(['alheia'], { orgId: ORG_B });
    await ativarAMao(deLa.loteId);
    await expect(lotes.detalhe(ORG, deLa.loteId)).rejects.toThrow(/não encontrado/);
    const r = await lotes.consumirItem({
      orgId: ORG, loteItemId: deLa.itens[0].id, capabilityId: CAP, recursoId: 'alheia', hashAtual: deLa.itens[0].hashItem, loteDaCapacidade: LOTE,
    });
    expect(r).toEqual({ ok: false, motivo: 'o item de lote não existe nesta empresa' });
    await expect(assinatura.pedirAssinatura(ORG, deLa.loteId, id.proponente)).rejects.toThrow(/não encontrado/);
  });

  it('o prazo vencido marca o lote como vencido, só na empresa de quem pediu', async () => {
    const m = await montar(['vence']);
    const deLa = await montar(['vence-la'], { orgId: ORG_B });
    for (const l of [m, deLa]) {
      await prisma.aprovacaoDeLote.update({ where: { id: l.loteId }, data: { validaAte: new Date(Date.now() - 1000) } });
    }
    await expect(lotes.expirarVencidos('')).rejects.toThrow();
    expect(await lotes.expirarVencidos(ORG)).toBeGreaterThanOrEqual(1);
    expect((await lotes.detalhe(ORG, m.loteId)).estado).toBe('vencido');
    expect((await prisma.aprovacaoDeLote.findUnique({ where: { id: deLa.loteId } }))?.estado).toBe('proposta');
  });

  it('lote vencido não vai à fila: a titular não gasta senha num lote que não ativaria', async () => {
    const m = await montar(['passou']);
    await prisma.aprovacaoDeLote.update({ where: { id: m.loteId }, data: { validaAte: new Date(Date.now() - 1000) } });
    await expect(assinatura.pedirAssinatura(ORG, m.loteId, id.proponente)).rejects.toThrow(/prazo do lote passou/);
    expect(await prisma.approval.count({ where: { orgId: ORG, resourceId: m.loteId } })).toBe(0);
    expect((await prisma.aprovacaoDeLote.findUnique({ where: { id: m.loteId } }))?.estado).toBe('proposta');
  });

  it('aprovação confirmada que venceu sem executar não segura o lote', async () => {
    const m = await montar(['confirmada-parada']);
    const r1 = (await assinatura.pedirAssinatura(ORG, m.loteId, id.proponente)) as { approvalId: string };
    await prisma.approval.update({
      where: { id: r1.approvalId },
      data: { status: 'confirmada', aprovadoPorId: id.titular, aprovadoEm: new Date(), expiraEm: new Date(Date.now() - 1000) },
    });
    const r2 = (await assinatura.pedirAssinatura(ORG, m.loteId, id.proponente)) as { approvalId: string };
    expect(r2.approvalId).not.toBe(r1.approvalId);
    expect((await lotes.detalhe(ORG, m.loteId)).approvalId).toBe(r2.approvalId);
  });

  it('revogar o último item ativo encerra o lote, e a auditoria leva os ids dos itens', async () => {
    const m = await montar(['so-ela']);
    await ativarAMao(m.loteId);
    expect(await lotes.revogarItensDoRecurso(ORG, CAP, 'so-ela', 'a peça saiu da semana', id.proponente)).toBe(1);
    expect((await lotes.detalhe(ORG, m.loteId)).estado).toBe('encerrado');
    const log = await prisma.auditLog.findFirst({ where: { orgId: ORG, action: 'lote.item_revogado', entityId: 'so-ela' }, orderBy: { createdAt: 'desc' } });
    expect(log).toMatchObject({ entityType: 'recurso_do_lote' });
    expect((log?.after as { itens: string[] }).itens).toEqual([m.itens[0].id]);
  });

  it('a falha ao encerrar o lote não desfaz um uso que já contou', async () => {
    const m = await montar(['arrumacao']);
    await ativarAMao(m.loteId);
    // A mesma conexão, com a contagem do encerramento quebrada.
    const quebrado = new Proxy(prisma, {
      get(alvo, chave) {
        if (chave === 'itemDoLote') {
          return new Proxy(alvo.itemDoLote, {
            get: (d, k) => (k === 'count' ? () => Promise.reject(new Error('queda passageira')) : Reflect.get(d, k)),
          });
        }
        const v = Reflect.get(alvo, chave);
        return typeof v === 'function' ? v.bind(alvo) : v;
      },
    });
    const lotesQuebrado = new LotesService(quebrado as unknown as PrismaService, {} as never, new AuditService(quebrado as unknown as PrismaService));
    const item = m.itens[0];
    const r = await lotesQuebrado.consumirItem({
      orgId: ORG, loteItemId: item.id, capabilityId: CAP, recursoId: 'arrumacao', hashAtual: item.hashItem, loteDaCapacidade: LOTE,
    });
    expect(r.ok).toBe(true);
    expect((await prisma.itemDoLote.findUnique({ where: { id: item.id } }))?.usos).toBe(1);
    // O lote segue ativo sem item que valha; a próxima arrumação o encerra.
    expect((await prisma.aprovacaoDeLote.findUnique({ where: { id: m.loteId } }))?.estado).toBe('ativo');
  });
});
