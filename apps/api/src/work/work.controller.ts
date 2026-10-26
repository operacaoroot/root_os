import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { SoGenteNoTrabalhoGuard } from './so-gente-no-trabalho.guard';
import { ContextoTrabalhoService } from '../memory/contexto-trabalho.service';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  TrabEspacoCreateSchema, TrabEspacoUpdateSchema,
  TrabPastaCreateSchema, TrabPastaUpdateSchema, TrabListaCreateSchema, TrabListaUpdateSchema,
  TrabStatusCreateSchema, TrabStatusUpdateSchema, TrabCampoCreateSchema, TrabCampoUpdateSchema,
  TrabOpcaoCreateSchema, TrabOpcaoUpdateSchema, TrabTagCreateSchema, TrabTagUpdateSchema,
  TrabTarefaCreateSchema, TrabTarefaUpdateHttpSchema, TrabTarefaArchiveHttpSchema, TrabComentarioSchema,
  TrabAssumirSchema, TrabSoltarSchema, TrabApontamentoCreateSchema, TrabListaDoModeloSchema,
  TrabTarefasOrdemSchema, TrabListaExcluirSchema, TrabListaArquivarTarefasSchema,
  TrabPastaExcluirComDestinoSchema, TrabListaMoverTarefasSchema, TrabArvoreOrdemSchema, TrabPastaMoverSchema,
} from '@mktos/shared';
import { WorkService } from './work.service';
import { CheckoutDeTarefaService } from './checkout-de-tarefa.service';
import { MovimentoDoQuadroService } from './movimento-do-quadro.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { parseWorkTaskQuery } from './work-task-query';

/**
 * Layout 26/10: ligar ou desligar o lead da tarefa pelo Trabalho pede também ver os leads
 * (`leads.ver`), a mesma régua da busca de lead (`/trabalho/atas/alvos?tipo=lead`).
 */
function exigirVerLeads(u: JwtUser, mexeNoLead: boolean): void {
  if (!mexeNoLead) return;
  if (!(u.permissions ?? []).includes('leads.ver')) throw new ForbiddenException('Ligar a tarefa a um lead pede a permissão de ver os leads (leads.ver).');
}

// Módulo TRABALHO (ClickUp-like). Escritas são INTERNAS ao mkt-os (sem efeito
// externo), então ficam fora do fluxo de approvals — o gate é o RBAC
// (tarefas.editar), como num board de verdade. Tudo auditado no AuditService.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho')
export class WorkController {
  constructor(
    private readonly svc: WorkService,
    private readonly fontesContexto: ContextoTrabalhoService,
    private readonly checkout: CheckoutDeTarefaService,
    private readonly movimento: MovimentoDoQuadroService,
  ) {}

  /*
   * OS CLIENTES DO SELETOR (rodada do trabalho T4): toda tarefa nova é ligada a um
   * cliente. Lê o cadastro que o fechamento comercial escreve (`Partner` cliente)
   * mais o cliente da casa. Só nome e CNPJ: o resto do cadastro é do Financeiro.
   */
  @Get('clientes')
  @RequirePermissions('tarefas.ver')
  clientes(@CurrentUser() u: JwtUser, @Query('q') q?: string) {
    if (q !== undefined && (typeof q !== 'string' || q.length > 120)) throw new BadRequestException('q deve ser texto de até 120 caracteres');
    return this.svc.clientes(u.orgId, q);
  }

  /*
   * AS PESSOAS DA EMPRESA (rodada do trabalho T5): o seletor de responsável do
   * aceite da ata lista os perfis reais (gente ativa, sem conta de máquina), em
   * vez do texto livre que não atribuía a ninguém.
   */
  @Get('pessoas')
  @RequirePermissions('tarefas.ver')
  pessoas(@CurrentUser() u: JwtUser) {
    return this.svc.pessoas(u.orgId);
  }

  // ---- estrutura ----
  @Get('estrutura')
  @RequirePermissions('tarefas.ver')
  estrutura(@CurrentUser() u: JwtUser) {
    return this.svc.estrutura(u.orgId);
  }

