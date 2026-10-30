import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApprovalState, Prisma, SessionCanal, SessionStatus } from '@prisma/client';
import { funcaoPorSlug, type OpcaoDaPendencia } from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PendenciasService } from '../pendencias/pendencias.service';
import { PendenciasRegistry } from '../pendencias/pendencias.registry';
import { ApprovalsService } from '../approvals/approvals.service';
import { temPapelDeMaquina } from '../approvals/alcada';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { MemoriaService } from '../memory/memoria.service';
import { TarefasDoDiaService } from '../work/tarefas-do-dia.service';
import { WorkService } from '../work/work.service';
import { acharPorNome } from '../work/agente-de-tarefas/pedido-do-grupo';
import { AgentRuntime } from '../agents/agent-runtime.service';
import {
  AgenteInvocarArgs,
  AprovacaoListarArgs,
  BriefingLerArgs,
  GRAVAR_NA_MEMORIA,
  MemoriaSugerirArgs,
  NAO_GRAVAR,
  PendenciaCriarArgs,
  PendenciaListarArgs,
  TIPO_DA_SUGESTAO_DE_MEMORIA,
  TarefaComentarArgs,
  TarefaCriarArgs,
  chaveDaPendencia,
  chaveDaSugestao,
  lerArgumentos,
  recusaDaInvocacao,
} from './argumentos-da-central';

/** O slug do Briefing diário (CE-02), cuja última passagem `briefing.ler` devolve. */
export const SLUG_DO_BRIEFING = 'briefing-diario';
/** A área em que a tarefa nasce quando o pedido não diz (a mesma escolha do TR-12). */
const AREA_PADRAO = 'Operação';

/** Os dados que a pendência de sugestão guarda: o texto EXATO que a pessoa vai ver. */
interface DadosDaSugestao {
  chave: string;
  titulo: string;
  corpo: string;
  tags: string[];
  motivo: string | null;
  agentSlug: string | null;
  correlationId: string | null;
}

/*
 * ============================================================================
 * AS CAPACIDADES DA CENTRAL (política 1.13.0, 30/10/2026) — o efeito de cada uma
 * ============================================================================
 *
 * Oito das nove capacidades que deixam a Rootinha (o agente que roda fora, no
 * Hermes) operar o OS só pelas portas dele. Todas são do PRÓPRIO OS — tarefa,
 * caixa, fila, memória, outro agente —, e por isso moram aqui e não num
 * conector: a regra de `agents/efeitos.service.ts` é que "efeito que fala com
 * sistema de terceiro é declarado pelo conector daquele sistema; o resto liga
 * o que é do próprio OS". A nona, responder no WhatsApp, fala com a Evolution e
 * mora em `resposta-na-conversa.service.ts`, pela porta da caixa.
 *
 * NENHUMA É ATALHO. Cada efeito chama o MESMO serviço que a tela chama:
 *   · a tarefa nasce pelo `TarefasDoDiaService` (o do TR-12, com as três regras
 *     que impedem card repetido) e o comentário pelo `WorkService`;
 *   · a pendência abre pelo `PendenciasService` (idempotente pela chave);
 *   · a fila é lida pelo `ApprovalsService.listar` — o resumo, nunca os
 *     argumentos gravados nem o token;
 *   · outro agente acorda pelo `AgentRuntime.invocar` — a mesma porta, o mesmo
 *     teto, o mesmo rastro do botão "Invocar";
 *   · a memória só é ESCRITA pelo `MemoriaService`, e só depois de uma pessoa.
 *
 * EM NOME DE QUEM. O efeito que escreve "como gente" (a tarefa, o comentário)
 * precisa de uma pessoa, e a pessoa vem de `pessoaDoPedido`: o solicitante que
 * a rota do agente externo carimbou, ou o ator quando ele é gente (o caminho de
 * depois da aprovação, em que quem age é quem aprovou). Sem pessoa, recusa — a
 * tarefa não nasce em nome de um agente.
 */
