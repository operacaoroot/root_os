import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type PautaPublicacao } from '@prisma/client';
import {
  INSTAGRAM_ESCOPO_DE_PUBLICAR,
  apelidoDoEpisodio,
  PAUTA_CAPACIDADE_DE_PUBLICAR_NO_INSTAGRAM,
  PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA,
  PAUTA_JANELA_DA_PUBLICACAO_MS,
  PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG,
  type PautaPublicacaoDaPeca,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decifrar } from '../common/crypto';
import { correlacaoAtual } from '../common/contexto-execucao';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { InterruptoresRegistry } from '../gateway/interruptores.registry';
import { PortaDoOperador, type AcaoRetida } from '../gateway/porta-do-operador.service';
import { MemoriaService } from '../memory/memoria.service';
import { GRAPH_DE_PUBLICACAO, semResposta, type ContainerDaGraph, type GraphDePublicacao } from './graph-de-publicacao';
import { assinar, origemDaMidiaPublica, rastroDoToken, segredoDaMidiaPublica } from './midia-publica';
import { ehPecaDaSemana, lerMetaDaSemana } from './derivacao-do-episodio';
import {
  CHAMADAS_DA_ROTINA,
  ESPERA_DA_CONFIRMACAO_MS,
  ESTADOS_EM_CURSO,
  ESTADOS_QUE_COMECAM,
  INTERVALO_DO_STATUS_MS,
  argsDaPublicacao,
  containerVencido,
  decisaoDaRotina,
  esperaEsgotada,
  lerArgsDaPublicacao,
  lerContainers,
  motivoParaNaoPublicar,
  mudouDesdeOPedido,
  passoDoStatus,
  posseAte,
  postDoContainer,
  publicacaoParaATela,
  type ArgsDaPublicacao,
  type ContaParaPublicar,
  type ContainersGravados,
  type PecaParaPublicar,
} from './publicacao-instagram';

const CAPACIDADE = PAUTA_CAPACIDADE_DE_PUBLICAR_NO_INSTAGRAM;
const REDE = 'instagram' as const;
/** O que o RASTRO chama cada passo da publicação. */
export const ACAO_DO_PASSO = 'pauta.publicacao_passo';
/** Quem age na rotina quando não há aprovação por trás (o horário, a janela perdida). */
export const ATOR_DA_ROTINA = 'rotina';
/** Quantas publicações a rotina toca por passagem, somando concluir e olhar o horário. */
export const TETO_POR_PASSAGEM = 3;
/** De onde o pedido reabre: `pendente` (pedido novo passa por cima), `erro` e `recusada` (voltou ao manual). */
const ESTADOS_QUE_REABREM: PautaPublicacao['estado'][] = ['pendente', 'erro', 'recusada'];

const MIDIA_PUBLICA_DESLIGADA =
  'A URL pública da mídia está desligada (PAUTA_MIDIA_PUBLICA_SEGREDO e a origem): a Meta não teria de onde baixar. Nada foi enviado.';

const DA_PECA = { id: true, canal: true, formato: true, status: true, corpo: true, meta: true, agendadaPara: true } as const;

/** O resultado do efeito e da conclusão: onde a publicação ficou. */
export interface DesfechoDaPublicacao {
  estado: PautaPublicacao['estado'];
  externalId: string | null;
  permalink: string | null;
  erro: string | null;
}

/** Uma linha da passagem da rotina, para o histórico (só apelido, formato e desfecho). */
export interface LinhaDaPassagem {
  rotulo: string;
  resultado: 'publicada' | 'processando' | 'erro' | 'pulada' | 'pendente' | 'interruptor';
  detalhe: string | null;
}

/**
 * A quem pertence cada passo no RASTRO: quem aprovou e a correlação da chamada
 * aprovada, também quando é a rotina que termina o Reels — aí a correlação da
 * passagem vai à parte, em `correlacaoDaRotina`.
 */
interface Trilha {
  ator: string;
  correlationId: string | null;
  approvalId: string | null;
  correlacaoDaRotina?: string | null;
}

class PublicacaoRecusada extends BadRequestException {}

/**
 * As publicações de um punhado de peças, como a tela as recebe. O `pendente`
 * cuja aprovação venceu, foi recusada ou sumiu chega como `erro` com o motivo
 * (`pedidoMorto`): a linha não volta sozinha, e a tela oferece pedir de novo.
 */
export async function publicacoesParaATela(
  prisma: PrismaService,
  orgId: string,
  pecaIds: string[],
  agora: Date = new Date(),
): Promise<Map<string, PautaPublicacaoDaPeca>> {
  if (!pecaIds.length) return new Map();
  const linhas = await prisma.pautaPublicacao.findMany({ where: { orgId, rede: REDE, pecaId: { in: pecaIds } } });
  const esperando = linhas.filter((l) => l.estado === 'pendente' && l.approvalId).map((l) => l.approvalId!);
  const aprovacoes = esperando.length
    ? await prisma.approval.findMany({ where: { orgId, id: { in: esperando } }, select: { id: true, status: true, expiraEm: true } })
    : [];
  const porId = new Map(aprovacoes.map((a) => [a.id, a]));
  return new Map(linhas.map((l) => [l.pecaId, publicacaoParaATela(l, l.approvalId ? (porId.get(l.approvalId) ?? null) : undefined, agora)]));
}