  /*
   * A estrutura sugerida (rodada do painel P2, 18/10/2026): cria SÓ o que falta
   * de Gestão (Administrativo, Financeiro, Pessoas) e Clientes (com a esteira, o
   * onboarding e a execução); desde 21/10/2026 move a lista solta de mesmo nome. `tarefas.editar`, como criar pasta e lista à mão: é a mesma
   * escrita, em lote. Repetir a chamada não duplica nada.
   */
  @Post('estrutura/sugerida')
  @RequirePermissions('tarefas.editar')
  criarEstruturaSugerida(@CurrentUser() u: JwtUser) {
    return this.svc.criarEstruturaSugerida(u.orgId, u.sub);
  }

  /*
   * O quadro denso (rodada da implantação I2): a última movimentação, os três
   * últimos passos, o último comentário, a próxima ação e o selo de procedência
   * de cada cartão da lista. Só leitura, da mesma auditoria que a caixa lê.
   */
  @Get('quadro/movimento')
  @RequirePermissions('tarefas.ver')
  movimentoDoQuadro(@CurrentUser() u: JwtUser, @Query('listId') listId: string) {
    if (!listId || !/^[0-9a-f-]{36}$/i.test(listId)) throw new BadRequestException('listId inválido');
    return this.movimento.daLista(u.orgId, listId);
  }

  // ---- espaços ----
  @Post('espacos')
  @RequirePermissions('tarefas.editar')
  criarEspaco(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarEspaco(u.orgId, u.sub, TrabEspacoCreateSchema.parse(body));
  }

  @Patch('espacos/:id')
  @RequirePermissions('tarefas.editar')
  editarEspaco(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarEspaco(u.orgId, u.sub, id, TrabEspacoUpdateSchema.parse(body));
  }

  @Delete('espacos/:id')
  @RequirePermissions('tarefas.editar')
  apagarEspaco(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarEspaco(u.orgId, u.sub, id);
  }

  // ---- pastas ----
  @Post('pastas')
  @RequirePermissions('tarefas.editar')
  criarPasta(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarPasta(u.orgId, u.sub, TrabPastaCreateSchema.parse(body));
  }

  @Patch('pastas/:id')
  @RequirePermissions('tarefas.editar')
  editarPasta(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarPasta(u.orgId, u.sub, id, TrabPastaUpdateSchema.parse(body));
  }

  /*
   * Excluir pasta pela tela (P3, 21/10/2026): só a que não tem lista nem pasta
   * visível dentro. Vazia de verdade é apagada; a que só guarda o que já foi
   * arquivado é arquivada (os dados ficam). Ver `WorkService.apagarPasta`.
   */
  @Delete('pastas/:id')
  @UseGuards(AcessoAtualGuard, SoGenteNoTrabalhoGuard)
  @RequirePermissions('tarefas.editar')
  apagarPasta(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarPasta(u.orgId, u.sub, id);
  }

  /*
   * Apagar pasta levando o que está dentro (A3, 21/10/2026): `{destino, esperadas}`.
   * As listas e as pastas que aparecem dentro vão para outra pasta (`{folderId}`) ou
   * para Sem pasta (`{semPasta: true}`) e a pasta sai, numa transação sob o cadeado
   * da árvore. Só de gente. Ver `WorkService.excluirPastaComDestino`.
   */
  @Post('pastas/:id/excluir')
  @UseGuards(AcessoAtualGuard, SoGenteNoTrabalhoGuard)
  @RequirePermissions('tarefas.editar')
  excluirPastaComDestino(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.excluirPastaComDestino(u.orgId, u.sub, id, TrabPastaExcluirComDestinoSchema.parse(body ?? {}));
  }

