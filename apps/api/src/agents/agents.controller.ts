import { ProcedimentoFerramentaLocalService } from './procedimento-ferramenta-local.service';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { EstadoDeAgente, SessionCanal } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AgentsService } from './agents.service';
import { AgentRuntime, type SessionResumo } from './agent-runtime.service';
import { SessionService } from './session.service';
import { ProcedimentoDoAgenteService } from './procedimento-do-agente.service';
import { AgendaLocalService } from './agenda-local.service';
import { AgentEstadoHumanoSchema, AgendaLocalListaConsultaSchema, AgendaLocalRecuperacaoConsultaSchema, SessaoHistoricaConsultaSchema } from '@mktos/shared';

const PedidoSchema = z.object({
  pedido: z.string().min(1).max(4000),
  canal: z.nativeEnum(SessionCanal).default(SessionCanal.web),
  canalRef: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});

/*
 * QUEM PODE FAZER UM AGENTE RODAR (RF-G-03 · LLM06 · fatia 0.3a).
 *
 * `mcp.executar` sozinho não serve de trava: ele está no perfil `ia_servico`,
 * que o próprio catálogo descreve como "só leitura (menor privilégio)", e
 * também no `ia_acao`. Ou seja, a conta de serviço da IA podia disparar um
 * agente — e um agente alcança a porta, que alcança conector.
 *
 * Enquanto não existir uma permissão dedicada (`agentes.executar` em
 * packages/shared/src/permissions.ts, que é decisão humana e mora fora desta
 * fatia), a trava é a mesma que o resto do código já usa para superfície de
 * administrador: `admin.usuarios` — hoje só o perfil `admin_master`. As rotas
 * de LEITURA seguem em `mcp.ver`: elas não fazem nada acontecer, e fechá-las
 * cegaria o painel sem fechar buraco nenhum.
 *
 * O guarda exige TODAS as permissões da lista (PermissionsGuard usa `every`),
 * então isto é interseção, não alternativa.
 */
const EXECUTAR_AGENTE = ['mcp.executar', 'admin.usuarios'] as const;

/** Declarar a linha de base é escrita na configuração do agente, não execução. */
const CONFIGURAR_AGENTE = ['automacoes.executar', 'admin.usuarios'] as const;

/*
 * PAUSAR, RETOMAR E ENCERRAR — fatia A2.
 *
 * `admin.usuarios` SOZINHA, e não a interseção de `CONFIGURAR_AGENTE`. O
 * precedente é o interruptor de conector (`POST /integrations/:chave/desligamento`,
 * RF-G-06), que é o freio de emergência mais próximo que existe aqui: ele pede
 * exatamente esta chave e nada mais. Somar `automacoes.executar` faria PARAR um
 * agente exigir mais permissão do que parar um conector inteiro — e freio que
 * pede mais do que o freio vizinho é freio que alguém não vai alcançar na hora.
 *
 * NENHUMA CHAVE NOVA ENTRA no catálogo de permissões, e é de propósito: chave
 * nova custa o ritual de três passos (construir o pacote, `db:sync-permissions`
 * — que não é aditivo — e todo mundo sair e entrar, porque a permissão viaja no
 * JWT). Uma `agentes.comandar` dedicada é o desenho certo no médio prazo e é
 * DECISÃO DO PEDRO; está no relatório da fatia, não decidida aqui.
 *
 * Hoje `admin.usuarios` só existe no perfil `admin_master`.
 */
const COMANDAR_AGENTE = ['admin.usuarios'] as const;

/** Pausar não pede motivo (freio tem de ser rápido); encerrar pede — e a API cobra. */
const MudancaDeEstadoSchema = AgentEstadoHumanoSchema;

/*
 * O "Invocar" — o pedido é MONTADO pelo servidor, não digitado.
 *
 * A `nota` é um recado curto do dono ("olhe o cliente X"), e não um pedido: quem
 * escreve o pedido de uma passagem de heartbeat é `agents/heartbeat.ts`. Se a
 * nota pudesse ter 4.000 caracteres como o `pedido` de `/executar`, esta rota
 * seria uma segunda `/executar` com outro nome — e a fatia A6 herdaria duas
 * formas de acordar um agente.
 */
