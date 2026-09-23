import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ActorType, type PautaFonte, type PautaFonteTipo } from '@prisma/client';
import { createHash } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { RssService } from './rss.service';
import { ColetorGmailService } from './coletor-gmail.service';

export interface ResultadoDaColeta {
  novas: number;
  repetidas: number;
  /** A coleta rodou, mas algo ficou de fora: vai para `ultimoErro`, que é o que o Radar mostra. */
  aviso?: string;
  /** Não leu nada (teto do mês, consulta faltando): `ultimaLeitura` fica como estava. */
  pulada?: boolean;
}

export interface ResultadoDaColetaDaRodada {
  novas: number;
  fontes: number;
  erros: number;
  /** Puladas com aviso, sem ser erro: o motivo fica na fonte, no Radar. */
  puladas: number;
}

export interface AtorDaColeta {
  id: string;
  tipo: ActorType;
}

export type Coletor = (
  fonte: PautaFonte,
  ator: AtorDaColeta,
  opcoes: { limite?: number },
) => Promise<ResultadoDaColeta>;

/**
 * O que a coleta da rodada percorre sozinha. `busca` e `perfil` (MC4) são run
 * pago do Apify, e entram porque os coletores deles reservam o run no teto do
 * mês e, com o teto no fim, pulam com aviso sem derrubar a rodada. `manual` não
 * se coleta — recebe.
 */
export const TIPOS_DA_COLETA_DA_RODADA: readonly PautaFonteTipo[] = ['rss', 'gmail', 'busca', 'perfil'];

/** Quem chama a coleta sem ser uma pessoa. O resto é o id de quem clicou. */
const ATORES_DE_SISTEMA = new Set(['rotina', 'sistema']);

export function atorDaColeta(actorId: string): AtorDaColeta {
  return { id: actorId, tipo: ATORES_DE_SISTEMA.has(actorId) ? ActorType.system : ActorType.user };
}

/*
 * ============================================================================
 * O DESPACHO DA COLETA POR TIPO DE FONTE (MC2)
 * ============================================================================
 *
 * Até o MC1 havia dois caminhos que não se conheciam: `PautaService.coletarFonte`
 * só aceitava `perfil`, e `RodadaService.coletarFeeds` só lia `rss`. Uma fonte
 * nova teria de escolher um deles ou abrir um terceiro. Aqui mora um só: o botão
 * "Coletar agora" do Radar e a coleta da rodada passam pelo mesmo `coletar`, que
 * escolhe o coletor pelo tipo e registra `ultimaLeitura`/`ultimoErro` na fonte
 * do mesmo jeito para todos.
 *
 * OS COLETORES DE PERFIL E DE BUSCA SE INSCREVEM DE FORA (`registrar`) em vez
 * de morar aqui: eles chamam o Apify, e o import do Apify está preso a `pauta.service.ts` na
 * lista de dívida da catraca de arquitetura — mover o import seria abrir uma
 * violação nova para fechar outra.
 */
@Injectable()
export class ColetaService {
  private readonly log = new Logger('ColetaDaPauta');
  private readonly coletores = new Map<PautaFonteTipo, { coletor: Coletor; dono: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rss: RssService,
    private readonly gmail: ColetorGmailService,
  ) {
    this.registrar('rss', (f, ator) => this.coletarRss(f, ator), 'ColetaService');
    this.registrar('gmail', (f, ator) => this.gmail.coletar(f, ator), 'ColetorGmailService');
  }

  registrar(tipo: PautaFonteTipo, coletor: Coletor, dono: string): void {
    const ja = this.coletores.get(tipo);
    if (ja) throw new Error(`O tipo "${tipo}" já tem coletor (${ja.dono}); ${dono} não pode se inscrever de novo.`);
    this.coletores.set(tipo, { coletor, dono });
  }

  temColetor(tipo: PautaFonteTipo): boolean {
    return this.coletores.has(tipo);
  }

