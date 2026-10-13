import { Body, Controller, Get, HttpCode, NotImplementedException, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';

/*
 * A INTELIGÊNCIA DO COCKPIT — Lane 0 → Lane E.
 *
 * Diagnóstico a partir da ata (reaproveita `onboarding/trilho/leitor-de-ata.ts`),
 * construtor e revisor de proposta, torre das automações (tela 12) e relatório
 * da quinta (tela 13). Toda chamada de modelo sai pelo `LLM_PROVIDER` (que
 * ganha `stub` e `ponte` em `src/llm/`), com `orgId` para o teto. Em
 * homologação a empresa fica sem teto e a `ponte` grava custo 0 com
 * `custoDesconhecido: true` — nunca um preço inventado.
 */
const PENDENTE = (oQue: string) =>
  new NotImplementedException(`${oQue}: ainda não implementado nesta versão (lane E da passagem).`);

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class InteligenciaController {
  /** Tela 06: o pós-sessão — falas com minuto, diagnóstico montado, proposta pronta e laudo. */
  @Get('lead/:id/sessao')
  @RequirePermissions('leads.ver')
  sessao(@CurrentUser() _user: JwtUser, @Param('id') _id: string) {
    throw PENDENTE('o pós-sessão');
  }

  /** Gera (ou refaz) o diagnóstico a partir da ata gravada. */
  @Post('lead/:id/diagnostico/gerar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  gerarDiagnostico(@CurrentUser() _user: JwtUser, @Param('id') _id: string, @Body() _body: unknown) {
    throw PENDENTE('gerar o diagnóstico');
  }

  /** Aprova o diagnóstico (portão de E5). */
  @Post('lead/:id/diagnostico/aprovar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  aprovarDiagnostico(@CurrentUser() _user: JwtUser, @Param('id') _id: string) {
    throw PENDENTE('aprovar o diagnóstico');
  }

  /** Constrói a proposta (tabela de preço + quadro de custos + validade) e passa pelo revisor. */
  @Post('lead/:id/proposta/gerar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  gerarProposta(@CurrentUser() _user: JwtUser, @Param('id') _id: string, @Body() _body: unknown) {
    throw PENDENTE('gerar a proposta');
  }

  /** Publica a proposta na sala (ou agenda a publicação, se "silêncio aprova" estiver ligado). */
  @Post('lead/:id/proposta/publicar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  publicarProposta(@CurrentUser() _user: JwtUser, @Param('id') _id: string, @Body() _body: unknown) {
    throw PENDENTE('publicar a proposta');
  }

  /** "Segurar": tira a proposta da publicação agendada. */
  @Post('lead/:id/proposta/segurar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  segurarProposta(@CurrentUser() _user: JwtUser, @Param('id') _id: string) {
    throw PENDENTE('segurar a proposta');
  }

  /** Tela 12: a torre das automações. */
  @Get('torre')
  @RequirePermissions('leads.ver')
  torre(@CurrentUser() _user: JwtUser) {
    throw PENDENTE('a torre');
  }

  /** Tela 13: o relatório da semana (lido; o relator roda na quinta pela rotina). */
  @Get('relatorio/semana')
  @RequirePermissions('leads.ver')
  relatorio(@CurrentUser() _user: JwtUser, @Query('dias') _dias?: string) {
    throw PENDENTE('o relatório da semana');
  }

  /** Gera o relatório agora (o que a rotina de quinta faz). */
  @Post('relatorio/semana/gerar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  gerarRelatorio(@CurrentUser() _user: JwtUser) {
    throw PENDENTE('gerar o relatório');
  }
}
