import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AssinaturaService, type RetratoDaAssinatura } from './assinatura.service';
import { SuspensaoInterceptor } from './suspensao.interceptor';

/*
 * ============================================================================
 * A TELA DA ASSINATURA — RF-O-03
 * ============================================================================
 *
 * `assinatura` é prefixo de ESPINHA DO OS (declarado em `tenants/modulos.ts`), e
 * a decisão tem duas metades:
 *
 *  · NÃO É MÓDULO DE NEGÓCIO. Módulo é escopo de produto que a empresa contrata
 *    — bio, pauta, financeiro. A assinatura é o contrato que sustenta TODOS eles;
 *    um módulo "cobrança" que a empresa pudesse não contratar seria um contrato
 *    opcional sobre o próprio contrato.
 *  · E SE FOSSE MÓDULO, A FATIA NÃO FUNCIONARIA. O gate de módulos responde 404
 *    para módulo não contratado. Uma empresa nova, que nasce com `modulos = []`,
 *    não alcançaria a própria tela de assinatura — e uma empresa suspensa não
 *    teria como ver por que está fora nem avisar que pagou. O bloqueio ficaria
 *    correto e o cliente, sem saída.
 *
 * Por isso `assinatura` entra em `PREFIXOS_DA_ESPINHA` e também em
 * `LIBERADOS_NA_SUSPENSAO` — as duas listas, porque são duas perguntas
 * diferentes ("desliga por contrato?" e "responde para quem está suspenso?") e
 * responder uma não responde a outra.
 *
 * ----------------------------------------------------------------------------
 * AS PERMISSÕES, E POR QUE NENHUMA É NOVA
 * ----------------------------------------------------------------------------
 * `GET /assinatura` não exige permissão, pelo mesmo motivo de `GET
 * /tenants/modulos`: todo usuário autenticado precisa desta resposta para que a
 * tela monte, e exigir permissão deixaria quem tem pouco acesso olhando para uma
 * casca quebrada sem saber que a empresa está suspensa. A resposta não revela
 * nada além do contrato da própria empresa de quem pergunta.
 *
 * TODO O RESTO exige `admin.usuarios` — a permissão de quem administra a conta.
 * Inclusive `POST /assinatura/conferir`, que na primeira escrita não exigia nada
 * e por isso deixava qualquer usuário desfazer a reativação do administrador
 * (ver a nota no método). Não foi criada permissão nova (`assinatura.administrar`)
 * de propósito: permissão nova exige o ritual de três passos (catálogo, semente,
 * todo mundo sai e entra de novo), e o comando de sincronizar REVOGA vínculo
 * feito à mão. Uma fatia que precise de um novo login de toda a carteira para
 * funcionar não está pronta. Fica em PERGUNTAS do relatório.
 */

const DefinirSchema = z.object({
  plano: z.string().trim().min(1).max(80),
  valorCentavos: z.number().int().min(0).max(100_000_000),
  ciclo: z.enum(['mensal', 'anual']).optional(),
  diasDeCarencia: z.number().int().min(0).max(365).optional(),
  provedorClienteId: z.string().trim().min(1).max(120).nullable().optional(),
  provedorAssinaturaId: z.string().trim().min(1).max(120).nullable().optional(),
});

/**
 * A chave do provedor. `min(10)` porque chave de gateway é longa: um valor de
 * três caracteres é engano de digitação, e guardá-lo criaria uma credencial viva
 * e inútil que só falharia na próxima conferência.
 *
 * O schema NÃO usa `.describe()` nem mensagem que ecoe o valor: a mensagem de
 * erro de validação vai para o log e para a tela, e uma que repita o que veio
 * seria a forma mais boba de vazar a chave.
 */
const CredencialSchema = z.object({ chave: z.string().min(10).max(500) });

const MotivoSchema = z.object({ motivo: z.string().trim().min(1).max(300) });

@UseGuards(JwtAuthGuard)
@Controller('assinatura')
export class AssinaturaController {
  constructor(
    private readonly assinaturas: AssinaturaService,
    private readonly gate: SuspensaoInterceptor,
  ) {}

  /** O contrato desta empresa e as últimas cobranças. Sem credencial nenhuma. */
  @Get()
  async minha(@CurrentUser() user: JwtUser): Promise<RetratoDaAssinatura> {
    return this.assinaturas.retrato(this.empresa(user));
  }

