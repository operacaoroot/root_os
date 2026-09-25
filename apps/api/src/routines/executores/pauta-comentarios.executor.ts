import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ComentariosService } from '../../pauta/comentarios.service';
import { DmAutomaticaService } from '../../pauta/dm-automatica.service';
import { ExecutoresDeRotinaRegistry } from '../executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../rotina.tipos';
import { TIPO_PAUTA_COMENTARIOS } from '../rotina.tipos';

/**
 * A FILA DA DM À MÃO (MD9), de 10 em 10 minutos (`*\/10 * * * *`):
 *
 *   1. apaga o @ das linhas que passaram dos 7 dias;
 *   2. lê pela porta (`instagram.comentario.ler`, R0, com o interruptor do
 *      Instagram) os comentários dos posts da semana com palavra, publicados
 *      nos últimos 7 dias — pelo id da mídia (MD6) ou pelo permalink colado
 *      à mão (MC16);
 *   3. grava na fila quem comentou a palavra inteira. A mesma leitura na
 *      passagem seguinte cai na mesma linha.
 *
 * Nada sai do OS: a DM é mandada à mão, da aba Semana. A rotina é o
 * interruptor ("liga já"): sem ela criada em /rotinas, nada é lido. Com o
 * módulo pauta desligado, a passagem só apaga o @ vencido e o envio da DM
 * que passou dos 90 dias.
 *
 *   4. MD11: a DM automática, logo depois — só com a nota
 *      `pauta.dm.automatica` ligada e a regra da matéria assinada no lote da
 *      semana; desligada, só apaga o envio que passou dos 90 dias.
 */
@Injectable()
export class ExecutorDeComentariosDaPauta implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comentarios: ComentariosService,
    private readonly registro: ExecutoresDeRotinaRegistry,
    @Optional() private readonly dm?: DmAutomaticaService,
  ) {}

  onModuleInit(): void {
    this.registro.registrar({ [TIPO_PAUTA_COMENTARIOS]: (ctx) => this.executar(ctx) }, 'ExecutorDeComentariosDaPauta');
  }

  async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const org = await this.prisma.org.findUnique({ where: { id: ctx.orgId }, select: { modulos: true } });
    if (!org?.modulos.includes('pauta')) {
      // Os prazos do @ (7 dias) e do envio da DM (90 dias) não dependem do módulo: apagar não lê a Graph nem sai do OS.
      const expurgados = await this.comentarios.expurgar(ctx.orgId);
      const envios = (await this.dm?.expurgar(ctx.orgId)) ?? 0;
      const nota = `${expurgados ? ` · ${expurgados} @ apagado(s) depois dos 7 dias` : ''}${envios ? ` · ${envios} envio(s) apagado(s) depois dos 90 dias` : ''}`;
      return { status: 'pulada', resumo: `módulo pauta desligado nesta empresa — nada a ler${nota}` };
    }
    const coleta = await this.comentarios.coletar(ctx.orgId);
    if (!this.dm) return coleta;
    const dm = await this.dm.passagem(ctx.orgId);
    return {
      status: coleta.status === 'ok' || dm.status === 'ok' ? 'ok' : 'pulada',
      resumo: `${coleta.resumo} · ${dm.resumo}`.slice(0, 500),
    };
  }
}
