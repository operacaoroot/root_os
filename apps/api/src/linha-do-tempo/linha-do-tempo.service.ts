import { Injectable } from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import type {
  LinhaDoTempoFiltros,
  LinhaDoTempoItem,
  LinhaDoTempoResposta,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogService } from '../gateway/event-log.service';
import { donosDaCasa } from '../agents/donos-da-casa';
import {
  CHAVES_DE_FAMILIA,
  FAMILIAS,
  JANELA_DOS_FILTROS,
  LIMITE_PADRAO,
  type FamiliaDeEvento,
  codificarCursor,
  limiteDaPagina,
  nomear,
  objetoDoEvento,
  prefixosDaFamilia,
  selo,
  temConteudo,
  tiposDaFamilia,
} from './narrativa';

export interface PedidoDaLinha {
  orgId: string;
  limite?: number;
  /** `seq` a partir da qual (exclusive) continuar, descendo. */
  antesDe?: bigint;
  agente?: string;
  tipo?: string;
  familia?: FamiliaDeEvento;
}

/**
 * A LEITURA NARRATIVA DO RASTRO — fatia A9.
 *
 * ---------------------------------------------------------------------------
 * A ÚNICA FONTE É O `EventLog`. Não há tabela nova.
 * ---------------------------------------------------------------------------
 * Este serviço só LÊ. Ele não tem nenhum caminho de escrita, nem indireto: não
 * injeta `EventLogService` para registrar coisa alguma — injeta para PERGUNTAR o
 * prazo de retenção da empresa (`diasDeRetencao`), que é o horizonte real da
 * tela. Se um dia alguém quiser gravar "a linha do tempo foi lida", isso é um
 * evento como outro qualquer e quem o grava é o registrador do rastro.
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO QUE ESTA ROTA NÃO REPETE
 * ---------------------------------------------------------------------------
 * A rota de listagem da MEMÓRIA não pagina e devolve o CORPO de cada nota: a
 * tela do mapa baixa o vault inteiro para desenhar dezenove pontos (o CLAUDE.md
 * registra isso como dívida aberta). O RASTRO é a tabela que MAIS cresce do
 * sistema — cada chamada de ferramenta deixa duas ou três linhas —, então a
 * mesma forma aqui seria pior em grau, não em espécie.
 *
 * Três defesas, e nenhuma é opcional:
 *  1. PAGINA POR CURSOR (`seq`), nunca por deslocamento. Ver `narrativa.ts`;
 *  2. PROJEÇÃO EXPLÍCITA no `select`, sem `payload` inteiro no corpo da
 *     resposta — o payload é LIDO para extrair identificadores e descartado;
 *  3. TETO DE PÁGINA (200) imposto no servidor, não pedido ao chamador.
 *
 * ---------------------------------------------------------------------------
 * NÃO AGRUPA POR DIA AQUI, E ISSO É DECISÃO
 * ---------------------------------------------------------------------------
 * "Hoje" depende do fuso de quem olha, e o container roda em UTC: agrupar no
 * servidor faria um evento das 21h de Brasília aparecer sob o cabeçalho do dia
 * seguinte. A API devolve a lista ORDENADA e o web agrupa no fuso do navegador
 * (`apps/web/src/app/linha-do-tempo/dias.ts`). O servidor não adivinha fuso, e
 * mandar o fuso na query só mudaria quem adivinha.
 */