/*
 * ============================================================================
 * O PUBLICADOR DO INSTAGRAM (MD6)
 * ============================================================================
 *
 * A primeira escrita pública automática do OS, e por isso cada peça dela passa
 * pela régua como qualquer outra escrita de fora:
 *
 *   · O PEDIDO (`pedir`, "Publicar agora" na aba Semana) monta os argumentos do
 *     catálogo a partir da peça aprovada e os entrega à `PortaDoOperador`. A
 *     capacidade `instagram.post.publicar` é R3: a porta retém e devolve
 *     `precisaDeOutraPessoa`. Quem clicou não confirma.
 *   · O EFEITO (`efeito`) é inscrito no `EfeitosRegistry` e só roda quando a
 *     porta o dispara — depois da confirmação em /atendimento. Ele relê a peça
 *     e recusa se o conteúdo mudou desde o pedido ou se a aprovação é de um
 *     pedido antigo, cria os containers com as URLs assinadas da MD4 e publica
 *     quando o status já é FINISHED.
 *   · A CONCLUSÃO (`concluir`, pela rotina `pauta.publicar-agendadas`) termina
 *     o Reels que a Meta ainda processava: status uma vez por minuto por até 5
 *     minutos, o limite de 100 posts em 24 h, o publish e o permalink. Não pede
 *     nova aprovação — a aprovação cobriu o container criado com os argumentos
 *     conferidos —, mas pergunta ao interruptor do conector antes de sair.
 *
 * A POSSE: quem trabalha numa linha a caminho grava `proximaEm` no futuro (o
 * prazo cobre as chamadas que ainda vai fazer), e a rotina só pega linha com a
 * posse vencida, tomando-a com um `updateMany` condicionado ao `proximaEm` que
 * leu. Toda escrita do dono é condicionada à posse dele; se ela der 0, outro a
 * levou e ele para. Assim o tique de cada minuto não disputa com o efeito que
 * ainda cria os containers ou espera o publish.
 *
 * NUNCA PUBLICA DUAS VEZES O MESMO CONTAINER: a marca `publicandoEm` vai ao
 * banco antes do `media_publish`, e com ela presente a máquina só relê o status
 * — `PUBLISHED` recupera o id; `FINISHED` espera a confirmação por até 10 min e
 * então vira erro que manda conferir no Instagram. Um pedido novo depois disso
 * relê o container antigo antes de criar outro.
 *
 * O cliente da Graph chega por injeção (`GRAPH_DE_PUBLICACAO`) — ver
 * `graph-de-publicacao.ts`: o HTTP mora no conector da bio.
 */
