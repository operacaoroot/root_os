import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AgentEstado } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { RotinasService } from './rotinas.service';
import { RotinasScheduler } from './rotinas.scheduler';

/**
 * A tela `/rotinas` — RF-N-04.
 *
 * PERMISSÕES: `automacoes.ver` para ler e `automacoes.executar` para agir. As
 * duas JÁ EXISTEM no catálogo (`packages/shared/src/permissions.ts`) e são as
 * mesmas que o menu declara para esta tela — nenhuma permissão nova entra aqui,
 * e com isso nenhum ritual de três passos (construir o pacote, sincronizar o
 * catálogo, todo mundo sair e entrar) precisa acontecer para esta fatia subir.
 *
 * O prefixo `rotinas` é de ESPINHA DO OS: rotina fala do sistema, não do negócio
 * do cliente, e não desliga por contrato. Ele precisa estar declarado em
 * `PREFIXOS_DA_ESPINHA` (`src/tenants/modulos.ts`) — arquivo que não é desta
 * fatia; está no relatório, e sem ele `test/modulos-por-tenant.test.ts` reprova
 * de propósito, que é a catraca fazendo o trabalho dela.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('rotinas')
export class RotinasController {
  constructor(
    private readonly svc: RotinasService,
    private readonly agendador: RotinasScheduler,
  ) {}

  /**
   * O estado do AGENDADOR vai junto com a lista, e não é enfeite: sem ele a tela
   * não tem como distinguir "nenhuma rotina disparou porque não era hora" de
   * "nada dispara neste processo" — nem de "a descoberta do tique volta vazia
   * por policy", que é o caso em que tudo parece verde e nada acontece.
   */
  @Get()
  @RequirePermissions('automacoes.ver')
  async listar(@CurrentUser() user: JwtUser) {
    return this.svc.listar(user.orgId, await this.agendador.diagnostico());
  }

  /**
   * Cria rotina sem linha de origem (MC5) — a coleta de quinta, por exemplo. A
   * permissão é a mesma que já edita rotina: criar é agir, não ler.
   */
  @Post()
  @RequirePermissions('automacoes.executar')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.svc.criar(user.orgId, body, user.sub);
  }

  @Get(':id/execucoes')
  @RequirePermissions('automacoes.ver')
  historico(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Query('limite') limite?: string,
  ) {
    const n = limite ? Number(limite) : undefined;
    return this.svc.historico(user.orgId, id, Number.isFinite(n) ? (n as number) : undefined);
  }

  @Post(':id/rodar')
  @RequirePermissions('automacoes.executar')
  rodar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.rodarAgora(user.orgId, id, user.sub);
  }

  /**
   * Muda estado, interruptor ou linha de base — um campo por vez, de propósito:
   * são três decisões diferentes, e um PATCH que aceitasse os três juntos
   * deixaria o RASTRO de auditoria dizendo "alguém mexeu na rotina".
   */
  @Patch(':id')
  @RequirePermissions('automacoes.executar')
  alterar(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() body: { estado?: string; ativo?: boolean; minutosPorExecucao?: number },
  ) {
    const campos = [body?.estado, body?.ativo, body?.minutosPorExecucao].filter(
      (v) => v !== undefined,
    );
    if (campos.length !== 1) {
      throw new BadRequestException(
        'Mande exatamente um campo: `estado`, `ativo` ou `minutosPorExecucao`.',
      );
    }

    if (body.estado !== undefined) {
      if (!Object.values(AgentEstado).includes(body.estado as AgentEstado)) {
        throw new BadRequestException(
          `Estado inválido. Use: ${Object.values(AgentEstado).join(', ')}.`,
        );
      }
      return this.svc.definirEstado(user.orgId, id, body.estado as AgentEstado, user.sub);
    }
    if (body.ativo !== undefined) {
      return this.svc.definirAtivo(user.orgId, id, Boolean(body.ativo), user.sub);
    }
    return this.svc.definirLinhaDeBase(user.orgId, id, Number(body.minutosPorExecucao), user.sub);
  }
}
