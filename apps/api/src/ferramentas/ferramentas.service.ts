import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ActorType, EstadoDeAgente } from '@prisma/client';
import { z } from 'zod';
import { temPapelDeMaquina } from '../approvals/alcada';
import { contextoAtual } from '../common/contexto-execucao';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModulosService } from '../tenants/modulos.service';
import { ferramentaGerada, ferramentasGeradas, type FerramentaGerada } from './bridge';

const TITULO = z.string().trim().min(1).max(200);
const TEXTO = z.string().min(1).max(10_000);

export interface AtorDaFerramenta {
  orgId: string;
  actorId: string;
  actorType: ActorType;
}

@Injectable()
export class FerramentasService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulos: ModulosService,
    private readonly efeitos: EfeitosRegistry,
    private readonly porta: PortaDoOperador,
  ) {}

  onModuleInit(): void {
    const capacidades: Record<string, (args: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito) => Promise<unknown>> = {};
    for (const ferramenta of ferramentasGeradas()) {
      capacidades[ferramenta.listCapability] = (_args, orgId, ctx) => this.efeitoListar(ferramenta, orgId, ctx);
      capacidades[ferramenta.createCapability] = (args, orgId, ctx) =>
        this.efeitoCriar(ferramenta, orgId, args, ctx);
    }
    this.efeitos.registrar(capacidades, 'FerramentasService (ferramentas geradas)');
  }

  ferramenta(slug: string): FerramentaGerada {
    const ferramenta = ferramentaGerada(slug);
    if (!ferramenta) throw new NotFoundException('Ferramenta não encontrada');
    return ferramenta;
  }

  async autorizarOperador(ator: AtorDaFerramenta, permissao: 'mcp.ver' | 'mcp.executar'): Promise<void> {
    if (ator.actorType !== ActorType.user) throw new ForbiddenException('A operação exige uma sessão humana.');
    const usuario = await this.prisma.user.findFirst({
      where: { id: ator.actorId, orgId: ator.orgId },
      select: {
        isActive: true,
        org: { select: { isActive: true } },
        roles: { select: { key: true, permissions: { select: { key: true } } } },
      },
    });
    if (!usuario?.isActive || !usuario.org.isActive) throw new ForbiddenException('Usuário ou empresa inativos.');
    const papeis = usuario.roles.map((role) => role.key);
    if (temPapelDeMaquina(papeis)) throw new ForbiddenException('Conta de máquina não opera como pessoa.');
    if (!usuario.roles.some((role) => role.permissions.some((permission) => permission.key === permissao))) {
      throw new ForbiddenException('Permissão insuficiente.');
    }
  }

  async listarParaOperador(slug: string, ator: AtorDaFerramenta): Promise<unknown> {
    const ferramenta = this.ferramenta(slug);
    await this.ferramentaAtiva(ator.orgId, ferramenta);
    await this.autorizarOperador(ator, 'mcp.ver');
    return this.executarPelaPorta(ferramenta.listCapability, ator, {});
  }

  async criarParaOperador(slug: string, ator: AtorDaFerramenta, titulo: string, texto: string): Promise<unknown> {
    const ferramenta = this.ferramenta(slug);
    await this.ferramentaAtiva(ator.orgId, ferramenta);
    await this.autorizarOperador(ator, 'mcp.executar');
    const input = { titulo: TITULO.parse(titulo), texto: TEXTO.parse(texto) };
    return this.executarPelaPorta(ferramenta.createCapability, ator, input);
  }

  private async executarPelaPorta(capabilityId: string, ator: AtorDaFerramenta, args: Record<string, unknown>): Promise<unknown> {
    const resultado = await this.porta.executar({
      orgId: ator.orgId,
      actorId: ator.actorId,
      capabilityId,
      args,
      resource: { type: 'ferramenta_registro', id: capabilityId },
    });
    return resultado;
  }

  private async ferramentaAtiva(orgId: string, ferramenta: FerramentaGerada): Promise<void> {
    const ativa = await this.modulos.ferramentaAtivaDaOrg(orgId, ferramenta.activationKey);
    if (!ativa) throw new NotFoundException('Ferramenta não encontrada');
  }

  private async validarAtorDeEfeito(
    orgId: string,
    capabilityId: string,
    ctx: ContextoDoEfeito,
    permissao: 'mcp.ver' | 'mcp.executar',
  ): Promise<void> {
    if (ctx.actorType === ActorType.user && ctx.actorId) {
      await this.autorizarOperador({ orgId, actorId: ctx.actorId, actorType: ActorType.user }, permissao);
      return;
    }
    if (ctx.actorType !== ActorType.ai || !ctx.actorId) {
      throw new ForbiddenException('Ator de ferramenta inválido.');
    }
    const agente = await this.prisma.agent.findFirst({
      where: {
        orgId,
        ativo: true,
        estado: EstadoDeAgente.ativo,
        ...(ctx.agentSlug ? { slug: ctx.agentSlug } : { id: ctx.actorId }),
      },
      select: { capacidades: true, org: { select: { isActive: true } } },
    });
    if (!agente?.org.isActive || !agente.capacidades.includes(capabilityId)) {
      throw new ForbiddenException(`Agente não autorizado para ${permissao}.`);
    }
  }

  private async efeitoListar(ferramenta: FerramentaGerada, orgId: string, ctx: ContextoDoEfeito): Promise<unknown> {
    await this.ferramentaAtiva(orgId, ferramenta);
    await this.validarAtorDeEfeito(orgId, ferramenta.listCapability, ctx, 'mcp.ver');
    return ferramenta.listarRegistros(this.prisma, orgId);
  }

  private async efeitoCriar(
    ferramenta: FerramentaGerada,
    orgId: string,
    args: Record<string, unknown>,
    ctx: ContextoDoEfeito,
  ): Promise<unknown> {
    await this.ferramentaAtiva(orgId, ferramenta);
    await this.validarAtorDeEfeito(orgId, ferramenta.createCapability, ctx, 'mcp.executar');
    const titulo = TITULO.safeParse(args.titulo);
    const texto = TEXTO.safeParse(args.texto);
    if (!titulo.success || !texto.success) throw new BadRequestException('Título e texto inválidos.');
    return ferramenta.criarRegistro(this.prisma, orgId, titulo.data, texto.data);
  }
}
