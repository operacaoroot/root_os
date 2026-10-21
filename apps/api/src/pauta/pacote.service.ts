import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Prisma } from '@prisma/client';
import {
  apelidoDoEpisodio,
  midiaDoEpisodio,
  motivoParaNaoGerarPacote,
  motivoParaNaoMexerNoPacote,
  tempoDoVideo,
  titulosDoPacote,
  type PautaEpisodioDetalhe,
  type PautaEpisodioStatus,
  type PautaPacoteGerado,
  type PautaThumbsParaRender,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';
import { SAIDA_DA_GERACAO_LONGA } from './saida-da-geracao';
import { EpisodioService } from './episodio.service';
import { VozService } from './voz.service';
import { MarcaService } from './marca.service';
import { itensMantidos, lerTranscricao } from './episodio';
import {
  PacoteInvalidoError,
  chaveDaThumb,
  conferirPngDaThumb,
  entradaDoPacote,
  montarPacote,
  systemDoPacote,
  thumbsGuardadas,
  type ThumbGuardada,
} from './pacote-do-episodio';
import { umaPorVez } from './uma-por-vez';

const DO_EPISODIO = {
  id: true,
  numero: true,
  titulo: true,
  status: true,
  midia: true,
  transcricao: true,
  titulos: true,
  thumbs: true,
  descricao: true,
  atualizadoEm: true,
  rodada: { select: { itens: true } },
} as const;

interface LinhaDoPacote {
  id: string;
  numero: number;
  titulo: string;
  status: PautaEpisodioStatus;
  midia: unknown;
  transcricao: unknown;
  titulos: unknown;
  thumbs: unknown;
  descricao: string;
  atualizadoEm: Date;
  rodada: { itens: unknown };
}

const MSG_CORRIDA = 'O episódio mudou enquanto isso (outra aba ou outro envio) — recarregue e tente de novo.';

/*
 * O PACOTE DO YOUTUBE (MC11): títulos, descrição com capítulos e os briefs das
 * thumbs saem da transcrição; as thumbs são renderizadas no Mac e voltam como
 * PNG para o storage da casa. Tudo é escrita DENTRO do OS: o envio ao YouTube é
 * da MD10 (`envio-ao-youtube.service.ts`), e a página de links é do MC12.
 */
@Injectable()
export class PacoteService {
  private readonly log = new Logger('PacoteService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly vozes: VozService,
    private readonly storage: StorageService,
    private readonly episodios: EpisodioService,
    /** MK1: a marca e os pilares, ao lado da voz no mesmo prompt. */
    private readonly marcas: MarcaService,
  ) {}

  private async ler(orgId: string, id: string): Promise<LinhaDoPacote> {
    const e = await this.prisma.pautaEpisodio.findFirst({ where: { id, orgId }, select: DO_EPISODIO });
    if (!e) throw new NotFoundException('Episódio não encontrado');
    return e as LinhaDoPacote;
  }

  /** A duração do vídeo final: a da mídia; sem ela, o fim da transcrição. */
  private duracao(e: LinhaDoPacote): number {
    const midia = midiaDoEpisodio(e.midia);
    if (midia) return midia.duracaoSeg;
    const segs = lerTranscricao(e.transcricao);
    return segs.length ? segs[segs.length - 1].fim : 0;
  }

  /**
   * Gera o pacote da transcrição. A escrita é condicionada ao status E ao
   * `atualizadoEm` lidos antes da IA: um título marcado ou uma thumb que subiu
   * enquanto o modelo pensava não é apagado em silêncio (409). Gerar de novo
   * troca os briefs, e as imagens das thumbs antigas saem junto.
   */
  gerar(orgId: string, id: string, actorId: string, opts: { substituir: boolean }): Promise<PautaPacoteGerado> {
    return umaPorVez(`pauta-pacote:${orgId}:${id}`, 'A geração do pacote deste episódio', () => this.gerarAgora(orgId, id, actorId, opts));
  }

  private async gerarAgora(orgId: string, id: string, actorId: string, opts: { substituir: boolean }): Promise<PautaPacoteGerado> {
    const e = await this.ler(orgId, id);
    const segmentos = lerTranscricao(e.transcricao);
    const motivo = motivoParaNaoGerarPacote(e.status, segmentos.length);
    if (motivo) throw new BadRequestException(motivo);
    const antes = thumbsGuardadas(e.thumbs);
    const temPacote = titulosDoPacote(e.titulos).length > 0 || e.descricao.trim() !== '' || antes.length > 0;
    if (temPacote && !opts.substituir) {
      throw new ConflictException('O episódio já tem pacote — confirme para substituir (as thumbs enviadas saem junto).');
    }
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(`IA não configurada: falta a credencial do provider "${this.llm.name}".`);
    }

    const apelido = apelidoDoEpisodio(e.numero);
    const itens = itensMantidos(e.rodada.itens);
    const duracaoSeg = this.duracao(e);
    const saida = await this.llm.complete({
      funcao: 'CT-06',
      system: systemDoPacote(await this.vozes.bloco(orgId), await this.marcas.bloco(orgId)),
      user: entradaDoPacote({ apelido, titulo: e.titulo, itens, segmentos, duracaoSeg }),
      // De quem é o gasto (RF-G-05), como nas outras chamadas da pauta.
      orgId,
      maxTokens: SAIDA_DA_GERACAO_LONGA,
    });

    let pacote;
    try {
      pacote = montarPacote(saida, { itens, segmentos, duracaoSeg });
    } catch (err) {
      if (err instanceof PacoteInvalidoError) {
        this.log.warn(`pacote ${apelido} de ${orgId}: ${err.message}`);
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    const r = await this.prisma.pautaEpisodio.updateMany({
      where: { id, orgId, status: e.status, atualizadoEm: e.atualizadoEm },
      data: {
        titulos: pacote.titulos as unknown as Prisma.InputJsonValue,
        descricao: pacote.descricao,
        thumbs: pacote.thumbs as unknown as Prisma.InputJsonValue,
      },
    });
    if (r.count === 0) throw new ConflictException(MSG_CORRIDA);

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_pacote_gerado',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { tinhaPacote: temPacote, thumbsComImagem: antes.filter((t) => t.imagem).length },
      after: {
        titulos: pacote.titulos.length,
        capitulos: pacote.capitulos.length,
        links: pacote.links,
        thumbs: pacote.thumbs.length,
        caracteres: pacote.descricao.length,
        correcoes: pacote.correcoes,
        avisos: pacote.avisos,
        provider: this.llm.name,
        model: this.llm.model,
      },
    });
    return { episodio: await this.episodios.obter(orgId, id), avisos: pacote.avisos, correcoes: pacote.correcoes };
  }

  /** Marca o título que vai ao ar (`null` desmarca). Só um fica marcado; depois de agendado, não muda. */
  async escolherTitulo(orgId: string, id: string, actorId: string, n: number | null): Promise<PautaEpisodioDetalhe> {
    const e = await this.ler(orgId, id);
    const travado = motivoParaNaoMexerNoPacote(e.status);
    if (travado) throw new BadRequestException(travado);
    const titulos = titulosDoPacote(e.titulos);
    if (!titulos.length) throw new BadRequestException('O episódio ainda não tem títulos — gere o pacote primeiro.');
    if (n !== null && n > titulos.length) throw new BadRequestException(`Não há o título ${n}: são ${titulos.length}.`);
    const novos = titulos.map((t, i) => ({ ...t, escolhido: n !== null && i === n - 1 }));
    const r = await this.prisma.pautaEpisodio.updateMany({
      where: { id, orgId, status: e.status, atualizadoEm: e.atualizadoEm },
      data: { titulos: novos as unknown as Prisma.InputJsonValue },
    });
    if (r.count === 0) throw new ConflictException(MSG_CORRIDA);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_titulo_escolhido',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { escolhido: titulos.findIndex((t) => t.escolhido) + 1 || null },
      after: { escolhido: n, titulo: n === null ? null : novos[n - 1].texto },
    });
    return this.episodios.obter(orgId, id);
  }

  private paraRender(e: LinhaDoPacote, thumbs: ThumbGuardada[]): PautaThumbsParaRender {
    const midia = midiaDoEpisodio(e.midia);
    return {
      episodioId: e.id,
      apelido: apelidoDoEpisodio(e.numero),
      titulo: e.titulo,
      status: e.status,
      arquivoFinal: midia?.arquivoFinal ?? null,
      duracaoSeg: midia?.duracaoSeg ?? null,
      thumbs: thumbs.map(({ imagem, ...t }) => ({ ...t, tempo: tempoDoVideo(t.tempoSeg), temImagem: imagem !== null })),
    };
  }

  /** Os briefs para o Mac renderizar: texto, destaque, o tempo do frame e onde está o vídeo final. */
  async thumbsParaRender(orgId: string, id: string): Promise<PautaThumbsParaRender> {
    const e = await this.ler(orgId, id);
    return this.paraRender(e, thumbsGuardadas(e.thumbs));
  }

  /**
   * O PNG que o Mac renderizou. Vai para o storage da casa (o MinIO, que não é
   * público) com o hash no nome; o episódio guarda a chave. Trocar a imagem
   * grava outra chave em vez de sobrescrever. Depois de agendado, não muda.
   */
  async enviarThumb(
    orgId: string,
    id: string,
    actorId: string,
    n: number,
    arquivo: { buffer: Buffer; mimetype: string; size?: number } | undefined,
  ): Promise<PautaThumbsParaRender> {
    const conferido = conferirPngDaThumb(arquivo);
    if (!conferido.ok) throw new BadRequestException(conferido.motivo);
    const e = await this.ler(orgId, id);
    const travado = motivoParaNaoMexerNoPacote(e.status);
    if (travado) throw new BadRequestException(travado);
    const thumbs = thumbsGuardadas(e.thumbs);
    const alvo = thumbs.find((t) => t.n === n);
    if (!alvo) throw new BadRequestException(`O episódio não tem o brief da thumb ${n} — gere o pacote primeiro.`);

    const buffer = arquivo!.buffer;
    const sha = createHash('sha256').update(buffer).digest('hex');
    const chave = chaveDaThumb(id, n, sha);
    await this.storage.put(chave, buffer, 'image/png');

    const imagem = { chave, sha: sha.slice(0, 12), bytes: buffer.length, largura: conferido.largura, altura: conferido.altura, enviadaEm: new Date().toISOString() };
    const novas = thumbs.map((t) => (t.n === n ? { ...t, imagem } : t));
    const r = await this.prisma.pautaEpisodio.updateMany({
      where: { id, orgId, status: e.status, atualizadoEm: e.atualizadoEm },
      data: { thumbs: novas as unknown as Prisma.InputJsonValue },
    });
    if (r.count === 0) throw new ConflictException(MSG_CORRIDA);
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_thumb',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { n, tinhaImagem: alvo.imagem !== null },
      after: { n, bytes: imagem.bytes, largura: imagem.largura, altura: imagem.altura, sha: imagem.sha },
    });
    return this.paraRender({ ...e, thumbs: novas }, novas);
  }

  /** A imagem de uma thumb, para a prévia na tela. Sem imagem, 404. */
  async imagemDaThumb(orgId: string, id: string, n: number): Promise<{ stream: Readable; size: number }> {
    const e = await this.ler(orgId, id);
    const alvo = thumbsGuardadas(e.thumbs).find((t) => t.n === n);
    if (!alvo?.imagem) throw new NotFoundException(`A thumb ${n} ainda não foi renderizada.`);
    try {
      const { stream, size } = await this.storage.get(alvo.imagem.chave);
      return { stream, size };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.log.warn(`thumb ${n} de ${id} (${orgId}) sumiu do storage: ${(err as Error).message}`);
      throw new NotFoundException(`A imagem da thumb ${n} não está no storage — renderize de novo no Mac.`);
    }
  }
}
