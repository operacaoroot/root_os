import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { MODULOS } from '@mktos/shared';
import { z } from 'zod';

import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisionamentoService } from './provisionar.service';
import {
  ProvisionamentoConcorrenteError,
  ProvisionamentoInvalidoError,
  ProvisionamentoSemPlataformaError,
  SLUG_DA_PLATAFORMA,
} from './provisionar';

export { SLUG_DA_PLATAFORMA };

const EntradaSchema = z.object({
  slug: z.string().min(2).max(40),
  nome: z.string().trim().min(1).max(120).optional(),
  /** Lista fechada: módulo inexistente é recusado aqui e de novo na operação. */
  modulos: z.array(z.enum(MODULOS)).optional(),
  admin: z
    .object({ email: z.string().email(), nome: z.string().trim().min(1).max(120).optional() })
    .optional(),
});

/**
 * Criar empresa pela API — RF-T-07, a segunda das duas formas.
 *
 * A outra é `node dist/scripts/provisionar-tenant.js`, para quem já está no
 * servidor. As duas chamam a MESMA operação: caminho duplicado é caminho que um
 * dia diverge, e divergência aqui significa duas empresas nascendo diferentes.
 *
 * ESTA ROTA **NÃO CONFIGURA EMPRESA QUE JÁ EXISTE**
 * Ela roda sempre em `modo: 'criar'` (ver `ModoDeProvisionamento`). Empresa que
 * já existe volta como RETRATO: administrador, módulos e nome informados são
 * ignorados e listados em `ignorado`.
 *
 * O motivo não é elegância, é o controle normativo. Se a rota escrevesse dentro
 * de empresa que já existe, quem tem `admin.permissoes` na plataforma plantaria
 * um administrador em QUALQUER empresa cliente e zeraria os módulos dela em duas
 * chamadas — o administrador plantado entra pelo login com a conta Google, que
 * não passa por lista de permissão quando o usuário já existe. Isso é acesso a
 * dado de tenant pelo operador da plataforma, sem autorização do cliente, sem
 * prazo e sem registro: exatamente o que 05-SEGURANCA-OWASP proíbe e o que
 * RF-B-02 condiciona. E abriria justamente o que a rota de criação de usuário
 * fecha, porque aquela é escopada à empresa de quem chama.
 *
 * POR QUE NÃO UMA BANDEIRA `reconfigurar: true` AQUI
 * Porque ela precisaria de permissão PRÓPRIA, e o catálogo de hoje
 * (`packages/shared/src/permissions.ts`) só sabe falar de permissão dentro de
 * uma empresa — não existe "permissão de plataforma", e `admin.permissoes` do
 * cliente é a mesma chave. Uma bandeira presa a uma permissão que qualquer
 * `admin_master` tem seria trava de mentira. Quando o console da plataforma
 * existir (RF-B-02), com permissão própria, prazo e autorização do cliente, é
 * aqui que a bandeira entra — e o modo `reconfigurar` já está pronto para ela.
 *
 * Enquanto isso, reconfigurar exige operador logado no servidor:
 * `pnpm --filter @mktos/api provisionar <slug> --modulos ... --reconfigurar`.
 *
 * `tenants` é prefixo de ESPINHA (`modulos.ts`), então o gate de módulos não
 * passa por esta rota — o que é o certo: ela fala do sistema, não do negócio.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tenants')
export class ProvisionamentoController {
  constructor(
    private readonly provisionamento: ProvisionamentoService,
    private readonly auditoria: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('provisionar')
  @RequirePermissions('admin.permissoes')
  async provisionar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    await this.exigirPlataforma(user, body);

    let entrada: z.infer<typeof EntradaSchema>;
    try {
      entrada = EntradaSchema.parse(body);
    } catch (e) {
      // Recusa por forma do corpo: nem chega à operação, então a auditoria dela
      // não veria. Sem esta linha, "quantas vezes tentaram provisionar" ficaria
      // menor do que a verdade.
      await this.auditarRecusa(user, body, 'corpo-invalido', (e as Error).message);
      throw e;
    }

    try {
      return await this.provisionamento.provisionar(
        // `modo` é fixado aqui e não vem do corpo: ver o comentário da classe.
        { ...entrada, modo: 'criar' },
        { tipo: 'user', id: user.sub, origem: 'http' },
      );
    } catch (e) {
      if (e instanceof ProvisionamentoInvalidoError) {
        throw e.motivo === 'email-de-outra-empresa'
          ? new ConflictException(e.message)
          : new BadRequestException(e.message);
      }
      if (e instanceof ProvisionamentoConcorrenteError) throw new ConflictException(e.message);
      if (e instanceof ProvisionamentoSemPlataformaError) {
        throw new ServiceUnavailableException(e.message);
      }
      throw e;
    }
  }

  /**
   * Só a empresa da plataforma provisiona empresa.
   *
   * A conferência lê o slug do banco em vez de confiar no token: o JWT carrega
   * `orgId`, não slug, e um token de vida longa emitido antes de qualquer
   * mudança continuaria valendo. Uma consulta por requisição desta rota — que é
   * chamada algumas vezes por ano — não é preço.
   *
   * A RECUSA É AUDITADA. Ela nunca chega à operação, então é aqui ou em lugar
   * nenhum — e "quem tentou e foi recusado" é a pergunta mais importante que uma
   * operação de plataforma precisa saber responder.
   */
  private async exigirPlataforma(user: JwtUser, body: unknown): Promise<void> {
    const org = await this.prisma.org.findUnique({
      where: { id: user.orgId },
      select: { slug: true },
    });
    if (org?.slug !== SLUG_DA_PLATAFORMA) {
      await this.auditarRecusa(
        user,
        body,
        'nao-e-a-plataforma',
        `a empresa "${org?.slug ?? user.orgId}" não é a plataforma.`,
      );
      throw new ForbiddenException(
        'provisionar empresa é operação da plataforma, não de um cliente.',
      );
    }
  }

  /**
   * A linha de auditoria da recusa, na empresa de QUEM TENTOU.
   *
   * Não é a empresa alvo de propósito: o alvo pode nem existir, e a tentativa é
   * fato da empresa de onde ela partiu. `slug` sai do corpo cru porque uma
   * recusa por forma do corpo não tem entrada validada — e o que se quer saber é
   * o que a pessoa digitou.
   */
  private async auditarRecusa(
    user: JwtUser,
    body: unknown,
    motivo: string,
    mensagem: string,
  ): Promise<void> {
    const slug = (body as { slug?: unknown } | null)?.slug;
    await this.auditoria
      .log({
        orgId: user.orgId,
        actorType: 'user',
        actorId: user.sub,
        action: 'tenant.provisionar.recusado',
        entityType: 'org',
        metadata: {
          slug: typeof slug === 'string' ? slug.slice(0, 80) : null,
          motivo,
          mensagem,
          origem: 'http',
        },
      })
      .catch(() => undefined);
  }
}