@Injectable()
export class EfeitosDaCentralService implements OnModuleInit {
  private readonly log = new Logger('EfeitosDaCentral');

  constructor(
    private readonly prisma: PrismaService,
    private readonly registro: EfeitosRegistry,
    private readonly pendencias: PendenciasService,
    private readonly tratadores: PendenciasRegistry,
    private readonly aprovacoes: ApprovalsService,
    private readonly memoria: MemoriaService,
    private readonly tarefas: TarefasDoDiaService,
    private readonly trabalho: WorkService,
    private readonly runtime: AgentRuntime,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(
      {
        'operacao.tarefa.criar': (a, org, ctx) => this.criarTarefa(a, org, ctx),
        'operacao.tarefa.comentar': (a, org, ctx) => this.comentarTarefa(a, org, ctx),
        'caixa.pendencia.listar': (a, org, ctx) => this.listarPendencias(a, org, ctx),
        'caixa.pendencia.criar': (a, org, ctx) => this.criarPendencia(a, org, ctx),
        'aprovacao.listar': (a, org) => this.listarAprovacoes(a, org),
        'agente.invocar': (a, org, ctx) => this.invocarAgente(a, org, ctx),
        'briefing.ler': (a, org) => this.lerBriefing(a, org),
        'contexto.memoria.sugerir': (a, org, ctx) => this.sugerirMemoria(a, org, ctx),
      },
      'EfeitosDaCentralService (capacidades da central, política 1.13.0)',
    );
    /*
     * A sugestão vira memória SÓ AQUI: quando uma pessoa responde a pendência.
     * `obsidian.editar` é a mesma permissão de `POST /contexto` e de
     * `POST /contexto/promover`, relida no banco pelo `PendenciasService` antes
     * de tomar a linha — quem não pode escrever memória na tela não grava por
     * aqui também.
     */
    this.tratadores.aoResponder(
      TIPO_DA_SUGESTAO_DE_MEMORIA,
      async (r) => {
        if (r.escolha !== GRAVAR_NA_MEMORIA) return;
        const d = r.dados as DadosDaSugestao | null;
        if (!d?.chave || !d.titulo || !d.corpo) throw new Error('a sugestão perdeu o texto: nada foi gravado');
        await this.memoria.promover(r.orgId, {
          chave: d.chave,
          title: d.titulo,
          body: d.corpo,
          tags: d.tags ?? [],
          sourceRef: `agente:${d.agentSlug ?? 'desconhecido'}:${d.correlationId ?? r.pendenciaId}`,
          motivo: d.motivo ?? `sugerida por ${d.agentSlug ?? 'um agente'} e aprovada na caixa`,
        });
      },
      'EfeitosDaCentralService',
      { permissao: 'obsidian.editar' },
    );
  }

  /* ------------------------------------------------------------------ gente */

  /**
   * A pessoa em nome de quem o efeito escreve, ou `null`.
   *
   * Duas candidatas, nesta ordem: o SOLICITANTE (carimbado pela rota do agente
   * externo) e o ATOR (no laço interno o ator de uma sessão pedida por alguém é
   * essa pessoa; depois de uma aprovação, é quem aprovou). Vale a primeira que
   * for usuário ATIVO desta empresa e não conta de máquina — o slug de um
   * agente nunca passa, e é isso que impede tarefa "em nome da Rootinha".
   */
  private async pessoaDoPedido(orgId: string, ctx: ContextoDoEfeito): Promise<{ id: string; nome: string } | null> {
    for (const id of [ctx.solicitanteId, ctx.actorId]) {
      if (!id) continue;
      const u = await this.prisma.user.findFirst({
        where: { id, orgId, isActive: true },
        select: { id: true, name: true, roles: { select: { key: true } } },
      });
      if (u && !temPapelDeMaquina(u.roles.map((r) => r.key))) return { id: u.id, nome: u.name };
    }
    return null;
  }

