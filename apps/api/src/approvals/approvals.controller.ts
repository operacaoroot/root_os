import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApprovalState } from '@prisma/client';
import { z } from 'zod';
import { ApprovalsService } from './approvals.service';
import { AcoesService } from '../gateway/acoes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { enderecoDeOrigem } from '../auth/endereco-de-origem';

const CreateApprovalSchema = z.object({
  resourceType: z.enum(['lead', 'task', 'campaign', 'content']),
  resourceId: z.string().min(1),
  changes: z.record(z.unknown()),
  summary: z.string().optional(),
});

/*
 * O CORPO DA CONFIRMAÇÃO — como quem decide prova que é ele, e por que decidiu.
 *
 * Nada do que a ação FAZ entra aqui: os argumentos executados são os gravados na
 * passagem pela porta. O que quem confirma manda é (1) como ele prova que é ele
 * — a senha, ou a prova curta obtida em `POST /auth/reautenticar` — e (2) o
 * MOTIVO, que R4 e R5 exigem por escrito (RF-A-03) e que até 11/09/2026 este
 * schema RECUSAVA: `.strict()` sem o campo transformava "mandar o motivo" em
 * erro 400, e a coluna `Approval.motivo` nunca saía de `null`.
 *
 * `.strict()` continua: campo desconhecido no corpo de uma confirmação R4 é
 * tentativa de mexer no que não é dela, e devolver 400 diz isso alto.
 */
const ConfirmarSchema = z
  .object({
    reauth: z
      .union([
        z.object({ senha: z.string().min(1) }).strict(),
        z.object({ token: z.string().min(1) }).strict(),
      ])
      .optional(),
    /*
     * O tamanho mínimo NÃO é conferido aqui, e é de propósito: quem sabe se este
     * nível exige motivo é a aprovação gravada, não o formato do corpo. Um `min`
     * no schema recusaria com 400 um R3 que mandou duas palavras, e deixaria a
     * regra de verdade (`MINIMO_DO_MOTIVO`, do pacote de política) escondida em
     * dois lugares.
     */
    motivo: z.string().max(2000).optional(),
  })
  .strict();

// Fluxo de aprovação de ação sensível (proposta → confirmação humana → escrita).
// A escrita real (PATCH /leads etc.) exige o token emitido aqui (ver ApprovalGuard).
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly acoes: AcoesService,
  ) {}

  /*
   * A FILA. Existia proposta, confirmação e consulta por id, mas não existia
   * "o que está esperando" — e sem isso a fila não é superfície de trabalho,
   * é uma caixa que só quem já sabe o id consegue abrir.
   */
  @Get()
  @RequirePermissions('mcp.executar')
  listar(@CurrentUser() user: JwtUser, @Query('status') status?: string) {
    const valido = status && (Object.values(ApprovalState) as string[]).includes(status);
    return this.approvals.listar(
      user.orgId,
      valido ? (status as ApprovalState) : ApprovalState.pendente,
    );
  }

  @Post()
  @RequirePermissions('mcp.executar')
  create(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = CreateApprovalSchema.parse(body);
    return this.approvals.create({ orgId: user.orgId, actorId: user.sub, ...input });
  }

  /*
   * Confirmar EXECUTA. Sem isto a fila era um museu: a ação ficava retida,
   * alguém confirmava, e nada saía.
   *
   * A execução usa os argumentos gravados na passagem pela porta, nunca os que
   * chegam nesta requisição — é o que impede trocar o texto entre a aprovação
   * e o envio.
   */
  @Post(':id/confirm')
  @RequirePermissions('mcp.executar')
  async confirm(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    /*
     * Corpo VAZIO continua válido: R2 e R3 não pedem reautenticação nem motivo,
     * e obrigar um `{}` na requisição quebraria a tela por nada. Quem decide o
     * que é obrigatório é a aprovação gravada (`exigeReauth`, `nivelExigido`),
     * nunca o formato do corpo.
     */
    const { reauth, motivo } = ConfirmarSchema.parse(body ?? {});
    const confirmada = await this.approvals.confirm(
      user.orgId,
      id,
      {
        id: user.sub,
        /*
         * Os papéis do token entram SÓ para a trava de "é gente": um token de
         * conta de serviço não decide nada, mesmo que o banco diga outra coisa.
         * A ALÇADA é decidida pelos papéis do banco, relidos dentro de
         * `confirm` — token de oito horas não sustenta autoridade.
         */
        papeis: user.roles ?? [],
        reauth,
        ip: enderecoDeOrigem(req),
      },
      motivo,
    );
    const execucao = await this.acoes.executarAprovada(user.orgId, id, user.sub);
    return { ...confirmada, execucao };
  }

  @Post(':id/reject')
  @RequirePermissions('mcp.executar')
  reject(@CurrentUser() user: JwtUser, @Param('id') id: string, @Req() req: any) {
    return this.approvals.reject(user.orgId, id, {
      id: user.sub,
      papeis: user.roles ?? [],
      ip: enderecoDeOrigem(req),
    });
  }

  @Get(':id')
  @RequirePermissions('mcp.executar')
  get(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.approvals.get(user.orgId, id);
  }
}
