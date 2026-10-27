import { HttpException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { AgentEstado, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../routines/executores.registry';
import { LIVRE, type ContextoDaRotina, type ResultadoDaRotina } from '../routines/rotina.tipos';
import { proximaOcorrencia } from '../pauta/cron';
import { ReguasService } from './reguas.service';

export const TIPO_DA_IMPORTACAO_DA_COMUNIDADE = 'marketing.comunidade.importar';
export const SLUG_DA_IMPORTACAO_DA_COMUNIDADE = 'marketing-comunidade-importar';
export const CRON_DA_IMPORTACAO_DA_COMUNIDADE = '0 * * * *';
const FUSO = 'America/Sao_Paulo';

/**
 * A rotina de hora em hora que traz para o Banco os arquivos novos de
 * canal-whatsapp/semanas (27/10/2026, pedido do agente da comunidade). É o mesmo
 * "Importar do Drive" da tela: só cria o que falta, nunca regrava post existente.
 * Aparece em /rotinas, onde pausa. Nasce na primeira importação feita na tela.
 */
@Injectable()
export class ImportacaoDaComunidadeService implements OnModuleInit {
  private readonly log = new Logger('ImportacaoDaComunidade');

  constructor(
    private readonly prisma: PrismaService,
    private readonly reguas: ReguasService,
    @Optional() private readonly executores?: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.executores?.registrar({ [TIPO_DA_IMPORTACAO_DA_COMUNIDADE]: (ctx) => this.passagem(ctx) }, 'ImportacaoDaComunidadeService');
  }

  /** Cria a rotina se ainda não existe. A que existe não é tocada (pausada fica pausada). */
  async garantirRotina(orgId: string): Promise<'criada' | 'ja-existia'> {
    const slug = SLUG_DA_IMPORTACAO_DA_COMUNIDADE;
    const existe = await this.prisma.rotina.findUnique({ where: { orgId_slug: { orgId, slug } }, select: { id: true } });
    if (existe) return 'ja-existia';
    await this.prisma.rotina.create({
      data: {
        orgId, slug, nome: 'Comunidade WhatsApp: traz os arquivos novos do Drive para o Banco (de hora em hora)',
        tipo: TIPO_DA_IMPORTACAO_DA_COMUNIDADE, config: {} as Prisma.InputJsonValue,
        cron: CRON_DA_IMPORTACAO_DA_COMUNIDADE, tz: FUSO, ativo: true, estado: AgentEstado.rodando,
        origem: 'manual', refExterna: null,
        reservadoEm: LIVRE, reservadoAte: LIVRE,
        proximaExecucaoEm: proximaOcorrencia(CRON_DA_IMPORTACAO_DA_COMUNIDADE, FUSO, new Date()),
      },
    });
    return 'criada';
  }

  async passagem(ctx: Pick<ContextoDaRotina, 'orgId'>): Promise<ResultadoDaRotina> {
    try {
      const r = await this.reguas.importarComunidade(ctx.orgId, 'rotina da comunidade');
      return {
        status: 'ok',
        resumo: r.criados
          ? `${r.criados} peça(s) nova(s) no Banco (${r.lidos} arquivo(s) na pasta).`
          : `Nada novo na pasta (${r.lidos} arquivo(s), ${r.jaExistiam} já no Banco).`,
      };
    } catch (e) {
      // Drive desligado ou pasta ausente: não é falha desta passagem, é falta de configuração.
      if (e instanceof HttpException && [404, 503].includes(e.getStatus())) return { status: 'pulada', resumo: e.message.slice(0, 200) };
      this.log.warn(`importação da comunidade falhou (${ctx.orgId}): ${(e as Error).message}`);
      return { status: 'erro', resumo: `A importação falhou: ${(e as Error).message}`.slice(0, 200) };
    }
  }
}