  private async exigirPessoa(orgId: string, ctx: ContextoDoEfeito, permissao: string, capacidade: string) {
    const pessoa = await this.pessoaDoPedido(orgId, ctx);
    if (!pessoa) {
      throw new Error(
        `${capacidade} escreve em nome de uma pessoa da empresa, e o pedido não disse quem pediu. Nada foi feito.`,
      );
    }
    try {
      await exigirAcessoAtual(this.prisma, orgId, pessoa.id, [permissao]);
    } catch {
      throw new Error(`${pessoa.nome} não tem a permissão "${permissao}". Nada foi feito.`);
    }
    return pessoa;
  }

  /* ---------------------------------------------------------------- tarefas */

  private async criarTarefa(bruto: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito) {
    const a = lerArgumentos(TarefaCriarArgs, bruto, 'operacao.tarefa.criar');
    const quem = await this.exigirPessoa(orgId, ctx, 'tarefas.editar', 'operacao.tarefa.criar');
    const painel = await this.tarefas.painel(orgId);
    const area = a.area
      ? acharPorNome(painel.areas, a.area)
      : (acharPorNome(painel.areas, AREA_PADRAO) ?? painel.areas[0] ?? null);
    if (!area) {
      throw new Error(
        a.area
          ? `Não achei a área "${a.area}" (${painel.areas.map((x) => x.nome).join(', ')}). Nada foi criado.`
          : 'Não há área de tarefa cadastrada. Nada foi criado.',
      );
    }
    let pessoaId: string | null = null;
    if (a.pessoa) {
      const p = /^(eu|mim)$/i.test(a.pessoa.trim())
        ? (acharPorNome(painel.pessoas, quem.nome) ?? { id: quem.id, nome: quem.nome })
        : acharPorNome(painel.pessoas, a.pessoa);
      if (!p) {
        throw new Error(
          `Não achei "${a.pessoa}" na equipe (${painel.pessoas.map((x) => x.nome).join(', ')}). Nada foi criado.`,
        );
      }
      pessoaId = p.id;
    }
    const r = await this.tarefas.criar(orgId, quem.id, {
      titulo: a.titulo,
      areaId: area.id,
      pessoaId,
      prazo: a.prazo ?? null,
      clienteId: a.clienteId ?? null,
      confirmar: a.confirmar ?? false,
    });
    // Aviso (igual, parecida, não parece tarefa) NÃO é erro: é a resposta que a
    // tela também dá, e quem pediu decide se confirma.
    return { ...r, emNomeDe: quem.nome };
  }

  private async comentarTarefa(bruto: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito) {
    const a = lerArgumentos(TarefaComentarArgs, bruto, 'operacao.tarefa.comentar');
    const quem = await this.exigirPessoa(orgId, ctx, 'tarefas.editar', 'operacao.tarefa.comentar');
    const c = await this.trabalho.comentar(orgId, quem.id, a.tarefaId, a.texto);
    return { comentado: true, comentarioId: c.id, em: c.createdAt, emNomeDe: quem.nome };
  }

  /* --------------------------------------------------------------- a caixa */

  private async listarPendencias(bruto: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito) {
    const a = lerArgumentos(PendenciaListarArgs, bruto, 'caixa.pendencia.listar');
    const quem = await this.pessoaDoPedido(orgId, ctx);
    // Sem pessoa, "minhas" quer dizer só as sem destinatário — o id vazio não casa com ninguém.
    const itens = await this.pendencias.listar(orgId, quem?.id ?? '', { estado: a.estado, de: a.de });
    return { itens, total: itens.length };
  }

