import { Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import { LISTA_DA_IMPLANTACAO, type ListaDeClientesAtivos } from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';
import { acharOuCriarClienteDoLead } from './cliente-do-lead';
import { juntarClientesAtivos } from './clientes-ativos';
import { ContratoVivoService } from './contrato-vivo.service';

/*
 * CLIENTES ATIVOS NUMA LISTA SÓ (P-84, 27/10/2026). Lê os cinco lugares onde o cliente
 * mora e entrega a junção de `clientes-ativos.ts`. A única escrita é "Criar cadastro" do
 * lead em Contrato ou Negócio fechado sem cadastro, pela régua do "Iniciar onboarding"
 * (`acharOuCriarClienteDoLead`); a ficha passa a apontar o cadastro, e o fechamento
 * depois o reaproveita. Cobrança, contrato e implantação não nascem aqui.
 */

const ETAPAS_COM_CADASTRO = ['contrato', 'fechado'];

@Injectable()
export class ClientesAtivosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contratos: ContratoVivoService,
  ) {}

  async lista(orgId: string): Promise<ListaDeClientesAtivos> {
    const [cadastros, acordos, fichas, vivos, conversas, tarefas] = await Promise.all([
      this.prisma.partner.findMany({
        where: { orgId, interno: false, ativo: true, OR: [{ isCliente: true }, { acordos: { some: {} } }] },
        select: { id: true, razaoSocial: true, nomeFantasia: true, principalId: true, isCliente: true },
        take: 5000,
      }),
      this.prisma.acordoComercial.findMany({
        where: { orgId },
        select: { id: true, cliente: true, apelidos: true, produto: true, tipo: true, valor: true, fechadoEm: true, partnerId: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.comercialFicha.findMany({
        where: { orgId },
        select: { leadId: true, empresa: true, etapa: true, partnerId: true, tipoNegocio: true, valorCentavos: true, valorNegociadoCentavos: true, cardId: true, lead: { select: { name: true } } },
        take: 5000,
      }),
      this.contratos.lista(orgId),
      this.prisma.whatsAppConversa.findMany({
        where: { orgId, arquivadaEm: null, OR: [{ clienteId: { not: null } }, { leadId: { not: null } }] },
        select: { id: true, nome: true, clienteId: true, leadId: true },
        take: 5000,
      }),
      this.prisma.workTask.findMany({
        where: { orgId, excluidaEm: null, list: { name: { equals: LISTA_DA_IMPLANTACAO, mode: 'insensitive' } } },
        select: { id: true, clienteId: true, leadId: true, status: { select: { name: true } } },
        take: 2000,
      }),
    ]);
    // O card que o fechamento abriu aponta o lead pela ficha (`cardId`), não pela tarefa.
    const leadDoCard = new Map(fichas.filter((f) => f.cardId).map((f) => [f.cardId!, f.leadId]));
    return juntarClientesAtivos({
      cadastros,
      acordos: acordos.map((a) => ({ ...a, valor: Number(a.valor) })),
      fichas: fichas.map((f) => ({
        leadId: f.leadId, leadNome: f.lead.name, empresa: f.empresa, etapa: f.etapa, partnerId: f.partnerId,
        tipoNegocio: f.tipoNegocio, valorCentavos: f.valorCentavos, valorNegociadoCentavos: f.valorNegociadoCentavos,
      })),
      contratos: vivos.map((c) => ({ leadId: c.leadId, situacao: c.situacao })),
      conversas: conversas.map((c) => ({ id: c.id, nome: (c.nome ?? '').trim() || 'Conversa sem nome', clienteId: c.clienteId, leadId: c.leadId })),
      implantacoes: tarefas.map((t) => ({ taskId: t.id, etapa: t.status.name, clienteId: t.clienteId, leadId: t.leadId ?? leadDoCard.get(t.id) ?? null })),
    });
  }

  /** "Criar cadastro" do lead em Contrato ou Negócio fechado: acha ou cria e a ficha passa a apontar. */
  async criarCadastro(orgId: string, leadId: string, quem: { id: string; papeis: readonly string[] }): Promise<ListaDeClientesAtivos> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException('Conta de máquina não cria cadastro de cliente: quem decide é gente da casa.');
    const pessoa = await this.prisma.user.findFirst({ where: { id: quem.id, orgId, isActive: true }, select: { id: true } });
    if (!pessoa) throw new ForbiddenException('Só gente ativa da empresa cria cadastro de cliente.');
    await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, orgId },
        select: { name: true, phone: true, email: true, ficha: { select: { etapa: true, partnerId: true, empresa: true, cnpj: true, cadastro: true } } },
      });
      if (!lead) throw new NotFoundException('Lead não encontrado nesta empresa.');
      const f = lead.ficha;
      if (!f || !ETAPAS_COM_CADASTRO.includes(f.etapa)) throw new ConflictException('O lead ainda não está em Contrato nem em Negócio fechado.');
      const cadastro = (f.cadastro ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const r = await acharOuCriarClienteDoLead(tx, orgId, {
        partnerIdDaFicha: f.partnerId,
        nome: f.empresa ?? str(cadastro.razaoSocial) ?? lead.name,
        cnpj: f.cnpj ?? str(cadastro.cnpj),
        telefone: lead.phone,
        email: str(cadastro.email) ?? lead.email ?? null,
      });
      if (r.como === 'ficha') return;
      await tx.comercialFicha.updateMany({ where: { leadId, orgId }, data: { partnerId: r.id } });
      await tx.auditLog.create({
        data: {
          orgId, actorType: ActorType.user, actorId: pessoa.id, action: 'comercial.cliente_ativo.cadastro', entityType: 'lead', entityId: leadId,
          before: { partnerId: f.partnerId } as Prisma.InputJsonValue,
          after: { partnerId: r.id, como: r.como } as Prisma.InputJsonValue,
          metadata: { etapa: f.etapa, origem: 'clientes-ativos' } as Prisma.InputJsonValue,
        },
      });
    });
    return this.lista(orgId);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/clientes-ativos')
export class ClientesAtivosController {
  constructor(private readonly svc: ClientesAtivosService) {}

  @Get()
  @RequirePermissions('leads.ver')
  lista(@CurrentUser() user: JwtUser): Promise<ListaDeClientesAtivos> {
    return this.svc.lista(user.orgId);
  }

  @Post(':leadId/cadastro')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  criarCadastro(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string, @Body() _body: unknown): Promise<ListaDeClientesAtivos> {
    return this.svc.criarCadastro(user.orgId, leadId, { id: user.sub, papeis: user.roles ?? [] });
  }
}