  /*
   * Mover pasta para dentro de outra (`{parentId}`) ou para o primeiro nível
   * (`{parentId: null}`): arrastar sobre a pasta, ou "⋯" › Mover para… (M3,
   * 22/10/2026). Só de gente; ciclo, nível, protegida e nome repetido conferidos
   * no serviço. Ver `WorkService.moverPasta`.
   */
  @Post('pastas/:id/mover')
  @UseGuards(AcessoAtualGuard, SoGenteNoTrabalhoGuard)
  @RequirePermissions('tarefas.editar')
  moverPasta(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.moverPasta(u.orgId, u.sub, id, TrabPastaMoverSchema.parse(body));
  }

  /*
   * AS ARQUIVADAS E DESARQUIVAR (M3, 22/10/2026). A lista lê com `tarefas.ver`;
   * desarquivar tem a permissão e os guardas de apagar (só de gente). A lista volta
   * para a pasta onde estava (ou Sem pasta, se ela continua arquivada); a pasta
   * volta com o que foi arquivado junto. Ver `WorkService.desarquivarLista/Pasta`.
   */
  @Get('arquivadas')
  @RequirePermissions('tarefas.ver')
  arquivadas(@CurrentUser() u: JwtUser) {
    return this.svc.arquivadas(u.orgId);
  }

  @Post('pastas/:id/desarquivar')
  @UseGuards(AcessoAtualGuard, SoGenteNoTrabalhoGuard)
  @RequirePermissions('tarefas.editar')
  desarquivarPasta(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.desarquivarPasta(u.orgId, u.sub, id);
  }

  @Post('listas/:id/desarquivar')
  @UseGuards(AcessoAtualGuard, SoGenteNoTrabalhoGuard)
  @RequirePermissions('tarefas.editar')
  desarquivarLista(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.desarquivarLista(u.orgId, u.sub, id);
  }

  /*
   * A ordem de um nível da árvore (A3): `{tipo: 'pasta'|'lista', paiId, ids}` com os
   * irmãos daquele nível na ordem nova. Arrastar e Alt+↑/↓ na árvore.
   */
  @Post('arvore/ordem')
  @RequirePermissions('tarefas.editar')
  ordenarArvore(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.ordenarArvore(u.orgId, u.sub, TrabArvoreOrdemSchema.parse(body));
  }

  // ---- listas ----
  @Post('listas')
  @RequirePermissions('tarefas.editar')
  criarLista(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarLista(u.orgId, u.sub, TrabListaCreateSchema.parse(body));
  }

  @Patch('listas/:id')
  @RequirePermissions('tarefas.editar')
  editarLista(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarLista(u.orgId, u.sub, id, TrabListaUpdateSchema.parse(body));
  }

  /*
   * Excluir lista pela tela (P3, 21/10/2026): o corpo traz `{confirmarNome}`, o
   * nome escrito pela pessoa. Só sai a lista vazia (apagada) ou com todas as
   * tarefas arquivadas (a lista é arquivada, as tarefas ficam). Auditada com a
   * contagem. Ver `WorkService.apagarLista`.
   */
  @Delete('listas/:id')
  @UseGuards(AcessoAtualGuard, SoGenteNoTrabalhoGuard)
  @RequirePermissions('tarefas.editar')
  apagarLista(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.apagarLista(u.orgId, u.sub, id, TrabListaExcluirSchema.parse(body ?? {}));
  }

  /** Arquivar todas as tarefas da lista, o passo antes de excluir (P3). `{esperadas}` = quantas a tela mostrou. */
  @Post('listas/:id/arquivar-tarefas')
  @UseGuards(AcessoAtualGuard, SoGenteNoTrabalhoGuard)
  @RequirePermissions('tarefas.editar')
  arquivarTarefasDaLista(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.arquivarTarefasDaLista(u.orgId, u.sub, id, TrabListaArquivarTarefasSchema.parse(body));
  }

