import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { EquipeService } from './equipe.service';

/*
 * A EQUIPE (rodada dos agentes, 21/10/2026, A7). Prefixo `organograma`, que já é
 * espinha (`tenants/modulos.ts`), e permissão `dashboard.ver`, a do item
 * "Equipe" do menu e a de `GET /organograma`: a tela é a mesma.
 *
 * As duas escritas pedem só `dashboard.ver` no guarda porque a regra de quem
 * pode é "OU" (admin.usuarios OU admin.permissoes para o dono; a própria pessoa
 * OU admin.usuarios para o número), e o guarda só sabe "E". Quem recusa é o
 * serviço, com os papéis RELIDOS no banco.
 */

const DonoSchema = z.object({ userId: z.string().min(1).max(100).nullable() });
const WhatsappSchema = z.object({ numero: z.string().max(40).nullable() });

function ler<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('organograma')
export class EquipeController {
  constructor(private readonly equipe: EquipeService) {}

  @Get('equipe')
  @RequirePermissions('dashboard.ver')
  ver(@CurrentUser() user: JwtUser) {
    return this.equipe.equipe(user.orgId, user.sub);
  }

  @Put('dono/:slug')
  @RequirePermissions('dashboard.ver')
  trocarDono(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    const { userId } = ler(DonoSchema, body);
    return this.equipe.trocarDono(user.orgId, user.sub, slug, userId);
  }

  @Put('pessoas/:id/whatsapp')
  @RequirePermissions('dashboard.ver')
  whatsapp(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { numero } = ler(WhatsappSchema, body);
    return this.equipe.cadastrarWhatsapp(user.orgId, user.sub, id, numero);
  }
}
