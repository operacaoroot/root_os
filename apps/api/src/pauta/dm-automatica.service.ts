import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ActorType, EnvioDeRespostaEstado, ItemDoLoteEstado, LoteEstado, Prisma } from '@prisma/client';
import {
  INSTAGRAM_ESCOPO_DE_COMENTARIOS,
  PAUTA_CHAVE_DA_DM_AUTOMATICA,
  apelidoDoEpisodio,
  bytesUtf8,
  diaNoFuso,
  type PautaDmAutomaticaNaFila,
  type PautaDmNoLote,
  type PautaItemDaDmNoLote,
  type PautaRegraDaDmParaAprovar,
} from '@mktos/shared';
import { AuditService } from '../audit/audit.service';
import { modoDeAprovacao } from '../approvals/lotes';
import { LotesService, type ItemParaMontar } from '../approvals/lotes.service';
import { comContexto, novaCorrelacao } from '../common/contexto-execucao';
import { decifrar } from '../common/crypto';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { InterruptoresRegistry } from '../gateway/interruptores.registry';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { MemoriaService } from '../memory/memoria.service';
import { fusoDaPolitica } from '../policy/limites';
import { PolicyService } from '../policy/policy.service';
import { ProcedenciaExterna } from '../policy/sinais.service';
import { PrismaService } from '../prisma/prisma.service';
import { ComentariosService, type RegraDaMateria } from './comentarios.service';
import { ehPecaDaSemana, lerMetaDaSemana } from './derivacao-do-episodio';
import { chaveDaPessoa } from './dm-por-comentario';
import {
  ATOR_DA_DM,
  CAPACIDADE_DA_DM,
  CAPACIDADE_DE_PAUSAR,
  CODIGO_SEM_ADVANCED_ACCESS,
  argsDaRegra,
  dentroDoHorario,
  expiraEmDoEnvio,
  janelaDaRegra,
  lerFalhaDaMeta,
  lerRecursoDaRegra,
  PRAZO_DO_ENVIANDO_MS,
  linhaDoResumoDaDm,
  problemaDoTextoAutomatico,
  proximaAbertura,
  recursoDaRegra,
  recusasSeguidasDaMeta,
  tetoDaRegra,
  textoDaDmAutomatica,
  travaDaPessoa,
  usoMaximoDaRegra,
  type ArgsDaRegra,
  type ResumoDaDm,
} from './dm-automatica';
import { GRAPH_DE_MENSAGENS, type GraphDeMensagens } from './graph-de-mensagens';
import { CAPACIDADE_DO_LOTE, VALIDADE_MAXIMA_DO_LOTE_MS } from './lote-da-semana';
import { notaDaAutomaticaLigada } from './publicacao-instagram';
import { contaDePublicacao } from './publicacao-instagram.service';
import { umaPorVez } from './uma-por-vez';

/** Quantos comentários da fila uma passagem leva à porta, no máximo. */
export const TETO_DE_ENVIOS_POR_PASSAGEM = 40;
const FORMATOS_COM_PALAVRA = ['carrossel', 'corte'];

/** A regra de uma matéria, calculada do estado de AGORA. */
export interface RegraCalculada {
  recursoId: string;
  episodioId: string;
  itemId: string;
  itemN: number;
  palavra: string;
  materia: string;
  apelido: string;
  link: string | null;
  destinoDoLink: string | null;
  destinoDaMateria: string | null;
  paginaNoAr: boolean;
  pecaIds: string[];
  /** Quando os posts da matéria saem (ou saíram): de onde a janela de 7 dias conta. */
  inicios: Date[];
  args: ArgsDaRegra | null;
  problema: string | null;
  /** O único problema é o link de campanha que ainda não existe: ele nasce na montagem. */
  linkAusente: boolean;
}

interface ItemDaDm {
  id: string;
  loteId: string;
  recursoId: string;
  hashItem: string;
  janelaDe: Date;
  janelaAte: Date;
  tetoPorDia: number | null;
  usosNoDia: number;
  diaDoContador: string | null;
}

/**
 * ============================================================================
 * A DM AUTOMÁTICA SOB O LOTE DA SEMANA (MD11)
 * ============================================================================
 *
 * O que faz, e em que ordem, para cada comentário da fila (MD9) de uma matéria
 * com regra ASSINADA no lote da semana:
 *
 *   0. lê da fila só os comentários das peças cujas regras podem mandar
 *      agora (no prazo, abaixo do teto do dia, com tempo até a janela abrir):
 *      o que não tem regra valendo fica na fila à mão sem tomar vaga;
 *   1. deduplica: um comentário, uma tentativa (`comentarioId` único) e uma DM
 *      por pessoa por regra (`travaDaPessoa` única enquanto a tentativa vale,
 *      presa à matéria e não ao item do lote, e mantida quando a Meta não
 *      respondeu: `incerto`);
 *   2. confere a regra de AGORA contra a assinada: o destino do link de
 *      campanha é o link da matéria, a página está no ar e o hash dos
 *      argumentos é o do item. Não bate: a regra PAUSA (o item é revogado), e
 *      voltar é assinar de novo;
 *   3. confere a janela de horário da política no fuso dela (08h–20h de São
 *      Paulo), calculada aqui e não pelo sinal da porta: fora dela, o envio
 *      fica SEGURADO até a próxima abertura, dentro do prazo da regra e dos 7
 *      dias da Meta;
 *   4. leva o pedido à PORTA com o `loteItemId` e a procedência externa
 *      marcada (o comentário é de um estranho): o envio sobe a R4, o lote R4 o
 *      cobre, e o uso contado do dia (com a virada em São Paulo) mora numa
 *      instrução só (`LotesService.consumirItem`);
 *   5. o efeito lê o id do comentário da linha do envio (nunca dos
 *      argumentos) e manda a resposta privada pelo conector; três recusas
 *      seguidas da Meta, ou a de Advanced Access, pausam a regra.
 *
 * TUDO NASCE DESLIGADO: sem a nota `pauta.dm.automatica` ligada, a passagem
 * não manda nada e a fila à mão continua sendo o caminho.
 *
 * As pausas automáticas revogam o item pelo serviço do lote, como a rotina de
 * publicação faz ao desistir de uma peça (MD8): só diminuem o alcance. A
 * capacidade `instagram.regra_de_resposta.pausar` (R0) é o botão da tela.
 */