  /**
   * Mover as tarefas ativas para outra lista, o passo antes de excluir (A3).
   * `{destinoId, esperadas}`; mesmos ids, etapa pelo nome no destino. Só de gente.
   */
  @Post('listas/:id/mover-tarefas')
  @UseGuards(AcessoAtualGuard, SoGenteNoTrabalhoGuard)
  @RequirePermissions('tarefas.editar')
  moverTarefasDaLista(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.moverTarefasDaLista(u.orgId, u.sub, id, TrabListaMoverTarefasSchema.parse(body));
  }

  // Lista pronta a partir de um modelo versionado (`MODELOS_DE_LISTA`).
  @Post('listas/modelo')
  @RequirePermissions('tarefas.editar')
  criarListaDoModelo(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarListaDoModelo(u.orgId, u.sub, TrabListaDoModeloSchema.parse(body));
  }

  // ---- statuses ----
  @Post('listas/:id/statuses')
  @RequirePermissions('tarefas.editar')
  criarStatus(@CurrentUser() u: JwtUser, @Param('id') listId: string, @Body() body: unknown) {
    return this.svc.criarStatus(u.orgId, u.sub, listId, TrabStatusCreateSchema.parse(body));
  }

  @Patch('statuses/:id')
  @RequirePermissions('tarefas.editar')
  editarStatus(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarStatus(u.orgId, u.sub, id, TrabStatusUpdateSchema.parse(body));
  }

  @Delete('statuses/:id')
  @RequirePermissions('tarefas.editar')
  apagarStatus(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarStatus(u.orgId, u.sub, id);
  }

  // ---- campos personalizados + opções ----
  @Post('campos')
  @RequirePermissions('tarefas.editar')
  criarCampo(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarCampo(u.orgId, u.sub, TrabCampoCreateSchema.parse(body));
  }

  @Patch('campos/:id')
  @RequirePermissions('tarefas.editar')
  editarCampo(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarCampo(u.orgId, u.sub, id, TrabCampoUpdateSchema.parse(body));
  }

  @Delete('campos/:id')
  @RequirePermissions('tarefas.editar')
  apagarCampo(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarCampo(u.orgId, u.sub, id);
  }

  @Post('campos/:id/opcoes')
  @RequirePermissions('tarefas.editar')
  criarOpcao(@CurrentUser() u: JwtUser, @Param('id') fieldId: string, @Body() body: unknown) {
    return this.svc.criarOpcao(u.orgId, u.sub, fieldId, TrabOpcaoCreateSchema.parse(body));
  }

  @Patch('opcoes/:id')
  @RequirePermissions('tarefas.editar')
  editarOpcao(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarOpcao(u.orgId, u.sub, id, TrabOpcaoUpdateSchema.parse(body));
  }

  @Delete('opcoes/:id')
  @RequirePermissions('tarefas.editar')
  apagarOpcao(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarOpcao(u.orgId, u.sub, id);
  }

  // ---- etiquetas ----
  @Post('tags')
  @RequirePermissions('tarefas.editar')
  criarTag(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criarTag(u.orgId, u.sub, TrabTagCreateSchema.parse(body));
  }

  @Patch('tags/:id')
  @RequirePermissions('tarefas.editar')
  editarTag(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editarTag(u.orgId, u.sub, id, TrabTagUpdateSchema.parse(body));
  }

  @Delete('tags/:id')
  @RequirePermissions('tarefas.editar')
  apagarTag(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarTag(u.orgId, u.sub, id);
  }

  // ---- tarefas ----
  @Get('tarefas')
  @RequirePermissions('tarefas.ver')
  tarefas(
    @CurrentUser() u: JwtUser,
    @Query() query?: Record<string, unknown>,
  ) {
    return this.svc.tarefas(u.orgId, parseWorkTaskQuery(query ?? {}));
  }

  @Get('tarefas/:id/fontes')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.ver', 'obsidian.ver')
  fontesDaTarefa(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.fontesContexto.fontes(u.orgId, u.sub, id);
  }

  @Get('tarefas/:id/atividade')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.ver')
  atividade(@CurrentUser() u: JwtUser, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.svc.atividade(u.orgId, u.sub, id, query ?? {});
  }