const InvocarSchema = z.object({
  nota: z.string().trim().max(300).optional(),
});

/*
 * O ORÇAMENTO MENSAL DE IA DO AGENTE — fatia A3.
 *
 * O TETO DE MIL DÓLARES não é timidez: é a diferença entre errar uma casa
 * decimal e dar a um agente um orçamento de carro popular por mês. Quem
 * realmente precisar de mais que isso está numa conversa de contrato, não numa
 * caixa de texto — e o erro de digitação é o caso comum, não o excepcional.
 *
 * Zero é VÁLIDO: com `ativo: true`, é a decisão "este agente não chama modelo",
 * e o serviço cobra motivo escrito para ela (ver `definirOrcamento`).
 */
const OrcamentoSchema = z.object({
  mensalUsd: z
    .number()
    .min(0, 'o orçamento mensal não pode ser negativo')
    .max(1000, 'orçamento acima de US$ 1.000 por mês: fale com quem administra o OS'),
  ativo: z.boolean(),
  motivo: z.string().trim().max(500).optional(),
});

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class AgentsController {
  constructor(
    private readonly agentes: AgentsService,
    private readonly runtime: AgentRuntime,
    private readonly sessoes: SessionService,
    private readonly procedimento: ProcedimentoDoAgenteService,
    private readonly agenda: AgendaLocalService,
    private readonly ferramentaLocal: ProcedimentoFerramentaLocalService,
  ) {}

  @Get('agents')
  @RequirePermissions('mcp.ver')
  roster(@CurrentUser() user: JwtUser) {
    return this.agentes.roster(user.orgId);
  }

  @Get('agents/prontidao')
  @RequirePermissions('mcp.ver')
  prontidao(@CurrentUser() user: JwtUser) {
    return this.procedimento.prontidao(user.orgId, user.sub);
  }

  @Get('agents/configuracao')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  configuracao(@CurrentUser() user: JwtUser) {
    return this.procedimento.configuracao(user.orgId, user.sub);
  }

  @Get('agents/pedidos/:requestId')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  pedidoDeCriacao(@CurrentUser() user: JwtUser, @Param('requestId') requestId: string) {
    return this.procedimento.criacaoPorPedido(user.orgId, user.sub, requestId);
  }

  @Post('agents')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.procedimento.criar(user.orgId, user.sub, body);
  }

  @Get('agents/:slug/procedimento/ferramenta/painel')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  painelDaFerramenta(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.ferramentaLocal.painel(user.orgId, user.sub, slug);
  }

  @Put('agents/:slug/procedimento/ferramenta/configuracao')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  configurarFerramenta(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    return this.ferramentaLocal.configurar(user.orgId, user.sub, slug, body);
  }

  @Post('agents/:slug/procedimento/ferramenta/executar')
  @RequirePermissions('mcp.ver', 'mcp.executar', 'admin.usuarios', 'obsidian.ver')
  executarFerramenta(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    return this.ferramentaLocal.executar(user.orgId, user.sub, slug, body);
  }

  @Get('agents/:slug/procedimento/ferramenta/pedidos/:requestId')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  recuperarFerramenta(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('requestId') requestId: string) {
    return this.ferramentaLocal.porPedido(user.orgId, user.sub, slug, requestId);
  }

  @Get('agents/:slug/procedimento/ferramenta/execucoes/:sessionId')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  detalheDaFerramenta(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('sessionId') sessionId: string) {
    return this.ferramentaLocal.detalhe(user.orgId, user.sub, slug, sessionId);
  }

  @Get('agents/:slug/procedimento/painel')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  painelDoProcedimento(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.procedimento.painel(user.orgId, user.sub, slug);
  }

  @Get('agents/:slug/procedimento/fontes')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  fontesDoProcedimento(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.procedimento.fontes(user.orgId, user.sub, slug);
  }

  @Post('agents/:slug/procedimento/executar')
  @RequirePermissions(...EXECUTAR_AGENTE, 'mcp.ver', 'obsidian.ver')
  executarProcedimento(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    return this.procedimento.executar(user.orgId, user.sub, slug, body);
  }

  @Get('agents/:slug/procedimento/pedidos/:requestId')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  pedidoDoProcedimento(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('requestId') requestId: string) {
    return this.procedimento.porPedido(user.orgId, user.sub, slug, requestId);
  }

  @Get('agents/:slug/procedimento/execucoes/:id')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  execucaoDoProcedimento(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('id') id: string) {
    return this.procedimento.detalhe(user.orgId, user.sub, slug, id);
  }

  @Get('agents/:slug/agendas-locais/configuracao')
  @RequirePermissions('automacoes.executar', 'admin.usuarios', 'mcp.ver', 'obsidian.ver')
  configuracaoAgenda(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.agenda.configuracao(user.orgId, user.sub, slug);
  }

  @Get('agents/:slug/agendas-locais')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  agendasLocais(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Query() query: unknown) {
    const consulta = AgendaLocalListaConsultaSchema.parse(query ?? {});
    return this.procedimento.listarAgendas(user.orgId, user.sub, slug, consulta.cursorId);
  }

  @Get('agents/:slug/agendas-locais/:agendaId/pedidos/:requestId')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  pedidoDaAgenda(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('agendaId') agendaId: string,
    @Param('requestId') requestId: string, @Query() query: unknown) {
    return this.procedimento.operacaoLocalPorPedido(user.orgId, user.sub, slug, requestId,
      AgendaLocalRecuperacaoConsultaSchema.parse(query), z.string().uuid().parse(agendaId));
  }

  // O tipo strict seleciona o gate atual dentro do serviço: agenda ou estado humano.
  @Get('agents/:slug/operacoes-locais/:requestId')
  operacaoLocal(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('requestId') requestId: string, @Query() query: unknown) {
    return this.procedimento.operacaoLocalPorPedido(user.orgId, user.sub, slug, requestId, AgendaLocalRecuperacaoConsultaSchema.parse(query));
  }

  @Get('agents/:slug/agendas-locais/:agendaId')
  @RequirePermissions('mcp.ver', 'obsidian.ver')
  detalheAgenda(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('agendaId') agendaId: string) {
    return this.procedimento.obterAgenda(user.orgId, user.sub, slug, z.string().uuid().parse(agendaId));
  }

  @Post('agents/:slug/agendas-locais')
  @RequirePermissions('automacoes.executar', 'admin.usuarios', 'mcp.ver', 'obsidian.ver')
  criarAgenda(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    return this.procedimento.criarAgenda(user.orgId, user.sub, slug, body);
  }

  @Put('agents/:slug/agendas-locais/:agendaId')
  @RequirePermissions('automacoes.executar', 'admin.usuarios', 'mcp.ver', 'obsidian.ver')
  editarAgenda(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('agendaId') agendaId: string, @Body() body: unknown) {
    return this.procedimento.editarAgenda(user.orgId, user.sub, slug, z.string().uuid().parse(agendaId), body);
  }

  @Post('agents/:slug/agendas-locais/:agendaId/estado')
  @RequirePermissions('automacoes.executar', 'admin.usuarios', 'mcp.ver', 'obsidian.ver')
  estadoDaAgenda(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('agendaId') agendaId: string, @Body() body: unknown) {
    return this.procedimento.definirEstadoDaAgenda(user.orgId, user.sub, slug, z.string().uuid().parse(agendaId), body);
  }

  @Post('agents/:slug/agendas-locais/:agendaId/disparar')
  @RequirePermissions('mcp.ver', 'mcp.executar', 'admin.usuarios', 'obsidian.ver')
  dispararAgenda(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Param('agendaId') agendaId: string, @Body() body: unknown) {
    return this.procedimento.executarDeAgenda(user.orgId, user.sub, slug, z.string().uuid().parse(agendaId), body);
  }

  @Get('agents/:slug/estado-humano')
  @RequirePermissions(...COMANDAR_AGENTE)
  estadoHumano(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.agentes.estadoHumano(user.orgId, user.sub, slug);
  }

  @Get('agents/:slug')
  @RequirePermissions('mcp.ver')
  detalhe(@CurrentUser() user: JwtUser, @Param('slug') slug: string) {
    return this.agentes.detalheParaPessoa(user.orgId, slug, user.sub);
  }

  @Post('agents/:slug/linha-de-base')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  linhaDeBase(
    @CurrentUser() user: JwtUser,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    const { minutos } = z.object({ minutos: z.number().int().positive() }).parse(body);
    return this.agentes.declararLinhaDeBase(user.orgId, slug, minutos, user.sub);
  }

  /**
   * O ORÇAMENTO MENSAL DE IA DO AGENTE (fatia A3).
   *
   * PERMISSÃO: `CONFIGURAR_AGENTE`, a mesma da linha de base e do procedimento.
   * Nenhuma chave nova entra no catálogo, e é de propósito — chave nova custa o
   * ritual de três passos (construir o pacote, `db:sync-permissions`, que não é
   * aditivo, e todo mundo sair e entrar, porque a permissão viaja no JWT). A
   * interseção já inclui `admin.usuarios`, que hoje só o `admin_master` tem, e
   * definir orçamento é decisão de quem administra a conta.
   *
   * POST e não PATCH: cada gravação é uma DECISÃO nova, com autor, data e
   * motivo. `PATCH /agents/:slug` é a identificação do agente e a lista branca
   * de lá exclui os campos de gasto de propósito — ver `AgenteIdentidadeSchema`.
   */
  @Post('agents/:slug/orcamento')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  definirOrcamento(
    @CurrentUser() user: JwtUser,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ) {
    const input = OrcamentoSchema.parse(body ?? {});
    return this.agentes.definirOrcamento(user.orgId, slug, input, user.sub);
  }

  /**
   * Grava o procedimento pela versão que a pessoa leu. O envelope exige
   * expectedSopVersion e procedimento; validarProcedimento conserva as regras
   * dos sete campos e os textos fixos. Versão antiga recusa409, sem sobrescrita.
   * CONFIGURAR_AGENTE permanece a permissão de configuração.
   */
  @Put('agents/:slug/sop')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  salvarSop(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    return this.agentes.salvarSop(user.orgId, slug, body, user.sub);
  }

  /*
   * A IDENTIFICAÇÃO do agente: nome, missão, pilar e dono — e SÓ.
   *
   * A lista branca mora no serviço (`AgenteIdentidadeSchema`), com o motivo de
   * cada campo que ficou de fora: capacidade e autonomia são a declaração de
   * menor privilégio, contexto fixo vira regra da casa no prompt, teto e modelo
   * são da fatia do custo, e cron/estado são da tela de rotinas. Aqui só se liga
   * o caminho; alargar o que entra é editar aquele schema, onde a decisão está
   * escrita.
   *
   * PATCH e não PUT: o schema é `.partial()`, o corpo é um subconjunto dos
   * campos e o que não vem não muda.
   */
  @Patch('agents/:slug')
  @RequirePermissions(...CONFIGURAR_AGENTE)
  atualizar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    return this.agentes.atualizar(user.orgId, slug, body, user.sub);
  }

  /*
   * O ORGANOGRAMA (RF-N-06) — gente e agentes lado a lado, por pilar.
   *
   * `dashboard.ver`, e não `mcp.ver` nem `admin.usuarios`: esta é a tela mais
   * aberta das três que mostram gente, e é o que o menu já declara para ela
   * (`packages/shared/src/nav.ts`). Duas permissões diferentes para a mesma tela
   * é o defeito que a fila de aprovação já pagou uma vez — item aparecendo para
   * um público e API respondendo a outro.
   *
   * Fora de `agents/` no caminho porque a resposta não é sobre agentes: é sobre
   * a organização. `/agents` continua sendo o roster.
   */
  @Get('organograma')
  @RequirePermissions('dashboard.ver')
  organograma(@CurrentUser() user: JwtUser) {
    return this.agentes.organograma(user.orgId);
  }

  /* ======================================================================== *
   * O ESTADO NA MÃO DO DONO — pausar, retomar, encerrar (fatia A2)
   * ======================================================================== *
   *
   * TRÊS ROTAS, e não um `PATCH { estado }`. Pelo mesmo motivo que desligar e
   * religar conector são duas rotas: são três DECISÕES diferentes, com preços
   * diferentes (encerrar não volta e exige motivo escrito), e um campo de enum
   * num corpo só as esconderia atrás de uma permissão só e de um nome só no
   * rastro. O recurso é a decisão; o verbo é POST porque cada clique CRIA uma
   * decisão nova, com autor, data e motivo.
   *
   * Por que não passam pela porta: o bloco de `AgentsService.definirEstado`
   * responde isso inteiro. Em uma linha — freio que precisa de segunda
   * assinatura não é freio.
   */
  @Post('agents/:slug/pausar')
  @RequirePermissions(...COMANDAR_AGENTE)
  pausar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    const input = MudancaDeEstadoSchema.parse(body);
    return this.agentes.definirEstado(user.orgId, slug, EstadoDeAgente.pausado, {
      userId: user.sub,
      ...input,
    });
  }

  @Post('agents/:slug/retomar')
  @RequirePermissions(...COMANDAR_AGENTE)
  retomar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    const input = MudancaDeEstadoSchema.parse(body);
    return this.agentes.definirEstado(user.orgId, slug, EstadoDeAgente.ativo, {
      userId: user.sub,
      ...input,
    });
  }

  /**
   * ENCERRAR É DIFERENTE DE APAGAR, e esta rota é a prova.
   *
   * Não existe `DELETE /agents/:slug`, e não deve existir: `Session` aponta para
   * `Agent` sem `onDelete: Cascade` de propósito (ver o schema), então apagar o
   * agente apagaria — ou recusaria apagar — o histórico de tudo o que ele fez.
   * Encerrar tira de circulação e deixa o histórico de pé, que é o que uma
   * empresa precisa quando demite um agente.
   *
   * Exige MOTIVO. A API recusa sem ele, com 400 e a frase pronta; a tela pede
   * antes do clique.
   */
  @Post('agents/:slug/encerrar')
  @RequirePermissions(...COMANDAR_AGENTE)
  encerrar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    const input = MudancaDeEstadoSchema.parse(body);
    return this.agentes.definirEstado(user.orgId, slug, EstadoDeAgente.encerrado, {
      userId: user.sub,
      ...input,
    });
  }

  /**
   * INVOCAR — uma passagem manual, disparada pelo dono na tela (fatia A2).
   *
   * É o primeiro dos quatro gatilhos de heartbeat do plano; os outros três
   * (atribuição, menção, aprovação resolvida) chegam na A6 e entram pelo MESMO
   * método do laço, trocando só o motivo.
   *
   * PERMISSÃO: a mesma de `/executar` (`EXECUTAR_AGENTE`), porque a consequência
   * é a mesma — o agente roda, alcança a porta e a porta alcança conector.
   * Afrouxar aqui daria a quem não pode executar um jeito de executar sem
   * escrever o pedido, que é a mesma coisa com um botão mais bonito.
   *
   * A RESPOSTA É A DE `/executar`, inclusive o 429 do teto de custo: quem chama
   * precisa tratar os mesmos desfechos, e duas formas para a mesma coisa é o que
   * faz uma tela mostrar "✅ enviado" em cima de uma retenção.
   */
  @Post('agents/:slug/invocar')
  @RequirePermissions(...EXECUTAR_AGENTE)
  async invocar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    const { nota } = InvocarSchema.parse(body ?? {});
    const resumo = await this.runtime.invocar({
      orgId: user.orgId,
      agentSlug: slug,
      canal: SessionCanal.web,
      motivo: 'manual',
      nota,
      solicitanteId: user.sub,
      solicitanteRotulo: user.name ?? user.sub,
    });
    return this.traduzirRecusaDeTeto(resumo);
  }

  @Post('agents/:slug/executar')
  @RequirePermissions(...EXECUTAR_AGENTE)
  async executar(@CurrentUser() user: JwtUser, @Param('slug') slug: string, @Body() body: unknown) {
    const input = PedidoSchema.parse(body);
    const resumo = await this.runtime.executar({
      orgId: user.orgId,
      agentSlug: slug,
      canal: input.canal,
      canalRef: input.canalRef,
      sessionId: input.sessionId,
      pedido: input.pedido,
      solicitanteId: user.sub,
      solicitanteRotulo: user.name ?? user.sub,
    });

    /*
     * TETO DE CUSTO DE IA DA EMPRESA ESTOURADO (RF-G-05): 429, e não 200 nem 500.
     *
     * Até 11/09/2026 a exceção do teto escapava do laço e chegava aqui crua: o
     * operador via "erro interno do servidor", sem o motivo, e a sessão ficava
     * pendurada. O laço passou a encerrar a sessão como `recusada` com o motivo;
     * falta a rota DIZER o que aconteceu.
     *
     * 429 porque a semântica é essa: a cota do período acabou e volta sozinha na
     * virada do dia — é a mesma família de "tente de novo mais tarde", e é o que
     * o front precisa para mostrar o aviso certo em vez da tela de erro. 402
     * (pagamento) diria que falta dinheiro no provedor, que é outra coisa; 403
     * diria que falta permissão, que também é outra.
     *
     * O corpo leva a sessão: ela EXISTE, está gravada e é auditável — quem
     * recebe o erro precisa conseguir abrir o traço do que já tinha rodado.
     */
    return this.traduzirRecusaDeTeto(resumo);
  }

  /**
   * O 429 do teto, num lugar só.
   *
   * Era corpo do `executar` e virou método na fatia A2, quando `invocar` passou
   * a produzir o mesmo desfecho: duas cópias deste `if` seriam dois caminhos
   * respondendo códigos diferentes para o mesmo teto estourado — e um deles
   * envelheceria. Os dois blocos de comentário sobre POR QUE é 429 (e não 402
   * nem 403) estão no cabeçalho de `executar`.
   */
  private traduzirRecusaDeTeto(resumo: SessionResumo): SessionResumo {
    if (resumo.recusaDeTeto) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          /*
           * DOIS CONTROLES, DOIS RÓTULOS (fatia A3). O 429 é o mesmo — a cota do
           * período acabou e volta sozinha —, mas o período é diferente: o teto
           * da empresa volta na virada do DIA, o orçamento do agente na virada do
           * MÊS. Um rótulo só faria a tela oferecer "tente amanhã" a quem tem de
           * esperar três semanas.
           */
          error: resumo.recusaDeTeto.causa.startsWith('agente_')
            ? 'orcamento_de_ia_do_agente'
            : 'teto_de_custo_de_ia',
          message: resumo.recusaDeTeto.motivo,
          sessionId: resumo.sessionId,
          status: resumo.status,
          dia: resumo.recusaDeTeto.dia,
          causa: resumo.recusaDeTeto.causa,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return resumo;
  }

  /*
   * O mesmo pedido, respondendo em pedaços.
   *
   * SSE e não WebSocket: o tráfego é de mão única. E com effort alto o primeiro
   * token demora dezenas de segundos — sem streaming a tela fica muda o tempo
   * todo e parece travada.
   *
   * POST que responde text/event-stream porque EventSource não manda header, e
   * token em query string é dado sensível em URL. O front lê com fetch +
   * ReadableStream.
   */
  @Post('agents/:slug/stream')
  @RequirePermissions(...EXECUTAR_AGENTE)
  async stream(
    @CurrentUser() user: JwtUser,
    @Param('slug') slug: string,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const input = PedidoSchema.parse(body);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // O proxy do Next bufferiza por padrão e o stream chegaria de uma vez só.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const manda = (e: unknown) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    try {
      await this.runtime.executar({
        orgId: user.orgId,
        agentSlug: slug,
        canal: input.canal,
        canalRef: input.canalRef,
        sessionId: input.sessionId,
        pedido: input.pedido,
        solicitanteId: user.sub,
        solicitanteRotulo: user.name ?? user.sub,
        onEvento: manda,
      });
    } catch (e) {
      manda({ t: 'erro', mensagem: (e as Error).message });
    } finally {
      res.end();
    }
  }

  @Get('sessions')
  @RequirePermissions('mcp.ver')
  listar(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    const consulta = SessaoHistoricaConsultaSchema.parse(query);
    return this.sessoes.listar(user.orgId, user.sub, consulta);
  }

  @Get('sessions/:id')
  @RequirePermissions('mcp.ver')
  async traco(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const sessionId = z.string().min(1).parse(id);
    const traco = await this.sessoes.traco(user.orgId, user.sub, sessionId);
    if (traco === null) throw new NotFoundException('Execução indisponível.');
    return traco;
  }
}
