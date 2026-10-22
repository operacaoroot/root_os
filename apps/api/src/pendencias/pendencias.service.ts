import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { funcaoPorId, type OpcaoDaPendencia, type Pendencia } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { exigirTenant } from '../common/contexto-execucao';
import { temPapelDeMaquina } from '../approvals/alcada';
import { PendenciasRegistry } from './pendencias.registry';

/** O que um agente ou rotina manda para abrir uma pendência. */
export interface AbrirPendencia {
  /** Id do cadastro único (TR-05, TR-07, CO-16, AG-01...). */
  funcao: string;
  tipo: string;
  /** Idempotência: a mesma chave cai na mesma linha. */
  chave: string;
  titulo: string;
  contexto?: string;
  opcoes: OpcaoDaPendencia[];
  paraUsuarioId?: string | null;
  refTipo?: string | null;
  refId?: string | null;
  dados?: Prisma.InputJsonValue | null;
  /** Produção 22, M4: quando o texto guardado em `dados` vence (`retencao-do-texto.ts`). */
  textoExpiraEm?: Date | null;
}

const TETO_DA_LISTA = 200;

export const RECUSA_DE_MAQUINA_NA_PENDENCIA = 'Responder pendência é de gente: conta de máquina não faz.';
export const RECUSA_DE_OUTRA_PESSOA_NA_PENDENCIA = 'Esta pendência é de outra pessoa: só ela responde ou descarta.';
export const recusaDePermissaoNaPendencia = (permissao: string) =>
  `Responder ou descartar esta pendência exige a permissão "${permissao}", que o seu perfil não tem.`;

/**
 * As pendências que agentes e rotinas deixam para gente (rodada dos agentes, Lane 0).
 *
 * ABRIR é idempotente pela chave: pendência aberta de novo atualiza título,
 * contexto e opções; resolvida ou descartada fica como está (a decisão de gente
 * não é reaberta por uma rotina que passou de novo).
 * RESPONDER toma a linha por escrita condicionada (`estado = 'aberta'`) e só
 * então chama o tratador do tipo; se o tratador falha, a linha volta a aberta e
 * o erro sobe. Dois cliques: o segundo ouve 409.
 * Só gente responde (a rota confere pelo token; aqui, pelo banco).
 *
 * E SÓ QUEM PODE (revisão adversarial de 21/10/2026): a pendência com
 * destinatário (`paraUsuarioId`) só é respondida ou descartada por ele; e a
 * permissão que o tratador do tipo declarou é relida no banco ANTES de tomar a
 * linha. Recusa é 403 e nada muda.
 */
