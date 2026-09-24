import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_STATUS_PENDENTES_DE_MIDIA,
  midiaDoEpisodio,
  textoDaTranscricao,
  thumbsDoPacote,
  titulosDoPacote,
  type PautaEpisodioDetalhe,
  type PautaEpisodioStatus,
  type PautaEpisodiosPendentesDeMidia,
  type PautaMidiaDoEpisodio,
  type PautaMidiaInput,
  type PautaTranscricaoInput,
} from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EpisodioService } from './episodio.service';
import { RoteiroService } from './roteiro.service';
import { lerTranscricao } from './episodio';
import { ehPecaDaSemana, lerMetaDaSemana } from './derivacao-do-episodio';
import { shaDaTranscricao } from './newsletter-do-episodio';
import {
  motivoParaNaoReceberMidia,
  motivoParaNaoReceberTranscricao,
  pendenteDeMidia,
  resumoDaMidia,
  transcricaoForaDoVideo,
} from './midia-do-episodio';

const MSG_CORRIDA = 'O episódio mudou enquanto isso (outra aba ou outro envio) — confira e mande de novo.';

/*
 * A ESTAÇÃO DE MÍDIA (MC9), o lado do OS. O Mac pergunta o que falta, edita e
 * transcreve lá, e devolve só o leve: onde estão os arquivos, a duração, o que
 * foi cortado e a transcrição. Tudo é escrita DENTRO do OS — o vídeo não sobe
 * (o MinIO da VPS não é público e o YouTube é manual na V1, D-MC6).
 */