  /**
   * "Já paguei, confere aí."
   *
   * ----------------------------------------------------------------------------
   * ELA EXIGE PERMISSÃO, E A PRIMEIRA ESCRITA NÃO EXIGIA NADA
   * ----------------------------------------------------------------------------
   * O argumento de antes era: "ela não decide por conta própria, só pergunta ao
   * provedor e aplica o que ele responder". O argumento estava errado por
   * omissão. Aplicar o que o provedor responde É DECIDIR quando o provedor
   * discorda de uma pessoa — e ele discorda exatamente nos casos em que
   * `reativar` existe (pagamento por fora, acordo comercial, suspensão
   * indevida). Sem permissão, QUALQUER usuário autenticado desfazia, com um
   * clique no botão que a própria tela de suspensão oferece, a reativação que um
   * administrador acabou de fazer.
   *
   * São duas travas, e as duas precisam existir:
   *
   *  1. `perdoadasAte` (em `assinatura.service.ts`) faz a reativação explícita
   *     sobreviver à conferência. Sem ela, nenhuma permissão resolve — bastaria
   *     o tique de qualquer outro caminho reconferir;
   *  2. esta permissão faz a chamada externa com a credencial do cliente ser
   *     coisa de quem administra a conta, e não de quem tem sessão.
   *
   * `admin.usuarios`, a MESMA das outras rotas de escrita daqui, e nenhuma
   * permissão nova: chave nova exige o ritual de três passos (catálogo, semente,
   * todo mundo sai e entra de novo) e o comando de sincronizar REVOGA vínculo
   * feito à mão. Fica em PERGUNTAS do relatório se a conferência devia ter chave
   * própria (`assinatura.conferir`) para que um financeiro sem `admin.usuarios`
   * alcance o botão.
   *
   * O TETO mora no serviço (`exigirTeto`), e não aqui: ele protege o provedor e
   * o cofre, que são coisas do serviço, e vale também para quem chamar a
   * conferência por outro caminho que não esta rota.
   *
   * E ela esquece o cache do gate DEPOIS, para que a próxima requisição da tela
   * já veja o estado novo. Sem esta linha, quem paga e clica continua vendo a
   * tela de bloqueio por mais dez segundos e conclui que não funcionou.
   */
  @Post('conferir')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('admin.usuarios')
  async conferir(@CurrentUser() user: JwtUser) {
    const orgId = this.empresa(user);
    const r = await this.assinaturas.conferir(orgId);
    this.gate.esquecer(orgId);
    return r;
  }

  @Put()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('admin.usuarios')
  async definir(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<RetratoDaAssinatura> {
    const entrada = DefinirSchema.parse(body);
    return this.assinaturas.definir(this.empresa(user), entrada);
  }

  /**
   * Guarda a chave do provedor no cofre.
   *
   * A RESPOSTA NÃO DEVOLVE A CHAVE, nem parte dela, nem os quatro últimos
   * caracteres. "Só o sufixo" é o padrão que parece inofensivo e reduz o espaço
   * de busca de quem já tem metade — e a tela não precisa dele: ela precisa
   * saber se HÁ credencial, e isso é `credencialGuardada` no retrato.
   */
  @Put('credencial')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('admin.usuarios')
  async credencial(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const { chave } = CredencialSchema.parse(body);
    const { versao } = await this.assinaturas.guardarCredencial(this.empresa(user), chave, user.sub);
    return { guardada: true, versao };
  }

  @Post('reativar')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('admin.usuarios')
  async reativar(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<RetratoDaAssinatura> {
    const { motivo } = MotivoSchema.parse(body);
    const orgId = this.empresa(user);
    const r = await this.assinaturas.reativar(orgId, motivo, user.sub);
    this.gate.esquecer(orgId);
    return r;
  }

  @Post('suspender')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('admin.usuarios')
  async suspender(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<RetratoDaAssinatura> {
    const { motivo } = MotivoSchema.parse(body);
    const orgId = this.empresa(user);
    const r = await this.assinaturas.suspender(orgId, motivo, user.sub);
    this.gate.esquecer(orgId);
    return r;
  }

  /**
   * Token autenticado e sem empresa recebe 401, não 500.
   *
   * Mesma razão de `ModulosController.meus`: `assinatura` é espinha, então o gate
   * de módulos não recusa por aqui, e sem esta linha o serviço LANÇA
   * `SemTenantError` — que não é exceção HTTP e vira 500 com o interno no corpo.
   * O token de propósito do login com Google (`{purpose:'google-login'}`, sem
   * `orgId`) é exatamente quem chega assim.
   */
  private empresa(user: JwtUser | undefined): string {
    if (typeof user?.orgId !== 'string' || user.orgId.trim() === '') {
      throw new UnauthorizedException('Sessão sem empresa');
    }
    return user.orgId;
  }
}