@Injectable()
export class PublicacaoInstagramService implements OnModuleInit {
  private readonly log = new Logger('PublicacaoInstagram');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly efeitos: EfeitosRegistry,
    private readonly interruptores: InterruptoresRegistry,
    private readonly porta: PortaDoOperador,
    private readonly memoria: MemoriaService,
    @Inject(GRAPH_DE_PUBLICACAO) private readonly graph: GraphDePublicacao,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar({
      'instagram.post.publicar': (a: Record<string, unknown>, org: string, ctx: ContextoDoEfeito) =>
        this.efeito(a, org, ctx),
    }, 'PublicacaoInstagramService');
  }

  // ------------------------------------------------------------------ leitura

  private async contaDe(orgId: string): Promise<(ContaParaPublicar & { tokenCifrado: string }) | null> {
    const c = await this.prisma.bioConexao.findFirst({
      where: { orgId, plataforma: 'instagram', finalidade: 'publicacao' },
      select: { externalId: true, handle: true, escopos: true, status: true, tokenCifrado: true },
    });
    if (!c) return null;
    const escopos = (c.escopos ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return { externalId: c.externalId, handle: c.handle, escopos, status: c.status, tokenCifrado: c.tokenCifrado };
  }

  private async pecaDe(orgId: string, pecaId: string): Promise<PecaParaPublicar> {
    const p = (await this.prisma.pautaPeca.findFirst({ where: { id: pecaId, orgId }, select: DA_PECA })) as PecaParaPublicar | null;
    if (!p) throw new NotFoundException('Peça não encontrada.');
    return p;
  }

  /** `GET /pauta/pecas/:id/publicacao`: a publicação no Instagram, ou nulo. */
  async daPeca(orgId: string, pecaId: string): Promise<PautaPublicacaoDaPeca | null> {
    return (await publicacoesParaATela(this.prisma, orgId, [pecaId])).get(pecaId) ?? null;
  }

  // ------------------------------------------------------------------ o pedido

  /**
   * "Publicar agora": confere a peça, monta os argumentos e entrega à porta.
   * R3 → retido, à espera de outra pessoa. A publicação fica `pendente` com a
   * aprovação que a espera, para a tela dizer onde ela está.
   */
  async pedir(orgId: string, pecaId: string, actorId: string): Promise<AcaoRetida | DesfechoDaPublicacao | unknown> {
    const peca = await this.pecaDe(orgId, pecaId);
    const conta = await this.contaDe(orgId);
    const motivo = motivoParaNaoPublicar(peca, conta, INSTAGRAM_ESCOPO_DE_PUBLICAR);
    if (motivo) throw new BadRequestException(motivo);
    // Antes da fila: sem a origem da mídia a aprovação seria queimada à toa.
    if (!segredoDaMidiaPublica() || !origemDaMidiaPublica()) throw new ServiceUnavailableException(MIDIA_PUBLICA_DESLIGADA);
    const atual = await this.prisma.pautaPublicacao.findFirst({ where: { orgId, pecaId, rede: REDE }, select: { estado: true } });
    if (atual?.estado === 'publicada') throw new ConflictException('Esta peça já foi publicada pelo OS.');
    if (atual && ESTADOS_EM_CURSO.includes(atual.estado)) {
      throw new ConflictException('A publicação desta peça já está a caminho: espere a Meta terminar.');
    }

    const args = argsDaPublicacao(peca, conta!);
    const r = await this.porta.executar({
      orgId,
      actorId,
      capabilityId: CAPACIDADE,
      args: args as unknown as Record<string, unknown>,
      resource: { type: CAPACIDADE, id: pecaId },
    });

    if (ehRetida(r)) {
      if (!(await this.abrirPendente(orgId, pecaId, r.approvalId))) {
        // A aprovação criada agora fica na fila, mas o efeito a recusa: a linha não aponta para ela.
        throw new ConflictException('A publicação desta peça mudou enquanto o pedido saía (outra aprovação a levou): recarregue. Este pedido não publica.');
      }
      await this.passo(orgId, pecaId, { ator: actorId, correlationId: correlacaoAtual() ?? null, approvalId: r.approvalId }, 'pedido', { nivel: r.nivel });
    }
    return r;
  }

  /** A linha `pendente` do pedido novo: cria, ou reabre só de onde se pede de novo. */
  private async abrirPendente(orgId: string, pecaId: string, approvalId: string): Promise<boolean> {
    try {
      await this.prisma.pautaPublicacao.create({ data: { pecaId, rede: REDE, estado: 'pendente', approvalId } });
      return true;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    const { count } = await this.prisma.pautaPublicacao.updateMany({
      where: { orgId, pecaId, rede: REDE, estado: { in: ESTADOS_QUE_REABREM } },
      data: { estado: 'pendente', approvalId, erro: null, proximaEm: null },
    });
    return count === 1;
  }

  /**
   * "Voltar ao manual": a publicação sai das mãos do OS. A rotina não a toca
   * mais, e a aprovação que esperava na fila, confirmada depois, não publica:
   * o efeito não começa de `recusada` e, depois de um pedido novo, recusa toda
   * aprovação que não seja a do pedido gravado na linha.
   */
  async voltarAoManual(orgId: string, pecaId: string, actorId: string): Promise<PautaPublicacaoDaPeca> {
    const p = await this.prisma.pautaPublicacao.findFirst({ where: { orgId, pecaId, rede: REDE } });
    if (!p) throw new NotFoundException('Esta peça não tem publicação pelo OS.');
    if (p.estado === 'publicada') throw new ConflictException('Esta peça já foi publicada pelo OS.');
    if (p.estado === 'recusada') return publicacaoParaATela(p);
    const { count } = await this.prisma.pautaPublicacao.updateMany({
      where: { id: p.id, orgId, estado: p.estado },
      data: { estado: 'recusada', erro: 'de volta ao fluxo manual', proximaEm: null },
    });
    if (count !== 1) throw new ConflictException('A publicação mudou enquanto isso: recarregue.');
    await this.passo(orgId, pecaId, { ator: actorId, correlationId: correlacaoAtual() ?? null, approvalId: p.approvalId }, 'manual', { de: p.estado });
    return publicacaoParaATela({ ...p, estado: 'recusada', erro: 'de volta ao fluxo manual', proximaEm: null, atualizadaEm: new Date() });
  }

  // ------------------------------------------------------------------ o efeito

  /**
   * O efeito de `instagram.post.publicar`, disparado pela porta depois da
   * aprovação. Os argumentos são os GRAVADOS na proposta (a porta já conferiu
   * que batem com o que foi assinado); aqui se confere que a peça de agora
   * ainda é aquela. Terminar em `erro` LANÇA: a porta registra `acao.falhou`
   * e quem confirmou vê o motivo, em vez de "executado" sem nada no ar.
   */
  async efeito(a: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<DesfechoDaPublicacao> {
    const assinado = lerArgsDaPublicacao(a);
    if (!assinado) throw new BadRequestException('Argumentos da publicação fora da forma do catálogo.');
    const trilha: Trilha = { ator: ctx.actorId ?? ATOR_DA_ROTINA, correlationId: ctx.correlationId ?? null, approvalId: null };

    const peca = await this.pecaDe(orgId, assinado.pecaId);
    const conta = await this.contaDe(orgId);

    const jaTem = await this.prisma.pautaPublicacao.findFirst({ where: { orgId, pecaId: peca.id, rede: REDE } });
    if (jaTem?.estado === 'publicada') return desfecho(jaTem);

    trilha.approvalId = ctx.approvalId ?? (await this.aprovacaoConsumida(orgId, peca.id));
    // A aprovação de um pedido antigo (houve outro pedido depois, ou a peça
    // voltou ao manual e foi pedida de novo) não publica, nem mexe na linha.
    if (jaTem?.approvalId && trilha.approvalId && jaTem.approvalId !== trilha.approvalId) {
      await this.passo(orgId, peca.id, trilha, 'recusada', { motivo: 'aprovação de um pedido antigo', daLinha: jaTem.approvalId });
      throw new PublicacaoRecusada('Esta aprovação é de um pedido antigo desta peça (depois dela houve outro pedido): nada foi publicado.');
    }

    const recusar = async (motivo: string): Promise<never> => {
      await this.garantirLinha(peca.id);
      await this.gravar(orgId, peca.id, { estado: 'recusada', erro: motivo.slice(0, 500), proximaEm: null }, ESTADOS_QUE_COMECAM);
      await this.passo(orgId, peca.id, trilha, 'recusada', { motivo });
      throw new PublicacaoRecusada(`${motivo} Nada foi publicado; peça de novo se ainda for para sair.`);
    };

    const motivo = motivoParaNaoPublicar(peca, conta, INSTAGRAM_ESCOPO_DE_PUBLICAR);
    if (motivo) return recusar(motivo);
    const mudou = mudouDesdeOPedido(assinado, argsDaPublicacao(peca, conta!));
    if (mudou) return recusar(`A peça não é mais a que foi aprovada: ${mudou}.`);

    const segredo = segredoDaMidiaPublica();
    const origem = origemDaMidiaPublica();
    if (!segredo || !origem) {
      await this.garantirLinha(peca.id);
      await this.gravar(orgId, peca.id, { estado: 'erro', erro: MIDIA_PUBLICA_DESLIGADA, proximaEm: null }, ESTADOS_QUE_COMECAM);
      await this.passo(orgId, peca.id, trilha, 'erro', { etapa: 'midia_publica', erro: MIDIA_PUBLICA_DESLIGADA });
      throw new ServiceUnavailableException(MIDIA_PUBLICA_DESLIGADA);
    }

    const token = decifrar(conta!.tokenCifrado);

    // O publish anterior desta peça ficou sem confirmação: antes de criar outro
    // container, pergunta à Meta se aquele saiu. Saiu → é este o post.
    const anterior = jaTem ? lerContainers(jaTem.containers) : null;
    if (jaTem && anterior?.publicandoEm && anterior.final && ESTADOS_QUE_COMECAM.includes(jaTem.estado)) {
      let codigo: string;
      try {
        codigo = (await this.graph.statusDoContainer(token, anterior.final)).codigo;
      } catch (e) {
        throw new ServiceUnavailableException(
          `Não deu para conferir na Meta se o post anterior desta peça saiu (${(e as Error).message}): nada foi enviado. Peça de novo em alguns minutos.`,
        );
      }
      if (passoDoStatus(codigo) === 'ja_publicado') return this.recuperar(orgId, peca.id, anterior, assinado, token, trilha);
    }

    // O pedido toma a publicação: só de `pendente` ou `erro`, e com a posse
    // pelo tempo de criar os containers e publicar. Outra aprovação confirmada
    // da mesma peça, em corrida, perde aqui e não cria outro post.
    await this.garantirLinha(peca.id);
    const posse = posseAte(new Date(), assinado.midias.length + CHAMADAS_DA_ROTINA);
    const inicio: ContainersGravados = {
      legenda: assinado.legenda,
      aprovadoPor: trilha.ator,
      ...(trilha.correlationId ? { correlacao: trilha.correlationId } : {}),
    };
    const tomada = await this.prisma.pautaPublicacao.updateMany({
      where: { orgId, pecaId: peca.id, rede: REDE, estado: { in: [...ESTADOS_QUE_COMECAM] } },
      data: {
        estado: 'container_criado',
        containers: inicio as Prisma.InputJsonValue,
        erro: null,
        proximaEm: posse,
        tentativas: { increment: 1 },
        approvalId: trilha.approvalId,
      },
    });
    if (tomada.count !== 1) {
      const agora = await this.prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId, pecaId: peca.id, rede: REDE } });
      if (agora.estado === 'publicada') return desfecho(agora);
      if (agora.estado === 'recusada') {
        throw new PublicacaoRecusada('A publicação desta peça voltou ao fluxo manual: nada foi publicado. Peça de novo se ainda for para sair.');
      }
      throw new ConflictException('A publicação desta peça já está a caminho (outra aprovação a levou): nada foi enviado de novo.');
    }

    const agora = Math.floor(Date.now() / 1000);
    const exp = agora + PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG;
    const urls = assinado.midias.map((m) => {
      const t = assinar({ orgId, pecaId: peca.id, chave: m.chave, exp }, segredo, agora);
      return { url: `${origem}/api/midia-publica/${t}`, hmac: rastroDoToken(t) };
    });

    const containers: ContainersGravados = { ...inicio };
    try {
      if (assinado.formato === 'carrossel') {
        containers.itens = [];
        for (const u of urls) {
          containers.itens.push(await this.graph.criarContainer(token, assinado.igUserId, { image_url: u.url, is_carousel_item: true }));
        }
        containers.final = await this.graph.criarContainer(token, assinado.igUserId, {
          media_type: 'CAROUSEL',
          children: containers.itens,
          caption: assinado.legenda,
        });
      } else {
        const c: ContainerDaGraph =
          assinado.formato === 'story'
            ? { media_type: 'STORIES', image_url: urls[0].url }
            : { media_type: 'REELS', video_url: urls[0].url, caption: assinado.legenda, share_to_feed: true };
        containers.final = await this.graph.criarContainer(token, assinado.igUserId, c);
      }
      containers.criadoEm = new Date().toISOString();
    } catch (e) {
      const erro = `A Meta recusou o container: ${(e as Error).message}`;
      await this.gravar(orgId, peca.id, { estado: 'erro', erro: erro.slice(0, 500), containers: containers as Prisma.InputJsonValue, proximaEm: null }, ['container_criado'], posse);
      await this.passo(orgId, peca.id, trilha, 'erro', { etapa: 'container', erro: erro.slice(0, 300), itens: containers.itens?.length ?? 0 });
      throw new BadRequestException(`${erro} Nada foi publicado.`);
    }

    const gravados = await this.gravar(orgId, peca.id, { containers: containers as Prisma.InputJsonValue }, ['container_criado'], posse);
    if (gravados !== 1) {
      await this.passo(orgId, peca.id, trilha, 'posse_perdida', { etapa: 'container', final: containers.final });
      throw new ConflictException('A publicação desta peça mudou enquanto os containers eram criados: esta aprovação não publicou nada. Confira a aba Semana.');
    }
    await this.passo(orgId, peca.id, trilha, 'container', {
      formato: assinado.formato,
      itens: containers.itens?.length ?? 0,
      final: containers.final,
      hmac: urls.map((u) => u.hmac),
    });

    const linha = await this.prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId, pecaId: peca.id, rede: REDE } });
    const d = await this.avancar(orgId, linha, assinado, token, trilha);
    if (d.estado === 'erro') throw new BadRequestException(d.erro ?? 'A publicação caiu em erro: nada foi publicado.');
    return d;
  }

  /** A linha da publicação, sem mexer na que já existe. */
  private async garantirLinha(pecaId: string): Promise<void> {
    await this.prisma.pautaPublicacao.upsert({
      where: { pecaId_rede: { pecaId, rede: REDE } },
      create: { pecaId, rede: REDE, estado: 'pendente' },
      update: {},
    });
  }

  // ------------------------------------------------------------------ a máquina

  /**
   * Um passo da máquina a partir do status do container: publica se FINISHED,
   * espera se IN_PROGRESS, recupera se já PUBLISHED, cai em erro ou volta a
   * pendente se venceu. É o mesmo passo para o efeito e para a rotina, e quem
   * chama já tomou a linha: `linha.proximaEm` é a posse, e toda escrita daqui
   * é condicionada a ela.
   */
  private async avancar(
    orgId: string,
    linha: PautaPublicacao,
    args: Pick<ArgsDaPublicacao, 'igUserId' | 'legenda' | 'formato'>,
    token: string,
    trilha: Trilha,
  ): Promise<DesfechoDaPublicacao> {
    const c = lerContainers(linha.containers);
    const posse = linha.proximaEm;
    const agora = new Date();
    const emCurso = [...ESTADOS_EM_CURSO];
    const daquiAUmMinuto = new Date(agora.getTime() + INTERVALO_DO_STATUS_MS);
    if (!c.final) {
      return this.falhar(orgId, linha.pecaId, 'A publicação foi interrompida antes de o container existir: peça de novo.', trilha, emCurso, posse);
    }
    if (containerVencido(c, agora) && !c.publicandoEm) return this.vencer(orgId, linha.pecaId, trilha, posse);

    let status: { codigo: string; detalhe: string | null };
    try {
      status = await this.graph.statusDoContainer(token, c.final);
    } catch (e) {
      // Sem status não se decide nada: a rotina tenta de novo no minuto seguinte.
      await this.gravar(orgId, linha.pecaId, { proximaEm: daquiAUmMinuto, erro: (e as Error).message.slice(0, 500) }, emCurso, posse);
      await this.passo(orgId, linha.pecaId, trilha, 'status_sem_resposta', { erro: (e as Error).message.slice(0, 300) });
      return { estado: linha.estado, externalId: null, permalink: null, erro: (e as Error).message };
    }

    const passo = passoDoStatus(status.codigo);
    if (passo === 'ja_publicado') return this.recuperar(orgId, linha.pecaId, c, args, token, trilha);
    if (passo === 'vencido' || containerVencido(c, agora)) return this.vencer(orgId, linha.pecaId, trilha, posse);
    if (passo === 'erro') {
      return this.falhar(orgId, linha.pecaId, `A Meta não processou a mídia (${status.codigo || 'sem status'}${status.detalhe ? `: ${status.detalhe}` : ''}).`, trilha, emCurso, posse);
    }

    // O publish deste container já foi tentado e a Meta ainda não o dá por
    // publicado: só se relê. Publicar de novo às cegas é o post duplicado.
    if (c.publicandoEm) {
      if (agora.getTime() - Date.parse(c.publicandoEm) >= ESPERA_DA_CONFIRMACAO_MS) {
        return this.falhar(
          orgId,
          linha.pecaId,
          'A Meta não confirmou se o post saiu (a resposta do publish se perdeu e o container segue sem publicar há 10 min): confira no Instagram antes de pedir de novo.',
          trilha,
          emCurso,
          posse,
        );
      }
      await this.gravar(orgId, linha.pecaId, { estado: 'container_criado', proximaEm: daquiAUmMinuto }, emCurso, posse);
      await this.passo(orgId, linha.pecaId, trilha, 'confirmando', { status: status.codigo });
      return { estado: 'container_criado', externalId: null, permalink: null, erro: null };
    }

    if (passo === 'esperar') {
      if (esperaEsgotada(c, agora)) {
        return this.falhar(orgId, linha.pecaId, 'A Meta não terminou de processar o vídeo em 5 minutos.', trilha, emCurso, posse);
      }
      await this.gravar(orgId, linha.pecaId, { estado: 'processando', proximaEm: daquiAUmMinuto, tentativas: { increment: 1 } }, emCurso, posse);
      await this.passo(orgId, linha.pecaId, trilha, 'processando', { status: status.codigo });
      return { estado: 'processando', externalId: null, permalink: null, erro: null };
    }

    // FINISHED: o limite de 100 posts em 24 h, e só então o publish.
    try {
      const limite = await this.graph.limiteDePublicacao(token, args.igUserId);
      if (limite.usado >= limite.teto) {
        return this.falhar(orgId, linha.pecaId, `A conta já publicou ${limite.usado} de ${limite.teto} posts pela API em 24 h: nada foi publicado.`, trilha, emCurso, posse);
      }
    } catch (e) {
      await this.gravar(orgId, linha.pecaId, { estado: 'container_criado', proximaEm: daquiAUmMinuto, erro: (e as Error).message.slice(0, 500) }, emCurso, posse);
      await this.passo(orgId, linha.pecaId, trilha, 'limite_sem_resposta', { erro: (e as Error).message.slice(0, 300) });
      return { estado: 'container_criado', externalId: null, permalink: null, erro: (e as Error).message };
    }

    // A marca ANTES de chamar, tomada com a posse: só quem a leva publica, e
    // depois dela ninguém chama `media_publish` neste container de novo.
    const posseDoPublish = posseAte(new Date(), CHAMADAS_DA_ROTINA);
    const marca = await this.prisma.pautaPublicacao.updateMany({
      where: { orgId, pecaId: linha.pecaId, rede: REDE, estado: { in: emCurso }, proximaEm: posse },
      data: {
        estado: 'container_criado',
        containers: { ...c, publicandoEm: new Date().toISOString() } as Prisma.InputJsonValue,
        proximaEm: posseDoPublish,
        erro: null,
      },
    });
    if (marca.count !== 1) {
      const atual = await this.prisma.pautaPublicacao.findFirstOrThrow({ where: { orgId, pecaId: linha.pecaId, rede: REDE } });
      return desfecho(atual);
    }

    let mediaId: string;
    try {
      mediaId = await this.graph.publicarContainer(token, args.igUserId, c.final);
    } catch (e) {
      const perdida = semResposta(e);
      await this.passo(orgId, linha.pecaId, trilha, 'publish_falhou', { erro: (e as Error).message.slice(0, 300), semResposta: perdida });
      // O post pode ter saído com a resposta perdida: relê o status já.
      let codigo: string | null = null;
      try {
        codigo = (await this.graph.statusDoContainer(token, c.final)).codigo;
      } catch {
        codigo = null;
      }
      if (codigo && passoDoStatus(codigo) === 'ja_publicado') return this.recuperar(orgId, linha.pecaId, c, args, token, trilha);
      if (perdida || !codigo) {
        // Desfecho desconhecido: a rotina relê a cada minuto, e nunca publica este container de novo.
        const aviso = 'A resposta da Meta ao publish se perdeu: conferindo a cada minuto se o post saiu.';
        await this.gravar(orgId, linha.pecaId, { estado: 'container_criado', proximaEm: daquiAUmMinuto, erro: aviso }, ['container_criado'], posseDoPublish);
        await this.passo(orgId, linha.pecaId, trilha, 'confirmando', { status: codigo });
        return { estado: 'container_criado', externalId: null, permalink: null, erro: aviso };
      }
      return this.falhar(orgId, linha.pecaId, `A Meta recusou o post: ${(e as Error).message}`.slice(0, 500), trilha, ['container_criado'], posseDoPublish);
    }
    return this.concluirPublicada(orgId, linha.pecaId, mediaId, await this.permalink(token, mediaId), trilha);
  }

  private async permalink(token: string, mediaId: string): Promise<string | null> {
    try {
      return await this.graph.permalinkDe(token, mediaId);
    } catch (e) {
      this.log.warn(`permalink de ${mediaId} não veio: ${(e as Error).message}`);
      return null;
    }
  }

  /** O container já está PUBLISHED: acha o post pela legenda, e nunca publica de novo. */
  private async recuperar(
    orgId: string,
    pecaId: string,
    c: ContainersGravados,
    args: Pick<ArgsDaPublicacao, 'igUserId' | 'legenda' | 'formato'>,
    token: string,
    trilha: Trilha,
  ): Promise<DesfechoDaPublicacao> {
    let achado: { id: string; permalink: string | null } | null = null;
    if (args.formato !== 'story') {
      try {
        achado = postDoContainer(await this.graph.midiasRecentes(token, args.igUserId, 10), args.legenda, c.criadoEm);
      } catch (e) {
        this.log.warn(`mídias recentes de ${pecaId} não vieram: ${(e as Error).message}`);
      }
    }
    await this.passo(orgId, pecaId, trilha, 'recuperada', { mediaId: achado?.id ?? null });
    return this.concluirPublicada(
      orgId,
      pecaId,
      achado?.id ?? null,
      achado ? (achado.permalink ?? (await this.permalink(token, achado.id))) : null,
      trilha,
      achado ? null : 'Publicada, mas a Meta não devolveu o id do post: confira no Instagram.',
    );
  }

  private async concluirPublicada(
    orgId: string,
    pecaId: string,
    mediaId: string | null,
    permalink: string | null,
    trilha: Trilha,
    aviso: string | null = null,
  ): Promise<DesfechoDaPublicacao> {
    const agora = new Date();
    await this.prisma.$transaction([
      this.prisma.pautaPublicacao.updateMany({
        where: { orgId, pecaId, rede: REDE, estado: { not: 'publicada' } },
        data: { estado: 'publicada', externalId: mediaId, permalink, erro: aviso, proximaEm: null },
      }),
      // O post está no ar: a peça fica publicada mesmo que alguém a tenha mexido no meio.
      this.prisma.pautaPeca.updateMany({
        where: { id: pecaId, orgId },
        data: { status: 'publicada', externalId: mediaId, urlPublicada: permalink, publicadaEm: agora, publicadaPor: trilha.ator, erro: null },
      }),
    ]);
    await this.audit.log({
      orgId,
      actorId: trilha.ator,
      action: 'pauta.peca_publicada',
      entityType: 'pauta_peca',
      entityId: pecaId,
      after: { canal: 'instagram', externalId: mediaId, permalink },
      metadata: metadataDa(trilha),
    });
    await this.passo(orgId, pecaId, trilha, 'publicada', { externalId: mediaId, permalink });
    return { estado: 'publicada', externalId: mediaId, permalink, erro: aviso };
  }

  private async falhar(
    orgId: string,
    pecaId: string,
    erro: string,
    trilha: Trilha,
    de: readonly PautaPublicacao['estado'][],
    posse?: Date | null,
  ): Promise<DesfechoDaPublicacao> {
    await this.gravar(orgId, pecaId, { estado: 'erro', erro: erro.slice(0, 500), proximaEm: null }, de, posse);
    await this.passo(orgId, pecaId, trilha, 'erro', { erro: erro.slice(0, 300) });
    return { estado: 'erro', externalId: null, permalink: null, erro };
  }

  /** Container vencido (24 h): volta a pendente, sem container — publicar de novo pede outra aprovação. */
  private async vencer(orgId: string, pecaId: string, trilha: Trilha, posse: Date | null): Promise<DesfechoDaPublicacao> {
    const erro = 'O container da Meta venceu (24 h) antes de publicar: peça de novo.';
    await this.gravar(orgId, pecaId, { estado: 'pendente', containers: {}, erro, proximaEm: null, approvalId: null }, [...ESTADOS_EM_CURSO], posse);
    await this.passo(orgId, pecaId, trilha, 'vencida', {});
    return { estado: 'pendente', externalId: null, permalink: null, erro };
  }

  /**
   * Escrita condicionada ao estado lido e, quando `posse` vem, à posse de
   * quem escreve (`proximaEm` igual ao que ele gravou ao tomar a linha).
   */
  private async gravar(
    orgId: string,
    pecaId: string,
    data: Prisma.PautaPublicacaoUpdateManyMutationInput,
    de: readonly PautaPublicacao['estado'][],
    posse?: Date | null,
  ): Promise<number> {
    const { count } = await this.prisma.pautaPublicacao.updateMany({
      where: { orgId, pecaId, rede: REDE, estado: { in: [...de] }, ...(posse !== undefined ? { proximaEm: posse } : {}) },
      data,
    });
    return count;
  }

  private async aprovacaoConsumida(orgId: string, pecaId: string): Promise<string | null> {
    const a = await this.prisma.approval.findFirst({
      where: { orgId, capabilityId: CAPACIDADE, resourceId: pecaId, status: 'consumida' },
      orderBy: { consumidoEm: 'desc' },
      select: { id: true },
    });
    return a?.id ?? null;
  }

  private async passo(orgId: string, pecaId: string, trilha: Trilha, passo: string, detalhe: Record<string, unknown>): Promise<void> {
    await this.audit.log({
      orgId,
      actorId: trilha.ator,
      action: ACAO_DO_PASSO,
      entityType: 'pauta_peca',
      entityId: pecaId,
      after: { rede: REDE, passo, ...(trilha.approvalId ? { approvalId: trilha.approvalId } : {}), ...detalhe } as Prisma.InputJsonValue,
      metadata: metadataDa(trilha),
    });
  }

  // ------------------------------------------------------------------ a rotina

  /**
   * Conclui o que está a caminho (o Reels em processamento, o publish cuja
   * resposta se perdeu). Só pega linha com a posse vencida e a toma antes de
   * chamar. Pergunta ao interruptor do conector antes de cada uma: desligar o
   * Instagram barra também a aprovação já assinada. O RASTRO sai na correlação
   * da chamada aprovada; a da passagem vai em `correlacaoDaRotina`.
   */
  async concluir(orgId: string, correlationId: string | null, teto = TETO_POR_PASSAGEM): Promise<LinhaDaPassagem[]> {
    const agora = new Date();
    const linhas = await this.prisma.pautaPublicacao.findMany({
      where: { orgId, rede: REDE, estado: { in: [...ESTADOS_EM_CURSO] }, OR: [{ proximaEm: null }, { proximaEm: { lte: agora } }] },
      orderBy: [{ proximaEm: 'asc' }, { atualizadaEm: 'asc' }],
      take: teto,
    });
    const saida: LinhaDaPassagem[] = [];
    for (const l of linhas) {
      const rotulo = await this.rotuloDa(orgId, l.pecaId);
      const recusa = await this.interruptores.consultar({
        orgId,
        capabilityId: CAPACIDADE,
        correlationId,
        actorType: 'system',
        actorId: ATOR_DA_ROTINA,
      });
      if (recusa) {
        saida.push({ rotulo, resultado: 'interruptor', detalhe: 'conector do Instagram desligado: nada foi chamado' });
        continue;
      }
      const posse = posseAte(new Date(), CHAMADAS_DA_ROTINA);
      const tomada = await this.prisma.pautaPublicacao.updateMany({
        where: { id: l.id, orgId, estado: l.estado, proximaEm: l.proximaEm },
        data: { proximaEm: posse },
      });
      if (tomada.count !== 1) continue;
      const linha = { ...l, proximaEm: posse };
      const c = lerContainers(l.containers);
      const trilha: Trilha = {
        ator: c.aprovadoPor ?? ATOR_DA_ROTINA,
        correlationId: c.correlacao ?? correlationId,
        approvalId: l.approvalId,
        correlacaoDaRotina: correlationId,
      };

      const conta = await this.contaDe(orgId);
      const peca = await this.prisma.pautaPeca.findFirst({ where: { id: l.pecaId, orgId }, select: { formato: true, status: true } });
      if (!conta || !peca) {
        const d = await this.falhar(orgId, l.pecaId, 'A conta de publicação ou a peça sumiu no meio da publicação.', trilha, [...ESTADOS_EM_CURSO], posse);
        saida.push({ rotulo, resultado: 'erro', detalhe: d.erro });
        continue;
      }
      // A peça que voltou a rascunho (editada) ou foi descartada no meio não sai.
      if (peca.status !== 'aprovada') {
        const motivo = `A peça saiu de aprovada (${peca.status}) antes de o post sair: publicação cancelada.`;
        await this.gravar(orgId, l.pecaId, { estado: 'recusada', erro: motivo, proximaEm: null }, [...ESTADOS_EM_CURSO], posse);
        await this.passo(orgId, l.pecaId, trilha, 'recusada', { motivo });
        saida.push({ rotulo, resultado: 'pulada', detalhe: motivo });
        continue;
      }
      try {
        const d = await this.avancar(
          orgId,
          linha,
          { igUserId: conta.externalId, legenda: c.legenda ?? '', formato: peca.formato as ArgsDaPublicacao['formato'] },
          decifrar(conta.tokenCifrado),
          trilha,
        );
        saida.push({ rotulo, resultado: d.estado === 'publicada' ? 'publicada' : d.estado === 'erro' ? 'erro' : d.estado === 'pendente' ? 'pendente' : 'processando', detalhe: d.erro });
      } catch (e) {
        saida.push({ rotulo, resultado: 'erro', detalhe: (e as Error).message.slice(0, 200) });
      }
    }
    return saida;
  }

  private async rotuloDa(orgId: string, pecaId: string): Promise<string> {
    const p = await this.prisma.pautaPeca.findFirst({ where: { id: pecaId, orgId }, select: { formato: true, meta: true } });
    if (!p || !ehPecaDaSemana(p.meta)) return `peça ${pecaId.slice(0, 8)}`;
    const m = lerMetaDaSemana(p.meta);
    const ep = await this.prisma.pautaEpisodio.findFirst({ where: { id: m.episodioId, orgId }, select: { numero: true } });
    return `${ep ? apelidoDoEpisodio(ep.numero) : 'ep-??'} ${p.formato} m${m.itemN}`;
  }

  /** A nota `pauta.publicacao.automatica` com a primeira linha `ligada`. Memória fora = desligada. */
  async automaticaLigada(orgId: string): Promise<boolean> {
    try {
      const nota = await this.memoria.porChave(orgId, PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA);
      if (!nota || nota.arquivadoEm) return false;
      const linha = nota.body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
      return linha.replace(/[*_`#>\-\s]/g, '').toLowerCase() === 'ligada';
    } catch {
      return false;
    }
  }

  /**
   * As peças aprovadas no horário (do slot até 2 h depois) e as que passaram da
   * janela com item de lote. A rotina não publica nada nesta onda: sem a nota,
   * sem o lote ou sem a porta que confere o lote (MD7), a peça segue manual.
   * Cada `pulada` vai ao RASTRO uma vez por peça, slot e motivo — não uma
   * linha por minuto.
   */
  async olharOHorario(orgId: string, correlationId: string | null, teto = TETO_POR_PASSAGEM): Promise<LinhaDaPassagem[]> {
    const agora = new Date();
    const pecas = (await this.prisma.pautaPeca.findMany({
      where: {
        orgId,
        canal: 'instagram',
        status: 'aprovada',
        agendadaPara: { lte: agora, gte: new Date(agora.getTime() - 2 * PAUTA_JANELA_DA_PUBLICACAO_MS) },
      },
      orderBy: { agendadaPara: 'asc' },
      select: { id: true, formato: true, meta: true, agendadaPara: true, publicacoes: { where: { rede: REDE }, select: { estado: true, loteItemId: true } } },
      take: 50,
    })) as Array<{ id: string; formato: string; meta: unknown; agendadaPara: Date; publicacoes: Array<{ estado: PautaPublicacao['estado']; loteItemId: string | null }> }>;
    const candidatas = pecas.filter((p) => {
      if (!ehPecaDaSemana(p.meta)) return false;
      const pub = p.publicacoes[0];
      if (!pub) return agora.getTime() - p.agendadaPara.getTime() <= PAUTA_JANELA_DA_PUBLICACAO_MS;
      return pub.estado === 'pendente' && !!pub.loteItemId;
    });
    if (!candidatas.length) return [];
    const ligada = await this.automaticaLigada(orgId);
    const saida: LinhaDaPassagem[] = [];
    const trilha: Trilha = { ator: ATOR_DA_ROTINA, correlationId, approvalId: null };
    for (const p of candidatas.slice(0, teto)) {
      const rotulo = await this.rotuloDa(orgId, p.id);
      const loteItemId = p.publicacoes[0]?.loteItemId ?? null;
      const d = decisaoDaRotina({ agendadaPara: p.agendadaPara, agora, automaticaLigada: ligada, loteItemId, loteConferidoPelaPorta: false });
      if (d.tipo === 'janela_perdida') {
        await this.falhar(orgId, p.id, d.motivo, trilha, ['pendente']);
        saida.push({ rotulo, resultado: 'erro', detalhe: d.motivo });
        continue;
      }
      const motivo = d.tipo === 'pular' ? d.motivo : 'o lote ainda não é conferido pela porta (MD7)';
      await this.registrarPulada(orgId, p.id, p.agendadaPara, motivo, trilha);
      saida.push({ rotulo, resultado: 'pulada', detalhe: motivo });
    }
    return saida;
  }

  private async registrarPulada(orgId: string, pecaId: string, agendadaPara: Date, motivo: string, trilha: Trilha): Promise<void> {
    const slot = agendadaPara.toISOString();
    const ja = await this.prisma.auditLog.findFirst({
      where: {
        orgId,
        action: ACAO_DO_PASSO,
        entityType: 'pauta_peca',
        entityId: pecaId,
        AND: [{ after: { path: ['passo'], equals: 'pulada' } }, { after: { path: ['agendadaPara'], equals: slot } }, { after: { path: ['motivo'], equals: motivo } }],
      },
      select: { id: true },
    });
    if (!ja) await this.passo(orgId, pecaId, trilha, 'pulada', { agendadaPara: slot, motivo });
  }
}

function metadataDa(t: Trilha): Prisma.InputJsonValue {
  return {
    correlationId: t.correlationId,
    ...(t.approvalId ? { approvalId: t.approvalId } : {}),
    ...(t.correlacaoDaRotina ? { correlacaoDaRotina: t.correlacaoDaRotina } : {}),
  } as Prisma.InputJsonValue;
}

function ehRetida(r: unknown): r is AcaoRetida {
  return !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';
}

function desfecho(p: Pick<PautaPublicacao, 'estado' | 'externalId' | 'permalink' | 'erro'>): DesfechoDaPublicacao {
  return { estado: p.estado, externalId: p.externalId, permalink: p.permalink, erro: p.erro };
}
