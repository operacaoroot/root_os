import { Injectable, OnModuleInit } from '@nestjs/common';
import { PAUTA_HORAS_DA_CURADORIA, PAUTA_ORIGENS, type PautaOrigem } from '@mktos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RodadaService } from '../../pauta/rodada.service';
import type { ResultadoDaColetaDaRodada } from '../../pauta/coleta.service';
import { filtroDasOrigens, lerOrigensDaRodada } from '../../pauta/origem-da-rodada';
import { lerCandidatos } from '../../pauta/curadoria-da-rodada';
import { ExecutoresDeRotinaRegistry } from '../executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../rotina.tipos';
import { TIPO_PAUTA_COLETA } from '../rotina.tipos';

/**
 * A COLETA DE QUINTA (MC5): coleta todas as fontes e deixa a rodada pronta para
 * a curadoria humana — sem curar.
 *
 * Difere da `pauta.rodada` em duas coisas. A rodada sai pelo modo "para
 * curadoria" (`gerarParaCuradoria`, MC6): todos os candidatos da janela, a IA
 * só sugere, status `aguardando_curadoria`. E não há `PautaRotina` por trás: a
 * rotina nasce pelo `POST /rotinas`, com a configuração na própria `Rotina`
 * (`horas`, padrão 168; `origens`, padrão todas).
 *
 * O grupo de WhatsApp (W) não se coleta: o link chega sozinho pelo webhook (MC1)
 * e entra na rodada pela janela. Uma fonte que falha não derruba as outras (o
 * motivo fica na fonte, no Radar); o resumo conta por origem.
 */
@Injectable()
export class ExecutorDeColetaDaPauta implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rodadas: RodadaService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(
      { [TIPO_PAUTA_COLETA]: (ctx) => this.executar(ctx) },
      'ExecutorDeColetaDaPauta',
    );
  }

  async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const cfg = ctx.config as { horas?: number; origens?: unknown };
    const lidas = lerOrigensDaRodada(cfg.origens);
    if ('erro' in lidas) throw new Error(`configuração da rotina: ${lidas.erro}`);
    const { origens } = lidas;

    // Segunda tranca do módulo, depois da do `POST /rotinas`: a empresa que
    // desliga a pauta não continua pagando Apify e IA pela rotina que ficou.
    const org = await this.prisma.org.findUnique({ where: { id: ctx.orgId }, select: { modulos: true } });
    if (!org?.modulos.includes('pauta')) {
      return { status: 'pulada', resumo: 'módulo pauta desligado nesta empresa — nada a coletar' };
    }

    const fontes = await this.prisma.pautaFonte.count({
      where: { orgId: ctx.orgId, ativo: true, OR: filtroDasOrigens(origens) },
    });
    if (fontes === 0) {
      return {
        status: 'pulada',
        resumo: `nenhuma fonte ativa nas origens ${origens.join(', ')} — nada a coletar`,
      };
    }

    const coleta = await this.rodadas.coletarPorOrigem(ctx.orgId, 'rotina', origens);
    const linhaDaColeta = resumoDaColeta(coleta.total, coleta.porOrigem);

    const horas = typeof cfg.horas === 'number' ? cfg.horas : PAUTA_HORAS_DA_CURADORIA;
    let rodada: { id: string; itens: unknown; erro: string | null };
    try {
      rodada = await this.rodadas.gerarParaCuradoria(ctx.orgId, 'rotina', {
        // `PautaRodada.rotinaId` aponta para `PautaRotina`, que esta rotina não tem.
        rotinaId: null,
        horas,
        // A janela conta do disparo, não do fim da coleta: se contasse do fim,
        // a coleta desta semana mais lenta que a da anterior abriria um buraco
        // que rodada nenhuma lê. O fim fica aberto até a consulta, para as
        // capturas da própria coleta entrarem.
        desde: new Date(ctx.agora.getTime() - horas * 3_600_000),
        origens,
      });
    } catch (e) {
      throw new Error(`${linhaDaColeta}; rodada não gerada: ${(e as Error).message}`);
    }

    return {
      status: 'ok',
      resumo: `${linhaDaColeta}; ${resumoDaRodada(rodada)}`.slice(0, 500),
    };
  }
}

/** "coleta: R 3 novas/2 fontes · N 0/1 (1 erro) · …" — só contagem, nunca conteúdo. */
export function resumoDaColeta(
  total: ResultadoDaColetaDaRodada,
  porOrigem: Partial<Record<PautaOrigem, ResultadoDaColetaDaRodada>>,
): string {
  const partes = PAUTA_ORIGENS.filter((o) => porOrigem[o]).map((o) => {
    const c = porOrigem[o] as ResultadoDaColetaDaRodada;
    const extra = [c.erros ? `${c.erros} erro(s)` : '', c.puladas ? `${c.puladas} pulada(s)` : '']
      .filter(Boolean)
      .join(', ');
    return `${o} ${c.novas} nova(s)/${c.fontes} fonte(s)${extra ? ` (${extra})` : ''}`;
  });
  return `coleta: ${total.novas} nova(s) de ${total.fontes} fonte(s)${partes.length ? ` — ${partes.join(' · ')}` : ''}`;
}

/** "rodada 1a2b3c4d aguardando curadoria: 42 candidatos (W 5 · N 10 · …)". */
export function resumoDaRodada(rodada: { id: string; itens: unknown; erro: string | null }): string {
  const candidatos = lerCandidatos(rodada.itens);
  const conta = new Map<PautaOrigem, number>();
  for (const c of candidatos) {
    for (const o of c.origens?.length ? c.origens : c.origem ? [c.origem] : []) {
      conta.set(o, (conta.get(o) ?? 0) + 1);
    }
  }
  const porOrigem = PAUTA_ORIGENS.filter((o) => conta.has(o)).map((o) => `${o} ${conta.get(o)}`);
  const sugeridos = candidatos.filter((c) => c.sugerido).length;
  return (
    `rodada ${rodada.id.slice(0, 8)} aguardando curadoria: ${candidatos.length} candidato(s)` +
    (porOrigem.length ? ` (${porOrigem.join(' · ')})` : '') +
    `, ${sugeridos} sugerido(s)` +
    (rodada.erro ? ' — sem sugestão da IA' : '')
  );
}
