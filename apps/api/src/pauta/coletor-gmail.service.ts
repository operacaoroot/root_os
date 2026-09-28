import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, type PautaFonte } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PortaDoOperador } from '../gateway/porta-do-operador.service';
import type { AtorDaColeta, ResultadoDaColeta } from './coleta.service';
import {
  TETO_DE_EMAILS_POR_COLETA,
  capturaDoEmail,
  consultaDaEtiqueta,
  ehEmailLido,
  ehListaDeEmails,
  hashDoEmail,
  lerEtiqueta,
} from './gmail-da-pauta';

/** O que é da empresa inteira e não de um e-mail: a coleta para em vez de seguir para o próximo. */
class ColetaParada extends Error {}

const retida = (r: unknown): boolean => (r as { status?: unknown } | null)?.status === 'aguardando_aprovacao';

/*
 * O Gmail é lido PELA PORTA, com as duas capacidades R0 que a tela do Google já
 * usa (`comunicacao.email.buscar` e `comunicacao.email.ler`), e não importando o
 * conector — a catraca de arquitetura recusa. Ganha-se de graça o que a porta
 * já faz: o interruptor do conector Gmail da empresa corta a coleta, e cada
 * leitura fica no RASTRO com quem pediu (a pessoa que clicou ou a rotina).
 *
 * Google não conectado na empresa é erro do conector ("Google não conectado.
 * Conecte em Integrações."), que a porta devolve como está: vira `ultimoErro`
 * da fonte pelo despacho, e a rodada segue com as outras.
 */
@Injectable()
export class ColetorGmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly porta: PortaDoOperador,
  ) {}

  async coletar(fonte: PautaFonte, ator: AtorDaColeta): Promise<ResultadoDaColeta> {
    const lida = lerEtiqueta(fonte.handle);
    if ('erro' in lida) throw new BadRequestException(lida.erro);
    const { etiqueta } = lida;
    const orgId = fonte.orgId;

    const lista = await this.porta.executar({
      orgId,
      actorId: ator.id,
      actorType: ator.tipo,
      capabilityId: 'comunicacao.email.buscar',
      args: { q: consultaDaEtiqueta(etiqueta), limite: TETO_DE_EMAILS_POR_COLETA },
    });
    if (!ehListaDeEmails(lista)) throw new Error(this.naoVeio(lista));

    const novas: string[] = [];
    let repetidas = 0;
    const falhas: string[] = [];
    try {
      for (const { id, link } of lista) {
        const urlHash = hashDoEmail(link);
        const existe = await this.prisma.pautaCaptura.findUnique({
          where: { orgId_urlHash: { orgId, urlHash } },
          select: { id: true },
        });
        // Checar antes de abrir o e-mail poupa uma chamada ao Gmail por repetido.
        if (existe) {
          repetidas++;
          continue;
        }

        /*
         * UM E-MAIL RUIM NÃO TRANCA A ETIQUETA. A lista vem do mais novo para o
         * mais antigo e a mesma lista volta na rodada seguinte: um e-mail que
         * sempre falha (apagado entre a busca e a leitura, gravação recusada)
         * deixaria os mais antigos sem coleta a semana inteira. O que é da
         * empresa inteira — conector desligado, leitura retida pela política —
         * para a coleta: seguir repetiria o mesmo não em cada e-mail, e a
         * retenção deixaria uma aprovação na fila por e-mail.
         */
        try {
          const email = await this.porta.executar({
            orgId,
            actorId: ator.id,
            actorType: ator.tipo,
            capabilityId: 'comunicacao.email.ler',
            args: { id },
            resource: { type: 'gmail', id },
          });
          if (!ehEmailLido(email)) {
            if (retida(email)) throw new ColetaParada(this.naoVeio(email));
            throw new Error(this.naoVeio(email));
          }

          const c = capturaDoEmail(email, etiqueta);
          const criada = await this.prisma.pautaCaptura.create({
            data: {
              orgId,
              fonteId: fonte.id,
              tipo: 'link',
              url: c.url,
              urlHash: c.urlHash,
              titulo: c.titulo,
              nota: c.nota,
              bruto: c.bruto,
              capturadoPor: ator.id,
            },
            select: { id: true },
          });
          novas.push(criada.id);
        } catch (e) {
          if (e instanceof ColetaParada || e instanceof ForbiddenException) throw e;
          // A rotina e o botão do Radar coletaram o mesmo e-mail ao mesmo tempo.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') repetidas++;
          else falhas.push((e as Error).message || 'falha sem mensagem');
        }
      }
    } finally {
      // No `finally`: a leitura retida no meio da lista não pode deixar as capturas já criadas sem RASTRO.
      if (novas.length > 0) {
        await this.audit.log({
          orgId,
          actorType: ator.tipo,
          actorId: ator.id,
          action: 'pauta.coleta_gmail',
          entityType: 'pauta_fonte',
          entityId: fonte.id,
          after: { etiqueta, capturas: novas, repetidas, falhas: falhas.length },
        });
      }
    }

    if (falhas.length > 0) {
      throw new Error(
        `${falhas.length} de ${lista.length} e-mail(s) da etiqueta não entraram ` +
          `(${novas.length} entraram): ${falhas[0]}`,
      );
    }
    return {
      novas: novas.length,
      repetidas,
      aviso:
        lista.length >= TETO_DE_EMAILS_POR_COLETA
          ? `A etiqueta trouxe ${lista.length} e-mails na semana, o teto de uma coleta; ` +
            'os mais antigos podem ter ficado de fora.'
          : undefined,
    };
  }

  /** A porta devolveu outra coisa: a leitura foi retida pela política (sobrescrita da empresa). */
  private naoVeio(resposta: unknown): string {
    if (retida(resposta)) {
      return `A leitura do Gmail foi retida para aprovação (${String((resposta as { nivel?: unknown }).nivel)}) pela política desta empresa; ` +
        'a coleta automática só roda com a leitura em R0. Cada coleta deixa um pedido na fila de aprovação, ' +
        'e aprová-lo não traz a newsletter: volte a leitura para R0 ou pause a fonte.';
    }
    return 'O Gmail respondeu num formato inesperado.';
  }
}
