import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';
import {
  INSTAGRAM_ESCOPO_DE_COMENTARIOS,
  PAUTA_CAPACIDADE_DE_LER_COMENTARIOS,
  PAUTA_CHAVE_DAS_RESPOSTAS_NA_FILA,
  PAUTA_DM_JANELA_DIAS,
  PAUTA_TIPO_DA_ROTINA_DE_COMENTARIOS,
  apelidoDoEpisodio,
  bytesUtf8,
  checagemAntiSlop,
  type PautaComentarioNaFila,
  type PautaFilaDeComentarios,
  type PautaFormatoDaSemana,
  type PautaItemCurado,
  type PautaTextoDaDm,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LotesService } from '../approvals/lotes.service';
import { AuditService } from '../audit/audit.service';
import { decifrar } from '../common/crypto';
import { EfeitosRegistry } from '../gateway/efeitos.registry';
import { sigiloso } from '../gateway/event-log.service';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import { MemoriaService } from '../memory/memoria.service';
import { GRAPH_DE_COMENTARIOS, type GraphDeComentarios } from './graph-de-comentarios';
import { contaDePublicacao } from './publicacao-instagram.service';
import { notaDaAutomaticaLigada } from './publicacao-instagram';
import { ehPecaDaSemana, lerMetaDaSemana } from './derivacao-do-episodio';
import { itensMantidos } from './episodio';
import { linkPublicoDoItem, semLinksDeCaixaDeEntrada } from './link-publico';
import { TETO_DO_DESTINO, TETO_DO_ROTULO, origemDaBio, urlDaPagina } from './pagina-de-links-do-episodio';
import {
  chaveDaDm,
  chaveDaPessoa,
  expiraEmDo,
  hmacDaPessoa,
  linhaDoResumo,
  mesmoPermalink,
  ondeEsperaResposta,
  problemaDoTextoDaDm,
  textoDaDm,
  triarComentario,
  type MotivoParaIgnorar,
  type ResumoDaColeta,
} from './dm-por-comentario';
import { ATOR_DA_DM, CAPACIDADE_DA_DM, recursoDaRegra } from './dm-automatica';

const CAPACIDADE = PAUTA_CAPACIDADE_DE_LER_COMENTARIOS;
const DIA = 86_400_000;
/** Quem age na rotina: não há pessoa por trás da leitura. */
export const ATOR_DO_COLETOR = 'rotina';
/** Quantas páginas de comentários por post, a cada passagem (50 por página). */
export const TETO_DE_PAGINAS_POR_MIDIA = 4;
/** Quantos posts por passagem: o teto do `argsSchema` da capacidade. */
export const TETO_DE_MIDIAS_POR_PASSAGEM = 30;
/** Quantas linhas a fila mostra. */
const TETO_DA_FILA = 200;
/** Por quanto tempo a linha respondida (ou vencida) continua aparecendo depois do comentário. */
const MOSTRA_POR_DIAS = 14;
const FORMATOS_COM_PALAVRA: PautaFormatoDaSemana[] = ['carrossel', 'corte'];

/** O que o efeito de `instagram.comentario.ler` devolve. O id do comentário e o @ vêm marcados com `sigiloso()`. */
export interface LeituraDeComentarios {
  midias: Array<{ pecaId: string; midiaId: string | null; lidos: number; truncado: boolean; erro: string | null }>;
  casados: Array<{
    pecaId: string;
    midiaId: string;
    palavra: string;
    commentId: unknown;
    usuario: unknown;
    pessoaHmac: string;
    comentadoEm: string;
  }>;
  ignorados: Partial<Record<MotivoParaIgnorar, number>>;
}

interface MidiaDoPedido {
  pecaId: string;
  palavra: string;
  midiaId?: string;
  permalink?: string;
}

/** Os argumentos da leitura, relidos na forma do catálogo (a porta já validou). */
function lerArgs(a: Record<string, unknown>): { igUserId: string; midias: MidiaDoPedido[] } | null {
  if (typeof a.igUserId !== 'string' || !a.igUserId || !Array.isArray(a.midias)) return null;
  const midias: MidiaDoPedido[] = [];
  for (const m of a.midias as unknown[]) {
    const o = m && typeof m === 'object' ? (m as Record<string, unknown>) : null;
    if (!o || typeof o.pecaId !== 'string' || typeof o.palavra !== 'string') return null;
    midias.push({
      pecaId: o.pecaId,
      palavra: o.palavra,
      ...(typeof o.midiaId === 'string' && o.midiaId ? { midiaId: o.midiaId } : {}),
      ...(typeof o.permalink === 'string' && o.permalink ? { permalink: o.permalink } : {}),
    });
  }
  return { igUserId: a.igUserId, midias };
}

/** O valor por trás de um `sigiloso(...)`, para quem grava onde ele é governado. */
function valorSigiloso(v: unknown): string | null {
  const bruto = v && typeof v === 'object' && '__sigiloso' in v ? (v as unknown as { valor: unknown }).valor : v;
  return typeof bruto === 'string' && bruto ? bruto : null;
}

function ehRetida(r: unknown): boolean {
  return !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';
}

interface PecaComPalavra {
  id: string;
  formato: string;
  titulo: string;
  status: string;
  meta: unknown;
  externalId: string | null;
  urlPublicada: string | null;
  publicadaEm: Date | null;
  publicacoes: Array<{ externalId: string | null; permalink: string | null }>;
}

interface Materia {
  episodioId: string;
  itemId: string;
  itemN: number;
  palavra: string;
  pecas: PecaComPalavra[];
}