@Injectable()
export class LinhaDoTempoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventLogService,
  ) {}

  async listar(pedido: PedidoDaLinha): Promise<LinhaDoTempoResposta> {
    const limite = limiteDaPagina(pedido.limite ?? LIMITE_PADRAO);
    const where = this.clausula(pedido);

    /*
     * `take: limite + 1` — a linha extra é como se sabe que há mais página sem
     * pagar um `count` na tabela que mais cresce. Ela é descartada da resposta;
     * o que sobra dela é o `proximoCursor`.
     */
    const linhas = await this.prisma.eventLog.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: limite + 1,
      select: {
        id: true,
        seq: true,
        tipo: true,
        actorType: true,
        actorId: true,
        agentSlug: true,
        capabilityId: true,
        nivel: true,
        correlationId: true,
        ocorreuEm: true,
        payload: true,
      },
    });

    const temMais = linhas.length > limite;
    const pagina = temMais ? linhas.slice(0, limite) : linhas;

    /*
     * O FILTRO POR FAMÍLIA `outro` ACONTECE AQUI, DEPOIS DE NOMEAR — e só ele.
     *
     * `outro` é definida por exclusão ("o dicionário não conhece e o prefixo não
     * resolve"), então não existe cláusula SQL que a expresse: a lista de tipos
     * que vão cair nela um dia não está escrita em lugar nenhum. Filtrar em
     * memória tem o preço conhecido de a página vir mais curta que o limite —
     * e a tela diz isso, porque o `proximoCursor` continua andando.
     *
     * Foi essa a escolha em vez de inventar uma cláusula "NOT IN (os 46 tipos
     * conhecidos)": ela ficaria correta hoje e silenciosamente errada no dia em
     * que alguém acrescentasse uma linha ao dicionário sem lembrar da consulta.
     */
    const nomeados = pagina.map((l) => ({ linha: l, nome: nomear(l.tipo) }));
    const visiveis =
      pedido.familia === 'outro' ? nomeados.filter((n) => n.nome.familia === 'outro') : nomeados;

    const [gente, agentes, retencaoDias] = await Promise.all([
      donosDaCasa(
        this.prisma,
        pedido.orgId,
        visiveis.filter((v) => v.linha.actorType === ActorType.user).map((v) => v.linha.actorId),
      ),
      this.agentesDaCasa(
        pedido.orgId,
        visiveis.map((v) => v.linha.agentSlug),
      ),
      this.eventos.diasDeRetencao(pedido.orgId).catch(() => this.eventos.retencaoPadrao()),
    ]);

    const itens: LinhaDoTempoItem[] = visiveis.map(({ linha, nome }) => {
      const marca = selo(linha.payload);
      return {
        id: linha.id,
        seq: linha.seq.toString(),
        tipo: linha.tipo,
        rotulo: nome.rotulo,
        familia: nome.familia,
        conhecido: nome.conhecido,
        ocorreuEm: linha.ocorreuEm.toISOString(),
        atorTipo: linha.actorType,
        atorId: linha.actorId,
        ator:
          linha.actorType === ActorType.user && linha.actorId
            ? (gente.get(linha.actorId)?.nome ?? null)
            : null,
        agenteSlug: linha.agentSlug,
        agenteNome: linha.agentSlug ? (agentes.get(linha.agentSlug) ?? null) : null,
        capacidade: linha.capabilityId,
        nivel: linha.nivel,
        correlacao: linha.correlationId,
        objeto: objetoDoEvento(linha.payload),
        sensibilidade: marca.sensibilidade,
        registroCompleto: marca.registroCompleto,
        temConteudo: temConteudo(linha.payload),
      };
    });

    /*
     * O CURSOR SAI DA ÚLTIMA LINHA LIDA DO BANCO, não do último item devolvido.
     *
     * A diferença aparece com o filtro `outro`: descartar itens em memória e
     * então apontar o cursor para o último SOBREVIVENTE faria a próxima página
     * reler tudo o que foi descartado, para descartar de novo — laço que nunca
     * termina numa empresa cujos eventos são todos conhecidos.
     */
    const ultima = pagina[pagina.length - 1];
    const proximoCursor = temMais && ultima ? codificarCursor(ultima.seq) : null;

    return {
      itens,
      proximoCursor,
      filtros: pedido.antesDe === undefined ? await this.filtros(pedido.orgId) : null,
      retencaoDias,
      source: { tool: 'rastro', generatedAt: new Date().toISOString() },
    };
  }

  // -------------------------------------------------------------------------
  // A cláusula
  // -------------------------------------------------------------------------

  private clausula(pedido: PedidoDaLinha): Prisma.EventLogWhereInput {
    const where: Prisma.EventLogWhereInput = { orgId: pedido.orgId };
    if (pedido.antesDe !== undefined) where.seq = { lt: pedido.antesDe };
    if (pedido.agente) where.agentSlug = pedido.agente;
    if (pedido.tipo) where.tipo = pedido.tipo;

    /*
     * FAMÍLIA = tipos declarados OU prefixo da família. As duas metades: sem a
     * primeira, o filtro perde os tipos que só o dicionário conhece; sem a
     * segunda, perde os que o dicionário não conhece e caem na família pelo
     * prefixo (`pauta.ficha_gerada`). `outro` não entra na cláusula — ver
     * `listar`.
     *
     * `tipo` explícito VENCE a família (o `AND` é implícito no Prisma quando as
     * duas chaves coexistem, e `tipo` já foi posto acima): pedir tipo e família
     * juntos é pedir a interseção, e a resposta vazia é a verdade quando o tipo
     * não pertence à família.
     */
    if (pedido.familia && pedido.familia !== 'outro') {
      const tipos = tiposDaFamilia(pedido.familia) ?? [];
      const prefixos = prefixosDaFamilia(pedido.familia);
      const alternativas: Prisma.EventLogWhereInput[] = [];
      if (tipos.length) alternativas.push({ tipo: { in: tipos } });
      for (const p of prefixos) alternativas.push({ tipo: { startsWith: `${p}.` } });
      if (alternativas.length) where.OR = alternativas;
    }
    return where;
  }

  // -------------------------------------------------------------------------
  // As contagens que alimentam os filtros da tela
  // -------------------------------------------------------------------------

  /**
   * Quem apareceu e o que apareceu, para a tela poder oferecer filtro.
   *
   * VARREDURA LIMITADA, E A TELA DIZ QUE É. `JANELA_DOS_FILTROS` corta a
   * contagem nos N eventos mais recentes; `parcial` fica verdadeiro quando o
   * corte pegou. A alternativa — `groupBy` sobre a tabela inteira — é uma
   * varredura completa do RASTRO a cada abertura de tela, na tabela que mais
   * cresce, para preencher um `<select>`. Número parcial DITO é honesto;
   * varredura completa escondida é a conta que ninguém vê até o cliente grande.
   *
   * Calculada só na PRIMEIRA página. Ver `LinhaDoTempoResposta.filtros`.
   */
  private async filtros(orgId: string): Promise<LinhaDoTempoFiltros> {
    const amostra = await this.prisma.eventLog.findMany({
      where: { orgId },
      orderBy: { seq: 'desc' },
      take: JANELA_DOS_FILTROS,
      select: { tipo: true, agentSlug: true },
    });

    const porTipo = new Map<string, number>();
    const porAgente = new Map<string, number>();
    const porFamilia = new Map<FamiliaDeEvento, number>();

    for (const { tipo, agentSlug } of amostra) {
      porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + 1);
      const familia = nomear(tipo).familia;
      porFamilia.set(familia, (porFamilia.get(familia) ?? 0) + 1);
      if (agentSlug) porAgente.set(agentSlug, (porAgente.get(agentSlug) ?? 0) + 1);
    }

    const nomesDeAgente = await this.agentesDaCasa(orgId, [...porAgente.keys()]);

    const tipos = [...porTipo.entries()]
      .map(([tipo, eventos]) => {
        const nome = nomear(tipo);
        return { tipo, rotulo: nome.rotulo, conhecido: nome.conhecido, eventos };
      })
      .sort((a, b) => b.eventos - a.eventos || a.tipo.localeCompare(b.tipo));

    return {
      agentes: [...porAgente.entries()]
        .map(([slug, eventos]) => ({ slug, nome: nomesDeAgente.get(slug) ?? null, eventos }))
        .sort((a, b) => b.eventos - a.eventos || a.slug.localeCompare(b.slug)),
      // Na ordem declarada em `FAMILIAS`, não por volume: o filtro é um menu, e
      // menu que muda de ordem a cada carga faz a pessoa procurar duas vezes.
      familias: CHAVES_DE_FAMILIA.filter((c) => porFamilia.has(c)).map((c) => ({
        chave: c,
        rotulo: FAMILIAS[c].rotulo,
        eventos: porFamilia.get(c)!,
      })),
      tipos,
      desconhecidos: tipos.filter((t) => !t.conhecido).length,
      janela: amostra.length,
      parcial: amostra.length >= JANELA_DOS_FILTROS,
    };
  }

  // -------------------------------------------------------------------------
  // Os nomes, escopados NA EMPRESA
  // -------------------------------------------------------------------------

  /**
   * Slug -> nome do agente, só de agentes DESTA empresa.
   *
   * O escopo é explícito pela mesma razão de `agents/donos-da-casa.ts`:
   * `Agent.slug` não é único globalmente (a unicidade é por empresa), então uma
   * busca por slug sem `orgId` traz o agente homônimo de outro cliente e a tela
   * publica o nome dele. Slug que não resolve fica NULO e o web mostra o slug
   * cru — que é a verdade ("este agente não é mais desta casa") e a única
   * resposta segura.
   */
  private async agentesDaCasa(
    orgId: string,
    slugs: (string | null)[],
  ): Promise<Map<string, string>> {
    const unicos = [...new Set(slugs.filter((s): s is string => !!s))];
    if (unicos.length === 0) return new Map();
    const linhas = await this.prisma.agent.findMany({
      where: { orgId, slug: { in: unicos } },
      select: { slug: true, nome: true },
    });
    return new Map(linhas.map((a) => [a.slug, a.nome]));
  }
}