@Injectable()
export class MidiaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly episodios: EpisodioService,
    private readonly roteiros: RoteiroService,
  ) {}

  /** Gravados e em edição, do mais antigo: é a fila do Mac. */
  async pendentes(orgId: string): Promise<PautaEpisodiosPendentesDeMidia> {
    const rows = await this.prisma.pautaEpisodio.findMany({
      where: { orgId, status: { in: [...PAUTA_STATUS_PENDENTES_DE_MIDIA] } },
      orderBy: { numero: 'asc' },
      take: 50,
      select: { id: true, numero: true, titulo: true, status: true, palavraDeCorte: true, midia: true, atualizadoEm: true },
    });
    // Uma leitura da memória para a fila inteira, e só se houver fila.
    const daEmpresa = rows.length ? await this.roteiros.palavraDaEmpresa(orgId) : null;
    return {
      items: rows.map((e) => pendenteDeMidia(e, daEmpresa)),
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  /**
   * As peças da semana (MC15) do episódio que ainda não foram postadas voltam ao
   * rascunho, saem da agenda e perdem o render: o trecho do corte e o frame do
   * story são tempos do vídeo anterior, e o texto foi tirado da fala de antes.
   * Com `shaNovo`, só as geradas de outra transcrição. Roda sob o cadeado do
   * `gerar` e das edições da semana, tomado ANTES de tocar o episódio — a
   * mesma ordem do `gerar`, para as duas transações não se travarem.
   */
  private async pecasDaSemanaAoRascunho(
    tx: Prisma.TransactionClient,
    orgId: string,
    e: { id: string; rodadaId: string },
    shaNovo?: string,
  ): Promise<string[]> {
    const pecas = await tx.pautaPeca.findMany({
      where: {
        orgId,
        rodadaId: e.rodadaId,
        canal: 'instagram',
        formato: { in: [...PAUTA_FORMATOS_DA_SEMANA] },
        status: { in: ['rascunho', 'aprovada'] },
      },
      select: { id: true, status: true, meta: true, agendadaPara: true },
    });
    const voltaram: string[] = [];
    for (const p of pecas) {
      if (!ehPecaDaSemana(p.meta, e.id)) continue;
      if (shaNovo !== undefined && lerMetaDaSemana(p.meta).transcricaoSha === shaNovo) continue;
      const meta = { ...(p.meta as Record<string, unknown>), imagens: [], video: null };
      const r = await tx.pautaPeca.updateMany({
        where: { id: p.id, orgId, status: p.status },
        data: { status: 'rascunho', agendadaPara: null, slotProposto: null, meta: meta as unknown as Prisma.InputJsonValue },
      });
      if (r.count === 0) throw new ConflictException(MSG_CORRIDA);
      voltaram.push(p.id);
    }
    return voltaram;
  }

  private travarASemana(tx: Prisma.TransactionClient, id: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pauta-semana:${id}`}))`;
  }

  /**
   * A mídia editada. Da gravação vai para a edição; na edição, substitui a de
   * antes. Uma mídia nova DESCARTA a transcrição que houver e o pacote do
   * YouTube (MC11) que saiu dela: os capítulos e os frames das thumbs são tempos
   * do vídeo anterior e não bateriam com o novo. Pelo mesmo motivo, as peças da
   * semana ainda não postadas voltam ao rascunho, fora da agenda e sem render.
   */
  async registrarMidia(orgId: string, id: string, actorId: string, entrada: PautaMidiaInput): Promise<PautaEpisodioDetalhe> {
    const e = await this.prisma.pautaEpisodio.findFirst({
      where: { id, orgId },
      select: {
        status: true,
        rodadaId: true,
        midia: true,
        transcricao: true,
        titulos: true,
        descricao: true,
        thumbs: true,
        atualizadoEm: true,
      },
    });
    if (!e) throw new NotFoundException('Episódio não encontrado');
    const motivo = motivoParaNaoReceberMidia(e.status);
    if (motivo) throw new BadRequestException(motivo);

    const para: PautaEpisodioStatus = 'edicao';
    const midia: PautaMidiaDoEpisodio = { ...entrada, recebidaEm: new Date().toISOString() };
    const transcricaoDescartada = lerTranscricao(e.transcricao).length > 0;
    const pacoteDescartado =
      titulosDoPacote(e.titulos).length > 0 || e.descricao.trim() !== '' || thumbsDoPacote(e.thumbs).length > 0;
    const pecasAoRascunho = await this.prisma.$transaction(async (tx) => {
      await this.travarASemana(tx, id);
      const r = await tx.pautaEpisodio.updateMany({
        where: { id, orgId, status: e.status, atualizadoEm: e.atualizadoEm },
        data: {
          midia: midia as unknown as Prisma.InputJsonValue,
          transcricao: [],
          transcricaoTexto: '',
          titulos: [],
          descricao: '',
          thumbs: [],
          status: para,
        },
      });
      if (r.count === 0) throw new ConflictException(MSG_CORRIDA);
      return this.pecasDaSemanaAoRascunho(tx, orgId, { id, rodadaId: e.rodadaId });
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_midia',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { status: e.status, tinhaMidia: midiaDoEpisodio(e.midia) !== null },
      after: { status: para, ...resumoDaMidia(entrada), transcricaoDescartada, pacoteDescartado, pecasAoRascunho },
    });
    return this.episodios.obter(orgId, id);
  }

  /** A transcrição do vídeo final: grava os segmentos e o texto corrido, e o episódio vai para o pacote. */
  async registrarTranscricao(
    orgId: string,
    id: string,
    actorId: string,
    entrada: PautaTranscricaoInput,
  ): Promise<PautaEpisodioDetalhe> {
    const e = await this.prisma.pautaEpisodio.findFirst({
      where: { id, orgId },
      select: { status: true, rodadaId: true, midia: true, atualizadoEm: true },
    });
    if (!e) throw new NotFoundException('Episódio não encontrado');
    const midia = midiaDoEpisodio(e.midia);
    const motivo = motivoParaNaoReceberTranscricao(e.status, midia);
    if (motivo) throw new BadRequestException(motivo);
    const fora = transcricaoForaDoVideo(entrada.segmentos, midia!.duracaoSeg);
    if (fora) throw new BadRequestException(fora);

    const segmentos = entrada.segmentos.map((s) => ({ inicio: s.inicio, fim: s.fim, texto: s.texto }));
    const texto = textoDaTranscricao(segmentos);
    const para: PautaEpisodioStatus = 'pacote';
    // A transcrição pode ser reenviada sem mídia nova (o episódio voltou à
    // Edição): a peça da semana gerada de outra fala também volta ao rascunho.
    const pecasAoRascunho = await this.prisma.$transaction(async (tx) => {
      await this.travarASemana(tx, id);
      const r = await tx.pautaEpisodio.updateMany({
        where: { id, orgId, status: e.status, atualizadoEm: e.atualizadoEm },
        data: { transcricao: segmentos, transcricaoTexto: texto, status: para },
      });
      if (r.count === 0) throw new ConflictException(MSG_CORRIDA);
      return this.pecasDaSemanaAoRascunho(tx, orgId, { id, rodadaId: e.rodadaId }, shaDaTranscricao(segmentos));
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.episodio_transcricao',
      entityType: 'pauta_episodio',
      entityId: id,
      before: { status: e.status },
      after: {
        status: para,
        segmentos: segmentos.length,
        caracteres: texto.length,
        fimSeg: segmentos[segmentos.length - 1]?.fim ?? 0,
        duracaoSeg: midia!.duracaoSeg,
        idioma: entrada.idioma ?? null,
        modelo: entrada.modelo ?? null,
        pecasAoRascunho,
      },
    });
    return this.episodios.obter(orgId, id);
  }
}
