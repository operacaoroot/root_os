import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ActorType, type EnvioAoYoutube, type PautaEpisodioStatus, type Prisma } from '@prisma/client';
import {
  PAUTA_CHAVE_DA_CATEGORIA_DO_YOUTUBE,
  PAUTA_CHAVE_DA_PLAYLIST_DO_YOUTUBE,
  PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA,
  PAUTA_THUMB_MAX_BYTES,
  YOUTUBE_VALIDADE_DA_SESSAO_MS,
  apelidoDoEpisodio,
  faltasDoYoutube,
  midiaDoEpisodio,
  motivoDaAuditoriaParaEnviar,
  motivoDaAuditoriaParaPublicar,
  titulosDoPacote,
  youtubeAuditoria,
  type EnvioAoYoutubeEstado,
  type PautaEnvioAoYoutube,
  type PautaSessaoDoYoutube,
  type PautaYoutubeDoEpisodio,
  type PautaYoutubePendente,
  type YoutubeArquivoInput,
  type YoutubeAuditoria,
  PAUTA_TIPO_DA_ROTINA_DE_PUBLICACAO,
} from '@mktos/shared';
import { rotinaDaPauta } from './rotina-da-pauta';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { cifrar, decifrar } from '../common/crypto';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { InterruptoresRegistry } from '../gateway/interruptores.registry';
import { PortaDoOperador, type AcaoRetida } from '../gateway/porta-do-operador.service';
import { MemoriaService } from '../memory/memoria.service';
import { StorageService } from '../storage/storage.service';
import { LotesService, type ItemVivo } from '../approvals/lotes.service';
import { CLIENTE_DO_YOUTUBE, ErroDoYoutube, type ClienteDoYoutube } from './cliente-do-youtube';
import { notaDaAutomaticaLigada } from './publicacao-instagram';
import type { LinhaDaPassagem } from './publicacao-instagram.service';
import { VALIDADE_MAXIMA_DO_LOTE_MS } from './lote-da-semana';
import { umaPorVez } from './uma-por-vez';
import {
  CAPACIDADE_DE_ENVIAR,
  CAPACIDADE_DE_PUBLICAR,
  argsDaPublicacao,
  argsDoEnvio,
  categoriaDaNota,
  divergenciaDoVideo,
  envioPerdido,
  mesmosArgs,
  motivoDoCanalDeTeste,
  playlistDaNota,
  pngDaThumbConfere,
  thumbEscolhida,
  type ArgsDaPublicacaoNoYoutube,
  type ArgsDoEnvioAoYoutube,
  type EpisodioParaOYoutube,
} from './youtube-do-episodio';

/*
 * ============================================================================
 * O VÍDEO DO EPISÓDIO NO YOUTUBE (MD10)
 * ============================================================================
 *
 * O Mac só manda os bytes. O resto é do OS, e cada escrita no canal sai por
 * uma capacidade R3 da régua, sob o item do lote da semana (MD7/MD8):
 *
 *   · DECLARAR (`PUT …/youtube/arquivo`): o Mac diz o sha256 e o tamanho do
 *     vídeo final. É o que entra no hash que a titular assina.
 *   · SESSÃO (`POST …/youtube/sessao`): confere o interruptor da auditoria, o
 *     arquivo declarado e o item de envio ATIVO — sem ele, nada chega à porta
 *     e o YouTube não recebe nada. Com ele, a porta consome um uso e o efeito
 *     de `youtube.video.enviar` abre a sessão resumable, SEMPRE privada e sem
 *     `publishAt`. A URI fica cifrada no banco e vai só para o Mac, com um
 *     token de acesso curto pedido SÓ com o escopo de envio; o refresh token
 *     nunca sai do cofre. Fora da janela do item (até 1 h antes do horário),
 *     nem a sessão nem o token saem. No modo teste, só para o canal de teste.
 *   · CONCLUÍDO (`POST …/youtube/concluido {videoId}`): o mesmo efeito, outro
 *     uso do item: `videos.list` confere que o vídeo está privado e com os
 *     metadados assinados, e `thumbnails.set` manda o PNG escolhido, lido do
 *     storage (e a playlist da nota, se houver).
 *   · AGENDAR (a rotina `pauta.publicar-agendadas`, com a nota
 *     `pauta.publicacao.automatica` ligada e `YOUTUBE_AUDITORIA=aprovada`): o
 *     efeito de `youtube.video.publicar` relê o vídeo, recusa o que diverge do
 *     hash, garante a thumb e a playlist e manda `videos.update` com
 *     `part=status` e o `publishAt`. Daí em diante quem publica é o YouTube.
 *
 * Nada aqui apaga vídeo: apagar é destruição (R5).
 */

/** O que o RASTRO chama cada passo do vídeo. */
export const ACAO_DO_PASSO_DO_YOUTUBE = 'pauta.youtube_passo';
const ATOR_DA_ROTINA = 'rotina';
/** Quantos agendamentos a rotina manda por passagem. */
const TETO_POR_PASSAGEM = 2;

const DO_EPISODIO = {
  id: true,
  numero: true,
  status: true,
  titulos: true,
  descricao: true,
  thumbs: true,
  midia: true,
  thumbEscolhida: true,
  publicarNoYoutubeEm: true,
  bioPage: { select: { handle: true, publicada: true } },
  envioAoYoutube: true,
} as const;

type LinhaDoEpisodio = EpisodioParaOYoutube & {
  numero: number;
  status: PautaEpisodioStatus;
  midia: unknown;
  envioAoYoutube: EnvioAoYoutube | null;
};

type Db = PrismaService | Prisma.TransactionClient;

/**
 * A thumb e o horário do YouTube só travam quando o vídeo já foi agendado (ou o
 * episódio foi concluído). O Agendado do episódio (D-MC11) vem da semana do
 * Instagram e não trava o YouTube: o vídeo pode entrar num lote depois.
 */
function travaDoYoutube(e: { status: string; envioAoYoutube: { estado: string } | null }): string | null {
  if (e.envioAoYoutube?.estado === 'agendado') return 'O vídeo já está agendado no YouTube: a thumb e o horário são o registro do que foi ao ar. Mude no Studio, se precisar.';
  if (e.status === 'concluido') return 'O episódio está concluído.';
  return null;
}

function ehRetida(r: unknown): r is AcaoRetida {
  return !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';
}

/** A frase do erro do YouTube como a tela a mostra, sem o token nem a URI. */
function fraseDoYoutube(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/Bearer\s+\S+/g, 'Bearer ***').slice(0, 500);
}

function paraATela(r: EnvioAoYoutube): PautaEnvioAoYoutube {
  return {
    estado: r.estado as EnvioAoYoutubeEstado,
    sha256: r.sha256,
    bytes: Number(r.bytes),
    mime: r.mime,
    videoId: r.videoId,
    sessaoExpiraEm: r.estado === 'sessao_aberta' ? (r.expiraEm?.toISOString() ?? null) : null,
    sessoes: r.sessoes,
    conferidoEm: r.conferidoEm?.toISOString() ?? null,
    thumbDefinidaEm: r.thumbDefinidaEm?.toISOString() ?? null,
    playlistId: r.playlistId,
    publicarEm: r.publicarEm?.toISOString() ?? null,
    agendadoEm: r.agendadoEm?.toISOString() ?? null,
    erro: r.erro,
    enviadoEmTeste: r.enviadoEmTeste,
    atualizadoEm: r.atualizadoEm.toISOString(),
  };
}

/** O que a linha perde quando o vídeo que ela aponta não serve mais (sumiu do canal, foi recusado): o arquivo pode subir de novo. */
const SOLTAR_O_VIDEO = {
  videoId: null,
  conferidoEm: null,
  thumbSha: null,
  thumbDefinidaEm: null,
  playlistId: null,
  playlistItemId: null,
  sessaoCifrada: null,
  enviadoEmTeste: false,
} as const;

