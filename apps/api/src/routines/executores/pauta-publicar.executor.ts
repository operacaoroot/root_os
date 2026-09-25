import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicacaoInstagramService, type LinhaDaPassagem } from '../../pauta/publicacao-instagram.service';
import { EnvioAoYoutubeService } from '../../pauta/envio-ao-youtube.service';
import { ExecutoresDeRotinaRegistry } from '../executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../rotina.tipos';
import { TIPO_PAUTA_PUBLICAR } from '../rotina.tipos';

/**
 * O PUBLICADOR DA PAUTA (MD6), a cada minuto:
 *
 *   1. conclui o que já foi aprovado e está a caminho — o Reels em
 *      processamento, o publish cuja resposta se perdeu —, perguntando ao
 *      interruptor do Instagram antes de cada um;
 *   2. olha as peças aprovadas no horário (do slot até 2 h depois). Publicar
 *      SOZINHA exige a nota `pauta.publicacao.automatica` ligada e o item de
 *      um lote assinado (MD8), conferido pela porta (MD7). Sem isso a passagem
 *      registra `pulada` com o motivo — no RASTRO, uma vez por peça, slot e
 *      motivo, porque o histórico da rotina não guarda `pulada` —, e a peça
 *      segue manual (MC16) ou pelo "Publicar agora".
 *
 *   3. (MD10) agenda o vídeo do episódio no YouTube: com o item de publicação
 *      ativo num lote assinado, o vídeo conferido, a nota ligada e
 *      `YOUTUBE_AUDITORIA=aprovada`, manda o `publishAt` pela porta. Até dois
 *      por passagem, fora da conta das três do Instagram.
 *
 * No máximo três publicações por passagem, somando as duas partes. Publicação
 * que caiu em erro nesta passagem faz a passagem LANÇAR: conta como falha no
 * histórico da rotina, que é o aviso.
 */
@Injectable()
export class ExecutorDePublicacaoDaPauta implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicacao: PublicacaoInstagramService,
    private readonly registro: ExecutoresDeRotinaRegistry,
    /** `@Optional()` porque as suítes montam o executor à mão só com o Instagram. */
    @Optional() private readonly youtube?: EnvioAoYoutubeService,
  ) {}

  onModuleInit(): void {
    this.registro.registrar({ [TIPO_PAUTA_PUBLICAR]: (ctx) => this.executar(ctx) }, 'ExecutorDePublicacaoDaPauta');
  }

  async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const org = await this.prisma.org.findUnique({ where: { id: ctx.orgId }, select: { modulos: true } });
    if (!org?.modulos.includes('pauta')) {
      return { status: 'pulada', resumo: 'módulo pauta desligado nesta empresa — nada a publicar' };
    }
    const concluidas = await this.publicacao.concluir(ctx.orgId, ctx.correlationId);
    const sobra = Math.max(0, 3 - concluidas.length);
    const noHorario = sobra ? await this.publicacao.olharOHorario(ctx.orgId, ctx.correlationId, sobra) : [];
    const noYoutube = this.youtube ? await this.youtube.olharOHorario(ctx.orgId, ctx.correlationId) : [];
    return desfechoDaPublicacao([...concluidas, ...noHorario, ...noYoutube]);
  }
}

export function linhaDaPublicacao(l: LinhaDaPassagem): string {
  return `${l.rotulo}: ${l.resultado}${l.detalhe ? ` (${l.detalhe})` : ''}`;
}

export function desfechoDaPublicacao(linhas: readonly LinhaDaPassagem[]): ResultadoDaRotina {
  if (!linhas.length) return { status: 'pulada', resumo: 'nenhuma peça no horário e nada a caminho' };
  const resumo = linhas.map(linhaDaPublicacao).join(' · ').slice(0, 500);
  if (linhas.some((l) => l.resultado === 'erro')) throw new Error(resumo);
  if (linhas.every((l) => l.resultado === 'pulada' || l.resultado === 'interruptor')) return { status: 'pulada', resumo };
  return { status: 'ok', resumo };
}
