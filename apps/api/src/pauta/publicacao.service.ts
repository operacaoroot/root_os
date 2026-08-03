import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EvolutionService } from './evolution.service';
import { ClickupService } from '../integrations/clickup.service';

// Publicação das peças (onda 3). O que cada canal faz e o que NÃO faz:
//
//   whatsapp   → Evolution, grupo, automático (atrás de aprovação humana)
//   clickup    → cria o tema de verdade na lista de pauta
//   instagram  → NÃO publica. Publicar carrossel exige `content_publish` +
//                App Review, e o app da Meta está em troca. A peça sai pronta
//                aqui e o post é manual (máquina de carrossel).
//   newsletter → idem: o corpo fica pronto, o envio é do canal de e-mail.
//
// Todo link publicado vira BioLink primeiro: assim o clique no grupo volta como
// BioEvent/PixelEvent e alimenta GoalWeek.bioClicks sem ninguém digitar nada.
@Injectable()
export class PublicacaoService {
  private readonly log = new Logger('PublicacaoService');
  private readonly baseBio = (process.env.PUBLIC_BIO_ORIGIN ?? '').replace(/\/$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly evolution: EvolutionService,
    private readonly clickup: ClickupService,
  ) {}

  /**
   * Cria o link rastreado da peça e devolve a URL curta. Sem página de bio
   * publicada não há como rastrear — nesse caso devolve o destino cru, para a
   * peça sair mesmo assim (medir é desejável, publicar é obrigatório).
   */
  private async linkRastreado(
    orgId: string,
    rotulo: string,
    destino: string,
  ): Promise<{ url: string; bioLinkId: string | null }> {
    const page = await this.prisma.bioPage.findFirst({
      where: { orgId },
      orderBy: [{ publicada: 'desc' }, { criadaEm: 'asc' }],
      select: { id: true },
    });
    if (!page || !this.baseBio) return { url: destino, bioLinkId: null };

    const ultimo = await this.prisma.bioLink.findFirst({
      where: { pageId: page.id },
      orderBy: { ordem: 'desc' },
      select: { ordem: true },
    });
    const link = await this.prisma.bioLink.create({
      data: {
        pageId: page.id,
        ordem: (ultimo?.ordem ?? 0) + 1,
        tipo: 'url',
        rotulo: rotulo.slice(0, 80),
        destino,
        // Não aparece na página pública: é link de campanha, não item de menu.
        ativo: false,
      },
    });
    return { url: `${this.baseBio}/r/${link.id}`, bioLinkId: link.id };
  }

  /** Destino do link da peça: o primeiro item curado da rodada. */
  private destinoDaRodada(itens: unknown): string | null {
    const lista = Array.isArray(itens) ? (itens as Array<{ url?: string }>) : [];
    return lista.find((i) => typeof i.url === 'string' && i.url)?.url ?? null;
  }

  async publicar(orgId: string, pecaId: string, actorId: string) {
    const peca = await this.prisma.pautaPeca.findFirst({
      where: { id: pecaId, orgId },
      include: { rodada: { select: { titulo: true, itens: true } } },
    });
    if (!peca) throw new NotFoundException('Peça não encontrada');
    if (peca.status === 'publicada') throw new BadRequestException('Esta peça já foi publicada.');
    if (peca.status === 'descartada') throw new BadRequestException('Peça descartada.');

    switch (peca.canal) {
      case 'whatsapp':
        return this.publicarWhatsapp(orgId, peca, actorId);
      case 'clickup':
        return this.publicarClickup(orgId, peca, actorId);
      case 'instagram':
      case 'newsletter':
      default:
        throw new BadRequestException(
          peca.canal === 'instagram'
            ? 'Instagram não publica pelo OS: exige content_publish com App Review (o app da Meta está em troca). ' +
              'Use o export para a máquina de carrossel e poste manualmente.'
            : 'Newsletter não tem canal de envio ligado — copie o corpo e envie pela ferramenta de e-mail.',
        );
    }
  }