/** O item vale AGORA: entre o início e o fim da janela dele (a do lote pode ir além). */
function dentroDaJanela(v: { janelaDe: Date; janelaAte: Date }, agora: Date): boolean {
  return agora.getTime() >= v.janelaDe.getTime() && agora.getTime() <= v.janelaAte.getTime();
}

async function lerAte(stream: Readable, teto: number): Promise<Buffer> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const c of stream) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array);
    total += b.length;
    if (total > teto) {
      stream.destroy();
      throw new Error(`o arquivo passa de ${teto} bytes`);
    }
    partes.push(b);
  }
  return Buffer.concat(partes);
}

@Injectable()
export class EnvioAoYoutubeService implements OnModuleInit {
  private readonly log = new Logger('EnvioAoYoutube');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly efeitos: EfeitosRegistry,
    private readonly interruptores: InterruptoresRegistry,
    private readonly porta: PortaDoOperador,
    private readonly memoria: MemoriaService,
    private readonly storage: StorageService,
    @Inject(CLIENTE_DO_YOUTUBE) private readonly youtube: ClienteDoYoutube,
    /*
     * Global (ApprovalsModule) e sempre presente no Nest; `@Optional()` porque
     * as suítes montam o serviço à mão. Sem ele nenhum item vale: a sessão é
     * recusada e a rotina não agenda nada.
     */
    @Optional() private readonly lotes?: LotesService,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar({
      'youtube.video.enviar': (a: Record<string, unknown>, org: string, ctx: ContextoDoEfeito) => this.efeitoDeEnviar(a, org, ctx),
      'youtube.video.publicar': (a: Record<string, unknown>, org: string, ctx: ContextoDoEfeito) => this.efeitoDePublicar(a, org, ctx),
    }, 'EnvioAoYoutubeService');
  }

  // ------------------------------------------------------------------ leitura

  private auditoria(): YoutubeAuditoria {
    return youtubeAuditoria(process.env.YOUTUBE_AUDITORIA);
  }

  private origemDaBio(): string {
    return process.env.PUBLIC_BIO_ORIGIN ?? '';
  }

  private async nota(orgId: string, chave: string): Promise<{ body: string; arquivadoEm?: unknown } | null> {
    try {
      const n = await this.memoria.porChave(orgId, chave);
      return n && !(n as { arquivadoEm?: unknown }).arquivadoEm ? (n as { body: string }) : null;
    } catch {
      return null;
    }
  }

  private async categoria(orgId: string): Promise<string> {
    return categoriaDaNota((await this.nota(orgId, PAUTA_CHAVE_DA_CATEGORIA_DO_YOUTUBE))?.body);
  }

  private async playlist(orgId: string): Promise<string | null> {
    return playlistDaNota((await this.nota(orgId, PAUTA_CHAVE_DA_PLAYLIST_DO_YOUTUBE))?.body);
  }

  /** A nota `pauta.publicacao.automatica` (D-MD1): sem ela, a rotina não agenda — e o "Aprovar a semana" avisa. */
  async publicacaoAutomatica(orgId: string): Promise<boolean> {
    try {
      return notaDaAutomaticaLigada(await this.memoria.porChave(orgId, PAUTA_CHAVE_DA_PUBLICACAO_AUTOMATICA));
    } catch {
      return false;
    }
  }

  private async episodio(orgId: string, episodioId: string, db: Db = this.prisma): Promise<LinhaDoEpisodio> {
    const e = (await db.pautaEpisodio.findFirst({ where: { id: episodioId, orgId }, select: DO_EPISODIO })) as LinhaDoEpisodio | null;
    if (!e) throw new NotFoundException('Episódio não encontrado.');
    return e;
  }

  /** O vídeo que subiu no modo teste, com o OS fora do modo teste: o arquivo pode ser declarado de novo, para o canal real. */
  private doTesteParaRefazer(r: EnvioAoYoutube | null): boolean {
    return !!r?.videoId && r.enviadoEmTeste && this.auditoria() !== 'teste';
  }

  private arquivoDe(r: EnvioAoYoutube | null): { sha256: string; bytes: number } | null {
    return r ? { sha256: r.sha256, bytes: Number(r.bytes) } : null;
  }

  /**
   * Os argumentos dos dois itens a partir do episódio de AGORA. É a conta que a
   * montagem do lote, a tela da titular, a ativação e os efeitos repetem — e a
   * porta confere pelo hash.
   */
  async argsAtuais(
    orgId: string,
    episodioId: string,
    db: Db = this.prisma,
    categoria?: string,
  ): Promise<{
    episodio: LinhaDoEpisodio;
    envio: { args: ArgsDoEnvioAoYoutube } | { problema: string };
    publicacao: { args: ArgsDaPublicacaoNoYoutube } | { problema: string };
  }> {
    const e = await this.episodio(orgId, episodioId, db);
    const ctx = { origemDaBio: this.origemDaBio(), categoria: categoria ?? (await this.categoria(orgId)) };
    const arquivo = this.arquivoDe(e.envioAoYoutube);
    return { episodio: e, envio: argsDoEnvio(e, arquivo, ctx), publicacao: argsDaPublicacao(e, arquivo, ctx) };
  }

  /** O que falta para o YouTube entrar no lote desta semana (a aba Semana e o pacote mostram). */
  async faltas(orgId: string, e: LinhaDoEpisodio, agora = new Date()): Promise<string[]> {
    const titulo = titulosDoPacote(e.titulos).some((t) => t.escolhido);
    const faltas = faltasDoYoutube({
      conectado: await this.youtube.conectado(orgId),
      auditoria: this.auditoria(),
      tituloEscolhido: titulo,
      descricao: !!e.descricao?.trim(),
      thumbEscolhida: !!e.thumbEscolhida,
      thumbComImagem: !!thumbEscolhida(e.thumbs, e.thumbEscolhida),
      arquivo: !!e.envioAoYoutube,
      publicarEm: e.publicarNoYoutubeEm,
      agora,
      validadeMaximaMs: VALIDADE_MAXIMA_DO_LOTE_MS,
    });
    if (!faltas.length) {
      // O que a lista de faltas não mede (página fora do ar, < >, bytes) sai da mesma conta dos argumentos.
      const { envio } = await this.argsAtuais(orgId, e.id);
      if ('problema' in envio) faltas.push(envio.problema);
    }
    if (e.envioAoYoutube?.estado === 'agendado') return ['O vídeo já está agendado no YouTube.'];
    if (this.doTesteParaRefazer(e.envioAoYoutube)) {
      faltas.push('O vídeo subiu no modo teste (canal de teste) e fica privado para sempre: declare o vídeo final de novo para o canal real (root-midia youtube ep-NN --declarar).');
    }
    return faltas;
  }

  /** `GET /pauta/episodios/:id/youtube`. */
  async doEpisodio(orgId: string, episodioId: string): Promise<PautaYoutubeDoEpisodio> {
    const e = await this.episodio(orgId, episodioId);
    const agora = new Date();
    const itens: PautaYoutubeDoEpisodio['itens'] = [];
    if (this.lotes) {
      for (const cap of [CAPACIDADE_DE_ENVIAR, CAPACIDADE_DE_PUBLICAR]) {
        const v = (await this.lotes.itensVivos(orgId, cap, [e.id], agora)).get(e.id);
        if (v) itens.push({ capabilityId: cap, itemId: v.itemId, loteId: v.loteId, estadoDoLote: v.estadoDoLote, estadoDoItem: v.estadoDoItem, janelaAte: v.janelaAte.toISOString() });
      }
    }
    const r = e.envioAoYoutube;
    return {
      episodioId: e.id,
      apelido: apelidoDoEpisodio(e.numero),
      auditoria: this.auditoria(),
      conectado: await this.youtube.conectado(orgId),
      tituloEscolhido: titulosDoPacote(e.titulos).find((t) => t.escolhido)?.texto ?? null,
      thumbEscolhida: e.thumbEscolhida,
      publicarEm: e.publicarNoYoutubeEm?.toISOString() ?? null,
      arquivoFinal: midiaDoEpisodio(e.midia)?.arquivoFinal ?? null,
      envio: r ? paraATela(r) : null,
      faltas: await this.faltas(orgId, e, agora),
      itens,
      url: r?.videoId && r.estado === 'agendado' ? this.youtube.urlDoVideo(r.videoId) : null,
      automatica: await this.publicacaoAutomatica(orgId),
      rotinaDePublicacao: await rotinaDaPauta(this.prisma, orgId, PAUTA_TIPO_DA_ROTINA_DE_PUBLICACAO),
    };
  }

  /** `GET /pauta/youtube/pendentes`: o que o vigia do Mac envia sozinho (item de envio num lote ASSINADO, vídeo ainda não conferido). */
  async pendentes(orgId: string): Promise<{ items: PautaYoutubePendente[] }> {
    if (!this.lotes) return { items: [] };
    const eps = await this.prisma.pautaEpisodio.findMany({
      where: { orgId, status: { in: ['derivacao', 'agendado'] }, OR: [{ envioAoYoutube: null }, { envioAoYoutube: { estado: { in: ['declarado', 'sessao_aberta', 'erro'] } } }] },
      orderBy: { numero: 'desc' },
      take: 20,
      select: { id: true, numero: true, midia: true, envioAoYoutube: { select: { sha256: true, estado: true, videoId: true } } },
    });
    const agora = new Date();
    const vivos = await this.lotes.itensVivos(orgId, CAPACIDADE_DE_ENVIAR, eps.map((e) => e.id), agora);
    const items: PautaYoutubePendente[] = [];
    for (const e of eps) {
      const v = vivos.get(e.id);
      // Com o id do vídeo e sem a conferência (o "concluído" que caiu no meio), o vigia só conclui.
      if (!v || v.estadoDoLote !== 'ativo' || !dentroDaJanela(v, agora)) continue;
      items.push({
        id: e.id,
        numero: e.numero,
        apelido: apelidoDoEpisodio(e.numero),
        arquivoFinal: midiaDoEpisodio(e.midia)?.arquivoFinal ?? null,
        sha256: e.envioAoYoutube?.sha256 ?? null,
        estado: (e.envioAoYoutube?.estado as EnvioAoYoutubeEstado | undefined) ?? null,
        janelaAte: v.janelaAte.toISOString(),
      });
    }
    return { items };
  }

  // ------------------------------------------------------------------ o pacote: thumb, horário, arquivo

  /** Mexer no que o hash cobre derruba os itens do YouTube ainda vivos: o lote antigo não sai com o conteúdo novo. */
  private async revogarItens(orgId: string, episodioId: string, motivo: string, actorId: string): Promise<void> {
    if (!this.lotes) return;
    for (const cap of [CAPACIDADE_DE_ENVIAR, CAPACIDADE_DE_PUBLICAR]) {
      try {
        await this.lotes.revogarItensDoRecurso(orgId, cap, episodioId, motivo, actorId);
      } catch (e) {
        this.log.warn(`item ${cap} do episódio ${episodioId} não foi revogado (${motivo}): ${(e as Error).message}`);
      }
    }
  }

  /** `PUT …/pacote/thumb`: a thumb que sobe ao YouTube. Depois do vídeo agendado, não muda. */
  async escolherThumb(orgId: string, episodioId: string, actorId: string, n: number | null): Promise<PautaYoutubeDoEpisodio> {
    const e = await this.episodio(orgId, episodioId);
    const trava = travaDoYoutube(e);
    if (trava) throw new BadRequestException(trava);
    if (n !== null && !(Array.isArray(e.thumbs) && e.thumbs.some((t) => Number((t as { n?: unknown })?.n) === n))) {
      throw new BadRequestException(`O pacote não tem a thumb ${n}: gere o pacote antes.`);
    }
    if (e.thumbEscolhida !== n) {
      const u = await this.prisma.pautaEpisodio.updateMany({ where: { id: e.id, orgId, status: e.status, thumbEscolhida: e.thumbEscolhida }, data: { thumbEscolhida: n } });
      if (u.count !== 1) throw new ConflictException('O episódio mudou enquanto a thumb era escolhida: recarregue.');
      await this.revogarItens(orgId, e.id, 'a thumb do YouTube mudou', actorId);
      await this.audit.log({ orgId, actorId, action: 'pauta.youtube_thumb', entityType: 'pauta_episodio', entityId: e.id, before: { thumbEscolhida: e.thumbEscolhida }, after: { thumbEscolhida: n } });
    }
    return this.doEpisodio(orgId, episodioId);
  }

  /** `PUT …/pacote/horario`: quando o vídeo vai ao ar. Depois do vídeo agendado, não muda. */
  async definirHorario(orgId: string, episodioId: string, actorId: string, publicarEm: Date | null): Promise<PautaYoutubeDoEpisodio> {
    const e = await this.episodio(orgId, episodioId);
    const trava = travaDoYoutube(e);
    if (trava) throw new BadRequestException(trava);
    if (publicarEm && publicarEm.getTime() <= Date.now()) throw new BadRequestException('O horário do vídeo já passou.');
    if ((e.publicarNoYoutubeEm?.getTime() ?? null) !== (publicarEm?.getTime() ?? null)) {
      const u = await this.prisma.pautaEpisodio.updateMany({
        where: { id: e.id, orgId, status: e.status, publicarNoYoutubeEm: e.publicarNoYoutubeEm },
        data: { publicarNoYoutubeEm: publicarEm },
      });
      if (u.count !== 1) throw new ConflictException('O episódio mudou enquanto o horário era definido: recarregue.');
      await this.revogarItens(orgId, e.id, 'o horário do vídeo no YouTube mudou', actorId);
      await this.audit.log({
        orgId,
        actorId,
        action: 'pauta.youtube_horario',
        entityType: 'pauta_episodio',
        entityId: e.id,
        before: { publicarEm: e.publicarNoYoutubeEm?.toISOString() ?? null },
        after: { publicarEm: publicarEm?.toISOString() ?? null },
      });
    }
    return this.doEpisodio(orgId, episodioId);
  }

  /**
   * `PUT …/youtube/arquivo`: o Mac declara o vídeo final (sha256 e tamanho),
   * lido por stream no Mac. O mesmo arquivo é idempotente; outro arquivo
   * recomeça o envio do zero e derruba os itens do lote que cobriam o anterior.
   * Depois que o vídeo subiu, o arquivo não troca por aqui.
   */
  async declararArquivo(orgId: string, episodioId: string, actorId: string, a: YoutubeArquivoInput): Promise<PautaYoutubeDoEpisodio> {
    const e = await this.episodio(orgId, episodioId);
    if (!midiaDoEpisodio(e.midia)) throw new BadRequestException('O episódio ainda não tem o vídeo final: rode /root-midia antes.');
    const r = e.envioAoYoutube;
    // O vídeo do modo teste ficou no canal de teste, privado para sempre: declarar de novo recomeça o envio, para o canal real.
    const doTeste = this.doTesteParaRefazer(r);
    if (r && !doTeste && r.sha256 === a.sha256 && Number(r.bytes) === a.bytes) return this.doEpisodio(orgId, episodioId);
    if (r?.videoId && !doTeste) {
      throw new ConflictException('O vídeo deste episódio já subiu ao YouTube com outro arquivo. O OS não apaga vídeo: resolva no Studio e fale com quem cuida do canal.');
    }
    if (r) {
      const u = await this.prisma.envioAoYoutube.updateMany({
        where: { id: r.id, orgId, estado: r.estado, videoId: r.videoId },
        data: {
          ...SOLTAR_O_VIDEO,
          sha256: a.sha256,
          bytes: BigInt(a.bytes),
          mime: a.mime,
          estado: 'declarado',
          sessaoAbertaEm: null,
          expiraEm: null,
          sessoes: 0,
          erro: null,
          publicarEm: null,
          agendadoEm: null,
        },
      });
      if (u.count !== 1) throw new ConflictException('O envio mudou enquanto o arquivo era declarado: tente de novo.');
      await this.revogarItens(orgId, e.id, doTeste ? 'o vídeo do modo teste foi deixado no canal de teste' : 'o vídeo final do episódio mudou', actorId);
    } else {
      await this.prisma.envioAoYoutube.create({ data: { episodioId: e.id, sha256: a.sha256, bytes: BigInt(a.bytes), mime: a.mime } });
    }
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.youtube_arquivo',
      entityType: 'pauta_episodio',
      entityId: e.id,
      before: r ? { sha256: r.sha256.slice(0, 12), bytes: Number(r.bytes), ...(doTeste ? { videoDoTeste: r.videoId } : {}) } : undefined,
      after: { sha256: a.sha256.slice(0, 12), bytes: a.bytes, mime: a.mime },
    });
    return this.doEpisodio(orgId, episodioId);
  }

  // ------------------------------------------------------------------ a sessão e a conclusão (o Mac)

  /**
   * O item de envio ATIVO de um lote ASSINADO, dentro da JANELA dele, ou a
   * frase de por que não há. A janela do envio fecha 1 h antes do horário do
   * vídeo, mas o lote vale até o último item da semana: sem esta conta, a
   * sessão aberta e o token seguiriam saindo por dias depois do que a titular
   * assinou — e a porta só confere a janela no uso que passa por ela.
   */
  private async itemDeEnvio(orgId: string, episodioId: string): Promise<ItemVivo> {
    const agora = new Date();
    const v = this.lotes ? (await this.lotes.itensVivos(orgId, CAPACIDADE_DE_ENVIAR, [episodioId], agora)).get(episodioId) : undefined;
    if (!v || v.estadoDoLote !== 'ativo') {
      throw new ConflictException(
        v
          ? 'O lote da semana com o YouTube ainda não foi assinado: a titular assina em /atendimento. Nada foi enviado.'
          : 'Não há item de envio ao YouTube num lote assinado: aprove a semana com o YouTube dentro (aba Semana). Nada foi enviado.',
      );
    }
    if (agora.getTime() < v.janelaDe.getTime()) throw new ConflictException('A janela do envio ao YouTube ainda não abriu. Nada foi enviado.');
    if (agora.getTime() > v.janelaAte.getTime()) {
      throw new ConflictException(
        'A janela do envio ao YouTube fechou (1 h antes do horário do vídeo): nem a sessão nem o token saem depois dela. Mude o horário e aprove a semana de novo, ou suba à mão no Studio. Nada foi enviado.',
      );
    }
    return v;
  }

  /**
   * A sessão já aberta e o token só saem para o conteúdo que a titular assinou:
   * sem passar pela porta, a conferência do hash é feita aqui, com a mesma conta.
   * O item que não bate mais é revogado — senão ele ficaria ativo e divergente,
   * e o vídeo não voltaria ao "Aprovar a semana".
   */
  private async conferirComOItem(
    orgId: string,
    episodioId: string,
    item: ItemVivo,
    envio: { args: ArgsDoEnvioAoYoutube } | { problema: string },
    actorId: string,
  ): Promise<void> {
    if ('problema' in envio) throw new BadRequestException(`${envio.problema} Nada foi enviado.`);
    const hash = this.lotes!.hashDoItem(orgId, CAPACIDADE_DE_ENVIAR, envio.args as unknown as Record<string, unknown>);
    if (hash !== item.hashItem) {
      await this.revogarItens(orgId, episodioId, 'o pacote do vídeo mudou depois da assinatura', actorId);
      throw new ConflictException(
        'O pacote do vídeo mudou depois da assinatura (título, descrição, thumb ou arquivo): o item do lote foi revogado e o vídeo volta ao "Aprovar a semana". Nada foi enviado.',
      );
    }
  }

  private async interruptor(orgId: string, capabilityId: string): Promise<void> {
    const recusa = await this.interruptores.consultar({ orgId, capabilityId, conector: 'youtube' });
    if (recusa) throw new ForbiddenException({ statusCode: 403, error: 'conector_desligado', message: recusa.motivo });
  }

  /** No modo teste, só o canal de `YOUTUBE_CANAL_DE_TESTE` recebe o vídeo. */
  private async canalDeTeste(orgId: string): Promise<void> {
    const auditoria = this.auditoria();
    if (auditoria !== 'teste') return;
    const motivo = motivoDoCanalDeTeste(auditoria, process.env.YOUTUBE_CANAL_DE_TESTE, await this.youtube.canalConectado(orgId));
    if (motivo) throw new ForbiddenException(motivo);
  }

  /**
   * O token que o Mac leva, pedido só com `youtube.upload`. Se o Google
   * devolver mais que isso (o `force-ssl` também altera e apaga os vídeos do
   * canal), com a auditoria aprovada ele NÃO sai: sem a auditoria, todo vídeo
   * do projeto fica privado de qualquer jeito, e o modo teste só alcança o
   * canal de teste. `forcar`: o Mac pediu outro porque o YouTube respondeu 401.
   *
   * O LIMITE DESTA TRAVA: `soEnvio` defende contra apagar e alterar vídeo, e
   * NÃO contra publicar. `videos.insert` aceita o escopo `youtube.upload` e
   * grava `status.privacyStatus` na inserção: num projeto auditado, este token
   * cria um vídeo PÚBLICO à parte, com qualquer arquivo, sem passar pela porta.
   * O risco é residual da D-MC6 (os bytes não passam pela VPS, `naoFazer`) e
   * está com o Pedro. O que o reduz: só quem tem `pauta.enviar_ao_youtube` recebe
   * o token (a conta do Mac, não todo editor), e a conclusão confere os
   * uploads do canal na janela da sessão (`conferirUploadsDoCanal`).
   */
  private async tokenParaOMac(orgId: string, forcar: boolean): Promise<{ token: string; expiraEm: Date; soEnvio: boolean }> {
    let token: { token: string; expiraEm: Date; soEnvio: boolean };
    try {
      token = await this.youtube.tokenDoEnvio(orgId, { forcar });
    } catch (e) {
      throw new ServiceUnavailableException(fraseDoYoutube(e));
    }
    if (!token.soEnvio && this.auditoria() === 'aprovada') {
      throw new ServiceUnavailableException(
        'O Google devolveu o token do envio com mais que o escopo de envio: com a auditoria aprovada, esse token tornaria vídeos públicos e os apagaria fora do lote, e o OS não o entrega ao Mac. Nada foi enviado. Veja o manual da MD10 (a autorização só de envio).',
      );
    }
    return token;
  }

  /**
   * A sessão e o token curto, que só o Mac recebe. Cada entrega vai ao RASTRO
   * (quem, qual episódio, até quando o token vale) — nunca o token nem a URI.
   */
  private async sessaoParaOMac(
    orgId: string,
    r: EnvioAoYoutube,
    nova: boolean,
    actorId: string,
    token: { token: string; expiraEm: Date; soEnvio: boolean },
    renovado = false,
  ): Promise<PautaSessaoDoYoutube> {
    if (!r.sessaoCifrada || !r.expiraEm) throw new ConflictException('Não há sessão de envio aberta.');
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.youtube_token_entregue',
      entityType: 'pauta_episodio',
      entityId: r.episodioId,
      after: { nova, renovado, soEnvio: token.soEnvio, tokenVaiAte: token.expiraEm.toISOString(), sessaoVaiAte: r.expiraEm.toISOString(), sessoes: r.sessoes },
    });
    return {
      uri: decifrar(r.sessaoCifrada),
      token: token.token,
      tokenExpiraEm: token.expiraEm.toISOString(),
      sessaoExpiraEm: r.expiraEm.toISOString(),
      bytes: Number(r.bytes),
      sha256: r.sha256,
      nova,
    };
  }

  /**
   * `POST …/youtube/sessao`. Tudo o que recusa vem ANTES da porta: sem o item de
   * envio num lote assinado, com a auditoria `pendente`, com o arquivo diferente
   * do declarado, o YouTube não recebe nada. A sessão ainda aberta é devolvida
   * (com token novo) sem gastar uso; `nova` abre outra (a anterior sumiu, 404).
   */
  async abrirSessao(orgId: string, episodioId: string, actorId: string, a: YoutubeArquivoInput & { nova?: boolean }): Promise<PautaSessaoDoYoutube> {
    return umaPorVez(`youtube-sessao:${orgId}:${episodioId}`, 'A abertura da sessão de envio deste vídeo', async () => {
      const auditoria = motivoDaAuditoriaParaEnviar(this.auditoria());
      if (auditoria) throw new BadRequestException(auditoria);
      const { episodio: e, envio } = await this.argsAtuais(orgId, episodioId);
      const r = e.envioAoYoutube;
      if (!r) throw new BadRequestException('O Mac ainda não declarou o vídeo final: rode root-midia youtube ep-NN --declarar.');
      if (r.sha256 !== a.sha256 || Number(r.bytes) !== a.bytes) {
        throw new ConflictException('Este arquivo não é o vídeo final declarado (sha256 ou tamanho diferentes): declare de novo e aprove a semana outra vez. Nada foi enviado.');
      }
      if (r.videoId) throw new ConflictException('O vídeo já subiu ao YouTube: conclua o envio com o id dele (root-midia youtube ep-NN).');
      const item = await this.itemDeEnvio(orgId, e.id);
      await this.interruptor(orgId, CAPACIDADE_DE_ENVIAR);
      await this.canalDeTeste(orgId);
      if (!a.nova && r.estado === 'sessao_aberta' && r.expiraEm && r.expiraEm.getTime() > Date.now() + 60_000) {
        await this.conferirComOItem(orgId, e.id, item, envio, actorId);
        return this.sessaoParaOMac(orgId, r, false, actorId, await this.tokenParaOMac(orgId, false));
      }
      if ('problema' in envio) throw new BadRequestException(`${envio.problema} Nada foi enviado.`);
      // O token vem ANTES da porta: o que não pode sair ao Mac não gasta uso nem abre sessão no YouTube.
      const token = await this.tokenParaOMac(orgId, false);
      await this.pelaPorta(orgId, actorId, ActorType.user, CAPACIDADE_DE_ENVIAR, envio.args as unknown as Record<string, unknown>, item.itemId, e.id);
      const depois = await this.prisma.envioAoYoutube.findFirst({ where: { episodioId: e.id, orgId } });
      if (!depois || depois.estado !== 'sessao_aberta') throw new ServiceUnavailableException(depois?.erro ?? 'A sessão não foi aberta.');
      return this.sessaoParaOMac(orgId, depois, true, actorId, token);
    });
  }

  /**
   * `POST …/youtube/sessao/token`: um token novo para a MESMA sessão, só com
   * ela aberta e dentro do prazo. O Mac só pede isto quando o YouTube respondeu
   * 401, então o token guardado é descartado e renovado de verdade.
   */
  async novoToken(orgId: string, episodioId: string, actorId: string): Promise<PautaSessaoDoYoutube> {
    const auditoria = motivoDaAuditoriaParaEnviar(this.auditoria());
    if (auditoria) throw new BadRequestException(auditoria);
    const { episodio: e, envio } = await this.argsAtuais(orgId, episodioId);
    const r = e.envioAoYoutube;
    if (!r || r.estado !== 'sessao_aberta' || !r.expiraEm || r.expiraEm.getTime() <= Date.now()) {
      throw new ConflictException('Não há sessão de envio aberta para este vídeo: peça uma sessão nova.');
    }
    await this.conferirComOItem(orgId, e.id, await this.itemDeEnvio(orgId, e.id), envio, actorId);
    await this.interruptor(orgId, CAPACIDADE_DE_ENVIAR);
    await this.canalDeTeste(orgId);
    return this.sessaoParaOMac(orgId, r, false, actorId, await this.tokenParaOMac(orgId, true), true);
  }

  /**
   * `POST …/youtube/concluido {videoId}`: o Mac terminou de mandar os bytes. O
   * id é gravado na linha (só vindo da sessão aberta) e o efeito de envio,
   * com outro uso do item, confere o vídeo e define a thumb.
   */
  async concluir(orgId: string, episodioId: string, actorId: string, videoId: string): Promise<PautaYoutubeDoEpisodio> {
    return umaPorVez(`youtube-sessao:${orgId}:${episodioId}`, 'A conclusão do envio deste vídeo', async () => {
      const auditoria = motivoDaAuditoriaParaEnviar(this.auditoria());
      if (auditoria) throw new BadRequestException(auditoria);
      const { episodio: e, envio } = await this.argsAtuais(orgId, episodioId);
      const r = e.envioAoYoutube;
      if (!r || !r.sessaoAbertaEm) throw new ConflictException('Nenhuma sessão de envio foi aberta para este vídeo.');
      if (r.estado === 'conferido' || r.estado === 'agendado') {
        if (r.videoId === videoId) return this.doEpisodio(orgId, episodioId);
        throw new ConflictException('Este episódio já tem outro vídeo conferido no YouTube.');
      }
      if (r.videoId && r.videoId !== videoId) throw new ConflictException('O envio deste episódio já foi concluído com outro id de vídeo.');
      const item = await this.itemDeEnvio(orgId, e.id);
      if ('problema' in envio) throw new BadRequestException(`${envio.problema} Nada foi enviado.`);
      if (!r.videoId) {
        await this.exigirOVideoDaSessao(orgId, r, videoId);
        const u = await this.prisma.envioAoYoutube.updateMany({
          where: { id: r.id, orgId, estado: r.estado, videoId: null },
          data: { videoId },
        });
        if (u.count !== 1) throw new ConflictException('O envio mudou enquanto era concluído: tente de novo.');
      }
      await this.pelaPorta(orgId, actorId, ActorType.user, CAPACIDADE_DE_ENVIAR, envio.args as unknown as Record<string, unknown>, item.itemId, e.id);
      return this.doEpisodio(orgId, episodioId);
    });
  }

  /**
   * O id que o Mac informa não é a fonte da verdade: o OS pergunta à sessão
   * resumable que ELE abriu (com o tamanho assinado no cabeçalho) qual vídeo
   * ela criou, e recusa quando não bate. Sem isso, qualquer vídeo privado com
   * os mesmos título, descrição e categoria passaria pela conferência.
   */
  private async exigirOVideoDaSessao(orgId: string, r: EnvioAoYoutube, informado: string): Promise<void> {
    if (!r.sessaoCifrada) {
      throw new ConflictException('A sessão de envio que o OS abriu não está mais guardada: peça uma sessão nova (root-midia youtube ep-NN). Nada foi conferido.');
    }
    let s;
    try {
      s = await this.youtube.resultadoDaSessao(orgId, decifrar(r.sessaoCifrada), Number(r.bytes));
    } catch (e) {
      if (e instanceof ErroDoYoutube && e.status === 404) {
        throw new ConflictException('A sessão de envio que o OS abriu não existe mais no YouTube: peça uma sessão nova e mande o arquivo de novo. Nada foi conferido.');
      }
      throw new ServiceUnavailableException(`A sessão de envio não respondeu: ${fraseDoYoutube(e)} Tente concluir de novo.`);
    }
    if (!s.videoId) {
      throw new ConflictException(`O upload na sessão aberta pelo OS não terminou (${s.recebidos} de ${Number(r.bytes)} bytes): o Mac termina de mandar antes de concluir.`);
    }
    if (s.videoId !== informado) {
      throw new ConflictException('O vídeo informado não é o que a sessão aberta pelo OS recebeu (o arquivo assinado): nada foi conferido.');
    }
  }

  /**
   * Depois de conferido, os uploads do canal desde a abertura da sessão: um
   * vídeo não privado que o OS não abriu é o sinal do token do Mac usado fora
   * do lote (ver `tokenParaOMac`). Vira aviso na linha e no RASTRO; a leitura
   * que falha também vira aviso, e não derruba o envio conferido.
   */
  private async conferirUploadsDoCanal(orgId: string, r: EnvioAoYoutube, ctx: ContextoDoEfeito): Promise<string | null> {
    if (!r.sessaoAbertaEm || !r.videoId) return null;
    let uploads;
    try {
      uploads = await this.youtube.uploadsDoCanal(orgId);
    } catch (e) {
      return `uploads do canal não conferidos: ${fraseDoYoutube(e)}`;
    }
    const desde = r.sessaoAbertaEm.getTime() - 60_000;
    const estranhos = uploads.filter(
      (u) => u.videoId !== r.videoId && u.privacidade !== 'private' && u.enviadoEm !== null && new Date(u.enviadoEm).getTime() >= desde,
    );
    if (!estranhos.length) return null;
    await this.audit.log({
      orgId,
      actorId: ctx.actorId ?? undefined,
      action: 'pauta.youtube_upload_fora_do_lote',
      entityType: 'pauta_episodio',
      entityId: r.episodioId,
      after: { videos: estranhos.slice(0, 10).map((u) => ({ videoId: u.videoId, privacidade: u.privacidade, enviadoEm: u.enviadoEm })) },
      metadata: { correlationId: ctx.correlationId ?? null, loteItemId: ctx.loteItemId ?? null } as Prisma.InputJsonValue,
    });
    return `ATENÇÃO: o canal recebeu ${estranhos.length} vídeo(s) não privado(s) que o OS não abriu, desde a sessão deste envio (${estranhos
      .slice(0, 3)
      .map((u) => u.videoId)
      .join(', ')}): confira no Studio e, se não foi a equipe, desligue o YouTube em /conexoes`;
  }

  private async pelaPorta(
    orgId: string,
    actorId: string,
    actorType: ActorType,
    capabilityId: string,
    args: Record<string, unknown>,
    loteItemId: string,
    episodioId: string,
  ): Promise<unknown> {
    const r = await this.porta.executar({
      orgId,
      actorId,
      actorType,
      capabilityId,
      args: { ...args, loteItemId },
      resource: { type: capabilityId, id: episodioId },
    });
    if (ehRetida(r)) throw new ConflictException('A porta reteve o pedido em vez de consumir o item do lote: nada foi enviado ao YouTube.');
    return r;
  }

  // ------------------------------------------------------------------ os efeitos

  private async passo(orgId: string, episodioId: string, ctx: ContextoDoEfeito | { actorId: string; correlationId: string | null; loteItemId?: string | null }, passo: string, detalhe: Record<string, unknown>) {
    await this.audit.log({
      orgId,
      actorId: ctx.actorId ?? undefined,
      action: ACAO_DO_PASSO_DO_YOUTUBE,
      entityType: 'pauta_episodio',
      entityId: episodioId,
      after: { passo, ...detalhe } as Prisma.InputJsonValue,
      metadata: { correlationId: ctx.correlationId ?? null, ...(ctx.loteItemId ? { loteItemId: ctx.loteItemId } : {}) } as Prisma.InputJsonValue,
    });
  }

  /** Grava o erro na linha e lança: a porta registra `acao.falhou`, e a tela e o Mac leem o motivo. */
  private async falhar(orgId: string, r: EnvioAoYoutube, ctx: ContextoDoEfeito, motivo: string, extra: Partial<EnvioAoYoutube> = {}): Promise<never> {
    await this.prisma.envioAoYoutube.updateMany({
      where: { id: r.id, orgId },
      data: { estado: r.estado === 'agendado' ? 'agendado' : 'erro', erro: motivo.slice(0, 500), loteItemId: ctx.loteItemId ?? r.loteItemId, ...(extra as object) },
    });
    await this.passo(orgId, r.episodioId, ctx, 'erro', { motivo: motivo.slice(0, 300) });
    throw new ServiceUnavailableException(motivo);
  }

  /**
   * Relê o episódio e confere que os argumentos que a porta aprovou ainda são
   * os de agora — o hash que o item cobre é o do conteúdo assinado; o que
   * mudou depois (título, descrição, thumb, arquivo) não sai.
   */
  private async conferirArgs<T extends ArgsDoEnvioAoYoutube>(orgId: string, a: Record<string, unknown>, qual: 'envio' | 'publicacao'): Promise<{ args: T; e: LinhaDoEpisodio; r: EnvioAoYoutube }> {
    const episodioId = String(a.episodioId ?? '');
    const atual = await this.argsAtuais(orgId, episodioId);
    const x = qual === 'envio' ? atual.envio : atual.publicacao;
    if ('problema' in x) throw new ConflictException(`O vídeo não sai como está: ${x.problema} Nada foi enviado.`);
    if (!mesmosArgs(x.args as unknown as Record<string, unknown>, a)) {
      throw new ConflictException('O pacote do vídeo mudou depois da assinatura (título, descrição, thumb, arquivo ou horário): nada foi enviado.');
    }
    const r = atual.episodio.envioAoYoutube;
    if (!r) throw new ConflictException('O vídeo final não foi declarado. Nada foi enviado.');
    return { args: x.args as T, e: atual.episodio, r };
  }

  /** O PNG da thumb assinada, lido do storage e conferido pelo sha curto do nome. */
  private async pngDaThumb(a: ArgsDoEnvioAoYoutube): Promise<Buffer> {
    const { stream } = await this.storage.get(a.thumbChave);
    const png = await lerAte(stream, PAUTA_THUMB_MAX_BYTES);
    if (!pngDaThumbConfere(createHash('sha256').update(png).digest('hex'), a.thumbSha)) {
      throw new Error('o PNG da thumb no storage não é o assinado');
    }
    return png;
  }

  /** Define a thumb (e a playlist). Devolve os avisos: a thumb que não entrou não barra a conferência, barra a publicação. */
  private async thumbEPlaylist(orgId: string, r: EnvioAoYoutube, a: ArgsDoEnvioAoYoutube, exigirThumb: boolean): Promise<{ dados: Prisma.EnvioAoYoutubeUpdateManyMutationInput; avisos: string[] }> {
    const dados: Prisma.EnvioAoYoutubeUpdateManyMutationInput = {};
    const avisos: string[] = [];
    const videoId = r.videoId!;
    if (r.thumbSha !== a.thumbSha || !r.thumbDefinidaEm) {
      try {
        await this.youtube.definirThumb(orgId, videoId, await this.pngDaThumb(a));
        dados.thumbSha = a.thumbSha;
        dados.thumbDefinidaEm = new Date();
      } catch (e) {
        const porque =
          e instanceof ErroDoYoutube && e.status === 403
            ? 'o YouTube recusou a thumb (403): o canal precisa estar verificado por telefone em youtube.com/verify'
            : fraseDoYoutube(e);
        if (exigirThumb) throw new Error(`A thumb assinada não pôde ser definida: ${porque}.`);
        avisos.push(`thumb: ${porque}`);
      }
    }
    const playlist = await this.playlist(orgId);
    if (playlist && !r.playlistItemId) {
      try {
        dados.playlistItemId = await this.youtube.inserirNaPlaylist(orgId, playlist, videoId);
        dados.playlistId = playlist;
      } catch (e) {
        avisos.push(`playlist: ${fraseDoYoutube(e)}`);
      }
    }
    return { dados, avisos };
  }

  /**
   * `youtube.video.enviar`. Só pelo item do lote. Duas etapas no mesmo efeito,
   * decididas pela linha: sem o id do vídeo, abre a sessão resumable (sempre
   * privada, sem `publishAt`); com o id (gravado pelo "concluído"), confere o
   * vídeo e define a thumb e a playlist.
   */
  async efeitoDeEnviar(a: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<{ estado: EnvioAoYoutubeEstado; sessoes: number; videoId: string | null; avisos: string[] }> {
    if (!ctx.loteItemId) throw new ForbiddenException('O envio ao YouTube só sai pelo item do lote da semana. Nada foi enviado.');
    const auditoria = motivoDaAuditoriaParaEnviar(this.auditoria());
    if (auditoria) throw new ForbiddenException(auditoria);
    const { args, r } = await this.conferirArgs<ArgsDoEnvioAoYoutube>(orgId, a, 'envio');

    if (r.estado === 'conferido' || r.estado === 'agendado') {
      return { estado: r.estado, sessoes: r.sessoes, videoId: r.videoId, avisos: [] };
    }

    if (!r.videoId) {
      await this.canalDeTeste(orgId);
      let uri: string;
      try {
        uri = await this.youtube.abrirSessao(orgId, { bytes: args.bytes, mime: r.mime, metadados: { titulo: args.titulo, descricao: args.descricao, categoria: args.categoria } });
      } catch (e) {
        return this.falhar(orgId, r, ctx, `A sessão de envio não abriu: ${fraseDoYoutube(e)}`);
      }
      const agora = new Date();
      const u = await this.prisma.envioAoYoutube.updateMany({
        where: { id: r.id, orgId, estado: r.estado, videoId: null },
        data: {
          estado: 'sessao_aberta',
          sessaoCifrada: cifrar(uri),
          sessaoAbertaEm: agora,
          expiraEm: new Date(agora.getTime() + YOUTUBE_VALIDADE_DA_SESSAO_MS),
          sessoes: { increment: 1 },
          erro: null,
          loteItemId: ctx.loteItemId,
          enviadoEmTeste: this.auditoria() === 'teste',
        },
      });
      if (u.count !== 1) throw new ConflictException('O envio mudou enquanto a sessão era aberta.');
      await this.passo(orgId, r.episodioId, ctx, 'sessao_aberta', { sessao: r.sessoes + 1, bytes: args.bytes, sha256: args.sha256.slice(0, 12) });
      return { estado: 'sessao_aberta', sessoes: r.sessoes + 1, videoId: null, avisos: [] };
    }

    // A conclusão: o vídeo que o Mac diz ter enviado é o do canal, privado e com o que foi assinado?
    let video;
    try {
      video = await this.youtube.lerVideo(orgId, r.videoId);
    } catch (e) {
      return this.falhar(orgId, r, ctx, `O vídeo não pôde ser conferido: ${fraseDoYoutube(e)}`);
    }
    const divergencia = divergenciaDoVideo(video, args);
    if (divergencia) {
      /*
       * O id que não é do canal (ou o vídeo que o YouTube recusou) não prende a
       * linha. Com a sessão ainda de pé, ela segue reaproveitável: a próxima
       * execução pergunta ao YouTube onde parou (`bytes * /total`) e recebe o id
       * certo, sem abrir outra sessão nem subir o arquivo de novo.
       */
      if (video && !envioPerdido(video)) return this.falhar(orgId, r, ctx, divergencia);
      const reaproveita = !video && !!r.sessaoCifrada && !!r.expiraEm && r.expiraEm.getTime() > Date.now() + 60_000;
      return this.falhar(orgId, r, ctx, divergencia, reaproveita ? { videoId: null, estado: 'sessao_aberta' } : { ...SOLTAR_O_VIDEO });
    }
    let extra: { dados: Prisma.EnvioAoYoutubeUpdateManyMutationInput; avisos: string[] };
    try {
      extra = await this.thumbEPlaylist(orgId, r, args, false);
    } catch (e) {
      return this.falhar(orgId, r, ctx, fraseDoYoutube(e));
    }
    const estranho = await this.conferirUploadsDoCanal(orgId, r, ctx);
    if (estranho) extra.avisos.unshift(estranho);
    const u = await this.prisma.envioAoYoutube.updateMany({
      where: { id: r.id, orgId, estado: r.estado, videoId: r.videoId },
      data: {
        ...extra.dados,
        estado: 'conferido',
        conferidoEm: new Date(),
        sessaoCifrada: null,
        erro: extra.avisos.length ? `Aviso: ${extra.avisos.join(' · ')}`.slice(0, 500) : null,
        loteItemId: ctx.loteItemId,
      },
    });
    if (u.count !== 1) throw new ConflictException('O envio mudou enquanto era conferido.');
    await this.passo(orgId, r.episodioId, ctx, 'conferido', { videoId: r.videoId, thumb: !!extra.dados.thumbDefinidaEm, avisos: extra.avisos });
    return { estado: 'conferido', sessoes: r.sessoes, videoId: r.videoId, avisos: extra.avisos };
  }

  /**
   * `youtube.video.publicar`. Só pelo item do lote e com a auditoria aprovada.
   * Relê o vídeo, recusa o que diverge do hash, garante a thumb assinada e a
   * playlist e manda o `publishAt` (só `part=status`).
   */
  async efeitoDePublicar(a: Record<string, unknown>, orgId: string, ctx: ContextoDoEfeito): Promise<{ estado: EnvioAoYoutubeEstado; videoId: string; publicarEm: string }> {
    if (!ctx.loteItemId) throw new ForbiddenException('A publicação no YouTube só sai pelo item do lote da semana. Nada foi enviado.');
    const auditoria = motivoDaAuditoriaParaPublicar(this.auditoria());
    if (auditoria) throw new ForbiddenException(auditoria);
    const { args, r } = await this.conferirArgs<ArgsDaPublicacaoNoYoutube>(orgId, a, 'publicacao');
    const publicarEm = new Date(args.publicarEm);
    if (r.estado === 'agendado' && r.publicarEm?.getTime() === publicarEm.getTime()) {
      return { estado: 'agendado', videoId: r.videoId!, publicarEm: args.publicarEm };
    }
    if (r.enviadoEmTeste) {
      throw new ConflictException('O vídeo subiu no modo teste (canal de teste) e fica privado para sempre: declare o vídeo final de novo para o canal real. Nada foi enviado.');
    }
    const conferido = r.estado === 'conferido' || (r.estado === 'erro' && !!r.conferidoEm);
    if (!conferido || !r.videoId) {
      throw new ConflictException('O vídeo ainda não está no YouTube conferido: o Mac termina o envio antes. Nada foi enviado.');
    }
    if (publicarEm.getTime() <= Date.now() + 60_000) {
      return this.falhar(orgId, r, ctx, 'O horário do vídeo já passou (ou falta menos de 1 min): o YouTube recusaria o publishAt. Nada foi enviado.');
    }
    let video;
    try {
      video = await this.youtube.lerVideo(orgId, r.videoId);
    } catch (e) {
      return this.falhar(orgId, r, ctx, `O vídeo não pôde ser relido: ${fraseDoYoutube(e)}`);
    }
    const divergencia = divergenciaDoVideo(video, args);
    // O vídeo que sumiu do canal (ou que o YouTube recusou) solta a linha: o arquivo pode subir de novo com outro lote.
    if (divergencia) return this.falhar(orgId, r, ctx, divergencia, !video || envioPerdido(video) ? { ...SOLTAR_O_VIDEO } : {});
    let extra: { dados: Prisma.EnvioAoYoutubeUpdateManyMutationInput; avisos: string[] };
    try {
      extra = await this.thumbEPlaylist(orgId, r, args, true);
    } catch (e) {
      return this.falhar(orgId, r, ctx, fraseDoYoutube(e), { thumbDefinidaEm: null });
    }
    let agendado;
    try {
      agendado = await this.youtube.agendar(orgId, r.videoId, publicarEm);
    } catch (e) {
      return this.falhar(orgId, r, ctx, `O YouTube não aceitou o horário: ${fraseDoYoutube(e)}`, extra.dados as Partial<EnvioAoYoutube>);
    }
    if (!agendado.publishAt || new Date(agendado.publishAt).getTime() !== publicarEm.getTime() || agendado.privacidade !== 'private') {
      return this.falhar(orgId, r, ctx, 'O YouTube respondeu ao agendamento sem o horário pedido: confira no Studio.', extra.dados as Partial<EnvioAoYoutube>);
    }
    await this.prisma.envioAoYoutube.updateMany({
      where: { id: r.id, orgId },
      data: { ...extra.dados, estado: 'agendado', publicarEm, agendadoEm: new Date(), erro: extra.avisos.length ? `Aviso: ${extra.avisos.join(' · ')}`.slice(0, 500) : null, loteItemId: ctx.loteItemId },
    });
    await this.passo(orgId, r.episodioId, ctx, 'agendado', { videoId: r.videoId, publicarEm: args.publicarEm, avisos: extra.avisos });
    await this.audit.log({
      orgId,
      actorId: ctx.actorId ?? undefined,
      action: 'pauta.youtube_agendado',
      entityType: 'pauta_episodio',
      entityId: r.episodioId,
      after: { videoId: r.videoId, publicarEm: args.publicarEm, titulo: args.titulo },
      metadata: { correlationId: ctx.correlationId ?? null, loteItemId: ctx.loteItemId } as Prisma.InputJsonValue,
    });
    // O que sobrou dos usos não serve mais: o vídeo está agendado, e o lote pode se encerrar.
    await this.revogarItens(orgId, r.episodioId, 'o vídeo já está agendado no YouTube', ctx.actorId ?? ATOR_DA_ROTINA);
    return { estado: 'agendado', videoId: r.videoId, publicarEm: args.publicarEm };
  }

  // ------------------------------------------------------------------ a rotina

  private async registrarPulada(orgId: string, episodioId: string, itemId: string, motivo: string, correlationId: string | null): Promise<void> {
    const ja = await this.prisma.auditLog.findFirst({
      where: {
        orgId,
        action: ACAO_DO_PASSO_DO_YOUTUBE,
        entityType: 'pauta_episodio',
        entityId: episodioId,
        AND: [{ after: { path: ['passo'], equals: 'pulada' } }, { after: { path: ['itemId'], equals: itemId } }, { after: { path: ['motivo'], equals: motivo } }],
      },
      select: { id: true },
    });
    if (!ja) await this.passo(orgId, episodioId, { actorId: ATOR_DA_ROTINA, correlationId }, 'pulada', { itemId, motivo });
  }

  /**
   * A parte do YouTube da rotina `pauta.publicar-agendadas`: o episódio com o
   * item de publicação ATIVO num lote ASSINADO e o vídeo conferido recebe o
   * `publishAt`, pela porta, com três travas — a nota
   * `pauta.publicacao.automatica` ligada (D-MD1), `YOUTUBE_AUDITORIA=aprovada`
   * e o interruptor do conector. Sem elas, `pulada` (no RASTRO, uma vez por
   * item e motivo). Com a nota ligada, a janela que fechou sem agendar vira
   * erro e derruba o item; desligada, a passagem só pula.
   */
  async olharOHorario(orgId: string, correlationId: string | null, teto = TETO_POR_PASSAGEM): Promise<LinhaDaPassagem[]> {
    if (!this.lotes) return [];
    const agora = new Date();
    // Parte dos ITENS vivos: as linhas `declarado`/`conferido` de outros episódios (o modo teste, a nota desligada) não tiram o da semana da consulta.
    const recursos = await this.lotes.recursosComItemAtivo(orgId, CAPACIDADE_DE_PUBLICAR);
    if (!recursos.length) return [];
    const envios = await this.prisma.envioAoYoutube.findMany({
      where: { orgId, episodioId: { in: recursos }, estado: { not: 'agendado' } },
      select: { episodioId: true, estado: true, conferidoEm: true, atualizadoEm: true, episodio: { select: { numero: true } } },
    });
    if (!envios.length) return [];
    const vivos = await this.lotes.itensVivos(orgId, CAPACIDADE_DE_PUBLICAR, envios.map((x) => x.episodioId), agora, { mesmoVencido: true });
    const saida: LinhaDaPassagem[] = [];
    let feitas = 0;
    const auditoria = motivoDaAuditoriaParaPublicar(this.auditoria());
    const ligada = await this.publicacaoAutomatica(orgId);
    for (const x of envios) {
      const v = vivos.get(x.episodioId);
      if (!v || v.estadoDoLote !== 'ativo') continue;
      const rotulo = `${apelidoDoEpisodio(x.episodio.numero)} youtube`;
      // Com a nota desligada (o padrão da D-MD1), a rotina só pula, como no Instagram: a janela que passa não é falha dela.
      if (!ligada) {
        const motivo = 'publicação automática desligada';
        await this.registrarPulada(orgId, x.episodioId, v.itemId, motivo, correlationId);
        saida.push({ rotulo, resultado: 'pulada', detalhe: motivo });
        continue;
      }
      if (agora.getTime() > v.janelaAte.getTime()) {
        if (feitas >= teto) continue;
        feitas++;
        const motivo = 'A janela do agendamento no YouTube fechou sem o vídeo agendado: marque o horário à mão no Studio ou aprove de novo.';
        await this.prisma.envioAoYoutube.updateMany({ where: { episodioId: x.episodioId, orgId, estado: { not: 'agendado' } }, data: { erro: motivo, loteItemId: v.itemId } });
        await this.lotes.revogarItensDoRecurso(orgId, CAPACIDADE_DE_PUBLICAR, x.episodioId, 'a janela do agendamento no YouTube passou', ATOR_DA_ROTINA);
        await this.passo(orgId, x.episodioId, { actorId: ATOR_DA_ROTINA, correlationId, loteItemId: v.itemId }, 'erro', { motivo });
        saida.push({ rotulo, resultado: 'erro', detalhe: motivo });
        continue;
      }
      const pular = auditoria
        ? 'auditoria do YouTube não aprovada'
        : !(x.estado === 'conferido' || (x.estado === 'erro' && x.conferidoEm))
          ? 'o vídeo ainda não subiu (ou não foi conferido)'
          : null;
      if (pular) {
        await this.registrarPulada(orgId, x.episodioId, v.itemId, pular, correlationId);
        saida.push({ rotulo, resultado: 'pulada', detalhe: pular });
        continue;
      }
      if (feitas >= teto) continue;
      feitas++;
      const recusa = await this.interruptores.consultar({ orgId, capabilityId: CAPACIDADE_DE_PUBLICAR, correlationId, actorType: 'system', actorId: ATOR_DA_ROTINA });
      if (recusa) {
        saida.push({ rotulo, resultado: 'interruptor', detalhe: 'conector do YouTube desligado: nada foi chamado' });
        continue;
      }
      const { publicacao } = await this.argsAtuais(orgId, x.episodioId);
      if ('problema' in publicacao) {
        await this.lotes.revogarItensDoRecurso(orgId, CAPACIDADE_DE_PUBLICAR, x.episodioId, 'o vídeo não se agenda mais como está', ATOR_DA_ROTINA);
        saida.push({ rotulo, resultado: 'erro', detalhe: publicacao.problema });
        continue;
      }
      try {
        await this.pelaPorta(orgId, ATOR_DA_ROTINA, ActorType.system, CAPACIDADE_DE_PUBLICAR, publicacao.args as unknown as Record<string, unknown>, v.itemId, x.episodioId);
        saida.push({ rotulo, resultado: 'agendada', detalhe: publicacao.args.publicarEm });
      } catch (e) {
        const msg = ((e as { response?: { message?: unknown } }).response?.message ?? (e as Error).message) as string;
        // O efeito que falhou gravou o erro na linha e o item guarda o uso que sobra.
        // A recusa da PORTA não tocou a linha: sem derrubar o item, ela se repetiria a cada minuto.
        const depois = await this.prisma.envioAoYoutube.findFirst({ where: { episodioId: x.episodioId, orgId }, select: { atualizadoEm: true } });
        if (depois?.atualizadoEm.getTime() === x.atualizadoEm.getTime()) {
          await this.lotes.revogarItensDoRecurso(orgId, CAPACIDADE_DE_PUBLICAR, x.episodioId, 'a porta não deixou o item do YouTube sair', ATOR_DA_ROTINA);
        }
        saida.push({ rotulo, resultado: 'erro', detalhe: String(msg).slice(0, 200) });
      }
    }
    return saida;
  }
}
