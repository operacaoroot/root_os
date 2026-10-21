import { Injectable } from '@nestjs/common';
import { ActorType, ApprovalState, type Alcada, type Prisma } from '@prisma/client';
import type {
  CaixaAprovacao,
  CaixaContador,
  CaixaConversa,
  CaixaResposta,
  CaixaTarefa,
} from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { ToolGateway } from '../gateway/tool-gateway.service';
import { ModulosService } from '../tenants/modulos.service';
import { exigirTenant } from '../common/contexto-execucao';
import {
  alcadaDe,
  alcadasAtendidasPor,
  descreverAlcada,
  exigeMotivo,
} from '../approvals/alcada';
import { agentesDaCasa } from '../work/agentes-da-casa';
import { tarefaDeListaVisivel } from '../work/arquivadas';
import {
  DIAS_DE_CONVERSA,
  DIAS_SEM_MOVIMENTO,
  ESTADO_DO_EIXO,
  HORAS_PRESA_COM_AGENTE,
  TETO_APROVACOES,
  TETO_CONVERSA,
  TETO_TAREFAS,
  condicoesDeParada,
  corteDaConversa,
  ehDeOutraPessoa,
  motivosDaParada,
  trechoDoComentario,
  type EstadoDoEixo,
} from './o-que-espera';

/**
 * ============================================================================
 * A CAIXA PESSOAL — "o que precisa de mim", fatia A7
 * ============================================================================
 *
 * Uma leitura que AGREGA três coisas que já existem e estavam em três telas
 * diferentes: as aprovações que ESTA pessoa pode assinar (hoje `/atendimento`
 * mostra a fila inteira, inclusive o que ela não assina), as tarefas dela que
 * pararam (hoje só no quadro, entre todas as outras) e a conversa recente nas
 * tarefas dela (hoje em lugar nenhum).
 *
 * NENHUMA ESCRITA. Este serviço não tem um único verbo que muda estado, e a
 * suíte reprova se ganhar um — a caixa é uma pergunta, e quem age é a tela de
 * destino, com a permissão e a trava dela. Em particular: a caixa NÃO confirma
 * aprovação. Ela leva para `/atendimento`, que é onde `confirm` relê o aprovador
 * no banco, cobra motivo escrito em R4/R5 e reautenticação de verdade.
 *
 * ----------------------------------------------------------------------------
 * PERMISSÃO NÃO É ALÇADA — e é por isso que esta fatia não é uma consulta trivial
 * ----------------------------------------------------------------------------
 * `aprovacoes.decidir` diz quem TRABALHA na fila. A alçada, lida do banco a cada
 * confirmação, diz de quem a assinatura VALE em cada degrau. E a invariante 7
 * tira da minha caixa o que EU propus. As três perguntas são as mesmas que
 * `POST /approvals/:id/confirm` faz, na mesma ordem — se esta caixa usasse só a
 * permissão, ela prometeria assinatura que a trava recusa, que é o defeito que a
 * fila de aprovação pagou uma vez (menu pedindo uma chave, API respondendo a
 * outra).
 *
 * Quatro cortes, e três deles vão para o `WHERE`:
 *
 *   1. `status = pendente` e `expiraEm > agora` — vencida não espera ninguém;
 *   2. `propostoPorId <> eu` — invariante 7, quem propõe não assina;
 *   3. `alcadaMinima IN (o que a minha alçada alcança)` — o conjunto vem de
 *      `alcadasAtendidasPor`, derivado de `atendeAlcada`, para a consulta e a
 *      confirmação nunca discordarem;
 *   4. o IMPEDIMENTO da porta (`conferirAprovado`) — este não cabe em SQL,
 *      porque depende dos argumentos gravados e da régua de hoje. Sai por
 *      subtração: a linha impedida não entra na lista nem no contador, e aparece
 *      como um número à parte com o caminho para `/atendimento`, que explica.
 *
 * ----------------------------------------------------------------------------
 * O DONO DE UM AGENTE, E O NOME DE UM AGENTE, NUNCA SAEM DE RELAÇÃO DO PRISMA
 * ----------------------------------------------------------------------------
 * `include: { agente: … }` devolve o agente do outro lado do ponteiro, de
 * qualquer empresa. O nome do agente que está com a tarefa vem de
 * `work/agentes-da-casa.ts`, que é o único lugar que faz essa pergunta com
 * `orgId` — publicar aqui o nome do agente da empresa vizinha seria vazamento,
 * não enfeite.
 *
 * ----------------------------------------------------------------------------
 * EIXO POR EIXO, COM PERMISSÃO PRÓPRIA — o desenho de `/contexto`
 * ----------------------------------------------------------------------------
 * A rota pede `dashboard.ver`, que todo perfil de gente tem, e cada eixo é
 * consultado SÓ se a sessão carregar a permissão dele (e, no caso do quadro, se
 * a empresa tiver contratado o módulo `trabalho`). Eixo sem permissão volta com
 * `estado: 'sem_permissao'` e lista vazia — nunca 403 na tela inteira, nunca
 * caixa de erro. É a decisão da fatia 4.4, e ela vale aqui pelo mesmo motivo:
 * uma caixa que morre por causa do eixo que a pessoa não tem some com os eixos
 * que ela tem.
 *
 * O MÓDULO É CONFERIDO AQUI DENTRO, e isso é obrigatório: `caixa` é prefixo de
 * ESPINHA, então o `ModulosInterceptor` deixa a rota responder sempre. Ler
 * `WorkTask` sem perguntar pelo módulo faria uma rota que nunca desliga servir
 * dado de um módulo que a empresa não contratou — o vazamento silencioso que
 * `src/tenants/modulos.ts` existe para impedir.
 */

