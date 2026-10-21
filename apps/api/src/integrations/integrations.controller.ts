import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ToggleIntegrationSchema } from '@mktos/shared';
import { IntegrationsService } from './integrations.service';
import { ClickupService } from './clickup.service';
import { ConectoresService } from './conectores.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/**
 * O corpo do desligamento (RF-G-06).
 *
 * `motivo` é opcional mas entra na frase que o agente recebe quando a
 * ferramenta é recusada — e é o que, seis meses depois, explica no RASTRO por
 * que o conector ficou parado. A tela pede; a API não obriga, porque desligar
 * em emergência não pode esbarrar num campo de texto.
 */
const DesligamentoSchema = z.object({
  motivo: z.string().trim().max(500).optional(),
});

/**
 * O corpo da REVOGAÇÃO. Mesmo campo, propósito diferente — e a diferença é toda
 * a distância entre pausar e queimar: aqui o motivo é o que vai explicar, no
 * RASTRO, por que uma credencial deixou de existir e alguém teve de reautorizar.
 */
const RevogacaoSchema = z.object({
  motivo: z.string().trim().max(500).optional(),
});

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly svc: IntegrationsService,
    private readonly clickup: ClickupService,
    private readonly conectores: ConectoresService,
  ) {}

  /**
   * A tela de Conexões. `?sondar=0` devolve a lista sem sondar ninguém — ver
   * `IntegrationsService.catalog`.
   */
  @Get('catalog')
  @RequirePermissions('dashboard.ver')
  async catalog(@CurrentUser() user: JwtUser, @Query('sondar') sondar?: string) {
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['dashboard.ver']);
    const result = await this.svc.catalog(user.orgId, { sondar: sondar === '1' || sondar === 'true' });
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['dashboard.ver']);
    return result;
  }

  /**
   * O CARTÃO ÚNICO de Conexões (rodada dos agentes, A6): o catálogo sondado, com
   * quem usa cada conector e se há credencial no cofre (nunca o valor).
   * `dashboard.ver`, como o catálogo: ler a tela não muda nada; agir pede
   * `admin.usuarios` nas rotas dos verbos e do desligamento.
   */
  @Get('cartoes')
  @RequirePermissions('dashboard.ver')
  cartoes(@CurrentUser() user: JwtUser) {
    return this.svc.cartoes(user.orgId, user.sub);
  }

  @Get('catalogo-declarativo')
  @RequirePermissions('dashboard.ver')
  catalogoDeclarativo(@CurrentUser() user: JwtUser) {
    return this.svc.catalogoDeclarativo(user.orgId, user.sub);
  }

  /*
   * ==========================================================================
   * OS QUATRO VERBOS DO CONTRATO — RF-X-01 (fatia 5.4)
   * ==========================================================================
   *
   * Quatro rotas, uma por verbo, iguais para TODO conector. Antes desta fatia
   * cada conector tinha a sua: `GET /google/connect`, `GET /meta/connect`,
   * `POST /integrations/clickup/sync`, `POST /knowledge/reindex`,
   * `POST /google/disconnect`. Quem escrevia a tela precisava saber o caminho de
   * cada um, e conector novo significava tela nova.
   *
   * AS ROTAS ANTIGAS CONTINUAM DE PÉ, e isso é decisão, não descuido: elas estão
   * em módulos de outras fatias (`google/`, `meta/`, `obsidian/`) e o callback
   * de OAuth do Google e da Meta é endereço REGISTRADO NA CONSOLA DO
   * FORNECEDOR — mudar exige recadastrar lá antes do deploy (a pesquisa da
   * onda D não achou fonte de que exija App Review novo).
   * O contrato é o caminho ÚNICO para quem chega de fora; o caminho velho é a
   * mesma implementação por outra porta.
   *
   * `:chave` é a chave do CONTRATO (a unidade de credencial): `google`, e não
   * `gmail`. Chave que ninguém implementa devolve 400 com a lista do que existe.
   */

  /**
   * AUTORIZAR. Devolve para onde mandar o navegador (OAuth) ou a instrução
   * manual, quando o conector não tem fluxo automático.
   */
  @Post(':chave/autorizacao')
  @RequirePermissions('admin.usuarios')
  async autorizar(@CurrentUser() user: JwtUser, @Param('chave') chave: string) {
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['admin.usuarios']);
    return this.svc.autorizar(user.orgId, chave, user.sub);
  }

  /**
   * SINCRONIZAR. Sai da casa, então passa pelo interruptor de conector antes.
   *
   * `admin.usuarios` NÃO É A ÚNICA EXIGÊNCIA: as permissões de quem pediu vão
   * junto, e o serviço confere a que o conector declara a mais
   * (`permissaoParaSincronizar`). Sincronizar o ClickUp sempre exigiu
   * `tarefas.editar` e reindexar o Obsidian sempre exigiu `obsidian.editar` —
   * sem essa conferência, este verbo seria uma segunda porta para as duas
   * operações, contornando a permissão específica de cada uma.
   */
  @Post(':chave/sincronizacao')
  @RequirePermissions('admin.usuarios')
  async sincronizar(@CurrentUser() user: JwtUser, @Param('chave') chave: string) {
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['admin.usuarios']);
    return this.svc.sincronizar(user.orgId, chave, user.sub, user.permissions ?? []);
  }

  /**
   * SAÚDE, sob demanda — o "verificar agora" da tela.
   *
   * `dashboard.ver` e não `admin.usuarios`: sondar não muda nada e não devolve
   * segredo nenhum; quem vê a tela precisa poder atualizar a linha que está
   * vermelha sem depender de um administrador.
   */
  @Get(':chave/saude')
  @RequirePermissions('dashboard.ver')
  async saude(@CurrentUser() user: JwtUser, @Param('chave') chave: string) {
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['dashboard.ver']);
    const result = await this.svc.saude(user.orgId, chave);
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['dashboard.ver']);
    return result;
  }

  /**
   * REVOGAR — QUEIMA a credencial desta empresa no cofre e apaga a conexão.
   *
   * NÃO É O DESLIGAMENTO, e as rotas existem separadas justamente para que
   * ninguém confunda no dia do incidente:
   *
   *   POST   :chave/desligamento  → PAUSA     (a credencial fica intacta)
   *   DELETE :chave/desligamento  → RELIGA    (desfaz a pausa)
   *   POST   :chave/revogacao     → QUEIMA    (não desfaz)
   *
   * É POST e não DELETE por um motivo prático além do semântico: corpo em
   * requisição DELETE é território cinzento (nem todo cliente HTTP o envia, e o
   * `express.json` só o interpreta com o cabeçalho certo), e o `motivo` desta
   * rota é justamente o que vai explicar no RASTRO, seis meses depois, por que
   * uma credencial deixou de existir. Perder o motivo por detalhe de transporte
   * seria perder a única coisa que a auditoria não consegue reconstruir.
   */
  @Post(':chave/revogacao')
  @RequirePermissions('admin.usuarios')
  async revogar(@CurrentUser() user: JwtUser, @Param('chave') chave: string, @Body() body: unknown) {
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['admin.usuarios']);
    const input = RevogacaoSchema.parse(body ?? {});
    return this.svc.revogar(user.orgId, chave, user.sub, input.motivo ?? null);
  }

  // Ligar/desligar manualmente um conector (só os com credencial via env/API key).
  // Gerência de integrações é ação de admin.
  @Put(':key')
  @RequirePermissions('admin.usuarios')
  async toggle(@CurrentUser() user: JwtUser, @Param('key') key: string, @Body() body: unknown) {
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['admin.usuarios']);
    const input = ToggleIntegrationSchema.parse(body);
    return this.svc.toggle(user.orgId, key, input.status, user.sub);
  }

  /**
   * DESLIGAR um conector desta empresa — RF-G-06, capacidade `conector.desligar`.
   *
   * Rota SEPARADA do `PUT :key` de propósito. Aquele muda a CONFIGURAÇÃO da
   * integração e recusa os conectores de OAuth (`isManaged`) — justamente os do
   * Google, que são os que mais importa poder desligar depressa. Este vale para
   * todos, porque a pergunta é outra: "pare de usar isto agora".
   *
   * DESLIGAR E RELIGAR SÃO DUAS ROTAS, e não um `desligado: boolean` num corpo
   * só, porque são DUAS CAPACIDADES com níveis diferentes na régua
   * (`conector.desligar` é R3, `conector.religar` é R4 — ver
   * `politica-marketing-os.json`). Um booleano no corpo esconderia isso: a mesma
   * rota valeria dois níveis, e nem o catálogo nem o futuro gancho da porta
   * teriam como dizer qual das duas está sendo chamada. O recurso é "o
   * desligamento": criá-lo é POST, removê-lo é DELETE.
   *
   * `chave` aceita conector (`gmail`) ou grupo (`google` = as quatro
   * superfícies). Alvo desconhecido devolve 400 com a lista do que existe.
   */
  @Post(':chave/desligamento')
  @RequirePermissions('admin.usuarios')
  async desligar(
    @CurrentUser() user: JwtUser,
    @Param('chave') chave: string,
    @Body() body: unknown,
  ) {
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['admin.usuarios']);
    const input = DesligamentoSchema.parse(body ?? {});
    const r = await this.conectores.desligar(user.orgId, chave, {
      motivo: input.motivo,
      actorId: user.sub,
    });
    // A sonda guardada é de ANTES do clique: esquecer aqui é o que impede a tela
    // de mostrar, por até trinta segundos, a saúde de um conector que acabou de
    // ser desligado. Ver `VALIDADE_DA_SONDA_MS`.
    this.svc.esquecerSonda(user.orgId, chave);
    return r;
  }

  /**
   * RELIGAR — capacidade `conector.religar`, R4 na régua.
   *
   * NENHUMA CREDENCIAL É TOCADA: religar apaga a linha do desligamento e o
   * conector volta ao estado exato de antes, sem nova autorização.
   */
  @Delete(':chave/desligamento')
  @RequirePermissions('admin.usuarios')
  async religar(@CurrentUser() user: JwtUser, @Param('chave') chave: string) {
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['admin.usuarios']);
    const r = await this.conectores.religar(user.orgId, chave, { actorId: user.sub });
    // Mesmo motivo do desligar: o estado mudou, a medição guardada envelheceu na
    // hora — e aqui ela é `nao_verificado`, que é o que a tela mostraria no
    // lugar do verde que volta a ser mensurável.
    this.svc.esquecerSonda(user.orgId, chave);
    return r;
  }

  /**
   * Sincroniza as tarefas reais do ClickUp → módulo Tarefas.
   *
   * CONTINUA DE PÉ depois do contrato, e por dois motivos concretos: a permissão
   * é outra (`tarefas.editar`, de quem opera as tarefas, e não `admin.usuarios`)
   * e este é o botão que a tela já oferece a quem não é administrador. O verbo
   * genérico (`POST :chave/sincronizacao`) faz a mesma coisa pelo contrato, para
   * quem administra.
   */
  @Post('clickup/sync')
  @RequirePermissions('tarefas.editar')
  async syncClickup(@CurrentUser() user: JwtUser) {
    await this.svc.verificarPessoaAtual(user.orgId, user.sub, ['tarefas.editar']);
    return this.clickup.sync(user.orgId, user.sub);
  }
}