@Injectable()
export class PendenciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registro: PendenciasRegistry,
  ) {}

  async abrir(orgIdBruto: string, p: AbrirPendencia): Promise<{ id: string; nova: boolean; estado: string }> {
    const orgId = exigirTenant(orgIdBruto, 'PendenciasService.abrir');
    if (!funcaoPorId(p.funcao)) throw new Error(`pendência com função desconhecida: ${p.funcao}`);
    const existente = await this.prisma.pendencia.findUnique({
      where: { orgId_chave: { orgId, chave: p.chave } },
      select: { id: true, estado: true },
    });
    if (existente) {
      if (existente.estado === 'aberta') {
        await this.prisma.pendencia.updateMany({
          where: { id: existente.id, orgId, estado: 'aberta' },
          data: { titulo: p.titulo, contexto: p.contexto ?? '', opcoes: p.opcoes as unknown as Prisma.InputJsonValue },
        });
      }
      return { id: existente.id, nova: false, estado: existente.estado };
    }
    try {
      const criada = await this.prisma.pendencia.create({
        data: {
          orgId,
          funcao: p.funcao,
          tipo: p.tipo,
          chave: p.chave,
          titulo: p.titulo,
          contexto: p.contexto ?? '',
          opcoes: p.opcoes as unknown as Prisma.InputJsonValue,
          paraUsuarioId: p.paraUsuarioId ?? null,
          refTipo: p.refTipo ?? null,
          refId: p.refId ?? null,
          dados: p.dados ?? Prisma.JsonNull,
          textoExpiraEm: p.textoExpiraEm ?? null,
        },
        select: { id: true },
      });
      return { id: criada.id, nova: true, estado: 'aberta' };
    } catch (e) {
      // Corrida: outra passada abriu a mesma chave entre a leitura e o insert.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const ja = await this.prisma.pendencia.findUniqueOrThrow({
          where: { orgId_chave: { orgId, chave: p.chave } },
          select: { id: true, estado: true },
        });
        return { id: ja.id, nova: false, estado: ja.estado };
      }
      throw e;
    }
  }

  async listar(orgIdBruto: string, usuarioId: string, filtro: { estado?: string; de?: 'minhas' | 'todas' }): Promise<Pendencia[]> {
    const orgId = exigirTenant(orgIdBruto, 'PendenciasService.listar');
    const linhas = await this.prisma.pendencia.findMany({
      where: {
        orgId,
        estado: filtro.estado ?? 'aberta',
        ...(filtro.de === 'todas' ? {} : { OR: [{ paraUsuarioId: usuarioId }, { paraUsuarioId: null }] }),
      },
      orderBy: { criadaEm: 'desc' },
      take: TETO_DA_LISTA,
    });
    return linhas.map((l) => ({
      id: l.id,
      funcao: l.funcao,
      tipo: l.tipo,
      titulo: l.titulo,
      contexto: l.contexto,
      opcoes: (Array.isArray(l.opcoes) ? l.opcoes : []) as unknown as OpcaoDaPendencia[],
      paraUsuarioId: l.paraUsuarioId,
      refTipo: l.refTipo,
      refId: l.refId,
      estado: l.estado as Pendencia['estado'],
      escolha: l.escolha,
      decididaPor: l.decididaPor,
      decididaEm: l.decididaEm?.toISOString() ?? null,
      criadaEm: l.criadaEm.toISOString(),
    }));
  }

  async responder(orgIdBruto: string, id: string, usuarioId: string, escolha: string, complemento?: string): Promise<{ ok: true }> {
    const orgId = exigirTenant(orgIdBruto, 'PendenciasService.responder');
    const quem = await this.exigirGente(orgId, usuarioId);
    const p = await this.prisma.pendencia.findFirst({ where: { id, orgId } });
    if (!p) throw new NotFoundException('Pendência não encontrada.');
    this.exigirQuePossa(p, usuarioId, quem.permissoes);
    if (p.estado !== 'aberta') throw new ConflictException('Esta pendência já foi decidida.');
    const opcoes = (Array.isArray(p.opcoes) ? p.opcoes : []) as unknown as OpcaoDaPendencia[];
    if (!opcoes.some((o) => o.chave === escolha)) throw new ConflictException('Esta opção não existe nesta pendência.');
    const tomada = await this.prisma.pendencia.updateMany({
      where: { id, orgId, estado: 'aberta' },
      data: { estado: 'resolvida', escolha, decididaPor: usuarioId, decididaEm: new Date() },
    });
    if (tomada.count !== 1) throw new ConflictException('Esta pendência já foi decidida.');
    const tratador = this.registro.tratador(p.tipo);
    if (tratador) {
      try {
        await tratador({ orgId, pendenciaId: id, tipo: p.tipo, escolha, complemento, usuarioId, refTipo: p.refTipo, refId: p.refId, dados: p.dados });
      } catch (e) {
        await this.prisma.pendencia.updateMany({
          where: { id, orgId, estado: 'resolvida', decididaPor: usuarioId },
          data: { estado: 'aberta', escolha: null, decididaPor: null, decididaEm: null },
        });
        throw e;
      }
    }
    return { ok: true };
  }

  async descartar(orgIdBruto: string, id: string, usuarioId: string): Promise<{ ok: true }> {
    const orgId = exigirTenant(orgIdBruto, 'PendenciasService.descartar');
    const quem = await this.exigirGente(orgId, usuarioId);
    const p = await this.prisma.pendencia.findFirst({ where: { id, orgId }, select: { tipo: true, paraUsuarioId: true } });
    if (!p) throw new NotFoundException('Pendência não encontrada.');
    this.exigirQuePossa(p, usuarioId, quem.permissoes);
    const r = await this.prisma.pendencia.updateMany({
      where: { id, orgId, estado: 'aberta' },
      data: { estado: 'descartada', decididaPor: usuarioId, decididaEm: new Date() },
    });
    if (r.count !== 1) throw new ConflictException('Esta pendência não está aberta.');
    return { ok: true };
  }

  /** Relê quem responde no BANCO: ativo, desta empresa, gente; e as permissões dos papéis de agora. */
  private async exigirGente(orgId: string, usuarioId: string): Promise<{ permissoes: Set<string> }> {
    const u = await this.prisma.user.findFirst({
      where: { id: usuarioId, orgId },
      select: { isActive: true, roles: { select: { key: true, permissions: { select: { key: true } } } } },
    });
    if (!u || !u.isActive) {
      throw new ForbiddenException('Sua sessão não corresponde a um usuário ativo desta empresa. Saia e entre de novo.');
    }
    if (temPapelDeMaquina(u.roles.map((r) => r.key))) throw new ForbiddenException(RECUSA_DE_MAQUINA_NA_PENDENCIA);
    return { permissoes: new Set(u.roles.flatMap((r) => r.permissions.map((x) => x.key))) };
  }

  /** O destinatário e a permissão declarada pelo tratador do tipo. Antes de tomar a linha. */
  private exigirQuePossa(p: { tipo: string; paraUsuarioId: string | null }, usuarioId: string, permissoes: Set<string>): void {
    if (p.paraUsuarioId && p.paraUsuarioId !== usuarioId) throw new ForbiddenException(RECUSA_DE_OUTRA_PESSOA_NA_PENDENCIA);
    const exigida = this.registro.permissaoDe(p.tipo);
    if (exigida && !permissoes.has(exigida)) throw new ForbiddenException(recusaDePermissaoNaPendencia(exigida));
  }
}
