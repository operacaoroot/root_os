import { Controller, ForbiddenException, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApprovalState } from '@prisma/client';
import type { ClienteComPasta } from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';
import { nomeDoCliente } from './pasta-do-cliente/nome-da-pasta';
import { PastaDoClienteService } from './pasta-do-cliente/pasta-do-cliente.service';
import type { ResultadoDaPasta } from './portas';

/*
 * `POST /api/clientes/:id/pasta` e `GET /api/clientes/pastas` (rodada dos agentes, lane A4, TR-04).
 *
 * Criar a pasta pede `tarefas.editar` OU `leads.editar` (o card da Implantação e
 * a ficha do comercial, as duas telas que mostram o botão) e é de GENTE: conta
 * de máquina não pede pasta por aqui (pelo token; a porta grava a pessoa como
 * proponente, e quem confirma é outra). A resposta é a `ResultadoDaPasta`:
 * `pronta`, `aguardando_aprovacao` (R3), `sem_raiz` ou `erro`.
 *
 * A lista dos clientes com o estado da pasta pede `tarefas.ver` OU `leads.ver`.
 * O `PermissionsGuard` só sabe exigir TODAS; o "ou" é conferido aqui.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('clientes')
export class ClientesController {
  constructor(
    private readonly pastas: PastaDoClienteService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':id/pasta')
  @HttpCode(200)
  @RequirePermissions('dashboard.ver')
  async criarPasta(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<ResultadoDaPasta> {
    exigirAlguma(user, ['tarefas.editar', 'leads.editar']);
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException('Pedir a pasta do cliente é de gente: conta de máquina não pede.');
    return this.pastas.garantir({ orgId: user.orgId, partnerId: id, origem: 'manual', atorId: user.sub });
  }

  @Get('pastas')
  @RequirePermissions('dashboard.ver')
  async pastasDosClientes(@CurrentUser() user: JwtUser): Promise<ClienteComPasta[]> {
    exigirAlguma(user, ['tarefas.ver', 'leads.ver']);
    const orgId = user.orgId;
    const clientes = await this.prisma.partner.findMany({
      where: { orgId, isCliente: true, ativo: true, interno: false },
      select: { id: true, razaoSocial: true, nomeFantasia: true, pastaDriveUrl: true, pastaDriveErro: true },
      orderBy: { razaoSocial: 'asc' },
      take: 500,
    });
    const ids = clientes.map((c) => c.id);
    const [pedidos, fila] = await Promise.all([
      this.prisma.approval.findMany({
        where: {
          orgId,
          capabilityId: 'drive.pasta.criar',
          resourceType: 'cliente',
          resourceId: { in: ids },
          status: { in: [ApprovalState.pendente, ApprovalState.confirmada] },
          expiraEm: { gt: new Date() },
        },
        select: { resourceId: true },
      }),
      this.prisma.arquivoDoCliente.groupBy({
        by: ['partnerId'],
        where: { orgId, partnerId: { in: ids }, estado: 'na_fila' },
        _count: { _all: true },
      }),
    ]);
    const aguardando = new Set(pedidos.map((p) => p.resourceId));
    const naFila = new Map(fila.map((f) => [f.partnerId, f._count._all]));
    return clientes.map((c) => ({
      id: c.id,
      nome: nomeDoCliente(c),
      pastaDriveUrl: c.pastaDriveUrl,
      pastaDriveErro: c.pastaDriveErro,
      aguardandoAprovacao: !c.pastaDriveUrl && aguardando.has(c.id),
      arquivosNaFila: naFila.get(c.id) ?? 0,
    }));
  }
}

function exigirAlguma(user: JwtUser, perms: string[]): void {
  const tem = user?.permissions ?? [];
  if (!perms.some((p) => tem.includes(p))) throw new ForbiddenException('Permissão insuficiente');
}