/** As permissões que cada eixo exige da SESSÃO. */
const VER_APROVACOES = 'aprovacoes.ver';
const DECIDIR_APROVACOES = 'aprovacoes.decidir';
const VER_TAREFAS = 'tarefas.ver';

/** O módulo dono do quadro. Mesma chave de `MODULOS`, em `@mktos/shared`. */
const MODULO_DO_QUADRO = 'trabalho';

/** Quem está olhando, já resolvido no banco. */
interface EuNoBanco {
  id: string;
  nome: string;
  email: string;
  alcada: Alcada | null;
  decide: boolean;
}

export interface PedidoDaCaixa {
  orgId: string;
  usuarioId: string;
  /** As permissões DO TOKEN desta sessão. Ver `decideNestaSessao`, abaixo. */
  permissoes: readonly string[];
  /**
   * A conversa do quadro custa uma consulta a mais e não entra no contador —
   * então o contador não a pede. Duas rotas, UMA aritmética.
   */
  comConversa: boolean;
}

@Injectable()
export class CaixaService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * A porta, e só pela metade SÓ-LEITURA (`conferirAprovado`): ela não chama
     * efeito, não escreve no banco e não registra evento. Mesma injeção que a
     * fila de aprovação faz, pelo mesmo motivo — oferecer botão que a execução
     * recusa é caro, porque a recusa acontece depois de a aprovação já ter
     * virado `confirmada`, estado do qual nenhuma tela a tira.
     */
    private readonly gateway: ToolGateway,
    /** Para perguntar se a empresa contratou o módulo `trabalho`. */
    private readonly modulos: ModulosService,
  ) {}

  /* ====================================================================== *
   * A CAIXA INTEIRA
   * ====================================================================== */

  async montar(pedido: PedidoDaCaixa): Promise<CaixaResposta> {
    // Empresa resolvida ANTES da primeira consulta (RF-T-04): `findMany({ where:
    // { orgId: undefined } })` é um filtro que o Prisma ignora, e o que sobra é
    // a caixa de todo mundo. Token sem empresa é erro, nunca "todas".
    const orgId = exigirTenant(pedido.orgId, 'CaixaService.montar');
    const agora = new Date();
    const perms = new Set(pedido.permissoes);

    const eu = await this.euNoBanco(orgId, pedido.usuarioId);

    /*
     * DECIDE SEGUNDO O BANCO **E** SEGUNDO O TOKEN — as duas coisas, como a
     * fila faz. Promovido no meio da sessão: o banco já diz que decide, o token
     * ainda não, e `PermissionsGuard` recusaria o clique com uma frase genérica.
     * Rebaixado no meio da sessão: o token ainda carrega a chave e o banco já
     * não, e quem recusa é `confirm`. Nos dois casos a caixa não deve prometer.
     */
    const decideNestaSessao = (eu?.decide ?? false) && perms.has(DECIDIR_APROVACOES);

    const aprovacoes = await this.eixoDeAprovacoes({
      orgId,
      agora,
      eu,
      veAFila: perms.has(VER_APROVACOES),
      decideNestaSessao,
    });

    const podeVerQuadro = perms.has(VER_TAREFAS);
    const quadroLigado = podeVerQuadro && (await this.quadroContratado(orgId));

    const tarefas = await this.eixoDeTarefas({
      orgId,
      agora,
      eu,
      podeVer: podeVerQuadro,
      quadroLigado,
    });

    const conversa = pedido.comConversa
      ? await this.eixoDeConversa({ orgId, agora, eu, podeVer: podeVerQuadro, quadroLigado })
      : { estado: ESTADO_DO_EIXO.ok, itens: [] as CaixaConversa[], truncado: false };

    return {
      agora: agora.toISOString(),
      eu: {
        id: pedido.usuarioId,
        nome: eu?.nome ?? null,
        alcada: descreverAlcada(eu?.alcada ?? null),
        decide: eu?.decide ?? false,
        decideNestaSessao,
        ativo: !!eu,
      },
      aprovacoes: {
        estado: aprovacoes.estado,
        itens: aprovacoes.itens,
        retidasPorImpedimento: aprovacoes.retidas,
        truncado: aprovacoes.truncado,
        teto: TETO_APROVACOES,
      },
      tarefas: {
        estado: tarefas.estado,
        itens: tarefas.itens,
        truncado: tarefas.truncado,
        teto: TETO_TAREFAS,
        identidades: [],
        diasSemMovimento: DIAS_SEM_MOVIMENTO,
        horasPresa: HORAS_PRESA_COM_AGENTE,
      },
      conversa: {
        estado: conversa.estado,
        itens: conversa.itens,
        truncado: conversa.truncado,
        dias: DIAS_DE_CONVERSA,
        teto: TETO_CONVERSA,
      },
      /*
       * O TOTAL É O QUE ESPERA AÇÃO SUA, e é o MESMO número do contador da
       * casca — a mesma função monta os dois. Duas aritméticas para o mesmo
       * número é o defeito que a A3 acabou de pagar nas horas devolvidas, onde
       * `/agentes` e `/rotinas` publicavam versões contraditórias.
       *
       * A conversa NÃO entra: sem estado de lido, ela nunca sairia da conta.
       */
      total: aprovacoes.itens.length + tarefas.itens.length,
      /** Bateu num teto: o total é PISO, e a tela escreve "N+". */
      totalParcial: aprovacoes.truncado || tarefas.truncado,
      source: { tool: 'caixa-pessoal', generatedAt: agora.toISOString() },
    };
  }

  /* ====================================================================== *
   * O CONTADOR DA CASCA
   * ====================================================================== */

  /**
   * O número que a barra lateral mostra — DERIVADO da mesma montagem.
   *
   * Não há consulta própria e não há atalho por `count()`, e a razão é a lição
   * da A3: um `count` aqui contaria as aprovações que a porta recusaria hoje
   * (o impedimento não cabe em SQL), então o selo diria 4 e a tela mostraria 3.
   * O preço é uma montagem a mais por navegação — as consultas têm teto e
   * `conferirAprovado` é toda em memória.
   *
   * `comConversa: false` porque a conversa não entra na conta: é uma consulta
   * que o contador não precisa pagar.
   */
  async contar(pedido: Omit<PedidoDaCaixa, 'comConversa'>): Promise<CaixaContador> {
    const caixa = await this.montar({ ...pedido, comConversa: false });
    return {
      quantos: caixa.total,
      parcial: caixa.totalParcial,
      aprovacoes: caixa.aprovacoes.itens.length,
      tarefas: caixa.tarefas.itens.length,
      medidoEm: caixa.agora,
    };
  }

  /* ====================================================================== *
   * EU, SEGUNDO O BANCO
   * ====================================================================== */

  /**
   * Quem está olhando, relido do banco a cada chamada — nunca do token.
   *
   * O token vale oito horas: papel rebaixado, perfil trocado ou usuário
   * desativado só aparecem na releitura, e é a releitura que `confirm` faz. A
   * caixa lê da mesma fonte para dizer a mesma coisa.
   *
   * `undefined` = o token não corresponde a usuário ativo desta empresa
   * (sessão de quem saiu, token de empresa trocada). Aí não há alçada nenhuma,
   * não há identidade para procurar no quadro, e a caixa diz isso em vez de
   * mostrar uma caixa vazia com cara de vitória.
   */
  private async euNoBanco(orgId: string, usuarioId: string): Promise<EuNoBanco | undefined> {
    const u = await this.prisma.user.findFirst({
      where: { id: usuarioId, orgId, isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        roles: { select: { key: true, permissions: { select: { key: true } } } },
      },
    });
    if (!u) return undefined;
    return {
      id: u.id,
      nome: u.name,
      email: u.email,
      // `alcadaDe` devolve `null` para conta de máquina e para papel
      // desconhecido — as duas caem fora de "quem assina" sozinhas.
      alcada: alcadaDe(u.roles.map((r) => r.key)),
      decide: u.roles.some((r) => r.permissions.some((p) => p.key === DECIDIR_APROVACOES)),
    };
  }

  /** A empresa contratou o quadro? Pergunta com cache de 30s, feita uma vez. */
  private async quadroContratado(orgId: string): Promise<boolean> {
    const contratados = await this.modulos.modulosDaOrg(orgId);
    return contratados.has(MODULO_DO_QUADRO);
  }

  /* ====================================================================== *
   * EIXO 1 — as aprovações que EU assino
   * ====================================================================== */

  private async eixoDeAprovacoes(entrada: {
    orgId: string;
    agora: Date;
    eu: EuNoBanco | undefined;
    veAFila: boolean;
    decideNestaSessao: boolean;
  }): Promise<{
    estado: EstadoDoEixo;
    itens: CaixaAprovacao[];
    retidas: number;
    truncado: boolean;
  }> {
    const vazio = { itens: [] as CaixaAprovacao[], retidas: 0, truncado: false };
    const { orgId, agora, eu } = entrada;

    if (!eu) return { estado: ESTADO_DO_EIXO.foraDaCasa, ...vazio };
    if (!entrada.veAFila) return { estado: ESTADO_DO_EIXO.semPermissao, ...vazio };
    /*
     * "Acompanha a fila e não decide nela" é estado PRÓPRIO, e não `ok` com
     * lista vazia: as duas coisas desenhariam a mesma caixa cinza, e são
     * diferentes — a segunda é vitória, a primeira é uma permissão que falta.
     */
    if (!entrada.decideNestaSessao) return { estado: ESTADO_DO_EIXO.naoDecide, ...vazio };

    const alcancadas = alcadasAtendidasPor(eu.alcada);
    // Sem alçada nenhuma não há degrau alcançado: `IN ()` traria zero linhas, e
    // perguntar ao banco por isso é ida de graça.
    if (alcancadas.length === 0) return { estado: ESTADO_DO_EIXO.ok, ...vazio };

    const where: Prisma.ApprovalWhereInput = {
      orgId,
      status: ApprovalState.pendente,
      // Vencida não espera ninguém. A coluna `status` NÃO é atualizada por
      // agendador nenhum (dívida declarada na fila de aprovação: nada chama
      // `expirarVencidas`), então o prazo é conferido aqui, por cálculo.
      expiraEm: { gt: agora },
      // Invariante 7: quem propõe não assina.
      propostoPorId: { not: eu.id },
      alcadaMinima: { in: alcancadas },
    };

    const linhas = await this.prisma.approval.findMany({
      where,
      orderBy: { expiraEm: 'asc' },
      take: TETO_APROVACOES + 1,
      select: {
        id: true,
        resumo: true,
        nivelExigido: true,
        capabilityId: true,
        toolCallId: true,
        canal: true,
        alcadaMinima: true,
        exigeReauth: true,
        propostoPorId: true,
        propostoPorTipo: true,
        criadoEm: true,
        expiraEm: true,
      },
    });
    const truncado = linhas.length > TETO_APROVACOES;
    const pagina = truncado ? linhas.slice(0, TETO_APROVACOES) : linhas;

    /*
     * Os argumentos GRAVADOS, e eles NÃO SAEM daqui: entram só na pergunta que a
     * porta responde. O conteúdo exato de uma ação retida tem uma superfície
     * só neste repositório — `GET /approvals/fila`, e apenas para quem tem
     * `aprovacoes.decidir` (decisão do Pedro, registrada lá). Uma segunda
     * superfície devolvendo o corpo seria ampliar aquela exposição de fininho,
     * numa fatia que ninguém leu como sendo sobre isso.
     */
    const idsDeChamada = pagina.map((a) => a.toolCallId).filter((v): v is string => !!v);
    const chamadas = idsDeChamada.length
      ? await this.prisma.toolCall.findMany({
          where: { orgId, id: { in: idsDeChamada } },
          select: { id: true, args: true },
        })
      : [];
    const porChamada = new Map(chamadas.map((c) => [c.id, c]));

    /** Os proponentes que são GENTE — para trocar identificador por nome. */
    const idsDePessoa = pagina
      .filter((a) => a.propostoPorTipo === ActorType.user)
      .map((a) => a.propostoPorId);
    const pessoas = idsDePessoa.length
      ? await this.prisma.user.findMany({
          where: { orgId, id: { in: [...new Set(idsDePessoa)] } },
          select: { id: true, name: true },
        })
      : [];
    const porPessoa = new Map(pessoas.map((p) => [p.id, p.name]));

    const itens: CaixaAprovacao[] = [];
    let retidas = 0;
    for (const ap of pagina) {
      const chamada = ap.toolCallId ? porChamada.get(ap.toolCallId) : undefined;
      const impedida =
        chamada && ap.capabilityId
          ? this.aPortaRecusaria(orgId, ap.capabilityId, (chamada.args ?? {}) as Record<string, unknown>)
          : false;
      if (impedida) {
        // Fora da lista e fora da conta: ela não espera por você, espera por um
        // conserto. O número vai à tela com o caminho para `/atendimento`, que
        // é quem diz QUAL é o impedimento — e diz sem vazar valor de argumento
        // (as frases da porta carregam nome de campo, nunca conteúdo).
        retidas += 1;
        continue;
      }
      itens.push({
        id: ap.id,
        resumo: ap.resumo,
        nivel: ap.nivelExigido,
        capacidade: ap.capabilityId,
        canal: ap.canal,
        alcadaMinima: ap.alcadaMinima,
        exigeMotivo: exigeMotivo(ap.nivelExigido),
        exigeReauth: ap.exigeReauth,
        proponente:
          ap.propostoPorTipo === ActorType.user
            ? (porPessoa.get(ap.propostoPorId) ?? ap.propostoPorId)
            : 'agente',
        proponenteTipo: ap.propostoPorTipo,
        propostaEm: ap.criadoEm.toISOString(),
        expiraEm: ap.expiraEm.toISOString(),
        esperandoMs: agora.getTime() - ap.criadoEm.getTime(),
        venceEmMs: ap.expiraEm.getTime() - agora.getTime(),
      });
    }

    return { estado: ESTADO_DO_EIXO.ok, itens, retidas, truncado };
  }

  /**
   * A porta recusaria esta ação HOJE? — a mesma conferência da fila, reduzida
   * ao booleano que esta tela precisa.
   *
   * `conferirAprovado` não toca em nada (não chama efeito, não escreve, não
   * registra) e é toda em memória, então chamá-la uma vez por linha não custa
   * ida ao banco. Quem mostra a FRASE é `/atendimento`; aqui ela não é mostrada
   * de propósito — o texto da porta é útil ao lado do conteúdo que se vai
   * assinar, e a caixa não mostra conteúdo.
   */
  private aPortaRecusaria(
    orgId: string,
    capabilityId: string,
    args: Record<string, unknown>,
  ): boolean {
    try {
      this.gateway.conferirAprovado({ capabilityId, args, orgId });
      return false;
    } catch {
      return true;
    }
  }

  /* ====================================================================== *
   * EIXO 2 — as minhas tarefas paradas
   * ====================================================================== */

  private async eixoDeTarefas(entrada: {
    orgId: string;
    agora: Date;
    eu: EuNoBanco | undefined;
    podeVer: boolean;
    quadroLigado: boolean;
  }): Promise<{ estado: EstadoDoEixo; itens: CaixaTarefa[]; truncado: boolean }> {
    const vazio = { itens: [] as CaixaTarefa[], truncado: false };
    const { orgId, agora, eu } = entrada;

    if (!eu) return { estado: ESTADO_DO_EIXO.foraDaCasa, ...vazio };
    if (!entrada.podeVer) return { estado: ESTADO_DO_EIXO.semPermissao, ...vazio };
    if (!entrada.quadroLigado) return { estado: ESTADO_DO_EIXO.moduloDesligado, ...vazio };

    const linhas = await this.prisma.workTask.findMany({
      where: {
        orgId,
        archived: false,
        // Tarefa encerrada não espera ninguém. `closed` é o TIPO do status, e
        // não o nome: cada lista batiza o dela ("Concluído", "Publicado"), e
        // casar por nome é casar por português.
        status: { type: { not: 'closed' } },
        AND: [
          { assigneeUserId: eu.id },
          // Os MESMOS três cortes de `motivosDaParada`, no `WHERE` — filtrar em
          // memória depois do `take` esconderia a caixa de quem tem muito
          // trabalho em andamento, que é quem mais precisa dela.
          { OR: condicoesDeParada(agora) },
          // Lista ou pasta arquivada não espera ninguém (21/10/2026).
          tarefaDeListaVisivel(),
        ],
      },
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'asc' }],
      take: TETO_TAREFAS + 1,
      select: {
        id: true,
        title: true,
        priority: true,
        dueDate: true,
        updatedAt: true,
        agenteId: true,
        agenteEm: true,
        assignee: true,
        status: { select: { name: true, color: true } },
        list: { select: { name: true } },
      },
    });
    const truncado = linhas.length > TETO_TAREFAS;
    const pagina = truncado ? linhas.slice(0, TETO_TAREFAS) : linhas;

    /*
     * UMA consulta para todos os agentes, depois da lista — nunca uma por
     * tarefa, e nunca por `include`. Ver o cabeçalho de `agentes-da-casa.ts`:
     * `include: { agente: … }` traria o agente de qualquer empresa.
     */
    const agentes = await agentesDaCasa(
      this.prisma,
      orgId,
      pagina.map((t) => t.agenteId),
    );

    const itens: CaixaTarefa[] = pagina.map((t) => {
      const agente = t.agenteId ? (agentes.get(t.agenteId) ?? null) : null;
      return {
        id: t.id,
        titulo: t.title,
        lista: t.list?.name ?? null,
        status: t.status.name,
        statusCor: t.status.color,
        prioridade: t.priority,
        responsavel: t.assignee,
        prazo: t.dueDate?.toISOString() ?? null,
        atualizadaEm: t.updatedAt.toISOString(),
        agenteSlug: agente?.slug ?? null,
        // Ponteiro que não resolve vira `null`, e a tela diz "outro agente".
        // Inventar o nome é pior do que não dizer.
        agenteNome: agente?.nome ?? null,
        agenteDesde: t.agenteEm?.toISOString() ?? null,
        motivos: motivosDaParada(t, agora),
      };
    });

    return { estado: ESTADO_DO_EIXO.ok, itens, truncado };
  }

  /* ====================================================================== *
   * EIXO 3 — a conversa recente nas minhas tarefas
   * ====================================================================== */

  /**
   * NÃO É MENÇÃO, E A TELA DIZ ISSO COM ESSAS PALAVRAS.
   *
   * A fatia pedia "menções a mim em comentários do quadro". MENÇÃO NÃO EXISTE
   * COMO DADO neste produto: `WorkComment` tem autor e texto, e nada mais — sem
   * tabela de menção, sem convenção de `@nome` gravada em lugar nenhum, sem
   * estado de lido. Inventar tabela estava fora do que foi pedido, e varrer o
   * texto atrás do nome de alguém seria criar uma convenção por conta própria e
   * prometer notificação para quem escrever `@pedro` — promessa que nenhum outro
   * caminho do sistema cumpre.
   *
   * O que existe hoje, e é verdade: comentário de OUTRA pessoa numa tarefa em
   * que você é o responsável, na última semana. É menos do que menção e é
   * honesto. A tela publica exatamente essa frase, e o eixo fica FORA do
   * contador — porque sem estado de lido ele nunca zeraria.
   */
  private async eixoDeConversa(entrada: {
    orgId: string;
    agora: Date;
    eu: EuNoBanco | undefined;
    podeVer: boolean;
    quadroLigado: boolean;
  }): Promise<{ estado: EstadoDoEixo; itens: CaixaConversa[]; truncado: boolean }> {
    const vazio = { itens: [] as CaixaConversa[], truncado: false };
    const { orgId, agora, eu } = entrada;

    if (!eu) return { estado: ESTADO_DO_EIXO.foraDaCasa, ...vazio };
    if (!entrada.podeVer) return { estado: ESTADO_DO_EIXO.semPermissao, ...vazio };
    if (!entrada.quadroLigado) return { estado: ESTADO_DO_EIXO.moduloDesligado, ...vazio };

    const linhas = await this.prisma.workComment.findMany({
      where: {
        orgId,
        createdAt: { gte: corteDaConversa(agora) },
        // A conta e a empresa da tarefa são conferidas pelo mesmo vínculo da Caixa.
        task: { orgId, archived: false, assigneeUserId: eu.id },
      },
      orderBy: { createdAt: 'desc' },
      take: TETO_CONVERSA + 1,
      select: {
        id: true,
        text: true,
        authorId: true,
        authorName: true,
        createdAt: true,
        task: { select: { id: true, title: true } },
      },
    });

    /*
     * O comentário próprio é reconhecido apenas por authorId.
     * Texto importado sem ID não permite deduzir quem escreveu.
     *
     * O preço é o teto poder cortar depois da filtragem — daí `truncado` ser
     * medido pelo que o banco devolveu, que é a resposta conservadora: dizer
     * "há mais" quando talvez não haja é melhor que calar que há.
     */
    const truncado = linhas.length > TETO_CONVERSA;
    const itens: CaixaConversa[] = linhas
      .slice(0, TETO_CONVERSA)
      .filter((c) => ehDeOutraPessoa(c, { id: eu.id, name: eu.nome }))
      .map((c) => {
        const { trecho, truncado: cortado } = trechoDoComentario(c.text);
        return {
          id: c.id,
          tarefaId: c.task.id,
          tarefaTitulo: c.task.title,
          autor: c.authorName,
          trecho,
          trechoCortado: cortado,
          criadaEm: c.createdAt.toISOString(),
        };
      });

    return { estado: ESTADO_DO_EIXO.ok, itens, truncado };
  }
}