  /**
   * Coleta UMA fonte. O erro fica na fonte E sobe: quem clicou precisa vê-lo,
   * e a rodada, que não pode parar por uma fonte, o engole em `coletarDaRodada`.
   */
  async coletar(fonte: PautaFonte, actorId: string, opcoes: { limite?: number } = {}): Promise<ResultadoDaColeta> {
    const inscrito = this.coletores.get(fonte.tipo);
    if (!inscrito) {
      throw new BadRequestException(
        fonte.tipo === 'manual'
          ? 'Fonte manual não se coleta: ela recebe o que alguém cola.'
          : `A fonte do tipo "${fonte.tipo}" ainda não tem coleta automática.`,
      );
    }
    try {
      const r = await inscrito.coletor(fonte, atorDaColeta(actorId), opcoes);
      await this.prisma.pautaFonte.update({
        where: { id: fonte.id },
        data: { ...(r.pulada ? {} : { ultimaLeitura: new Date() }), ultimoErro: r.aviso ?? null },
      });
      return r;
    } catch (e) {
      const msg = ((e as Error).message || 'falha sem mensagem').slice(0, 300);
      await this.prisma.pautaFonte.update({ where: { id: fonte.id }, data: { ultimoErro: msg } });
      throw e;
    }
  }

  /**
   * As fontes ativas que a rodada coleta — só dos `tipos` pedidos, quando vierem
   * (as origens da rotina: uma rotina de feed e busca não gasta run com perfil).
   * Uma fonte que falha não derruba as outras.
   */
  async coletarDaRodada(
    orgId: string,
    actorId = 'sistema',
    tipos: readonly PautaFonteTipo[] = TIPOS_DA_COLETA_DA_RODADA,
  ): Promise<ResultadoDaColetaDaRodada> {
    const pedidos = TIPOS_DA_COLETA_DA_RODADA.filter((t) => tipos.includes(t));
    if (!pedidos.length) return { novas: 0, fontes: 0, erros: 0, puladas: 0 };
    const fontes = await this.prisma.pautaFonte.findMany({
      where: { orgId, ativo: true, tipo: { in: pedidos } },
      orderBy: { criadaEm: 'asc' },
    });

    let novas = 0;
    let erros = 0;
    let puladas = 0;
    for (const f of fontes) {
      try {
        const r = await this.coletar(f, actorId);
        novas += r.novas;
        if (r.pulada) puladas++;
      } catch (e) {
        erros++;
        this.log.warn(`fonte "${f.nome}" (${f.tipo}) falhou: ${(e as Error).message}`);
      }
    }
    return { novas, fontes: fontes.length, erros, puladas };
  }

  /**
   * O feed RSS, como `RodadaService.coletarFeeds` fazia. O `urlHash` continua
   * com a regra própria do RSS: unificar com a da tela muda o hash das capturas
   * novas contra as já gravadas, e é decisão do MC5 (ver `url-da-captura.ts`).
   */
  private async coletarRss(f: PautaFonte, ator: AtorDaColeta): Promise<ResultadoDaColeta> {
    if (!f.url) throw new BadRequestException('Fonte RSS sem url.');
    const itens = await this.rss.ler(f.url);
    let novas = 0;
    let repetidas = 0;
    for (const item of itens) {
      const urlNorm = item.url.replace(/[?#].*$/, '').replace(/\/$/, '');
      const urlHash = createHash('sha256').update(urlNorm).digest('hex');
      const existe = await this.prisma.pautaCaptura.findUnique({
        where: { orgId_urlHash: { orgId: f.orgId, urlHash } },
        select: { id: true },
      });
      if (existe) {
        repetidas++;
        continue;
      }
      await this.prisma.pautaCaptura.create({
        data: {
          orgId: f.orgId,
          fonteId: f.id,
          tipo: 'link',
          url: item.url,
          urlHash,
          titulo: item.titulo,
          nota: null,
          bruto: {
            resumo: item.resumo,
            publicadoEm: item.publicadoEm?.toISOString() ?? null,
            feed: f.nome,
          },
          capturadoPor: ator.id,
        },
      });
      novas++;
    }
    return { novas, repetidas };
  }
}
