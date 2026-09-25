import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CreateUserSchema, UpdateUserSchema } from '@mktos/shared';
import { UsersService } from './users.service';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * ============================================================================
 * MUDAR O QUE UMA PESSOA PODE passa pela porta (RF-G-01, RF-A-01)
 * ============================================================================
 *
 * `PATCH /users/:id` está no catálogo como `usuario.permissao.alterar`, R4 —
 * "muda o papel de uma pessoa: quem pode o quê" — e vivia protegido por
 * `admin.usuarios` e mais nada. Sem régua, sem retenção, sem segunda pessoa,
 * sem RASTRO pela porta. É o mesmo furo que a fatia 3.3 fechou para o Google,
 * numa ação mais sensível: R4 exige alçada de titular, motivo escrito e
 * reautenticação na confirmação.
 *
 * O controlador virou TRADUTOR, como o do Google: valida o corpo, entrega à
 * porta e devolve o que ela decidiu. Quem executa é o efeito que o próprio
 * `UsersService` inscreveu — a mesma função na hora e depois da aprovação.
 *
 * O guard continua decidindo QUEM pode propor; a porta decide o RISCO. R4 não
 * sai no clique: a rota responde 200 com `{status:'aguardando_aprovacao'}` e
 * quem executa é `POST /approvals/:id/confirm`, por OUTRA pessoa com alçada.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class UsersController {
  constructor(
    private readonly svc: UsersService,
    private readonly porta: PortaDoOperador,
  ) {}

  @Get('users')
  @RequirePermissions('admin.usuarios')
  list(@CurrentUser() user: JwtUser) {
    return this.svc.list(user.orgId);
  }

  @Get('roles')
  @RequirePermissions('admin.usuarios')
  roles(@CurrentUser() user: JwtUser) {
    return this.svc.roles(user.orgId);
  }

  @Post('users')
  @RequirePermissions('admin.usuarios')
  create(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateUserSchema.parse(body);
    return this.svc.create(user.orgId, input, user.sub);
  }

  @Patch('users/:id')
  @RequirePermissions('admin.usuarios')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = UpdateUserSchema.parse(body);
    /*
     * AS DUAS TRAVAS DE "NÃO CONTRA SI MESMO" FICAM NO PROPONENTE. O serviço já
     * as aplica ao `actorId` que recebe — mas, pela porta, quem executa depois
     * da aprovação é o APROVADOR, e aí a conferência do serviço olharia para a
     * pessoa errada. Recusar aqui, antes de propor, é o que mantém a regra
     * valendo para quem clicou, seja quem for que assine.
     */
    if (id === user.sub && input.isActive === false) {
      throw new ForbiddenException('Você não pode desativar a própria conta.');
    }
    if (id === user.sub && input.password) {
      throw new ForbiddenException(
        'Troque a própria senha em POST /config/password, que exige a senha atual. ' +
          'Esta rota não redefine a senha de quem está usando a sessão.',
      );
    }
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'usuario.permissao.alterar',
      args: { id, ...input },
      resource: { type: 'user', id },
    });
  }
}
