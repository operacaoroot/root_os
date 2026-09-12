import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SendEmailSchema, CreateEventSchema, CreateDocSchema, AppendDocSchema } from '@mktos/shared';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * ============================================================================
 * AS AÇÕES DO GOOGLE, TODAS PELA PORTA — RF-G-01, RF-A-01 (fatia 3.3)
 * ============================================================================
 *
 * O QUE ESTE ARQUIVO ERA. Ele injetava o `GoogleService` e chamava os métodos
 * dele direto. Quatro dessas rotas — `POST gmail/send`, `POST calendar/event`,
 * `POST docs` e `POST docs/:id/append` — são ESCRITA EXTERNA: mandam e-mail em
 * nome da empresa, criam evento que dispara convite para gente de fora, criam e
 * alteram documento. Estavam vivas em produção protegidas só por JWT mais uma
 * permissão de papel. Sem classificação de risco, sem retenção por aprovação,
 * sem RASTRO, e — o que é pior num incidente — fora do alcance do interruptor
 * de conector: desligar o Google na tela de Conexões não parava nenhuma delas.
 *
 * O QUE ELE É AGORA. Um TRADUTOR. Ele valida o corpo da requisição com o schema
 * que a tela já usa, traduz para os argumentos que o catálogo declara (em
 * português) e entrega à porta. Não conhece mais o conector — nem por import,
 * nem por injeção. Quem chama o Google é o efeito registrado pelo próprio
 * `GoogleService`.
 *
 * ----------------------------------------------------------------------------
 * O QUE MUDA PARA QUEM USA A TELA
 * ----------------------------------------------------------------------------
 * As LEITURAS continuam respondendo na hora: são R0, a porta classifica,
 * registra e deixa passar. O que elas ganham é o que não tinham — ficam no
 * RASTRO, e param quando alguém desliga o Google.
 *
 * As ESCRITAS são R3 no catálogo, e R3 não sai sem uma pessoa confirmar. A rota
 * responde 200 com `{status:'aguardando_aprovacao', approvalId, ...}` em vez do
 * resultado do envio: a ação foi ACEITA e está na fila, e quem a executa é
 * `POST /approvals/:id/confirm`. Isso é mudança de contrato para a tela, e está
 * dita por escrito no relatório da fatia.
 *
 * `x-approval-token` continua aceito no cabeçalho para quem já traz uma
 * aprovação confirmada na mão — é o mesmo cabeçalho da superfície antiga, e a
 * porta o consome com as mesmas travas (uso único, casado com o hash do
 * conteúdo).
 *
 * ----------------------------------------------------------------------------
 * AS PERMISSÕES DE PAPEL FICAM
 * ----------------------------------------------------------------------------
 * A porta decide o RISCO da ação; o guard decide QUEM pode sequer propô-la. São
 * perguntas diferentes e as duas valem: sem o guard, qualquer usuário autenticado
 * poderia encher a fila de aprovação com propostas de envio de e-mail.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('google')
export class GoogleController {
  constructor(private readonly porta: PortaDoOperador) {}

  // ---------- Leitura (R0) ----------

  @Get('calendar')
  @RequirePermissions('dashboard.ver')
  calendar(@CurrentUser() user: JwtUser, @Query('max') max?: string) {
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'comunicacao.agenda.listar',
      args: { limite: max ? Number(max) : 10 },
    });
  }

  @Get('gmail')
  @RequirePermissions('gmail.ver')
  gmail(@CurrentUser() user: JwtUser, @Query('q') q?: string, @Query('max') max?: string) {
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'comunicacao.email.buscar',
      args: { q: q ?? '', limite: max ? Number(max) : 10 },
    });
  }

  @Get('gmail/:id')
  @RequirePermissions('gmail.ver')
  gmailOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'comunicacao.email.ler',
      args: { id },
      resource: { type: 'gmail', id },
    });
  }

  @Get('drive')
  @RequirePermissions('drive.ver')
  drive(@CurrentUser() user: JwtUser, @Query('q') q?: string, @Query('max') max?: string) {
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'contexto.arquivo.listar',
      args: { q: q ?? '', limite: max ? Number(max) : 15 },
    });
  }

  @Get('docs/:id')
  @RequirePermissions('drive.ver')
  doc(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'contexto.documento.ler',
      args: { id },
      resource: { type: 'gdocs', id },
    });
  }

  // ---------- Escrita (R3: retida até uma pessoa confirmar) ----------

  @Post('gmail/send')
  @RequirePermissions('gmail.responder')
  gmailSend(
    @CurrentUser() user: JwtUser,
    @Body() body: unknown,
    @Headers('x-approval-token') token?: string,
  ) {
    const input = SendEmailSchema.parse(body);
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'email.enviar',
      args: {
        para: input.to,
        assunto: input.subject,
        corpo: input.body,
        ...(input.cc ? { cc: input.cc } : {}),
      },
      // O RECURSO é o destinatário: é ele que a aprovação nomeia na fila, e é a
      // pergunta que quem confirma faz primeiro ("para quem isto vai?").
      resource: { type: 'email.enviar', id: input.to },
      approvalToken: token,
    });
  }

  @Post('calendar/event')
  @RequirePermissions('agenda.editar')
  createEvent(
    @CurrentUser() user: JwtUser,
    @Body() body: unknown,
    @Headers('x-approval-token') token?: string,
  ) {
    const input = CreateEventSchema.parse(body);
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'agenda.evento.criar',
      args: {
        titulo: input.title,
        inicio: input.start,
        fim: input.end,
        ...(input.description ? { descricao: input.description } : {}),
        ...(input.location ? { local: input.location } : {}),
        ...(input.attendees?.length ? { convidados: input.attendees } : {}),
      },
      resource: { type: 'agenda.evento.criar', id: input.title },
      approvalToken: token,
    });
  }

  @Post('docs')
  @RequirePermissions('drive.editar')
  createDoc(
    @CurrentUser() user: JwtUser,
    @Body() body: unknown,
    @Headers('x-approval-token') token?: string,
  ) {
    const input = CreateDocSchema.parse(body);
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'documento.criar',
      args: { titulo: input.title, ...(input.content ? { conteudo: input.content } : {}) },
      resource: { type: 'documento.criar', id: input.title },
      approvalToken: token,
    });
  }

  @Post('docs/:id/append')
  @RequirePermissions('drive.editar')
  appendDoc(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-approval-token') token?: string,
  ) {
    const input = AppendDocSchema.parse(body);
    return this.porta.executar({
      orgId: user.orgId,
      actorId: user.sub,
      capabilityId: 'documento.anexar',
      /*
       * O ID DO DOCUMENTO VAI NOS ARGUMENTOS, e não só na URL. É ele que entra
       * no hash que a aprovação assina e é dele que a execução pós-aprovação
       * precisa: quando a pessoa confirmar, a requisição original já não existe
       * — o que sobrou são os argumentos gravados.
       */
      args: { documentoId: id, texto: input.text },
      resource: { type: 'documento.anexar', id },
      approvalToken: token,
    });
  }
}