  private async publicarWhatsapp(
    orgId: string,
    peca: { id: string; corpo: string; titulo: string; rodada: { titulo: string; itens: unknown } },
    actorId: string,
  ) {
    const estado = await this.evolution.estado();
    if (!estado.conectada) {
      throw new ServiceUnavailableException(estado.motivo ?? 'Evolution indisponível.');
    }
    const jid = this.evolution.grupo;
    if (!jid) {
      throw new ServiceUnavailableException(
        'Falta EVOLUTION_GRUPO_JID (o JID do grupo, terminado em @g.us — não é o número).',
      );
    }

    const destino = this.destinoDaRodada(peca.rodada.itens);
    let texto = peca.corpo;
    let bioLinkId: string | null = null;
    if (destino) {
      const l = await this.linkRastreado(orgId, peca.rodada.titulo, destino);
      bioLinkId = l.bioLinkId;
      texto = `${texto}\n\n${l.url}`;
    }

    let r: { id: string | null };
    try {
      r = await this.evolution.enviarTexto(jid, texto);
    } catch (e) {
      // O link só existe para ser clicado nesta mensagem: se ela não saiu,
      // apaga em vez de deixar BioLink órfão acumulando na página.
      if (bioLinkId) {
        await this.prisma.bioLink.delete({ where: { id: bioLinkId } }).catch(() => undefined);
      }
      await this.prisma.pautaPeca.update({
        where: { id: peca.id },
        data: { erro: (e as Error).message.slice(0, 300) },
      });
      throw e;
    }

    const atualizada = await this.prisma.pautaPeca.update({
      where: { id: peca.id },
      data: {
        status: 'publicada',
        externalId: r.id,
        bioLinkId,
        publicadaEm: new Date(),
        publicadaPor: actorId,
        erro: null,
      },
    });

    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.peca_publicada',
      entityType: 'pauta_peca',
      entityId: peca.id,
      after: { canal: 'whatsapp', jid, mensagemId: r.id, bioLinkId },
    });
    return { ok: true, canal: 'whatsapp', externalId: atualizada.externalId };
  }

  private async publicarClickup(
    orgId: string,
    peca: { id: string; titulo: string; corpo: string },
    actorId: string,
  ) {
    const t = await this.clickup.criarTarefa({ nome: peca.titulo, descricao: peca.corpo });
    await this.prisma.pautaPeca.update({
      where: { id: peca.id },
      data: {
        status: 'publicada',
        externalId: t.id,
        meta: { url: t.url },
        publicadaEm: new Date(),
        publicadaPor: actorId,
        erro: null,
      },
    });
    await this.audit.log({
      orgId,
      actorId,
      action: 'pauta.peca_publicada',
      entityType: 'pauta_peca',
      entityId: peca.id,
      after: { canal: 'clickup', taskId: t.id },
    });
    return { ok: true, canal: 'clickup', externalId: t.id, url: t.url };
  }

  /**
   * Pacote da peça de Instagram para a máquina de carrossel (marca `root`):
   * capa + slides + legenda no formato que o gerador consome.
   */
  async exportarCarrossel(orgId: string, pecaId: string) {
    const peca = await this.prisma.pautaPeca.findFirst({ where: { id: pecaId, orgId } });
    if (!peca) throw new NotFoundException('Peça não encontrada');
    if (peca.canal !== 'instagram') throw new BadRequestException('Só peças de Instagram têm carrossel.');

    const meta = (peca.meta ?? {}) as { slides?: Array<{ titulo?: string; texto?: string }> };
    return {
      marca: 'root',
      titulo: peca.titulo,
      legenda: peca.corpo,
      slides: (meta.slides ?? []).map((s, i) => ({
        ordem: i + 1,
        titulo: s.titulo ?? '',
        texto: s.texto ?? '',
      })),
    };
  }
}