/** O texto de uma matéria e o que a DM automática (MD11) confere por trás dele. */
export interface RegraDaMateria {
  texto: PautaTextoDaDm;
  /** As peças da matéria (carrossel e corte) que vieram na pergunta. */
  pecaIds: string[];
  bioLinkId: string | null;
  /** Para onde o link de campanha leva AGORA (editável no /bio). */
  destinoDoLink: string | null;
  /** Para onde ele deveria levar: o link público da matéria (D-MC9.6 a). */
  destinoDaMateria: string | null;
  paginaNoAr: boolean;
}

/**
 * ============================================================================
 * A FILA DA DM À MÃO (MD9)
 * ============================================================================
 *
 * O CTA do carrossel e do corte promete o link da matéria no direct. Enquanto a
 * DM automática não existe (MD11, depois do App Review), a resposta é à mão, e
 * este serviço monta a fila dela:
 *
 *   · A LEITURA (`instagram.comentario.ler`, R0) vai pela PORTA: a rotina chama
 *     `porta.executar`, a porta confere o interruptor do Instagram, classifica,
 *     registra, e só então dispara o efeito inscrito aqui. O efeito lê os
 *     comentários na Graph (cliente injetado, `graph-de-comentarios.ts`), faz a
 *     triagem e devolve SÓ quem casou a palavra — o texto do comentário morre no
 *     efeito, e o id do comentário e o @ saem marcados com `sigiloso()` sem
 *     resumo: o RASTRO e o `ToolCall` guardam só a marca e o rótulo, porque um
 *     sha256 sem chave de um @ se desfaz calculando o hash dos candidatos.
 *   · A GRAVAÇÃO é da rotina, depois: uma linha por comentário, única por
 *     empresa. A reentrega (a mesma leitura de 10 em 10 min) cai na mesma linha.
 *   · O @ vive 7 dias (`expiraEm`): a passagem seguinte ao prazo o anula. A
 *     linha inteira some aos 14 dias (a que tem envio da DM, quando ele vence).
 *   · "Marquei como respondido" vai ao RASTRO (`pauta.dm_manual_respondida`)
 *     só com o HMAC da pessoa.
 *
 * POR QUE R0 E NÃO R1: a leitura não escreve nada nem produz rascunho; quem
 * grava a fila é a rotina, do lado de dentro, como a coleta de quinta grava as
 * capturas depois de ler o Gmail (R0). Declarada R1, qualquer sinal
 * (`fora_da_janela` toda noite, `volume_atipico` nas primeiras semanas de uma
 * leitura de 10 em 10 min) a subiria a R2, e R2 exige aprovação: a rotina
 * encheria a fila de aprovações de hora em hora com um pedido de LER.
 */