  private async criarPendencia(bruto: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito) {
    const a = lerArgumentos(PendenciaCriarArgs, bruto, 'caixa.pendencia.criar');
    const funcao = this.funcaoDoAgente(ctx, 'caixa.pendencia.criar');
    let paraUsuarioId: string | null = null;
    if (a.para) {
      const pessoas = (await this.tarefas.painel(orgId)).pessoas;
      const p = acharPorNome(pessoas, a.para);
      if (!p) throw new Error(`Não achei "${a.para}" na equipe (${pessoas.map((x) => x.nome).join(', ')}). Nada foi aberto.`);
      paraUsuarioId = p.id;
    }
    const opcoes: OpcaoDaPendencia[] = a.opcoes ?? [{ chave: 'feito', rotulo: 'Feito' }];
    const r = await this.pendencias.abrir(orgId, {
      funcao,
      tipo: `agente.${ctx.agentSlug}.pedido`,
      chave: a.chave
        ? `agente:${ctx.agentSlug}:${a.chave}`
        : chaveDaPendencia(`agente:${ctx.agentSlug}`, [a.titulo, paraUsuarioId]),
      titulo: a.titulo,
      contexto: a.contexto ?? '',
      opcoes,
      paraUsuarioId,
    });
    return { pendenciaId: r.id, nova: r.nova, estado: r.estado };
  }

  /** O id do cadastro único do agente que pede (a pendência carrega a função de quem a deixou). */
  private funcaoDoAgente(ctx: ContextoDoEfeito, capacidade: string): string {
    const f = ctx.agentSlug ? funcaoPorSlug(ctx.agentSlug) : null;
    if (!f) {
      throw new Error(
        `${capacidade} é de agente do cadastro único, e "${ctx.agentSlug ?? 'sem agente'}" não está nele. Nada foi aberto.`,
      );
    }
    return f.id;
  }

  /* ---------------------------------------------------------------- a fila */

  private async listarAprovacoes(bruto: Record<string, unknown>, orgId: string) {
    const a = lerArgumentos(AprovacaoListarArgs, bruto, 'aprovacao.listar');
    // O que `listar` devolve é o que a tela de lista mostra: resumo, nível, alçada
    // e prazo. Os argumentos gravados e o token NÃO estão nele — e é de propósito.
    return this.aprovacoes.listar(orgId, (a.status ?? ApprovalState.pendente) as ApprovalState);
  }

  /* ------------------------------------------------------------ outro agente */

  private async invocarAgente(bruto: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito) {
    const a = lerArgumentos(AgenteInvocarArgs, bruto, 'agente.invocar');
    const alvo = await this.prisma.agent.findFirst({
      where: { orgId, slug: a.agente },
      select: { slug: true, tipo: true, capacidades: true },
    });
    const recusa = recusaDaInvocacao(ctx.agentSlug, alvo ? { ...alvo, tipo: String(alvo.tipo) } : null);
    if (recusa) throw new Error(`agente.invocar: ${recusa}`);
    const quem = await this.pessoaDoPedido(orgId, ctx);
    /*
     * A MARCA DE FORA ATRAVESSA A INVOCAÇÃO. Se o pedido que chegou ao agente
     * que invoca era texto de terceiro, a passagem do agente chamado nasce
     * marcada (`procedenciaExterna`), e o sinal `fonte_nao_confiavel` sobe um
     * degrau em cada ação dela — a mesma regra de quem lê mensagem de fora.
     */
    const deFora = ctx.pedidoDeFora === true;
    const r = await this.runtime.invocar({
      orgId,
      agentSlug: a.agente,
      canal: SessionCanal.mcp,
      canalRef: null,
      solicitanteId: quem?.id ?? null,
      solicitanteRotulo: `${ctx.agentSlug ?? 'agente'}${quem ? ` (a pedido de ${quem.nome})` : ''}`,
      motivo: 'manual',
      nota: a.nota ?? null,
      ...(deFora ? { procedenciaExterna: true } : {}),
    });
    return {
      sessionId: r.sessionId,
      status: r.status,
      resposta: r.resposta,
      motivo: r.motivo ?? null,
      aprovacoes: r.aprovacoes,
    };
  }

