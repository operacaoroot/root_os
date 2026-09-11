import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApprovalState } from '@prisma/client';
import { z } from 'zod';
import { ApprovalsService } from './approvals.service';
import { AcoesService } from '../gateway/acoes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { enderecoDeOrigem } from '../auth/endereco-de-origem';
import { corpoDaRecusa } from '../integrations/conectores';

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
   *
   * SÃO TRÊS PASSOS, E A ORDEM É O DESENHO (RF-G-06, 11/09/2026):
   *
   *   1. o conector desta aprovação ainda está ligado?
   *   2. confirmar (a aprovação vira `confirmada`, o token nasce);
   *   3. executar.
   *
   * O passo 1 vem ANTES do 2 porque `confirm` é IRREVERSÍVEL para a fila: uma
   * vez `confirmada`, a aprovação sai de `listar` (que devolve as pendentes) e
   * `confirm` passa a recusá-la ("Aprovação já confirmada"). Perguntar depois de
   * confirmar deixava a ação num limbo do qual nenhuma superfície a tirava — e
   * desmentia a frase que o próprio operador lê na recusa, que promete que
   * religar restabelece o uso sem nova autorização.
   *
   * Perguntando antes, a recusa é um 403 e NADA muda: a aprovação continua
   * pendente, continua na fila, e este mesmo botão volta a funcionar assim que
   * alguém religar o conector em Conexões.
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

    /*
     * PASSO 1 — o interruptor, antes de mexer no estado da aprovação.
     *
     * `ForbiddenException` e não uma exceção de `integrations/`: o controlador
     * de aprovações não importa o módulo de integrações, pelo mesmo motivo que a
     * porta não importa (ver `gateway/interruptores.registry.ts`) — o import
     * aqui é do arquivo PURO de conectores, que não traz módulo nenhum junto. A
     * frase e o corpo vêm prontos de `montarRecusa`/`corpoDaRecusa`.
     *
     * O corpo leva o código `conector_desligado` em `error`, e é por ele que a
     * tela distingue esta recusa das outras para oferecer o caminho de conserto
     * (Conexões) em vez de mais uma caixa vermelha. `message` continua a frase
     * em português, então o `Error.message` não muda para quem já o conferia.
     */
    const desligado = await this.acoes.conectorDesligado(user.orgId, id, user.sub);
    if (desligado) throw new ForbiddenException(corpoDaRecusa(desligado));

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
