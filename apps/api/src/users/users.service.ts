import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { UpdateUserSchema } from '@mktos/shared';
import type { CreateUserInput, RoleList, UpdateUserInput, UserList } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly efeitos: EfeitosRegistry,
  ) {}

  onModuleInit(): void {
    /*
     * MUDAR O QUE UMA PESSOA PODE É R4 — e até aqui era um PATCH atrás de uma
     * permissão só.
     *
     * `usuario.permissao.alterar` está no catálogo como R4 desde a base ROOT:
     * alçada de titular, motivo escrito e reautenticação de verdade na
     * confirmação. A rota, porém, chamava `update()` direto, protegida por
     * `admin.usuarios` e mais nada — sem régua, sem segunda pessoa, sem RASTRO
     * pela porta. Inscrever o efeito é o que deixa o controlador virar tradutor.
     *
     * A SENHA ENTRA JUNTO, de propósito. Este método já dizia que resetar a
     * senha de outra pessoa "deveria ser ação sensível com aprovação"; agora é.
     * O RASTRO não a grava em claro: a capacidade é `sensibilidade: restrita`,
     * e a porta redige os argumentos antes de escrever.
     *
     * O `id` do alvo viaja nos argumentos porque é parte do que a aprovação
     * assina: mudar o alvo depois de assinado derruba o vínculo de conteúdo.
     */
    // No formato `registrar({` com a chave a seis espaços, de propósito: é o que
    // a varredura de `test/escritas-pela-porta.test.ts` lê para cruzar efeito e
    // catálogo. Recuar de outro jeito cega a varredura, e ela reprova por isso.
    this.efeitos.registrar({
      'usuario.permissao.alterar': (a, org, ctx: ContextoDoEfeito) => {
        const { id, ...resto } = a as { id?: unknown };
        return this.update(org, String(id ?? ''), UpdateUserSchema.parse(resto), ctx.actorId ?? 'porta');
      },
    }, 'UsersService');
  }

  async list(orgId: string): Promise<UserList> {
    const rows = await this.prisma.user.findMany({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
      include: { roles: { select: { key: true } } },
    });
    return {
      items: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        roles: u.roles.map((r) => r.key),
      })),
      total: rows.length,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  async roles(orgId: string): Promise<RoleList> {
    const rows = await this.prisma.role.findMany({
      where: { orgId },
      include: { permissions: { select: { key: true } }, _count: { select: { users: true } } },
    });
    return {
      items: rows.map((r) => ({
        key: r.key,
        name: r.name,
        permissions: r.permissions.map((p) => p.key).sort(),
        userCount: r._count.users,
      })),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /** ids dos perfis do org a partir das keys (valida que todas existem). */
  private async roleIdsByKeys(orgId: string, keys: string[]): Promise<string[]> {
    const roles = await this.prisma.role.findMany({
      where: { orgId, key: { in: keys } },
      select: { id: true, key: true },
    });
    const found = new Set(roles.map((r) => r.key));
    const missing = keys.filter((k) => !found.has(k));
    if (missing.length) throw new BadRequestException(`Perfil(is) inexistente(s): ${missing.join(', ')}`);
    return roles.map((r) => r.id);
  }

  async create(orgId: string, input: CreateUserInput, actorId: string): Promise<{ id: string }> {
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new BadRequestException('E-mail já cadastrado.');

    const roleIds = await this.roleIdsByKeys(orgId, input.roles);
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: {
        orgId,
        name: input.name,
        email: input.email,
        passwordHash,
        roles: { connect: roleIds.map((id) => ({ id })) },
      },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      after: { name: input.name, email: input.email, roles: input.roles },
    });
    return { id: user.id };
  }

  async update(
    orgId: string,
    id: string,
    input: UpdateUserInput,
    actorId: string,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.user.findFirst({
      where: { id, orgId },
      include: { roles: { select: { key: true } } },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    // trava de segurança: não desativar/rebaixar a própria conta
    if (id === actorId && input.isActive === false) {
      throw new ForbiddenException('Você não pode desativar a própria conta.');
    }

    /*
     * NÃO SE TROCA A PRÓPRIA SENHA POR AQUI — e esta linha é o que faz a
     * reautenticação de R4/R5 valer alguma coisa.
     *
     * O revisor mediu, na API compilada: com APENAS um token de sessão de
     * `admin_master`, esta rota trocou a senha do PRÓPRIO dono do token — sem
     * pedir a senha atual, sem reautenticação — e a confirmação de R4 passou em
     * seguida com a senha recém-definida. Como `admin_master` é o ÚNICO papel
     * que junta a permissão desta rota (`admin.usuarios`) com a alçada de
     * titular, a prova de identidade não acrescentava nada contra sessão roubada
     * justamente no perfil que aprova R4 — que é o cenário inteiro que a fatia
     * 3.4 existe para fechar.
     *
     * Trocar a própria senha já tem caminho próprio e ele pede a senha atual:
     * `POST /config/password` (`config.service.ts`). Esta rota continua servindo
     * para RESETAR a senha de outra pessoa — o que também deveria ser ação
     * sensível com aprovação, e está no relatório como pergunta de produto.
     */
    if (id === actorId && input.password) {
      throw new ForbiddenException(
        'Troque a própria senha em POST /config/password, que exige a senha atual. ' +
          'Esta rota não redefine a senha de quem está usando a sessão.',
      );
    }

    const data: Record<string, unknown> = {};
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.password) data.passwordHash = await bcrypt.hash(input.password, 10);
    if (input.roles) {
      const roleIds = await this.roleIdsByKeys(orgId, input.roles);
      data.roles = { set: roleIds.map((rid) => ({ id: rid })) };
    }

    await this.prisma.user.update({ where: { id }, data });
    await this.audit.log({
      orgId,
      actorId,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      before: { isActive: user.isActive, roles: user.roles.map((r) => r.key) },
      after: {
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.roles ? { roles: input.roles } : {}),
        ...(input.password ? { passwordReset: true } : {}),
      },
    });
    return { ok: true };
  }
}