@Injectable()
export class ComentariosService implements OnModuleInit {
  private readonly log = new Logger('ComentariosDaPauta');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly efeitos: EfeitosRegistry,
    private readonly porta: PortaDoOperador,
    private readonly memoria: MemoriaService,
    @Inject(GRAPH_DE_COMENTARIOS) private readonly graph: GraphDeComentarios,
    /*
     * MD11: editar o texto da DM de uma matéria revoga a regra dela no lote da
     * semana (o hash do item cobre o texto). Global (ApprovalsModule);
     * `@Optional()` porque as suítes da MD9 montam o serviço sem ele.
     */
    @Optional() private readonly lotes?: LotesService,
  ) {}

  /** O relógio, trocável na suíte (o expurgo dos 7 dias). */
  agora(): Date {
    return new Date();
  }

  onModuleInit(): void {
    this.efeitos.registrar({
      'instagram.comentario.ler': (a: Record<string, unknown>, org: string) => this.efeito(a, org),
    }, 'ComentariosService');
  }

  // ------------------------------------------------------------------ o efeito

  /**
   * A leitura, disparada pela porta. Um post que falha não derruba os outros
   * (o erro dele volta na linha da mídia); falhar em todos lança, e a porta
   * registra `tool.erro`.
   */
  private async efeito(a: Record<string, unknown>, orgId: string): Promise<LeituraDeComentarios> {
    const args = lerArgs(a);
    if (!args) throw new BadRequestException('Pedido de leitura de comentários fora da forma do catálogo.');
    const conta = await contaDePublicacao(this.prisma, orgId);
    if (!conta || conta.externalId !== args.igUserId) {
      throw new ConflictException('A conta de publicação do Instagram mudou desde o pedido: nada foi lido.');
    }
    if (!conta.escopos.includes(INSTAGRAM_ESCOPO_DE_COMENTARIOS)) {
      throw new BadRequestException('A conta de publicação não concedeu a leitura de comentários: reconecte na aba Semana.');
    }
    const chave = chaveDaPessoa();
    if (!chave) throw new ServiceUnavailableException('Falta META_WEBHOOK_PESSOA_HMAC_KEY (32+ caracteres): nada foi lido.');

    const token = decifrar(conta.tokenCifrado);
    const agora = this.agora();
    const incluirRespostas = notaDaAutomaticaLigada(await this.memoria.porChave(orgId, PAUTA_CHAVE_DAS_RESPOSTAS_NA_FILA));

    // O post marcado à mão (MC16) só tem o permalink: acha o id nas mídias da conta,
    // uma leitura por passagem — e a falha dessa leitura também vale pela passagem.
    let recentes: Array<{ externalId: string; permalink?: string }> | null = null;
    let falhaDasMidias: string | null = null;
    const saida: LeituraDeComentarios = { midias: [], casados: [], ignorados: {} };
    let falhas = 0;
    for (const m of args.midias) {
      let midiaId = m.midiaId ?? null;
      try {
        if (!midiaId && m.permalink) {
          if (!recentes && !falhaDasMidias) {
            try {
              recentes = await this.graph.midiasDesde(token, new Date(agora.getTime() - (PAUTA_DM_JANELA_DIAS + 1) * DIA), 3);
            } catch (e) {
              falhaDasMidias = `mídias da conta: ${String((e as Error).message)}`;
            }
          }
          if (falhaDasMidias) throw new Error(falhaDasMidias);
          midiaId = recentes!.find((r) => mesmoPermalink(r.permalink, m.permalink))?.externalId ?? null;
        }
        if (!midiaId) {
          // Não achado não é falha: o post pode ter sido apagado ou ser de outra conta.
          saida.midias.push({ pecaId: m.pecaId, midiaId: null, lidos: 0, truncado: false, erro: null });
          continue;
        }
        const { comentarios, truncado } = await this.graph.comentariosDa(token, midiaId, TETO_DE_PAGINAS_POR_MIDIA);
        for (const c of comentarios) {
          const t = triarComentario(c, { palavra: m.palavra, igUserId: conta.externalId, handle: conta.handle, agora, incluirRespostas });
          if (!t.entra) {
            saida.ignorados[t.motivo] = (saida.ignorados[t.motivo] ?? 0) + 1;
            continue;
          }
          saida.casados.push({
            pecaId: m.pecaId,
            midiaId,
            palavra: m.palavra,
            commentId: sigiloso(c.id, 'id do comentário', { semResumo: true }),
            usuario: sigiloso(c.deUsuario, '@ de quem comentou', { semResumo: true }),
            pessoaHmac: hmacDaPessoa(c.deId!, chave),
            comentadoEm: t.comentadoEm.toISOString(),
          });
        }
        saida.midias.push({ pecaId: m.pecaId, midiaId, lidos: comentarios.length, truncado, erro: null });
      } catch (e) {
        falhas++;
        saida.midias.push({ pecaId: m.pecaId, midiaId, lidos: 0, truncado: false, erro: String((e as Error).message).slice(0, 200) });
      }
    }
    if (falhas && falhas === args.midias.length) {
      throw new ServiceUnavailableException(`A leitura dos comentários falhou em todos os posts: ${saida.midias[0]?.erro ?? 'sem detalhe'}`);
    }
    return saida;
  }

  // ------------------------------------------------------------------ a rotina

  /** As peças da semana com palavra, publicadas nos últimos 7 dias. */
  private async pecasPublicadas(orgId: string, agora: Date): Promise<PecaComPalavra[]> {
    const linhas = (await this.prisma.pautaPeca.findMany({
      where: { orgId, status: 'publicada', formato: { in: FORMATOS_COM_PALAVRA }, publicadaEm: { gte: new Date(agora.getTime() - PAUTA_DM_JANELA_DIAS * DIA) } },
      select: {
        id: true,
        formato: true,
        titulo: true,
        status: true,
        meta: true,
        externalId: true,
        urlPublicada: true,
        publicadaEm: true,
        publicacoes: { where: { rede: 'instagram', estado: 'publicada' }, select: { externalId: true, permalink: true } },
      },
      orderBy: { publicadaEm: 'desc' },
    })) as PecaComPalavra[];
    return linhas.filter((p) => ehPecaDaSemana(p.meta) && /^[A-Z0-9]{3,20}$/.test(lerMetaDaSemana(p.meta).palavraChave ?? ''));
  }

  /**
   * Apaga o @ das linhas que passaram dos 7 dias e devolve quantas. A linha
   * inteira some quando a fila deixa de mostrá-la (14 dias do comentário): o
   * `commentId` reabre o @ pela Graph, e o HMAC estável liga a mesma pessoa em
   * todos os posts. A que tem envio da DM automática fica até o envio vencer
   * (90 dias, D-MC9.9) e sai na passagem seguinte ao expurgo dele. A coleta não
   * a traz de volta: ela só lê post dos últimos 8 dias.
   */
  async expurgar(orgId: string, agora: Date = this.agora()): Promise<number> {
    const r = await this.prisma.comentarioComPalavra.updateMany({
      where: { orgId, expiraEm: { lte: agora }, usuario: { not: null } },
      data: { usuario: null },
    });
    await this.prisma.comentarioComPalavra.deleteMany({
      where: { orgId, comentadoEm: { lte: new Date(agora.getTime() - MOSTRA_POR_DIAS * DIA) }, envio: { is: null } },
    });
    return r.count;
  }

  /**
   * Uma passagem da rotina `pauta.coletar-comentarios`: apaga o @ vencido, lê
   * pela porta os comentários dos posts da semana e grava quem casou a palavra.
   * `pulada` quando não há o que ler; lança quando a porta não deixa ler.
   */
  async coletar(orgId: string): Promise<{ status: 'ok' | 'pulada'; resumo: string }> {
    const agora = this.agora();
    const expurgados = await this.expurgar(orgId, agora);
    const comExpurgo = (m: string) => (expurgados ? `${m} · ${expurgados} @ apagado(s) depois dos 7 dias` : m);

    const conta = await contaDePublicacao(this.prisma, orgId);
    if (!conta) return { status: 'pulada', resumo: comExpurgo('sem conta de publicação do Instagram (aba Semana › Conectar)') };
    if (conta.status === 'token_expirado') return { status: 'pulada', resumo: comExpurgo('o token da conta de publicação venceu: reconecte na aba Semana') };
    if (!conta.escopos.includes(INSTAGRAM_ESCOPO_DE_COMENTARIOS)) {
      return { status: 'pulada', resumo: comExpurgo('a conta de publicação não concedeu comentários: reconecte na aba Semana') };
    }
    if (!chaveDaPessoa()) return { status: 'pulada', resumo: comExpurgo('falta META_WEBHOOK_PESSOA_HMAC_KEY (32+ caracteres): nada foi lido') };

    const pecas = await this.pecasPublicadas(orgId, agora);
    const midias: MidiaDoPedido[] = [];
    let semMidia = 0;
    for (const p of pecas.slice(0, TETO_DE_MIDIAS_POR_PASSAGEM)) {
      const palavra = lerMetaDaSemana(p.meta).palavraChave!;
      const midiaId = p.publicacoes[0]?.externalId ?? p.externalId ?? null;
      const permalink = p.urlPublicada ?? p.publicacoes[0]?.permalink ?? null;
      if (midiaId) midias.push({ pecaId: p.id, palavra, midiaId });
      else if (permalink && /^https:\/\//.test(permalink)) midias.push({ pecaId: p.id, palavra, permalink });
      else semMidia++;
    }
    if (!midias.length) {
      return {
        status: 'pulada',
        resumo: comExpurgo(semMidia ? `${semMidia} peça(s) publicada(s) sem o id nem o link do post` : 'nenhuma peça com palavra publicada nos últimos 7 dias'),
      };
    }

    const r = await this.porta.executar({
      orgId,
      actorId: ATOR_DO_COLETOR,
      actorType: ActorType.system,
      capabilityId: CAPACIDADE,
      args: { igUserId: conta.externalId, midias } as unknown as Record<string, unknown>,
      resource: { type: CAPACIDADE, id: conta.externalId },
    });
    if (ehRetida(r)) throw new Error('A porta reteve a leitura dos comentários para aprovação: nada foi lido. Confira o nível de instagram.comentario.ler.');
    const leitura = r as LeituraDeComentarios;

    let novos = 0;
    let jaNaFila = 0;
    for (const c of leitura.casados) {
      const commentId = valorSigiloso(c.commentId);
      const usuario = valorSigiloso(c.usuario);
      if (!commentId || !usuario) continue;
      const comentadoEm = new Date(c.comentadoEm);
      try {
        await this.prisma.comentarioComPalavra.create({
          data: {
            pecaId: c.pecaId,
            commentId,
            midiaId: c.midiaId,
            palavra: c.palavra,
            pessoaHmac: c.pessoaHmac,
            usuario,
            comentadoEm,
            expiraEm: expiraEmDo(comentadoEm),
          },
        });
        novos++;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') jaNaFila++;
        else throw e;
      }
    }
    // O texto de cada linha nova precisa do link de campanha da matéria.
    if (novos) await this.garantirLinksDasPecas(orgId, [...new Set(leitura.casados.map((c) => c.pecaId))]).catch((e) => this.log.warn(`links da DM: ${(e as Error).message}`));

    const resumo: ResumoDaColeta = {
      midias: leitura.midias.length,
      lidos: leitura.midias.reduce((n, m) => n + m.lidos, 0),
      novos,
      jaNaFila,
      ignorados: leitura.ignorados,
      truncadas: leitura.midias.filter((m) => m.truncado).length,
      semMidia: semMidia + leitura.midias.filter((m) => !m.midiaId && !m.erro).length,
      expurgados,
    };
    const erros = leitura.midias.filter((m) => m.erro).map((m) => m.erro);
    return { status: 'ok', resumo: `${linhaDoResumo(resumo)}${erros.length ? ` · ${erros.length} post(s) com erro: ${erros[0]}` : ''}`.slice(0, 500) };
  }

  // ------------------------------------------------------------------ os textos

  /** As matérias com palavra das peças dadas (carrossel e corte da mesma matéria juntos). */
  private materiasDe(pecas: PecaComPalavra[]): Materia[] {
    const porChave = new Map<string, Materia>();
    for (const p of pecas) {
      if (!ehPecaDaSemana(p.meta)) continue;
      const m = lerMetaDaSemana(p.meta);
      if (!m.palavraChave) continue;
      const k = `${m.episodioId}|${m.itemId}`;
      const atual = porChave.get(k) ?? { episodioId: m.episodioId, itemId: m.itemId, itemN: m.itemN, palavra: m.palavraChave, pecas: [] };
      atual.pecas.push(p);
      porChave.set(k, atual);
    }
    return [...porChave.values()];
  }

  /** As peças com palavra que a fila e os textos olham: aprovadas, ou publicadas nos últimos 7 dias. */
  private async pecasDosTextos(orgId: string, agora: Date, episodioId?: string): Promise<PecaComPalavra[]> {
    const linhas = (await this.prisma.pautaPeca.findMany({
      where: {
        orgId,
        formato: { in: FORMATOS_COM_PALAVRA },
        OR: [{ status: 'aprovada' }, { status: 'publicada', publicadaEm: { gte: new Date(agora.getTime() - PAUTA_DM_JANELA_DIAS * DIA) } }],
      },
      select: { id: true, formato: true, titulo: true, status: true, meta: true, externalId: true, urlPublicada: true, publicadaEm: true, publicacoes: { select: { externalId: true, permalink: true }, where: { rede: 'instagram' } } },
    })) as PecaComPalavra[];
    return linhas.filter((p) => ehPecaDaSemana(p.meta, episodioId));
  }

  private async episodios(orgId: string, ids: string[]) {
    if (!ids.length) return new Map<string, { id: string; numero: number; itens: PautaItemCurado[]; bioPage: { id: string; handle: string; publicada: boolean } | null }>();
    const eps = await this.prisma.pautaEpisodio.findMany({
      where: { orgId, id: { in: ids } },
      select: { id: true, numero: true, rodada: { select: { itens: true } }, bioPage: { select: { id: true, handle: true, publicada: true } } },
    });
    return new Map(eps.map((e) => [e.id, { id: e.id, numero: e.numero, itens: itensMantidos(e.rodada?.itens), bioPage: e.bioPage }]));
  }

  /** O destino do link da DM: o link público da matéria (D-MC9.6 a), ou nulo com o porquê. */
  private destinoDa(materia: Materia, itens: PautaItemCurado[]): { destino: string | null; titulo: string } {
    const item = itens[materia.itemN - 1];
    const meta = lerMetaDaSemana(materia.pecas[0]?.meta);
    const titulo = item?.titulo ?? `Matéria ${materia.itemN}`;
    const destino = item ? linkPublicoDoItem(item) : linkPublicoDoItem({ url: meta.linkDaMateria });
    return { destino, titulo };
  }

  /**
   * O texto de uma matéria como a tela o mostra. Não cria nada: sem o link de
   * campanha ainda, diz o que falta.
   */
  private montarTexto(
    materia: Materia,
    ep: { numero: number; itens: PautaItemCurado[]; bioPage: { id: string; handle: string; publicada: boolean } | null } | undefined,
    link: { id: string; destino: string } | undefined,
  ): PautaTextoDaDm {
    const base = {
      episodioId: materia.episodioId,
      apelido: ep ? apelidoDoEpisodio(ep.numero) : 'ep-??',
      itemId: materia.itemId,
      itemN: materia.itemN,
      palavra: materia.palavra,
      materia: '',
      texto: null,
      link: null,
      bytes: 0,
      editado: false,
      checagem: null,
    };
    if (!ep) return { ...base, motivo: 'O episódio desta matéria não foi achado.' };
    const { destino, titulo } = this.destinoDa(materia, ep.itens);
    const comTitulo = { ...base, materia: titulo };
    if (!destino) return { ...comTitulo, motivo: 'A matéria não tem link público (newsletter ou caixa de entrada): não há link para mandar.' };
    if (!ep.bioPage) return { ...comTitulo, motivo: 'O episódio não tem página de links: monte e publique a página no Episódio.' };
    if (!ep.bioPage.publicada) return { ...comTitulo, motivo: 'A página de links do episódio não está no ar: sem ela o /r/ não redireciona.' };
    if (!link) return { ...comTitulo, motivo: 'O link rastreado da DM ainda não existe: "Preparar os textos da DM".' };
    const url = `${origemDaBio(process.env.PUBLIC_BIO_ORIGIN)}/r/${link.id}`;
    const salvo = materia.pecas.map((p) => textoEditadoDe(p.meta)).find((t) => !!t) ?? null;
    // A página remontada no /bio dá outro id ao link da DM: o texto editado com o
    // /r/ antigo levaria a um link morto, então volta o padrão, com o aviso.
    const editado = salvo && salvo.includes(url) ? salvo : null;
    const texto = editado ?? textoDaDm({ materia: titulo, link: url, pagina: urlDaPagina(process.env.PUBLIC_BIO_ORIGIN ?? '', ep.bioPage.handle) });
    const motivo =
      link.destino !== destino
        ? 'O link da matéria mudou desde que o link da DM foi criado: "Preparar os textos da DM" de novo.'
        : salvo && !editado
          ? 'O texto editado tinha um link da DM que não existe mais: voltou o texto padrão. Edite de novo se quiser o seu.'
          : null;
    return {
      ...comTitulo,
      texto,
      motivo,
      link: url,
      bytes: bytesUtf8(texto),
      editado: !!editado,
      checagem: checagemAntiSlop(texto),
    };
  }

  /** Os links de campanha da DM que já existem nas páginas dadas, por chave. */
  private async linksDasPaginas(pageIds: string[]): Promise<Map<string, { id: string; destino: string }>> {
    if (!pageIds.length) return new Map();
    const links = await this.prisma.bioLink.findMany({
      where: { pageId: { in: pageIds }, chave: { startsWith: chaveDaDm('') } },
      select: { id: true, pageId: true, chave: true, destino: true },
    });
    return new Map(links.map((l) => [`${l.pageId}|${l.chave}`, { id: l.id, destino: l.destino }]));
  }

  private async textosDe(orgId: string, pecas: PecaComPalavra[]): Promise<PautaTextoDaDm[]> {
    return (await this.regrasDe(orgId, pecas)).map((r) => r.texto);
  }

  /** O texto de cada matéria e, para a DM automática (MD11), o link e o destino por trás dele. */
  private async regrasDe(orgId: string, pecas: PecaComPalavra[]): Promise<RegraDaMateria[]> {
    const materias = this.materiasDe(pecas);
    const eps = await this.episodios(orgId, [...new Set(materias.map((m) => m.episodioId))]);
    const links = await this.linksDasPaginas([...new Set([...eps.values()].map((e) => e.bioPage?.id).filter((x): x is string => !!x))]);
    return materias
      .map((m) => {
        const ep = eps.get(m.episodioId);
        const link = ep?.bioPage ? links.get(`${ep.bioPage.id}|${chaveDaDm(m.itemId)}`) : undefined;
        return {
          texto: this.montarTexto(m, ep, link),
          pecaIds: m.pecas.map((p) => p.id),
          bioLinkId: link?.id ?? null,
          destinoDoLink: link?.destino ?? null,
          destinoDaMateria: ep ? this.destinoDa(m, ep.itens).destino : null,
          paginaNoAr: !!ep?.bioPage?.publicada,
        };
      })
      .sort((a, b) => a.texto.apelido.localeCompare(b.texto.apelido) || a.texto.itemN - b.texto.itemN);
  }

  /**
   * As peças dadas, na forma que os textos leem (qualquer status), em ordem
   * fixa: o texto editado vem da primeira peça que o tiver, e a DM automática
   * (MD11) assina esse texto — a ordem de leitura não pode mudar o hash.
   */
  private async pecasPorId(orgId: string, pecaIds: string[]): Promise<PecaComPalavra[]> {
    if (!pecaIds.length) return [];
    return (await this.prisma.pautaPeca.findMany({
      where: { orgId, id: { in: pecaIds } },
      orderBy: { id: 'asc' },
      select: { id: true, formato: true, titulo: true, status: true, meta: true, externalId: true, urlPublicada: true, publicadaEm: true, publicacoes: { select: { externalId: true, permalink: true }, where: { rede: 'instagram' } } },
    })) as PecaComPalavra[];
  }

  /**
   * A regra de cada matéria das peças dadas, para a DM automática (MD11): o
   * texto (o padrão ou o editado), o link de campanha e para onde ele leva
   * agora, e o destino que ele DEVERIA ter (o link público da matéria). Não
   * cria nada.
   */
  async regrasDasPecas(orgId: string, pecaIds: string[]): Promise<RegraDaMateria[]> {
    return this.regrasDe(orgId, await this.pecasPorId(orgId, pecaIds));
  }

  /**
   * Cria (ou atualiza o destino de) o link de campanha `campanha:dm:<itemId>` de
   * cada matéria, na página do episódio no ar. Inativo: não aparece na página,
   * mas o `/r/` segue e grava o clique como qualquer link de campanha (MC12).
   *
   * Só gente ATUALIZA o destino ("Preparar os textos da DM", a montagem do lote
   * da semana). A rotina só cria o que falta: se ela regravasse o destino a cada
   * comentário novo, uma troca feita no /bio seria desfeita calada, e a DM
   * automática (MD11), que pausa quando o destino muda, nunca a veria.
   */
  private async garantirLinks(orgId: string, materias: Materia[], atualizar = true): Promise<number> {
    const eps = await this.episodios(orgId, [...new Set(materias.map((m) => m.episodioId))]);
    let feitos = 0;
    for (const m of materias) {
      const ep = eps.get(m.episodioId);
      if (!ep?.bioPage?.publicada) continue;
      const { destino, titulo } = this.destinoDa(m, ep.itens);
      if (!destino || destino.length > TETO_DO_DESTINO) continue;
      const chave = chaveDaDm(m.itemId);
      if (!atualizar && (await this.prisma.bioLink.findUnique({ where: { pageId_chave: { pageId: ep.bioPage.id, chave } }, select: { id: true } }))) continue;
      const ultimo = await this.prisma.bioLink.findFirst({ where: { pageId: ep.bioPage.id }, orderBy: { ordem: 'desc' }, select: { ordem: true } });
      const dados = { rotulo: `DM: ${titulo}`.slice(0, TETO_DO_ROTULO), destino, ativo: false };
      await this.prisma.bioLink.upsert({
        where: { pageId_chave: { pageId: ep.bioPage.id, chave } },
        create: { pageId: ep.bioPage.id, chave, ordem: (ultimo?.ordem ?? 0) + 1, tipo: 'url', ...dados },
        update: dados,
      });
      feitos++;
    }
    return feitos;
  }

  /**
   * O link de campanha da DM de cada matéria das peças dadas: a rotina (MD9) e a
   * montagem do lote da semana (MD11, com quem montou como ator) chamam.
   */
  async garantirLinksDasPecas(orgId: string, pecaIds: string[], actorId: string = ATOR_DO_COLETOR): Promise<void> {
    const pecas = await this.pecasPorId(orgId, pecaIds);
    const materias = this.materiasDe(pecas);
    // O /r/ é público: o link criado pela rotina deixa rastro como o do "Preparar".
    for (const episodioId of new Set(materias.map((m) => m.episodioId))) {
      const doEpisodio = materias.filter((m) => m.episodioId === episodioId);
      const feitos = await this.garantirLinks(orgId, doEpisodio, actorId !== ATOR_DO_COLETOR);
      if (!feitos) continue;
      const daRotina = actorId === ATOR_DO_COLETOR;
      await this.audit.log({
        orgId,
        actorId,
        ...(daRotina ? { actorType: ActorType.system } : {}),
        action: 'pauta.dm_links',
        entityType: 'pauta_episodio',
        entityId: episodioId,
        after: { materias: doEpisodio.length, links: feitos, ...(daRotina ? { origem: PAUTA_TIPO_DA_ROTINA_DE_COMENTARIOS } : {}) },
      });
    }
  }

  // ------------------------------------------------------------------ as rotas

  /** `GET /pauta/comentarios`: a fila e os textos. */
  async fila(orgId: string, incluir?: string): Promise<PautaFilaDeComentarios> {
    const agora = this.agora();
    const include = {
      peca: { select: { id: true, formato: true, titulo: true, status: true, meta: true, externalId: true, urlPublicada: true, publicadaEm: true } },
      envio: { select: { estado: true, seguradoAte: true, enviadoEm: true, motivo: true } },
    } as const;
    // O teto corta pelo que importa: primeiro as que esperam resposta, das que
    // vencem antes; o resto (respondidas e vencidas) completa, das mais novas.
    const esperando = ondeEsperaResposta(orgId, agora);
    const pendentesAgora = await this.prisma.comentarioComPalavra.findMany({ where: esperando, orderBy: { expiraEm: 'asc' }, take: TETO_DA_FILA, include });
    const recentes = { comentadoEm: { gte: new Date(agora.getTime() - MOSTRA_POR_DIAS * DIA) } };
    const resto = pendentesAgora.length < TETO_DA_FILA
      ? await this.prisma.comentarioComPalavra.findMany({
          where: { orgId, NOT: { respondidoEm: null, expiraEm: { gt: agora } }, ...recentes },
          orderBy: { comentadoEm: 'desc' },
          take: TETO_DA_FILA - pendentesAgora.length,
          include,
        })
      : [];
    const linhas = [...pendentesAgora, ...resto];
    if (incluir && !linhas.some((l) => l.id === incluir)) {
      const pedida = await this.prisma.comentarioComPalavra.findFirst({ where: { orgId, id: incluir }, include });
      if (pedida) linhas.push(pedida);
    }
    const pecasDaFila = linhas.map((l) => ({ ...l.peca, publicacoes: [] })) as PecaComPalavra[];
    const dosTextos = await this.pecasDosTextos(orgId, agora);
    const vistas = new Set<string>();
    const todas = [...dosTextos, ...pecasDaFila].filter((p) => (vistas.has(p.id) ? false : (vistas.add(p.id), true)));
    const textos = await this.textosDe(orgId, todas);
    const textoDa = (meta: unknown) => {
      const m = lerMetaDaSemana(meta);
      return textos.find((t) => t.episodioId === m.episodioId && t.itemId === m.itemId) ?? null;
    };

    const quem = [...new Set(linhas.map((l) => l.respondidoPor).filter((x): x is string => !!x))];
    const nomes = quem.length
      ? new Map((await this.prisma.user.findMany({ where: { orgId, id: { in: quem } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name || u.email]))
      : new Map<string, string>();

    const naFila: PautaComentarioNaFila[] = linhas.map((l) => {
      const m = lerMetaDaSemana(l.peca.meta);
      const t = textoDa(l.peca.meta);
      return {
        id: l.id,
        usuario: l.expiraEm > agora ? l.usuario : null,
        palavra: l.palavra,
        pecaId: l.pecaId,
        formato: l.peca.formato as PautaFormatoDaSemana,
        apelido: t?.apelido ?? 'ep-??',
        itemN: m.itemN,
        tituloDaPeca: l.peca.titulo,
        comentadoEm: l.comentadoEm.toISOString(),
        expiraEm: l.expiraEm.toISOString(),
        respondidoEm: l.respondidoEm?.toISOString() ?? null,
        respondidoPor: l.respondidoPor ? (l.respondidoPor === ATOR_DA_DM ? 'DM automática' : (nomes.get(l.respondidoPor) ?? 'outra pessoa')) : null,
        texto: t?.texto ?? null,
        motivo: t ? t.motivo : 'A matéria desta peça não foi achada.',
        automatica: l.envio
          ? {
              estado: l.envio.estado,
              seguradoAte: l.envio.seguradoAte?.toISOString() ?? null,
              enviadoEm: l.envio.enviadoEm?.toISOString() ?? null,
              motivo: l.envio.motivo,
            }
          : null,
      };
    });
    // Primeiro o que espera resposta dentro do prazo, do mais antigo (o que vence antes) ao mais novo.
    const pendente = (l: PautaComentarioNaFila) => !l.respondidoEm && new Date(l.expiraEm) > agora;
    naFila.sort((a, b) => Number(pendente(b)) - Number(pendente(a)) || (pendente(a) ? a.comentadoEm.localeCompare(b.comentadoEm) : b.comentadoEm.localeCompare(a.comentadoEm)));

    const conta = await contaDePublicacao(this.prisma, orgId);
    const rotina = await this.prisma.rotina.findFirst({ where: { orgId, tipo: PAUTA_TIPO_DA_ROTINA_DE_COMENTARIOS }, select: { id: true } });
    const ultima = rotina
      ? await this.prisma.rotinaExecucao.findFirst({ where: { orgId, rotinaId: rotina.id }, orderBy: { inicioEm: 'desc' }, select: { inicioEm: true, status: true, resumo: true, erro: true } })
      : null;

    return {
      linhas: naFila,
      textos: textos.filter((t) => dosTextos.some((p) => textoDaPecaE(p, t))),
      pendentes: await this.pendentes(orgId, agora),
      conta: { handle: conta?.handle ?? null, podeLerComentarios: !!conta && conta.escopos.includes(INSTAGRAM_ESCOPO_DE_COMENTARIOS) },
      ultimaColeta: ultima ? { em: ultima.inicioEm.toISOString(), status: ultima.status, resumo: ultima.resumo ?? ultima.erro ?? null } : null,
      source: { tool: 'banco-interno', generatedAt: agora.toISOString() },
    };
  }

  /** Quantas linhas esperam resposta dentro do prazo, contadas no banco (o teto da fila não as corta). */
  private async pendentes(orgId: string, agora: Date): Promise<number> {
    return this.prisma.comentarioComPalavra.count({ where: ondeEsperaResposta(orgId, agora) });
  }

  /** "Marquei como respondido": grava quem e quando, e o RASTRO leva só o HMAC da pessoa. */
  async marcarRespondido(orgId: string, id: string, actorId: string): Promise<PautaComentarioNaFila> {
    const agora = this.agora();
    const linha = await this.prisma.comentarioComPalavra.findFirst({ where: { id, orgId }, select: { id: true, pecaId: true, palavra: true, pessoaHmac: true, respondidoEm: true } });
    if (!linha) throw new NotFoundException('Comentário não encontrado.');
    const { count } = await this.prisma.comentarioComPalavra.updateMany({ where: { id, orgId, respondidoEm: null }, data: { respondidoEm: agora, respondidoPor: actorId } });
    if (!count) throw new ConflictException('Este comentário já foi marcado como respondido.');
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.dm_manual_respondida',
      entityType: 'pauta_comentario',
      entityId: linha.id,
      after: { pessoaHmac: linha.pessoaHmac, palavra: linha.palavra, pecaId: linha.pecaId },
    });
    const fila = await this.fila(orgId, id);
    const saida = fila.linhas.find((l) => l.id === id);
    if (!saida) throw new NotFoundException('Comentário não encontrado.');
    return saida;
  }

  /** "Preparar os textos da DM" de um episódio: cria o link de campanha de cada matéria com palavra. */
  async prepararTextos(orgId: string, episodioId: string, actorId: string): Promise<PautaTextoDaDm[]> {
    const ep = await this.prisma.pautaEpisodio.findFirst({ where: { id: episodioId, orgId }, select: { id: true, bioPage: { select: { publicada: true } } } });
    if (!ep) throw new NotFoundException('Episódio não encontrado.');
    if (!ep.bioPage) throw new BadRequestException('O episódio não tem página de links: monte e publique a página no Episódio antes.');
    if (!ep.bioPage.publicada) throw new BadRequestException('A página de links do episódio não está no ar: sem ela o /r/ não redireciona.');
    const pecas = await this.pecasDosTextos(orgId, this.agora(), episodioId);
    const materias = this.materiasDe(pecas);
    if (!materias.length) throw new BadRequestException('Nenhuma peça aprovada ou publicada com palavra-chave neste episódio.');
    const feitos = await this.garantirLinks(orgId, materias);
    await this.audit.log({ orgId, actorId, action: 'pauta.dm_links', entityType: 'pauta_episodio', entityId: episodioId, after: { materias: materias.length, links: feitos } });
    return this.textosDe(orgId, pecas);
  }

  /**
   * O texto da DM de uma matéria, editado à mão (ou de volta ao padrão, com
   * `null`). Passa por `semLinksDeCaixaDeEntrada`, tem de caber em 1000 bytes,
   * levar o link rastreado e passar na checagem anti-slop. Grava nas peças da
   * matéria (carrossel e corte), em `meta.dm`.
   */
  async editarTexto(orgId: string, episodioId: string, itemId: string, texto: string | null, actorId: string): Promise<PautaTextoDaDm> {
    const pecas = (await this.pecasDosTextos(orgId, this.agora(), episodioId)).filter((p) => lerMetaDaSemana(p.meta).itemId === itemId);
    if (!pecas.length) throw new NotFoundException('Matéria sem peça aprovada ou publicada com palavra-chave neste episódio.');
    const [atual] = await this.textosDe(orgId, pecas);
    let limpo: string | null = null;
    if (texto !== null) {
      if (!atual?.link) throw new BadRequestException(atual?.motivo ?? 'O link rastreado da DM ainda não existe.');
      limpo = semLinksDeCaixaDeEntrada(texto).trim();
      const problema = problemaDoTextoDaDm(limpo, atual.link);
      if (problema) throw new BadRequestException(problema.motivo);
    }
    // A meta é gravada INTEIRA: relida sob o mesmo cadeado do upload da mídia e
    // da edição da peça, para não desfazer um JPEG ou um mp4 gravado no meio.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-semana:${episodioId}`}))`;
      for (const p of pecas) {
        const lida = await tx.pautaPeca.findFirst({ where: { id: p.id, orgId }, select: { meta: true } });
        if (!lida) continue;
        const meta = { ...((lida.meta as Record<string, unknown>) ?? {}) };
        if (limpo === null) delete meta.dm;
        else meta.dm = { texto: limpo, editadoEm: this.agora().toISOString(), editadoPor: actorId };
        await tx.pautaPeca.update({ where: { id: p.id }, data: { meta: meta as Prisma.InputJsonValue } });
      }
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.dm_texto_editado',
      entityType: 'pauta_episodio',
      entityId: episodioId,
      after: { itemId, padrao: limpo === null, bytes: limpo === null ? null : bytesUtf8(limpo) },
    });
    // A regra assinada da DM automática levava o texto de antes: ela cai, e volta no próximo lote.
    if (this.lotes) {
      await this.lotes
        .revogarItensDoRecurso(orgId, CAPACIDADE_DA_DM, recursoDaRegra(episodioId, itemId), 'o texto da DM foi editado depois da montagem do lote', actorId)
        .catch((e) => this.log.warn(`a regra da DM de ${itemId} não foi revogada: ${(e as Error).message}`));
    }
    const pecasDepois = (await this.pecasDosTextos(orgId, this.agora(), episodioId)).filter((p) => lerMetaDaSemana(p.meta).itemId === itemId);
    const [depois] = await this.textosDe(orgId, pecasDepois);
    return depois;
  }
}

/** O texto editado à mão que a peça guarda (`meta.dm.texto`), ou nulo. */
function textoEditadoDe(meta: unknown): string | null {
  const m = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).dm : null;
  const t = m && typeof m === 'object' ? (m as Record<string, unknown>).texto : null;
  return typeof t === 'string' && t.trim() ? t : null;
}

function textoDaPecaE(p: PecaComPalavra, t: PautaTextoDaDm): boolean {
  const m = lerMetaDaSemana(p.meta);
  return m.episodioId === t.episodioId && m.itemId === t.itemId;
}
