import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RelatorioService, mesSeguinte } from '../../pauta/relatorio.service';
import { ExecutoresDeRotinaRegistry } from '../executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../rotina.tipos';
import { TIPO_PAUTA_RELATORIO } from '../rotina.tipos';

/** O `AAAA-MM` de uma data, em UTC — o mesmo fuso da janela do mês. */
function mesDe(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** O mês anterior ao da data. */
function mesAFechar(agora: Date): string {
  const m = mesDe(agora);
  const [a, n] = m.split('-').map(Number);
  return n === 1 ? `${a - 1}-12` : `${a}-${String(n - 1).padStart(2, '0')}`;
}

/**
 * O RELATÓRIO DO MÊS (MK6). No dia em que a rotina dispara, fecha o MÊS
 * ANTERIOR — o cron padrão da tela é o primeiro dia do mês.
 *
 * NASCE DESLIGADA, como toda automação da casa: ela gasta IA sozinha, todo mês,
 * e quem liga é gente. Enquanto ninguém liga, o relatório se gera pelo botão.
 *
 * NÃO REFAZ RELATÓRIO QUE JÁ EXISTE. Um mês fechado é um documento que alguém
 * pode ter editado à mão; a rotina passando por cima apagaria a edição sem
 * avisar. Refazer é decisão de quem clica, e o botão da tela faz isso.
 */
@Injectable()
export class ExecutorDoRelatorioDaPauta implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relatorios: RelatorioService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(
      { [TIPO_PAUTA_RELATORIO]: (ctx) => this.executar(ctx) },
      'ExecutorDoRelatorioDaPauta',
    );
  }

  async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    // Segunda tranca do módulo, depois da do `POST /rotinas`: empresa que
    // desliga a pauta não continua pagando IA pela rotina que ficou.
    const org = await this.prisma.org.findUnique({ where: { id: ctx.orgId }, select: { modulos: true } });
    if (!org?.modulos.includes('pauta')) {
      return { status: 'pulada', resumo: 'módulo pauta desligado nesta empresa — nada a fechar' };
    }

    const cfg = ctx.config as { mes?: unknown };
    // `mes` na config existe para refazer um mês antigo à mão, sem esperar a
    // virada. Sem ele, o mês a fechar é o anterior ao do tique.
    const mes = typeof cfg.mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(cfg.mes) ? cfg.mes : mesAFechar(ctx.agora);

    const antes = await this.relatorios.painel(ctx.orgId, mes);
    if (antes.documento.trim()) {
      return { status: 'pulada', resumo: `${mes} já tem relatório — refazer é pelo botão, para não apagar edição` };
    }

    const painel = await this.relatorios.gerar(ctx.orgId, ctx.rotinaId, mes, true);
    return {
      status: 'ok',
      resumo: `relatório de ${mes} gerado · ${painel.publicadas} peça(s) publicada(s) no mês`,
    };
  }
}

/** Exportado para o teste: o mês seguinte é o da estratégia que o relatório lê. */
export { mesAFechar, mesSeguinte };
