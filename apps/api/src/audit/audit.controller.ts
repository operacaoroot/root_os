import { Body, Controller, Delete, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { EventLogService } from '../gateway/event-log.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { PEDIDO_DE_HERANCA, PEDIDO_DE_RETENCAO, RetencaoService } from './retencao.service';

/*
 * NENHUMA ROTA DE EXPURGO AQUI, E ISSO É A FATIA.
 *
 * O caminho que apaga linha do RASTRO por retenção não pode estar ao alcance da
 * aplicação em operação normal — então ele não é rota. E, desde 11/09/2026,
 * `ExpurgoService` também não é provider de módulo nenhum: o injetor da API não
 * conhece a classe. Quem a constrói é `src/scripts/expurgar-rastro.ts`, à mão,
 * com a conexão DONA das tabelas.
 *
 * A diferença importa porque, quando a aplicação conecta como dono — o padrão
 * sem `TENANT_DATABASE_URL` —, as travas do BANCO não a alcançam: ela é dona,
 * tem EXECUTE e atravessa policy. O que separava o expurgo de uma requisição
 * HTTP era só não existir uma. Agora é também não existir o provider.
 *
 * O QUE ESTÁ AQUI é a retenção: ler e configurar o prazo desta empresa, e
 * verificar a integridade da cadeia.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly svc: AuditService,
    private readonly eventos: EventLogService,
    private readonly retencao: RetencaoService,
  ) {}

  /*
   * A cadeia do rastro, verificada de ponta a ponta. É o que transforma
   * "cadeia íntegra" de enfeite de tela em afirmação checável: um elo quebrado
   * devolve em qual sequência e por quê.
   *
   * E É AQUI QUE A LACUNA DE CAMPO POR NÍVEL FICA LEGÍVEL. A conferência de
   * nível avisa em vez de recusar (ação sem registro é pior do que registro
   * incompleto), mas o campo `payload.rastro.faltando` que ela grava não tinha
   * leitor nenhum: não há rota que liste os eventos e a tela de auditoria ainda
   * lê o log antigo. `incompletosPorNivel` na resposta é o leitor — a contagem
   * de eventos que declararam lacuna, por degrau da régua.
   */
  @Get('verificar')
  @RequirePermissions('auditoria.ver')
  verificar(@CurrentUser() user: JwtUser) {
    return this.eventos.verificar(user.orgId);
  }

  /** Quanto tempo o rastro desta empresa fica (RF-R-06). */
  @Get('retencao')
  @RequirePermissions('auditoria.ver')
  lerRetencao(@CurrentUser() user: JwtUser) {
    return this.retencao.ler(user.orgId);
  }

  /*
   * DUAS PERMISSÕES, E AND ENTRE ELAS (`PermissionsGuard` usa `every`).
   *
   * O catálogo de `packages/shared/src/permissions.ts` não tem
   * `auditoria.configurar`, e aquele arquivo é de outro pacote — não desta
   * fatia. `auditoria.ver` sozinha é fraca demais para uma escrita que decide
   * quando a prova some; `admin.permissoes` junto restringe a quem já administra
   * o acesso. A permissão própria está registrada como pergunta no relatório.
   */
  @Put('retencao')
  @RequirePermissions('auditoria.ver', 'admin.permissoes')
  definirRetencao(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const pedido = PEDIDO_DE_RETENCAO.parse(body);
    return this.retencao.definir({
      orgId: user.orgId,
      dias: pedido.dias,
      motivo: pedido.motivo,
      definidoPor: user.sub,
    });
  }

  /**
   * Volta a herdar o prazo da política. Apaga a CONFIGURAÇÃO, nunca evento.
   *
   * Aceita corpo por causa do `motivo`: quando a herança ENCURTA a guarda, o
   * serviço o exige, pela mesma regra de `PUT`. Vai no corpo e não na query
   * porque parâmetro de URL entra em log de acesso e em histórico de proxy, e o
   * motivo é texto de negócio.
   */
  @Delete('retencao')
  @RequirePermissions('auditoria.ver', 'admin.permissoes')
  herdarRetencao(@CurrentUser() user: JwtUser, @Body() body?: unknown) {
    const pedido = PEDIDO_DE_HERANCA.parse(body ?? {});
    return this.retencao.herdar(user.orgId, user.sub, pedido.motivo);
  }

  @Get()
  @RequirePermissions('auditoria.ver')
  list(
    @CurrentUser() user: JwtUser,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('actorType') actorType?: string,
  ) {
    return this.svc.list(user.orgId, {
      limit: limit ? Number(limit) : undefined,
      action,
      actorType,
    });
  }
}