  @Get('tarefas/:id')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.ver')
  tarefa(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.tarefa(u.orgId, id, u.sub);
  }

  @Post('tarefas')
  @RequirePermissions('tarefas.editar')
  criarTarefa(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    // T4: a tarefa criada pela tela sempre tem cliente (subtarefa herda o da mãe).
    const input = TrabTarefaCreateSchema.parse(body);
    exigirVerLeads(u, !!input.leadId);
    return this.svc.criarTarefa(u.orgId, u.sub, input, { exigirCliente: true });
  }

  /** Ordem manual (versão final, F4): arrastar na lista ou na coluna grava `order`, com versão. */
  @Post('tarefas/ordem')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.editar')
  reordenarTarefas(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.reordenar(u.orgId, u.sub, TrabTarefasOrdemSchema.parse(body));
  }

  @Patch('tarefas/:id')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.editar')
  editarTarefa(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = TrabTarefaUpdateHttpSchema.parse(body);
    exigirVerLeads(u, input.leadId !== undefined);
    return this.svc.editarTarefaHttp(u.orgId, u.sub, id, input);
  }

  // "apagar" = arquivar (nada some de verdade; auditoria fica)
  @Delete('tarefas/:id')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('tarefas.editar')
  arquivarTarefa(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const input = TrabTarefaArchiveHttpSchema.parse(body);
    return this.svc.editarTarefaHttp(u.orgId, u.sub, id, { archived: true, expectedUpdatedAt: input.expectedUpdatedAt });
  }

  /* ---- o dono único: assumir e soltar (fatia A4) ----
   *
   * `tarefas.editar` nas duas, e não uma permissão nova. A pergunta que decide
   * isso é "quem pode mexer no quadro desta empresa?", e ela já tem resposta —
   * criar `tarefas.assumir` obrigaria os três passos de permissão
   * (`shared build` → `db:sync-permissions` → todo mundo sai e entra) para
   * separar um subconjunto de gente que ninguém pediu para separar.
   *
   * NÃO PASSA PELA PORTA, e o porquê está inteiro no cabeçalho de
   * `checkout-de-tarefa.service.ts`: é escrita interna, sem efeito externo, e
   * retenção por aprovação faria todo checkout esperar uma segunda pessoa.
   *
   * O 409 é o contrato: quem perde a corrida recebe `ConflictException` com a
   * frase dizendo quem ficou com a tarefa. A tela mostra a frase como veio.
   */
  @Post('tarefas/:id/assumir')
  @RequirePermissions('tarefas.editar')
  assumir(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const entrada = TrabAssumirSchema.parse(body);
    return this.checkout.assumir(u.orgId, id, entrada.agente, { actorId: u.sub }, entrada.statusId);
  }

  @Post('tarefas/:id/soltar')
  @RequirePermissions('tarefas.editar')
  soltar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const entrada = TrabSoltarSchema.parse(body ?? {});
    return this.checkout.soltar(u.orgId, id, { actorId: u.sub }, entrada.motivo);
  }

  @Post('tarefas/:id/comentarios')
  @RequirePermissions('tarefas.editar')
  comentar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.comentar(u.orgId, u.sub, id, TrabComentarioSchema.parse(body).text);
  }

  /* ---- horas apontadas (esteira de clientes) ----
   *
   * `tarefas.editar` e não uma permissão nova, pelo mesmo motivo do checkout:
   * quem mexe no quadro aponta hora nele, e uma chave `tarefas.apontar` custaria
   * os três passos de permissão para separar gente que ninguém pediu para
   * separar. Apagar tem uma regra a mais, no serviço: só quem lançou.
   */
  @Post('tarefas/:id/apontamentos')
  @RequirePermissions('tarefas.editar')
  apontar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.apontar(u.orgId, u.sub, id, TrabApontamentoCreateSchema.parse(body));
  }

  @Delete('apontamentos/:id')
  @RequirePermissions('tarefas.editar')
  apagarApontamento(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.svc.apagarApontamento(u.orgId, u.sub, id);
  }
}
