import { BadRequestException, Body, Controller, Get, GoneException, HttpCode, Ip, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { COMERCIAL_CHAVES_DOS_FILTROS_DO_FUNIL, COMERCIAL_ESTADOS_DE_DECISAO, ComercialDecisaoRespostaSchema, type ComercialEstadoDeDecisao, type ComercialFiltrosDoFunil } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { ConfigComercialService } from './config.service';
import { DecisoesService } from './decisoes.service';
import { FichaService } from './ficha.service';
import { LeadRepetidoService } from './lead-repetido.service';
import { MoverService, PEDIDO_DE_MOVER_APOSENTADO, SoGenteGuard } from './mover.service';
import { LeituraEReacaoService } from './leitura-e-reacao.service';
import { ReacoesDaPropostaService } from './reacoes-da-proposta.service';
import { AreaDoClienteService } from './area-do-cliente.service';
import { SalaVersaoService } from './sala-versao.service';
import { RelogioDaEspinha } from './relogio-da-espinha';

/*
 * A ESPINHA DO COCKPIT — rotas internas do módulo comercial (lane A).
 *
 * Permissões: `leads.ver` lê, `leads.editar` escreve; responder decisão pede
 * também `aprovacoes.decidir` (é a fila de quem decide, como `/atendimento`).
 * A etapa NUNCA se escreve por aqui: não há PATCH de etapa. Quem move é a
 * reação a um evento, e o portão recusa com a lista do que falta. A saída é um
 * FATO com motivo (`saida.registrada`), conferido por `podeSair` antes de entrar
 * no fio. A exceção é a PESSOA que move o cartão: desde a rodada da interface
 * (U4, 20/10/2026, decisão do dono do produto) ela move para qualquer etapa,
 * direto, sem pedido nem assinatura de outra pessoa (ver `mover.service.ts`).
 * Conta de máquina e agente seguem fora (`SoGenteGuard` e os portões).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class ComercialController {
  constructor(
    private readonly fichas: FichaService,
    private readonly decisoesSvc: DecisoesService,
    private readonly configSvc: ConfigComercialService,
    private readonly relogio: RelogioDaEspinha,
    private readonly moverSvc: MoverService,
    private readonly reacoesSvc: ReacoesDaPropostaService,
    private readonly salaVersoes: SalaVersaoService,
    private readonly areaDoCliente: AreaDoClienteService,
    private readonly leitura: LeituraEReacaoService,
    private readonly leadRepetido: LeadRepetidoService,
  ) {}

  /** Tela 03: a fila de decisões, o que rodou sozinho hoje e os contadores. */
  @Get('fila')
  @RequirePermissions('leads.ver')
  fila(@CurrentUser() user: JwtUser) {
    return this.decisoesSvc.fila(user.orgId);
  }

  /**
   * Tela 04: o funil vivo, com as saídas visíveis. Filtros do painel (U4):
   * `dono` (id, `eu` ou `sem`), `produto`, `perfil`, `etapa` (ou `saidas`),
   * `parado=1`, `decisao=1` e `q` (empresa ou contato). O `?filtro=` antigo
   * (todos, parados, decisao, P1/P2/P3 ou produto) continua valendo.
   */
  @Get('funil')
  @RequirePermissions('leads.ver')
  funil(@CurrentUser() user: JwtUser, @Query() query: Record<string, unknown>) {
    const lido = (k: string) => (typeof query[k] === 'string' ? (query[k] as string) : '');
    const temPainel = COMERCIAL_CHAVES_DOS_FILTROS_DO_FUNIL.some((k) => lido(k).trim() !== '');
    if (!temPainel) return this.fichas.funil(user.orgId, lido('filtro') || null, undefined, undefined, user.sub);
    const filtros = Object.fromEntries(COMERCIAL_CHAVES_DOS_FILTROS_DO_FUNIL.map((k) => [k, lido(k)])) as unknown as ComercialFiltrosDoFunil;
    return this.fichas.funil(user.orgId, filtros, undefined, undefined, user.sub);
  }

  /** Tela 05: a ficha do lead — projeção do fio, com o portão da próxima etapa. */
  @Get('lead/:id')
  @RequirePermissions('leads.ver')
  ficha(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.fichas.projecao(user.orgId, id);
  }

  /** O fio cru (as linhas) — para a tela 05 e para a suíte. */
  @Get('lead/:id/fio')
  @RequirePermissions('leads.ver')
  async fio(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const f = await this.fichas.projecao(user.orgId, id);
    return { leadId: id, fio: f.fio };
  }

  /**
   * I4: o que o cliente leu na proposta e o que anotou nela (leitura agregada por
   * seção, "faz sentido", dúvidas e ideias com o texto já mascarado). Só lê, na
   * empresa do token: lead de outra empresa é 404.
   */
  @Get('lead/:id/reacoes')
  @RequirePermissions('leads.ver')
  reacoes(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.reacoesSvc.doLead(user.orgId, id);
  }

  /*
   * I3 (rodada da implantação): a sala publicada por versão. A bancada lê o
   * rascunho e o que está no ar, grava o rascunho e pede a publicação, que é
   * `comercial.sala.publicar` (R3) pela porta: outra pessoa libera em
   * /atendimento, lendo a versão inteira pela rota de conteúdo (só quem decide
   * a fila, como a proposta). Pedir é só de gente: conta de máquina é recusada.
   */
  @Get('lead/:id/sala/versoes')
  @RequirePermissions('leads.ver')
  versoesDaSala(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.salaVersoes.versoes(user.orgId, id);
  }

  @Put('lead/:id/sala/rascunho')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  rascunhoDaSala(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.salaVersoes.salvarRascunho(user.orgId, id, body, { id: user.sub });
  }

  @Post('lead/:id/sala/publicar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  publicarSala(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.salaVersoes.publicar(user.orgId, id, { id: user.sub });
  }

  @Get('lead/:id/sala/v/:versao/conteudo')
  @RequirePermissions('aprovacoes.decidir')
  conteudoDaSala(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('versao') versao: string, @Query('hash') hash?: string) {
    const n = Number(versao);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException('versão inválida');
    return this.salaVersoes.conteudoParaLiberar(user.orgId, id, n, typeof hash === 'string' && hash ? hash : null);
  }

  /*
   * A ÁREA DO CLIENTE (leva A, 30/10/2026): a bancada. Os quinze slots com o
   * estado de cada um (vazio, derivado, rascunho, na porta, no ar, lido), e a
   * versão por item: ler o rascunho, gravar, pedir a publicação. Publicar um
   * item é a MESMA capacidade da sala (`comercial.sala.publicar`, R3): outra
   * pessoa libera em /atendimento lendo a versão pela rota de conteúdo acima,
   * que agora diz de que item ela é. Item derivado (o OS monta sozinho) é
   * recusado com o motivo nas duas escritas.
   */
  @Get('lead/:id/area')
  @RequirePermissions('leads.ver')
  areaDoClienteNaBancada(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.areaDoCliente.bancada(user.orgId, id);
  }

  @Get('lead/:id/area/:item/versoes')
  @RequirePermissions('leads.ver')
  versoesDoItemDaArea(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('item') item: string) {
    return this.salaVersoes.versoesDoItem(user.orgId, id, item);
  }

  @Put('lead/:id/area/:item/rascunho')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  rascunhoDoItemDaArea(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('item') item: string, @Body() body: unknown) {
    return this.salaVersoes.salvarRascunhoDoItem(user.orgId, id, item, body, { id: user.sub });
  }

  @Post('lead/:id/area/:item/publicar')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  publicarItemDaArea(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('item') item: string) {
    return this.salaVersoes.publicarItem(user.orgId, id, item, { id: user.sub });
  }

  /*
   * I5 (rodada da implantação): o bloco "Leitura e reação" do relatório. Só
   * contagem do que está gravado. "Virar tarefa" cria a WorkTask com a
   * procedência e o trecho (gente, `tarefas.editar` também); "respondida" só
   * registra que alguém respondeu pelo canal.
   */
  @Get('relatorio/leitura')
  @RequirePermissions('leads.ver')
  relatorioDeLeitura(@CurrentUser() user: JwtUser, @Query('dias') dias?: string) {
    return this.leitura.relatorio(user.orgId, dias);
  }

  @Post('reacoes/:id/tarefa')
  @HttpCode(200)
  @RequirePermissions('leads.editar', 'tarefas.editar')
  @UseGuards(SoGenteGuard)
  ideiaViraTarefa(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const listId = body && typeof body === 'object' && typeof (body as { listId?: unknown }).listId === 'string' ? (body as { listId: string }).listId : null;
    return this.leitura.virarTarefa(user.orgId, id, { id: user.sub, papeis: user.roles ?? [] }, listId);
  }

  @Post('reacoes/:id/respondida')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  ideiaRespondida(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.leitura.marcarRespondida(user.orgId, id);
  }

  /** E1: o lead entra pelo WhatsApp (simulador ou provedor). Idempotente pelo telefone e pela mensagem. */
  @Post('entrada/whats')
  @RequirePermissions('leads.editar')
  async entradaWhats(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    await this.relogio.garantirRotina(user.orgId);
    return this.fichas.entrarPeloWhats(user.orgId, body);
  }

  /** E4: a ata da sessão chega. Só o hash vai para o fio; quem sobe a ata é o sócio da conta. */
  @Post('lead/:id/ata')
  @RequirePermissions('leads.editar')
  ata(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.fichas.registrarAta(user.orgId, id, body, { id: user.sub, nome: user.name });
  }

  /** Layout 26/10: corrigir o nome do contato e/ou a empresa do lead (fato no fio, sem automação). */
  @Post('lead/:id/identidade')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  identidade(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.fichas.editarIdentidade(user.orgId, id, body, { id: user.sub, nome: user.name });
  }

  /** 29/10: o "+ lead" pergunta antes de criar: já há lead com esta empresa, telefone, e-mail ou contato? Só leitura. */
  @Get('leads/parecidos')
  @RequirePermissions('leads.ver')
  parecidos(@CurrentUser() user: JwtUser, @Query() query: Record<string, unknown>) {
    const lido = (k: string) => (typeof query[k] === 'string' ? (query[k] as string) : undefined);
    return this.leadRepetido.parecidos(user.orgId, { empresa: lido('empresa'), contato: lido('contato'), telefone: lido('telefone'), email: lido('email') });
  }

  /** 29/10: venda nova de quem já é cliente: lead novo ligado ao MESMO cadastro do lead `:id` (sem mover, cobrar nem mandar mensagem). */
  @Post('lead/:id/venda-nova')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard, AcessoAtualGuard)
  vendaNova(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.leadRepetido.vendaNova(user.orgId, id, body, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [], permissoes: user.permissions });
  }

  /** Layout 26/10: o tipo do negócio (pagante, parceria, permuta, repasse); fato no fio, sem automação. */
  /** Layout 26/10: valor negociado, vendedor (≠ dono) e canal de aquisição; fato no fio, sem automação. */
  @Post('lead/:id/negocio')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  ajustarNegocio(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.fichas.ajustarNegocio(user.orgId, id, body, { id: user.sub, nome: user.name });
  }

  @Post('lead/:id/tipo')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  tipoDoNegocio(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.fichas.definirTipoDoNegocio(user.orgId, id, body, { id: user.sub, nome: user.name });
  }

  /** Saída com motivo e dono (desqualificado, geladeira, perdido, parceiro). */
  @Post('lead/:id/saida')
  @RequirePermissions('leads.editar')
  saida(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.fichas.registrarSaida(user.orgId, id, body, { id: user.sub, nome: user.name });
  }

  /**
   * APOSENTADO (U4, 20/10/2026) · o pedido de mover. O mover não pede mais
   * assinatura: responde 410 com o caminho novo e não cria nada na fila.
   */
  @Post('lead/:id/mover/pedido')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  pedirMover(): never {
    throw new GoneException(PEDIDO_DE_MOVER_APOSENTADO);
  }

  /**
   * APOSENTADO (U4, 20/10/2026) · o estado do pedido de mover. Não há mais
   * pedido: responde sempre vazio, para a aba antiga parar de esperar.
   */
  @Get('lead/:id/mover/pedido')
  @RequirePermissions('leads.ver')
  estadoDoPedido() {
    return { pedido: null, aposentado: PEDIDO_DE_MOVER_APOSENTADO };
  }

  /**
   * U4 · MOVER, sem limitação: a pessoa com `leads.editar` leva o lead para
   * qualquer etapa (para a frente, para trás, E8 e E9, de e para as saídas).
   * Grava direto: sem pedido, sem assinatura, sem token. Só gente: conta de
   * máquina cai no `SoGenteGuard` e na releitura do banco. Nenhuma escrita do
   * fechamento nasce daqui. Devolve a mensagem da tela.
   */
  @Post('lead/:id/mover')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  mover(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.moverSvc.mover(user.orgId, id, body, { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [] });
  }

  /** A fila de decisões (abertas, tomadas, expiradas). */
  @Get('decisoes')
  @RequirePermissions('leads.ver')
  decisoes(@CurrentUser() user: JwtUser, @Query('estado') estado?: string) {
    if (estado && !(COMERCIAL_ESTADOS_DE_DECISAO as readonly string[]).includes(estado)) {
      throw new BadRequestException(`Estado desconhecido: ${estado}. Use ${COMERCIAL_ESTADOS_DE_DECISAO.join(', ')}.`);
    }
    return this.decisoesSvc.listar(user.orgId, estado as ComercialEstadoDeDecisao | undefined);
  }

  /** Um toque: responde a decisão pela tela. */
  @Post('decisoes/:id/responder')
  @RequirePermissions('leads.editar', 'aprovacoes.decidir')
  responder(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const r = ComercialDecisaoRespostaSchema.safeParse(body);
    if (!r.success) throw new BadRequestException({ message: 'Resposta inválida.', erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return this.decisoesSvc.responder(user.orgId, id, r.data.escolha, { id: user.sub, nome: user.name }, 'tela', r.data.motivo ?? null);
  }

  /** Os interruptores e a régua por empresa (K08). Sem linha gravada, os padrões da regra vigente. */
  @Get('config')
  @RequirePermissions('leads.ver')
  config(@CurrentUser() user: JwtUser) {
    return this.configSvc.ler(user.orgId);
  }

  /**
   * Os interruptores da mesa (K08) e a autonomia são decisão de mesa (A-1): pede
   * `aprovacoes.decidir`, recusa conta de máquina e grava no RASTRO.
   */
  @Put('config')
  @RequirePermissions('aprovacoes.decidir')
  salvarConfig(@CurrentUser() user: JwtUser, @Body() body: unknown, @Ip() ip?: string) {
    return this.configSvc.gravar(user.orgId, body, { id: user.sub, papeis: user.roles ?? [], ip });
  }
}