@Injectable()
export class DmAutomaticaService implements OnModuleInit {
  private readonly log = new Logger('DmAutomatica');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly efeitos: EfeitosRegistry,
    private readonly interruptores: InterruptoresRegistry,
    private readonly porta: PortaDoOperador,
    private readonly memoria: MemoriaService,
    private readonly policy: PolicyService,
    private readonly lotes: LotesService,
    private readonly comentarios: ComentariosService,
    @Inject(GRAPH_DE_MENSAGENS) private readonly graph: GraphDeMensagens,
  ) {}

  /** O relógio, trocável na suíte. */
  agora(): Date {
    return new Date();
  }

  onModuleInit(): void {
    this.efeitos.registrar({
      'instagram.resposta_privada.enviar': (a: Record<string, unknown>, org: string, ctx: ContextoDoEfeito) => this.efeito(a, org, ctx),
      'instagram.regra_de_resposta.pausar': (a: Record<string, unknown>, org: string, ctx: ContextoDoEfeito) => this.efeitoDePausar(a, org, ctx),
    }, 'DmAutomaticaService');
  }

  /** A nota `pauta.dm.automatica`: primeira linha `ligada`. Qualquer falha ao ler conta como desligada. */
  async ligada(orgId: string): Promise<boolean> {
    try {
      return notaDaAutomaticaLigada(await this.memoria.porChave(orgId, PAUTA_CHAVE_DA_DM_AUTOMATICA));
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ a regra de agora

  /**
   * As regras das matérias de um episódio, calculadas de AGORA: o carrossel e o
   * corte da matéria que não foram descartados, o texto (o padrão ou o
   * editado) com o aviso de mensagem automática na frente, o link de campanha
   * e o destino dele. É daqui que sai o hash — na montagem, na tela da titular,
   * na ativação e em cada envio.
   */
  async regrasDoEpisodio(orgId: string, episodioId: string): Promise<RegraCalculada[]> {
    const e = await this.prisma.pautaEpisodio.findFirst({ where: { id: episodioId, orgId }, select: { id: true, numero: true, rodadaId: true } });
    if (!e) return [];
    const pecas = (
      await this.prisma.pautaPeca.findMany({
        where: { orgId, rodadaId: e.rodadaId, canal: 'instagram', formato: { in: FORMATOS_COM_PALAVRA }, status: { not: 'descartada' } },
        select: { id: true, meta: true, agendadaPara: true, slotProposto: true, publicadaEm: true },
      })
    ).filter((p) => ehPecaDaSemana(p.meta, e.id) && /^[A-Z0-9]{3,20}$/.test(lerMetaDaSemana(p.meta).palavraChave ?? ''));
    if (!pecas.length) return [];
    const regras = await this.comentarios.regrasDasPecas(orgId, pecas.map((p) => p.id));
    const conta = await contaDePublicacao(this.prisma, orgId);
    const apelido = apelidoDoEpisodio(e.numero);
    return regras.map((r) => {
      const daMateria = pecas.filter((p) => r.pecaIds.includes(p.id));
      const inicios = daMateria.map((p) => p.publicadaEm ?? p.agendadaPara ?? p.slotProposto).filter((d): d is Date => !!d);
      const palavras = [...new Set(daMateria.map((p) => lerMetaDaSemana(p.meta).palavraChave!))].sort();
      return this.calcular(r, conta, apelido, inicios, palavras);
    });
  }

  private calcular(
    r: RegraDaMateria,
    conta: { externalId: string; escopos: string[] } | null,
    apelido: string,
    inicios: Date[],
    palavras: string[],
  ): RegraCalculada {
    const t = r.texto;
    const base: Omit<RegraCalculada, 'args' | 'problema' | 'linkAusente'> = {
      recursoId: recursoDaRegra(t.episodioId, t.itemId),
      episodioId: t.episodioId,
      itemId: t.itemId,
      itemN: t.itemN,
      palavra: t.palavra,
      materia: t.materia,
      apelido,
      link: t.link,
      destinoDoLink: r.destinoDoLink,
      destinoDaMateria: r.destinoDaMateria,
      paginaNoAr: r.paginaNoAr,
      pecaIds: [...r.pecaIds].sort(),
      inicios,
    };
    const sem = (problema: string, linkAusente = false): RegraCalculada => ({ ...base, args: null, problema, linkAusente });
    if (!conta) return sem('A empresa não tem conta de publicação do Instagram: conecte na aba Semana.');
    if (!conta.escopos.includes(INSTAGRAM_ESCOPO_DE_COMENTARIOS)) return sem('A conta de publicação não concedeu comentários: reconecte na aba Semana.');
    // O coletor casa cada post com a palavra DELE; a regra assina uma só.
    if (palavras.length > 1) return sem(`O carrossel e o corte da matéria estão com palavras diferentes (${palavras.join(', ')}): deixe uma só antes de assinar.`);
    if (!r.destinoDaMateria) return sem(t.motivo ?? 'A matéria não tem link público: não há o que mandar.');
    if (!r.paginaNoAr) return sem('A página de links do episódio não está no ar: sem ela o /r/ não redireciona.');
    if (!r.bioLinkId || !t.link) return sem(t.motivo ?? 'O link rastreado da DM ainda não existe.', true);
    if (!t.texto) return sem(t.motivo ?? 'O texto da DM ainda não existe.');
    if (r.destinoDoLink !== r.destinoDaMateria) {
      return sem('O link da DM não leva mais ao link da matéria (mudou no /bio, ou a matéria mudou): "Preparar os textos da DM" de novo.');
    }
    const texto = textoDaDmAutomatica(t.texto, t.palavra);
    const problema = problemaDoTextoAutomatico(texto, t.link);
    if (problema) return sem(`Com a linha de mensagem automática: ${problema}`);
    return {
      ...base,
      problema: null,
      linkAusente: false,
      args: argsDaRegra({ igUserId: conta.externalId, palavra: t.palavra, texto, bioLinkId: r.bioLinkId, destinoAprovado: r.destinoDaMateria, midias: r.pecaIds }),
    };
  }

  /** A regra de agora de um item de lote, ou nula quando a matéria sumiu. */
  private async regraDoItem(orgId: string, recursoId: string, cache?: Map<string, RegraCalculada[]>): Promise<RegraCalculada | null> {
    const alvo = lerRecursoDaRegra(recursoId);
    if (!alvo) return null;
    let regras = cache?.get(alvo.episodioId);
    if (!regras) {
      regras = await this.regrasDoEpisodio(orgId, alvo.episodioId);
      cache?.set(alvo.episodioId, regras);
    }
    return regras.find((r) => r.itemId === alvo.itemId) ?? null;
  }

  /** Por que o item não bate mais com a regra de agora, ou nulo. */
  async divergencia(
    orgId: string,
    item: { recursoId: string; hashItem: string },
    cache?: Map<string, RegraCalculada[]>,
  ): Promise<{ divergente: string | null; regra: RegraCalculada | null }> {
    const regra = await this.regraDoItem(orgId, item.recursoId, cache);
    if (!regra) return { divergente: 'A matéria desta regra não tem mais carrossel nem corte com a palavra.', regra: null };
    if (!regra.args) return { divergente: `A regra não sai mais como está: ${regra.problema}`, regra };
    const hash = this.lotes.hashDoItem(orgId, CAPACIDADE_DA_DM, regra.args as unknown as Record<string, unknown>);
    return {
      divergente: hash === item.hashItem ? null : 'A regra mudou depois da assinatura (o texto, o link, o destino ou as peças): ela não sai.',
      regra,
    };
  }

  // ------------------------------------------------------------------ o lote da semana

  /**
   * As regras que entram no próximo lote deste episódio (MD8): uma por matéria
   * com palavra, link público, página no ar e texto dentro das regras, com
   * janela da primeira publicação até 7 dias depois e teto por dia. Na
   * montagem (`montagem` com quem monta), o link de campanha de cada matéria é
   * criado antes, e a regra ativa que não bate mais é revogada para entrar de
   * novo. A regra com problema não barra a semana: fica fora, com o porquê.
   */
  async paraOLote(
    orgId: string,
    episodioId: string,
    agora: Date,
    montagem: { actorId: string } | null = null,
  ): Promise<{ itens: ItemParaMontar[]; tela: PautaDmNoLote; resumo: string }> {
    const automatica = await this.ligada(orgId);
    if (montagem) {
      const pecas = await this.pecaIdsDoEpisodio(orgId, episodioId);
      if (pecas.length) await this.comentarios.garantirLinksDasPecas(orgId, pecas, montagem.actorId);
    }
    const regras = await this.regrasDoEpisodio(orgId, episodioId);
    const vivos = await this.lotes.itensVivos(orgId, CAPACIDADE_DA_DM, regras.map((r) => r.recursoId), agora);
    const semChave = chaveDaPessoa() ? null : 'Falta META_WEBHOOK_PESSOA_HMAC_KEY (32+ caracteres) no ambiente: sem ela a DM não sabe quem já recebeu.';
    // Sem a capacidade no catálogo desta empresa, a montagem recusaria o lote INTEIRO: a regra fica fora e os posts seguem.
    const modo = modoDeAprovacao(this.policy.resolverCapacidade(orgId, CAPACIDADE_DA_DM));
    const semCatalogo =
      modo?.modo === 'sob_lote' && modo.lote === CAPACIDADE_DO_LOTE
        ? null
        : 'O catálogo desta empresa ainda não tem a DM automática sob o lote da semana: rode o db:seed:politica assinado (POLITICA_CAPACIDADE_NOVA_*).';
    const teto = tetoDaRegra();
    const itens: ItemParaMontar[] = [];
    const tela: PautaRegraDaDmParaAprovar[] = [];
    for (const r of regras) {
      const vivo = vivos.get(r.recursoId) ?? null;
      const janela = janelaDaRegra(r.inicios, agora, VALIDADE_MAXIMA_DO_LOTE_MS);
      let problema = semCatalogo ?? semChave ?? r.problema ?? (janela ? null : 'Nenhum post desta matéria tem horário, ou os 7 dias da resposta já passaram.');
      let noLote = vivo ? { loteId: vivo.loteId, estadoDoLote: vivo.estadoDoLote } : null;
      if (!problema && vivo?.estadoDoLote === 'ativo') {
        const hash = this.lotes.hashDoItem(orgId, CAPACIDADE_DA_DM, r.args as unknown as Record<string, unknown>);
        if (hash === vivo.hashItem) {
          problema = null;
        } else if (montagem) {
          await this.lotes.revogarItensDoRecurso(orgId, CAPACIDADE_DA_DM, r.recursoId, 'a regra mudou depois da assinatura: entra no lote novo', montagem.actorId);
          noLote = null;
        }
      }
      // Antes da montagem o link de campanha da matéria pode ainda não existir: ele nasce nela.
      const linkPorCriar = !montagem && r.linkAusente && problema === r.problema && !!janela;
      const entra = !problema && !(noLote?.estadoDoLote === 'ativo');
      if (entra && r.args && janela) {
        itens.push({
          capabilityId: CAPACIDADE_DA_DM,
          recursoId: r.recursoId,
          args: r.args as unknown as Record<string, unknown>,
          ...janela,
          usoMaximo: usoMaximoDaRegra(teto),
          tetoPorDia: teto,
        });
      }
      tela.push({
        itemId: r.itemId,
        itemN: r.itemN,
        palavra: r.palavra,
        materia: r.materia,
        texto: r.args?.texto ?? null,
        bytes: r.args ? bytesUtf8(r.args.texto) : 0,
        link: r.link,
        destino: r.destinoDaMateria,
        janelaDe: janela?.janelaDe.toISOString() ?? null,
        janelaAte: janela?.janelaAte.toISOString() ?? null,
        tetoPorDia: teto,
        problema: linkPorCriar ? null : problema,
        noLote,
      });
    }
    tela.sort((a, b) => a.itemN - b.itemN);
    return {
      itens,
      tela: { automatica, regras: tela },
      resumo: itens.length ? `${itens.length} regra(s) de DM automática (até ${teto} por dia cada, 7 dias)` : '',
    };
  }

  private async pecaIdsDoEpisodio(orgId: string, episodioId: string): Promise<string[]> {
    const e = await this.prisma.pautaEpisodio.findFirst({ where: { id: episodioId, orgId }, select: { rodadaId: true } });
    if (!e) return [];
    const pecas = await this.prisma.pautaPeca.findMany({
      where: { orgId, rodadaId: e.rodadaId, canal: 'instagram', formato: { in: FORMATOS_COM_PALAVRA }, status: { not: 'descartada' } },
      select: { id: true, meta: true },
    });
    return pecas.filter((p) => ehPecaDaSemana(p.meta, episodioId)).map((p) => p.id);
  }

  /** Os itens de DM do lote, como a titular os lê: o texto exato, o link, o destino, o teto e a janela. */
  async conteudoDoLote(
    orgId: string,
    itens: ReadonlyArray<{ id: string; recursoId: string; hashItem: string; tetoPorDia: number | null; janelaDe: string; janelaAte: string; estado: ItemDoLoteEstado }>,
    handle: string | null,
  ): Promise<PautaItemDaDmNoLote[]> {
    const cache = new Map<string, RegraCalculada[]>();
    const saida: PautaItemDaDmNoLote[] = [];
    const [abre, fecha] = this.policy.limites(orgId).janelaHoraria as [string, string];
    const fuso = fusoDaPolitica();
    for (const i of itens) {
      const d = await this.divergencia(orgId, i, cache);
      const r = d.regra;
      const titulos = r?.pecaIds.length
        ? await this.prisma.pautaPeca.findMany({ where: { orgId, id: { in: r.pecaIds } }, select: { id: true, formato: true, titulo: true } })
        : [];
      saida.push({
        itemId: i.id,
        apelido: r?.apelido ?? 'ep-??',
        itemN: r?.itemN ?? 0,
        palavra: r?.palavra ?? '?',
        materia: r?.materia ?? '(matéria sumiu)',
        texto: r?.args?.texto ?? '',
        bytes: r?.args ? bytesUtf8(r.args.texto) : 0,
        link: r?.link ?? '',
        destino: r?.destinoDaMateria ?? '',
        pecas: titulos,
        tetoPorDia: i.tetoPorDia,
        janelaDe: i.janelaDe,
        janelaAte: i.janelaAte,
        handle,
        estadoDoItem: i.estado,
        hashCurto: i.hashItem.slice(0, 12),
        divergente: i.estado === 'ativo' ? d.divergente : null,
        horario: `${abre}–${fecha}`,
        fuso,
      });
    }
    return saida.sort((a, b) => a.itemN - b.itemN);
  }

  /** Na ativação do lote: a regra que mudou entre a montagem e a assinatura não vale. */
  async divergentesNaAtivacao(orgId: string, itens: ReadonlyArray<{ id: string; recursoId: string; hashItem: string }>): Promise<Array<{ itemId: string; motivo: string }>> {
    const cache = new Map<string, RegraCalculada[]>();
    const saida: Array<{ itemId: string; motivo: string }> = [];
    for (const i of itens) {
      const d = await this.divergencia(orgId, i, cache);
      if (d.divergente) saida.push({ itemId: i.id, motivo: d.divergente });
    }
    return saida;
  }

  // ------------------------------------------------------------------ a passagem

  /** Apaga as linhas de envio que passaram dos 90 dias (D-MC9.9). */
  async expurgar(orgId: string, agora: Date = this.agora()): Promise<number> {
    const r = await this.prisma.envioDeResposta.deleteMany({ where: { orgId, expiraEm: { lte: agora } } });
    return r.count;
  }

  /**
   * Uma passagem da DM automática, logo depois da coleta da rotina de
   * comentários. Desligada (a nota), só apaga o que passou dos 90 dias.
   */
  async passagem(orgId: string): Promise<{ status: 'ok' | 'pulada'; resumo: string }> {
    const agora = this.agora();
    const apagados = await this.expurgar(orgId, agora);
    const comApagados = (m: string) => (apagados ? `${m} · ${apagados} envio(s) apagado(s) depois dos 90 dias` : m);
    if (!(await this.ligada(orgId))) {
      return { status: 'pulada', resumo: comApagados('DM automática desligada (nota pauta.dm.automatica): a fila segue à mão') };
    }
    try {
      return await umaPorVez(`pauta-dm-automatica:${orgId}`, 'A passagem da DM automática', async () => {
        const r = await this.passar(orgId, agora);
        return { status: r.status, resumo: comApagados(r.resumo) };
      });
    } catch (e) {
      if (e instanceof ConflictException) return { status: 'pulada', resumo: comApagados('outra passagem da DM automática está em curso') };
      throw e;
    }
  }

  private async passar(orgId: string, agora: Date): Promise<{ status: 'ok' | 'pulada'; resumo: string }> {
    // A linha presa em `enviando`: a passagem caiu entre tomar a linha e ouvir a porta. A DM pode ter saído, e a trava fica.
    await this.prisma.envioDeResposta.updateMany({
      where: { orgId, estado: EnvioDeRespostaEstado.enviando, atualizadoEm: { lt: new Date(agora.getTime() - PRAZO_DO_ENVIANDO_MS) } },
      data: { estado: EnvioDeRespostaEstado.incerto, motivo: 'a passagem caiu no meio do envio' },
    });
    const chave = chaveDaPessoa();
    if (!chave) return { status: 'pulada', resumo: 'DM automática: falta META_WEBHOOK_PESSOA_HMAC_KEY, nada saiu' };
    const conta = await contaDePublicacao(this.prisma, orgId);
    if (!conta || conta.status === 'token_expirado') return { status: 'pulada', resumo: 'DM automática: sem conta de publicação válida, nada saiu' };
    const desligado = await this.interruptores.consultar({ orgId, capabilityId: CAPACIDADE_DA_DM, actorType: ActorType.system, actorId: ATOR_DA_DM });
    if (desligado) return { status: 'pulada', resumo: 'DM automática: conector do Instagram desligado, nada saiu' };

    // A pendência que alguém respondeu à mão enquanto estava segurada solta a trava.
    await this.prisma.envioDeResposta.updateMany({
      where: { orgId, estado: EnvioDeRespostaEstado.segurado, comentario: { respondidoEm: { not: null } } },
      data: { estado: EnvioDeRespostaEstado.recusado, travaDaPessoa: null, motivo: 'respondida à mão antes de a janela de horário abrir' },
    });

    const itens = (await this.prisma.itemDoLote.findMany({
      where: { orgId, capabilityId: CAPACIDADE_DA_DM, estado: ItemDoLoteEstado.ativo, lote: { estado: LoteEstado.ativo, validaAte: { gt: agora } } },
      select: { id: true, loteId: true, recursoId: true, hashItem: true, janelaDe: true, janelaAte: true, tetoPorDia: true, usosNoDia: true, diaDoContador: true },
    })) as ItemDaDm[];
    // A segurada cuja regra caiu (pausada, vencida, lote cancelado) não sai mais: volta à mão, sem trava.
    await this.prisma.envioDeResposta.updateMany({
      where: { orgId, estado: EnvioDeRespostaEstado.segurado, loteItemId: { notIn: itens.map((i) => i.id) } },
      data: { estado: EnvioDeRespostaEstado.recusado, travaDaPessoa: null, motivo: 'a regra da DM caiu antes de a janela de horário abrir: a resposta fica à mão' },
    });
    const janela = this.policy.limites(orgId).janelaHoraria as [string, string];
    const fuso = fusoDaPolitica();
    const hoje = diaNoFuso(agora, fuso);
    const resumo: ResumoDaDm = { enviadas: 0, seguradas: 0, ignoradas: 0, noTeto: 0, recusadas: 0, erros: 0, pausadas: [], semTempo: 0, incertos: 0, abertura: janela[0] };
    if (!itens.length) return { status: 'ok', resumo: `${linhaDoResumoDaDm(resumo)} · nenhuma regra assinada valendo` };

    const dentro = dentroDoHorario(agora, janela, fuso);
    const abre = dentro ? agora : proximaAbertura(agora, janela, fuso);
    const cache = new Map<string, RegraCalculada[]>();
    const conferidas = new Map<string, ArgsDaRegra | null>();
    const pausadas = new Set<string>();

    // As peças das regras que podem mandar AGORA. A fila só é lida nelas: sem isso, 40 comentários
    // antigos de matéria sem regra (a newsletter, a regra pausada, a que bateu o teto) tomariam
    // todas as vagas da passagem por 7 dias, e a regra que vale ficaria sem mandar nada.
    const porRecurso = new Map<string, ItemDaDm>();
    const quePodem: string[] = [];
    const noTeto: string[] = [];
    const semTempo: string[] = [];
    for (const item of itens) {
      if (agora < item.janelaDe || agora > item.janelaAte) continue;
      const regra = await this.regraDoItem(orgId, item.recursoId, cache);
      if (!regra) {
        const motivo = 'a matéria da regra não tem mais carrossel nem corte com a palavra';
        await this.pausarSozinha(orgId, item, motivo);
        pausadas.add(item.id);
        resumo.pausadas.push(motivo);
        continue;
      }
      // O teto do dia: a porta é quem decide, e a conferência daqui só evita bater nela à toa.
      if (item.tetoPorDia !== null && item.diaDoContador === hoje && item.usosNoDia >= item.tetoPorDia) noTeto.push(...regra.pecaIds);
      else if (abre.getTime() > item.janelaAte.getTime()) semTempo.push(...regra.pecaIds);
      else {
        porRecurso.set(item.recursoId, item);
        quePodem.push(...regra.pecaIds);
      }
    }
    const pendentes = (pecaIds: string[], expiraEm: Prisma.DateTimeFilter): Prisma.ComentarioComPalavraWhereInput => ({
      orgId,
      pecaId: { in: pecaIds },
      respondidoEm: null,
      expiraEm,
      OR: [{ envio: null }, { envio: { estado: EnvioDeRespostaEstado.segurado, seguradoAte: { lte: agora } } }],
    });
    if (noTeto.length) resumo.noTeto += await this.prisma.comentarioComPalavra.count({ where: pendentes(noTeto, { gt: agora }) });
    if (semTempo.length) resumo.semTempo += await this.prisma.comentarioComPalavra.count({ where: pendentes(semTempo, { gt: agora }) });
    // Fora do horário, o comentário que vence antes de a janela abrir não tem como sair.
    if (!dentro && quePodem.length) resumo.semTempo += await this.prisma.comentarioComPalavra.count({ where: pendentes(quePodem, { gt: agora, lt: abre }) });

    const linhas = quePodem.length
      ? await this.prisma.comentarioComPalavra.findMany({
          where: pendentes(quePodem, dentro ? { gt: agora } : { gte: abre }),
          select: { id: true, pecaId: true, pessoaHmac: true, expiraEm: true, peca: { select: { meta: true } }, envio: { select: { id: true, estado: true } } },
          orderBy: { comentadoEm: 'asc' },
          take: TETO_DE_ENVIOS_POR_PASSAGEM,
        })
      : [];

    for (const l of linhas) {
      const m = lerMetaDaSemana(l.peca.meta);
      const item = porRecurso.get(recursoDaRegra(m.episodioId, m.itemId));
      if (!item || pausadas.has(item.id)) continue;
      if (agora < item.janelaDe || agora > item.janelaAte) continue;

      // 1. Uma DM por pessoa por regra (a matéria, não o item do lote).
      const trava = travaDaPessoa(item.recursoId, l.pessoaHmac);
      const dono = await this.prisma.envioDeResposta.findFirst({ where: { orgId, travaDaPessoa: trava, NOT: { comentarioId: l.id } }, select: { estado: true } });
      if (dono) {
        await this.ignorar(orgId, l.id, item.id, l.pessoaHmac, l.envio?.id ?? null, agora, dono.estado);
        resumo.ignoradas++;
        continue;
      }

      // 2. A regra de agora é a assinada?
      if (!conferidas.has(item.id)) {
        const motivo = await this.motivoParaPausar(orgId, item, cache);
        if (motivo) {
          await this.pausarSozinha(orgId, item, motivo);
          pausadas.add(item.id);
          resumo.pausadas.push(motivo);
          conferidas.set(item.id, null);
          continue;
        }
        conferidas.set(item.id, (await this.regraDoItem(orgId, item.recursoId, cache))!.args);
      }
      const args = conferidas.get(item.id);
      if (!args) continue;

      // O teto que a própria passagem alcançou.
      if (item.tetoPorDia !== null && item.diaDoContador === hoje && item.usosNoDia >= item.tetoPorDia) {
        resumo.noTeto++;
        continue;
      }

      // 3. A janela de horário, no fuso da política.
      if (!dentro) {
        if (abre.getTime() > Math.min(item.janelaAte.getTime(), l.expiraEm.getTime())) {
          resumo.semTempo++;
          continue;
        }
        const segurou = await this.segurar(orgId, l.id, item, l.pessoaHmac, l.envio, abre, agora);
        if (segurou === 'ignorado') resumo.ignoradas++;
        else if (segurou) resumo.seguradas++;
        continue;
      }

      // 4. A porta, com a procedência externa.
      const r = await this.enviarPelaPorta(orgId, l.id, item, l.pessoaHmac, l.envio, args, agora);
      if (r === 'enviado') {
        resumo.enviadas++;
        if (item.diaDoContador !== hoje) {
          item.diaDoContador = hoje;
          item.usosNoDia = 0;
        }
        item.usosNoDia++;
      } else if (r === 'ignorado') {
        resumo.ignoradas++;
      } else if (r === 'recusado') {
        resumo.recusadas++;
      } else if (r === 'incerto') {
        resumo.incertos++;
      } else if (r === 'erro' || r === 'pausar') {
        resumo.erros++;
        const motivo =
          r === 'pausar'
            ? `precisa de Advanced Access: a Meta recusou a mensagem (${CODIGO_SEM_ADVANCED_ACCESS}), falta o App Review de mensagens`
            : await this.motivoDasRecusas(orgId, item.id);
        if (motivo) {
          await this.pausarSozinha(orgId, item, motivo);
          pausadas.add(item.id);
          resumo.pausadas.push(motivo);
        }
      }
    }
    return { status: 'ok', resumo: linhaDoResumoDaDm(resumo).slice(0, 500) };
  }

  /** Por que a regra tem de parar antes de mandar qualquer coisa, ou nulo. */
  private async motivoParaPausar(orgId: string, item: ItemDaDm, cache: Map<string, RegraCalculada[]>): Promise<string | null> {
    const regra = await this.regraDoItem(orgId, item.recursoId, cache);
    if (!regra) return 'a matéria da regra não tem mais carrossel nem corte com a palavra';
    if (!regra.paginaNoAr) return 'a página de links do episódio saiu do ar: o /r/ não redireciona';
    if (regra.destinoDaMateria && regra.destinoDoLink && regra.destinoDoLink !== regra.destinoDaMateria) {
      return 'o destino do link da DM foi alterado no /bio depois da assinatura';
    }
    if (!regra.args) return `a regra não sai mais como está: ${regra.problema}`;
    const hash = this.lotes.hashDoItem(orgId, CAPACIDADE_DA_DM, regra.args as unknown as Record<string, unknown>);
    return hash === item.hashItem ? null : 'a regra mudou depois da assinatura (texto, link, destino ou peças)';
  }

  /** Três recusas seguidas da Meta nesta regra? O motivo da pausa, ou nulo. */
  private async motivoDasRecusas(orgId: string, loteItemId: string): Promise<string | null> {
    const ultimas = await this.prisma.envioDeResposta.findMany({
      where: { orgId, loteItemId, estado: { in: [EnvioDeRespostaEstado.enviado, EnvioDeRespostaEstado.erro] } },
      orderBy: { atualizadoEm: 'desc' },
      take: 3,
      select: { estado: true },
    });
    return recusasSeguidasDaMeta(ultimas.map((u) => u.estado)) ? 'três recusas seguidas da Meta' : null;
  }

  /** Pausa sozinha: revoga o item da regra, com o motivo. Só diminui o alcance. */
  private async pausarSozinha(orgId: string, item: ItemDaDm, motivo: string): Promise<void> {
    const n = await this.lotes.revogarItensDoRecurso(orgId, CAPACIDADE_DA_DM, item.recursoId, `DM automática pausada: ${motivo}`, ATOR_DA_DM);
    if (n) {
      await this.audit.log({
        orgId,
        actorId: ATOR_DA_DM,
        actorType: ActorType.system,
        action: 'pauta.dm_regra_pausada',
        entityType: 'item_do_lote',
        entityId: item.id,
        after: { recursoId: item.recursoId, motivo: motivo.slice(0, 300), sozinha: true },
      });
    }
    this.log.warn(`regra ${item.id} pausada: ${motivo}`);
  }

  /**
   * A mesma pessoa já recebeu (ou vai receber) a DM desta regra: a linha sai da
   * fila à mão. Quando a primeira ficou sem resposta da Meta (`incerto`), nada
   * garante que ela saiu: a linha fica na fila, sem DM automática, para quem
   * conferir no Instagram.
   */
  private async ignorar(
    orgId: string,
    comentarioId: string,
    loteItemId: string,
    pessoaHmac: string,
    envioId: string | null,
    agora: Date,
    estadoDoDono: EnvioDeRespostaEstado | null,
  ): Promise<void> {
    const incerto = estadoDoDono === EnvioDeRespostaEstado.incerto;
    const dados = {
      estado: EnvioDeRespostaEstado.ignorado,
      travaDaPessoa: null,
      motivo: incerto ? 'a DM desta pessoa ficou sem resposta da Meta e pode ter saído' : 'a mesma pessoa já recebeu a DM desta regra',
    };
    if (envioId) await this.prisma.envioDeResposta.updateMany({ where: { id: envioId, orgId }, data: dados });
    else {
      await this.prisma.envioDeResposta
        .create({ data: { comentarioId, loteItemId, pessoaHmac, expiraEm: expiraEmDoEnvio(agora), ...dados } })
        .catch((e) => {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        });
    }
    if (incerto) return;
    await this.prisma.comentarioComPalavra.updateMany({ where: { id: comentarioId, orgId, respondidoEm: null }, data: { respondidoEm: agora, respondidoPor: ATOR_DA_DM } });
  }

  /** A trava já era de outra linha (a corrida do índice único): ignora, lendo o estado de quem a tem. */
  private async ignorarPelaTrava(orgId: string, comentarioId: string, item: ItemDaDm, pessoaHmac: string, agora: Date): Promise<void> {
    const dono = await this.prisma.envioDeResposta.findFirst({ where: { orgId, travaDaPessoa: travaDaPessoa(item.recursoId, pessoaHmac) }, select: { estado: true } });
    await this.ignorar(orgId, comentarioId, item.id, pessoaHmac, null, agora, dono?.estado ?? null);
  }

  /** Segura o envio até a janela abrir. `ignorado` quando a trava da pessoa já era de outra linha. */
  private async segurar(
    orgId: string,
    comentarioId: string,
    item: ItemDaDm,
    pessoaHmac: string,
    envio: { id: string; estado: EnvioDeRespostaEstado } | null,
    ate: Date,
    agora: Date,
  ): Promise<boolean | 'ignorado'> {
    if (envio) {
      const r = await this.prisma.envioDeResposta.updateMany({ where: { id: envio.id, orgId, estado: EnvioDeRespostaEstado.segurado }, data: { seguradoAte: ate } });
      return r.count === 1;
    }
    try {
      await this.prisma.envioDeResposta.create({
        data: {
          comentarioId,
          loteItemId: item.id,
          pessoaHmac,
          travaDaPessoa: travaDaPessoa(item.recursoId, pessoaHmac),
          estado: EnvioDeRespostaEstado.segurado,
          seguradoAte: ate,
          expiraEm: expiraEmDoEnvio(agora),
        },
      });
      return true;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const alvo = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
      if (alvo.includes('travaDaPessoa')) {
        await this.ignorarPelaTrava(orgId, comentarioId, item, pessoaHmac, agora);
        return 'ignorado';
      }
      return false;
    }
  }

  /**
   * Toma a linha (nova, ou a segurada que chegou a hora) em `enviando` com uma
   * correlação só dela e leva o pedido à porta DENTRO dessa correlação: é por
   * ela que o efeito acha o comentário, sem ele entrar nos argumentos.
   */
  private async enviarPelaPorta(
    orgId: string,
    comentarioId: string,
    item: ItemDaDm,
    pessoaHmac: string,
    envio: { id: string; estado: EnvioDeRespostaEstado } | null,
    args: ArgsDaRegra,
    agora: Date,
  ): Promise<'enviado' | 'ignorado' | 'recusado' | 'erro' | 'pausar' | 'incerto' | 'nada'> {
    const correlationId = novaCorrelacao('dm');
    let envioId: string;
    if (envio) {
      const r = await this.prisma.envioDeResposta.updateMany({
        where: { id: envio.id, orgId, estado: EnvioDeRespostaEstado.segurado },
        data: { estado: EnvioDeRespostaEstado.enviando, correlationId, seguradoAte: null },
      });
      if (r.count !== 1) return 'nada';
      envioId = envio.id;
    } else {
      try {
        envioId = (
          await this.prisma.envioDeResposta.create({
            data: {
              comentarioId,
              loteItemId: item.id,
              pessoaHmac,
              travaDaPessoa: travaDaPessoa(item.recursoId, pessoaHmac),
              estado: EnvioDeRespostaEstado.enviando,
              correlationId,
              expiraEm: expiraEmDoEnvio(agora),
            },
            select: { id: true },
          })
        ).id;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        const alvo = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
        if (alvo.includes('travaDaPessoa')) {
          await this.ignorarPelaTrava(orgId, comentarioId, item, pessoaHmac, agora);
          return 'ignorado';
        }
        return 'nada';
      }
    }

    const soltar = (estado: EnvioDeRespostaEstado, motivo: string) =>
      this.prisma.envioDeResposta.updateMany({
        where: { id: envioId, orgId, estado: EnvioDeRespostaEstado.enviando },
        data: { estado, travaDaPessoa: null, motivo: motivo.slice(0, 500) },
      });
    const procedencia = new ProcedenciaExterna().marcar('comentário de uma pessoa de fora num post do Instagram');
    try {
      const r = await comContexto({ orgId, correlationId, actorType: ActorType.system, actorId: ATOR_DA_DM, origem: 'cron' }, () =>
        this.porta.executar({
          orgId,
          actorId: ATOR_DA_DM,
          actorType: ActorType.system,
          capabilityId: CAPACIDADE_DA_DM,
          args: { ...(args as unknown as Record<string, unknown>), loteItemId: item.id },
          resource: { type: CAPACIDADE_DA_DM, id: item.recursoId },
          procedenciaExterna: procedencia,
        }),
      );
      if (r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao') {
        await soltar(EnvioDeRespostaEstado.recusado, 'a porta reteve o envio em vez de consumir o item do lote');
        return 'recusado';
      }
      return 'enviado';
    } catch (e) {
      const atual = await this.prisma.envioDeResposta.findFirst({ where: { id: envioId, orgId }, select: { estado: true, codigoDoErro: true } });
      // O efeito chegou à Meta e ela recusou: a linha já está em `erro`, com o código.
      if (atual?.estado === EnvioDeRespostaEstado.erro) return atual.codigoDoErro === CODIGO_SEM_ADVANCED_ACCESS ? 'pausar' : 'erro';
      // A Meta não respondeu: pode ter saído, a trava fica e não conta como recusa.
      if (atual?.estado === EnvioDeRespostaEstado.incerto) return 'incerto';
      // A porta recusou antes do efeito (o item não valia mais, o teto correu, o conector desligou).
      const motivo = e instanceof ForbiddenException ? String((e.getResponse() as { message?: unknown }).message ?? e.message) : (e as Error).message;
      await soltar(EnvioDeRespostaEstado.recusado, motivo);
      return 'recusado';
    }
  }

  // ------------------------------------------------------------------ os efeitos

  /**
   * O EFEITO de `instagram.resposta_privada.enviar`, disparado pela porta
   * depois de consumir um uso do item. Acha a linha do envio pela correlação
   * (o id do comentário nunca passa pelos argumentos nem pelo RASTRO), confere
   * que o comentário é de uma peça da regra, e manda a resposta privada.
   */
  private async efeito(a: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<{ envioId: string; estado: 'enviado' }> {
    if (!ctx.loteItemId) throw new ForbiddenException('A DM automática só sai por item do lote da semana: nada foi enviado.');
    if (!ctx.correlationId) throw new BadRequestException('Envio sem correlação: nada foi enviado.');
    const envio = await this.prisma.envioDeResposta.findFirst({
      where: { orgId, loteItemId: ctx.loteItemId, correlationId: ctx.correlationId, estado: EnvioDeRespostaEstado.enviando },
      select: { id: true, comentario: { select: { commentId: true, pecaId: true, palavra: true, expiraEm: true } } },
    });
    if (!envio) throw new NotFoundException('Não há envio tomado nesta passagem para este item: nada foi enviado.');
    /*
     * `erro` é só o que a Meta recusou: é ele que as três recusas seguidas
     * contam. O que o efeito recusa antes de chamar a Graph é `recusado`, e o
     * que ficou sem resposta dela é `incerto`, com a trava da pessoa mantida.
     */
    const falhar = async (bruto: string, estado: EnvioDeRespostaEstado, codigo: string | null = null): Promise<never> => {
      // O erro da Meta vai ao RASTRO (5 anos): se ele ecoar o id do comentário, o id sai dali.
      const motivo = bruto.split(envio.comentario.commentId).join('[id do comentário]');
      await this.prisma.envioDeResposta.updateMany({
        where: { id: envio.id, orgId, estado: EnvioDeRespostaEstado.enviando },
        data: {
          estado,
          ...(estado === EnvioDeRespostaEstado.incerto ? {} : { travaDaPessoa: null }),
          motivo: motivo.slice(0, 500),
          codigoDoErro: codigo,
        },
      });
      throw new Error(motivo);
    };
    const recusar = (motivo: string) => falhar(motivo, EnvioDeRespostaEstado.recusado);
    const midias = Array.isArray(a.midias) ? (a.midias as unknown[]) : [];
    if (a.palavra !== envio.comentario.palavra || !midias.includes(envio.comentario.pecaId)) {
      return recusar('O comentário não é de um post desta regra: nada foi enviado.');
    }
    if (envio.comentario.expiraEm.getTime() <= this.agora().getTime()) return recusar('Passaram os 7 dias da resposta privada: nada foi enviado.');
    const conta = await contaDePublicacao(this.prisma, orgId);
    if (!conta || conta.externalId !== a.igUserId) return recusar('A conta de publicação do Instagram mudou desde a assinatura: nada foi enviado.');

    let mensagemId: string | null;
    try {
      ({ mensagemId } = await this.graph.responderEmPrivado(decifrar(conta.tokenCifrado), conta.externalId, envio.comentario.commentId, String(a.texto)));
    } catch (e) {
      const f = lerFalhaDaMeta(e);
      if (f.incerto) return falhar(f.mensagem, EnvioDeRespostaEstado.incerto);
      return falhar(f.semAdvancedAccess ? `precisa de Advanced Access (${f.codigo}): ${f.mensagem}` : f.mensagem, EnvioDeRespostaEstado.erro, f.codigo);
    }
    const agora = this.agora();
    await this.prisma.envioDeResposta.updateMany({
      where: { id: envio.id, orgId, estado: EnvioDeRespostaEstado.enviando },
      data: { estado: EnvioDeRespostaEstado.enviado, mensagemId, enviadoEm: agora, motivo: null },
    });
    await this.prisma.comentarioComPalavra.updateMany({
      where: { orgId, envio: { id: envio.id }, respondidoEm: null },
      data: { respondidoEm: agora, respondidoPor: ATOR_DA_DM },
    });
    return { envioId: envio.id, estado: 'enviado' };
  }

  /** O EFEITO de `instagram.regra_de_resposta.pausar` (R0): revoga o item da regra. */
  private async efeitoDePausar(
    a: Record<string, unknown>,
    orgId: string,
    ctx: ContextoDoEfeito,
  ): Promise<{ regraId: string; revogados: number; estadoAnterior: { estado: string }; estadoNovo: { estado: string } }> {
    const regraId = typeof a.regraId === 'string' ? a.regraId : '';
    const item = await this.prisma.itemDoLote.findFirst({ where: { id: regraId, orgId, capabilityId: CAPACIDADE_DA_DM }, select: { id: true, recursoId: true, estado: true } });
    if (!item) throw new NotFoundException('Regra da DM não encontrada.');
    if (item.estado !== ItemDoLoteEstado.ativo) throw new ConflictException(`A regra não está valendo (o item está ${item.estado}): não há o que pausar.`);
    const motivo = String(a.motivo ?? '').slice(0, 300);
    const revogados = await this.lotes.revogarItensDoRecurso(orgId, CAPACIDADE_DA_DM, item.recursoId, `DM automática pausada à mão: ${motivo}`, ctx.actorId ?? 'desconhecido');
    return { regraId: item.id, revogados, estadoAnterior: { estado: 'ativo' }, estadoNovo: { estado: 'revogado' } };
  }

  /** `POST /pauta/dm/regras/:itemId/pausar`: pela porta, R0 — o freio não espera outra pessoa. */
  async pausarPelaTela(orgId: string, itemId: string, motivo: string, actorId: string): Promise<unknown> {
    return this.porta.executar({
      orgId,
      actorId,
      capabilityId: CAPACIDADE_DE_PAUSAR,
      args: { regraId: itemId, motivo },
      resource: { type: CAPACIDADE_DE_PAUSAR, id: itemId },
    });
  }

  // ------------------------------------------------------------------ a fila

  /** As regras da DM que a fila mostra: as ativas e as que caíram nos últimos 2 dias, com "enviadas hoje". */
  async estadoNaFila(orgId: string): Promise<PautaDmAutomaticaNaFila> {
    const agora = this.agora();
    const hoje = diaNoFuso(agora, fusoDaPolitica());
    const itens = await this.prisma.itemDoLote.findMany({
      where: {
        orgId,
        capabilityId: CAPACIDADE_DA_DM,
        lote: { estado: { in: [LoteEstado.ativo, LoteEstado.encerrado, LoteEstado.revogado] } },
        janelaAte: { gt: new Date(agora.getTime() - 2 * 86_400_000) },
        OR: [{ estado: ItemDoLoteEstado.ativo }, { revogadoEm: { gt: new Date(agora.getTime() - 2 * 86_400_000) } }],
      },
      orderBy: { janelaDe: 'desc' },
      take: 30,
      select: { id: true, recursoId: true, estado: true, motivoDaRevogacao: true, tetoPorDia: true, usosNoDia: true, diaDoContador: true, janelaAte: true },
    });
    const cache = new Map<string, RegraCalculada[]>();
    const regras = [];
    for (const i of itens) {
      const r = await this.regraDoItem(orgId, i.recursoId, cache);
      regras.push({
        loteItemId: i.id,
        apelido: r?.apelido ?? 'ep-??',
        itemN: r?.itemN ?? 0,
        palavra: r?.palavra ?? '?',
        estadoDoItem: i.estado,
        motivoDaPausa: i.estado === ItemDoLoteEstado.ativo ? null : i.motivoDaRevogacao,
        tetoPorDia: i.tetoPorDia ?? 0,
        enviadasHoje: i.diaDoContador === hoje ? i.usosNoDia : 0,
        janelaAte: i.janelaAte.toISOString(),
      });
    }
    return { ligada: await this.ligada(orgId), regras };
  }
}
