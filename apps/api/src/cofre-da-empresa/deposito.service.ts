import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { comTenantPublico } from '../common/tenant-publico';
import { contextoAtual } from '../common/contexto-execucao';
import { cifrar } from '../common/crypto';

export const DIAS_DO_LINK = 7;
export const LIMITE_DE_ENVIOS = 100;
export const EmitirDepositoSchema = z.object({ cliente: z.string().trim().min(1).max(60) }).strict();
export const TokenDepositoSchema = z.object({ token: z.string().max(100) }).strict();
export const EnvioDepositoSchema = TokenDepositoSchema.extend({
  envioId: z.string().uuid(),
  titulo: z.string().trim().min(1).max(80),
  usuario: z.string().max(300).default(''),
  segredo: z.string().min(1).max(5000),
  notas: z.string().max(5000).default(''),
}).strict();
const indisponivel = () => new NotFoundException('Link indisponível ou encerrado. Peça um novo link à ROOT.');
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const formato = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;
const metadados = { id: true, cliente: true, expiraEm: true, revogadoEm: true, recebidos: true, createdAt: true } as const;

/** Apenas depósito. Nunca chama revelar/listar do cofre nem entrega um segredo. */
@Injectable()
export class CofreDepositoService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async podeEmitir(db: Pick<Prisma.TransactionClient, 'user' | 'org'>, orgId: string, userId: string) {
    const [org, user] = await Promise.all([
      db.org.findFirst({ where: { id: orgId, isActive: true }, select: { id: true } }),
      db.user.findFirst({ where: { id: userId, orgId, isActive: true,
        roles: { some: { orgId, permissions: { some: { key: 'cofre.editar' } } } } }, select: { id: true } }),
    ]);
    return !!org && !!user;
  }

  /** Usado pela tela com cofre aberto e pelo CLI operacional autenticado no servidor. */
  async emitir(orgId: string, userId: string, cliente: string) {
    cliente = EmitirDepositoSchema.parse({ cliente }).cliente;
    if (!await this.podeEmitir(this.prisma, orgId, userId)) throw new ForbiddenException('Sem acesso ao cofre.');
    const token = `${orgId}.${randomBytes(32).toString('base64url')}`;
    const expiraEm = new Date(Date.now() + DIAS_DO_LINK * 86_400_000);
    const row = await this.prisma.$transaction(async (tx) => {
      const d = await tx.cofreDeposito.create({ data: { orgId, cliente, criadoPor: userId, tokenHash: hash(token), expiraEm }, select: metadados });
      await this.audit.log({ orgId, actorId: userId, action: 'cofre.deposito.emitir', entityType: 'cofre_deposito', entityId: d.id,
        after: { cliente, expiraEm: expiraEm.toISOString() } }, tx);
      return d;
    });
    // Fragmento: o token não chega ao servidor no GET, no Referer nem no access log.
    return { ...row, caminho: `/entregar-acessos#${token}` };
  }

  async listar(orgId: string) {
    return this.prisma.cofreDeposito.findMany({ where: { orgId }, select: metadados, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async revogar(orgId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // O UPDATE concorre com a mesma trava de linha usada no recebimento.
      const r = await tx.cofreDeposito.updateMany({ where: { id, orgId, revogadoEm: null }, data: { revogadoEm: new Date() } });
      if (r.count) await this.audit.log({ orgId, actorId: userId, action: 'cofre.deposito.revogar', entityType: 'cofre_deposito', entityId: id }, tx);
      return { ok: true };
    });
  }

  private async noLink<T>(token: string, fn: (tx: Prisma.TransactionClient, d: { id: string; orgId: string; cliente: string; expiraEm: Date; recebidos: number }) => Promise<T>): Promise<T> {
    const orgId = formato.exec(token)?.[1];
    if (!orgId) throw indisponivel();
    const fora = contextoAtual()?.orgId;
    if (fora && fora !== orgId) throw indisponivel();
    // orgId só escolhe a partição. O hash completo, a validade e a revogação
    // autorizam a única linha acessível por esta rota. Sem sentinela/bypass RLS.
    return comTenantPublico(orgId, () => this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "CofreDeposito" WHERE "orgId"=${orgId} AND "tokenHash"=${hash(token)} FOR UPDATE`;
      if (!rows.length) throw indisponivel();
      const d = await tx.cofreDeposito.findFirst({ where: { id: rows[0].id, orgId } });
      if (!d || d.revogadoEm || d.expiraEm.getTime() <= Date.now() || !await this.podeEmitir(tx, orgId, d.criadoPor)) throw indisponivel();
      return fn(tx, d);
    }));
  }

  async estado(token: string) {
    return this.noLink(token, async (_tx, d) => ({ cliente: d.cliente, expiraEm: d.expiraEm.toISOString(),
      podeEnviar: d.recebidos < LIMITE_DE_ENVIOS }));
  }

  async receber(input: z.infer<typeof EnvioDepositoSchema>) {
    input = EnvioDepositoSchema.parse(input);
    return this.noLink(input.token, async (tx, d) => {
      const anterior = await tx.cofreDepositoRecibo.findFirst({ where: { orgId: d.orgId, depositoId: d.id, envioId: input.envioId }, select: { id: true } });
      if (anterior) return { ok: true, recibo: anterior.id };
      if (d.recebidos >= LIMITE_DE_ENVIOS) throw new BadRequestException('Limite de envios atingido. Peça outro link à ROOT.');
      const id = randomUUID();
      const fechar = (campo: string, valor: string) => valor ? cifrar(valor, { aad: `cofre-da-empresa:${d.orgId}:${id}:${campo}` }) : null;
      await tx.cofreItem.create({ data: {
        id, orgId: d.orgId, tipo: 'senha', titulo: `${d.cliente} · ${input.titulo}`.slice(0, 120),
        usuarioCifrado: fechar('usuario', input.usuario), segredoCifrado: fechar('segredo', input.segredo),
        notasCifradas: fechar('notas', input.notas), criadoPor: `deposito:${d.id}`,
      } });
      const recibo = await tx.cofreDepositoRecibo.create({ data: { orgId: d.orgId, depositoId: d.id, envioId: input.envioId, itemId: id }, select: { id: true } });
      await tx.cofreDeposito.update({ where: { id: d.id }, data: { recebidos: { increment: 1 } } });
      await this.audit.log({ orgId: d.orgId, actorType: 'system', action: 'cofre.deposito.receber', entityType: 'cofre_item', entityId: id,
        metadata: { depositoId: d.id, recibo: recibo.id } }, tx);
      return { ok: true, recibo: recibo.id };
    });
  }
}