  /* -------------------------------------------------------------- o briefing */

  private async lerBriefing(bruto: Record<string, unknown>, orgId: string) {
    lerArgumentos(BriefingLerArgs, bruto, 'briefing.ler');
    return this.ultimaPassagem(orgId, SLUG_DO_BRIEFING);
  }

  /**
   * A última passagem RESPONDIDA de um agente desta empresa, ou `null` com o
   * motivo. Serve ao `briefing.ler` e à rota `GET /agents/:slug/ultima-passagem`.
   */
  async ultimaPassagem(orgId: string, slug: string) {
    const s = await this.prisma.session.findFirst({
      where: {
        orgId,
        agent: { slug, orgId },
        status: { in: [SessionStatus.respondida, SessionStatus.executada] },
      },
      orderBy: { criadaEm: 'desc' },
      select: { id: true, criadaEm: true, encerradaEm: true, resposta: true, status: true, canal: true },
    });
    if (!s) return { agente: slug, passagem: null, motivo: 'nenhuma passagem respondida deste agente ainda' };
    return {
      agente: slug,
      passagem: {
        sessionId: s.id,
        criadaEm: s.criadaEm.toISOString(),
        encerradaEm: s.encerradaEm?.toISOString() ?? null,
        status: s.status,
        canal: s.canal,
        resposta: s.resposta,
      },
    };
  }

  /* -------------------------------------------------------------- a memória */

  /**
   * NÃO GRAVA MEMÓRIA. Abre uma pendência com o texto exato, e quem grava é o
   * tratador inscrito acima, quando uma pessoa responde "Gravar na memória".
   *
   * POR QUE A CAIXA E NÃO A FILA DE APROVAÇÃO: a fila (`Approval`) retém uma
   * AÇÃO da porta, presa ao hash dos argumentos, com prazo de 5 a 15 minutos
   * conforme o degrau — e R1 não gera aprovação nenhuma (a régua diz `nunca`
   * para R0 e R1, com validade zero). Forçar uma aprovação para um R1 seria
   * inventar um degrau que a política não tem. A pendência é o lugar que o OS
   * já tem para "um agente deixou uma decisão para gente": não vence, mostra o
   * texto inteiro e só a pessoa com a permissão da memória responde.
   */
  private async sugerirMemoria(bruto: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito) {
    const a = lerArgumentos(MemoriaSugerirArgs, bruto, 'contexto.memoria.sugerir');
    const funcao = this.funcaoDoAgente(ctx, 'contexto.memoria.sugerir');
    const chave = chaveDaSugestao(a.titulo, a.chave, orgId);
    const dados: DadosDaSugestao = {
      chave,
      titulo: a.titulo,
      corpo: a.corpo,
      tags: a.tags ?? [],
      motivo: a.motivo ?? null,
      agentSlug: ctx.agentSlug ?? null,
      correlationId: ctx.correlationId ?? null,
    };
    const r = await this.pendencias.abrir(orgId, {
      funcao,
      tipo: TIPO_DA_SUGESTAO_DE_MEMORIA,
      chave: chaveDaPendencia('memoria.sugestao', [chave, a.corpo]),
      titulo: `Gravar na memória: ${a.titulo}`.slice(0, 300),
      contexto: [a.motivo ? `Por quê: ${a.motivo}` : null, `Chave: ${chave}`, '', a.corpo]
        .filter((l) => l !== null)
        .join('\n')
        .slice(0, 8000),
      opcoes: [
        { chave: GRAVAR_NA_MEMORIA, rotulo: 'Gravar na memória' },
        { chave: NAO_GRAVAR, rotulo: 'Não gravar' },
      ],
      dados: dados as unknown as Prisma.InputJsonValue,
    });
    this.log.log(`sugestão de memória ${chave} na caixa (pendência ${r.id}, nova=${r.nova})`);
    return { pendenciaId: r.id, nova: r.nova, chave, gravada: false };
  }
}
