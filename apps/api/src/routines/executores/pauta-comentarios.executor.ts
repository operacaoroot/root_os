import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ComentariosService } from '../../pauta/comentarios.service';
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
 * módulo pauta desligado, a passagem só apaga o @ vencido.
 */
@Injectable()
export class ExecutorDeComentariosDaPauta implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comentarios: ComentariosService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar({ [TIPO_PAUTA_COMENTARIOS]: (ctx) => this.executar(ctx) }, 'ExecutorDeComentariosDaPauta');
  }

  async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const org = await this.prisma.org.findUnique({ where: { id: ctx.orgId }, select: { modulos: true } });
    if (!org?.modulos.includes('pauta')) {
      // O prazo do @ não depende do módulo: apagar não lê a Graph nem sai do OS.
      const expurgados = await this.comentarios.expurgar(ctx.orgId);
      const nota = expurgados ? ` · ${expurgados} @ apagado(s) depois dos 7 dias` : '';
      return { status: 'pulada', resumo: `módulo pauta desligado nesta empresa — nada a ler${nota}` };
    }
    return this.comentarios.coletar(ctx.orgId);
  }
}
