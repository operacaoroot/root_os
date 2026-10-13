import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { COMERCIAL_ETAPAS, COMERCIAL_ROTULO_DA_ETAPA, type ComercialEtapa } from '@mktos/shared';
import { AgentEstado, Prisma } from '@prisma/client';

import { proximaOcorrencia } from '../pauta/cron';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../routines/executores.registry';
import { LIVRE, type ContextoDaRotina, type ResultadoDaRotina } from '../routines/rotina.tipos';
import { ConfigComercialService } from './config.service';
import { DecisoesService } from './decisoes.service';
import { FichaService } from './ficha.service';
import { etapaDeVolta } from './portoes';
import { FioService } from './fio.service';
import { RelogioComercialRegistry } from './relogio.registry';

/*
 * O RELÓGIO COMERCIAL (lane A, 13/10/2026) — a rotina `comercial.relogio`.
 *
 * Uma rotina como as outras (`/rotinas`, estado declarado, histórico), semeada
 * por empresa no primeiro lead que chega (`garantirRotina`, como o
 * `onboarding.relogio` é semeado no primeiro trilho), com tique de 1 minuto em
 * São Paulo. `ROTINAS_CRON=off` cala o agendador inteiro e, com ele, esta
 * rotina: o relógio não tem tique próprio.
 *
 * A cada passagem chama TODAS as tarefas do `RelogioComercialRegistry`, cada
 * uma isolada: a que lança vira uma linha de falha no resumo e as outras
 * seguem. As três da espinha, inscritas aqui:
 *
 *   · `espinha.decisoes-vencidas` — `expirarVencidas`: aplica o padrão escrito;
 *   · `espinha.reacoes-pendentes` — `FioService.reexecutarPendentes` para a
 *     reação que ficou `erro` ou parada em `em_curso` há mais de 2 minutos;
 *   · `espinha.lead-parado` — com `leadParadoDias` na config, abre a decisão
 *     `lead_parado` UMA VEZ POR PERÍODO: a chave é a etapa, o dia em que o lead
 *     entrou nela e quantos períodos de N dias já passaram. Sem o número
 *     ([a decidir]), a tarefa não faz nada;
 *   · `espinha.geladeira-volta` — lead na geladeira com `voltaEm` vencido volta
 *     para a etapa em que estava quando saiu (`etapaAntesDaSaida`), pelo mesmo
 *     `mudarEtapa`. Geladeira sem data não volta sozinha.
 *
 * Passagem sem nenhuma ação devolve `pulada` (não vira linha de histórico).
 */

export const TIPO_DA_ROTINA_COMERCIAL = 'comercial.relogio';
export const SLUG_DA_ROTINA_COMERCIAL = 'comercial-relogio';
export const CRON_DA_ROTINA_COMERCIAL = '* * * * *';
export const FUSO_DA_ROTINA_COMERCIAL = 'America/Sao_Paulo';

const DIA_MS = 86_400_000;
const REACAO_PARADA_MS = 2 * 60_000;

/** O período do lead parado (puro): a chave da decisão, ou `null` se ainda não passou de N dias. */
export function periodoDoLeadParado(etapa: string, etapaDesde: Date, agora: Date, nDias: number): string | null {
  const dias = (agora.getTime() - etapaDesde.getTime()) / DIA_MS;
  if (dias <= nDias) return null;
  const periodo = Math.floor(dias / nDias);
  return `${etapa}:${etapaDesde.toISOString().slice(0, 10)}:p${periodo}`;
}

@Injectable()
export class RelogioDaEspinha implements OnModuleInit {
  private readonly log = new Logger('RelogioComercial');
  private readonly garantidas = new Set<string>();
  /** Os pulos de autonomia (A0) já registrados hoje, por empresa e tarefa. */
  private readonly pulosAvisados = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registroDeRotinas: ExecutoresDeRotinaRegistry,
    private readonly tarefas: RelogioComercialRegistry,
    private readonly decisoes: DecisoesService,
    private readonly fio: FioService,
    private readonly config: ConfigComercialService,
    private readonly fichas: FichaService,
  ) {}

  onModuleInit(): void {
    this.inscrever();
  }

  /** Separado do `onModuleInit` para a suíte montar à mão. */
  inscrever(): void {
    this.registroDeRotinas.registrar({ [TIPO_DA_ROTINA_COMERCIAL]: (ctx) => this.executar(ctx) }, 'RelogioDaEspinha (comercial)');
    this.tarefas.inscrever('espinha.decisoes-vencidas', (orgId, agora) => this.decisoes.expirarVencidas(orgId, agora));
    this.tarefas.inscrever('espinha.reacoes-pendentes', (orgId, agora) => this.fio.reexecutarPendentes(orgId, new Date(agora.getTime() - REACAO_PARADA_MS)));
    this.tarefas.inscrever('espinha.lead-parado', (orgId, agora) => this.leadsParados(orgId, agora));
    this.tarefas.inscrever('espinha.geladeira-volta', (orgId, agora) => this.voltasDaGeladeira(orgId, agora));
  }

  /** Semeia a rotina da empresa (idempotente; uma vez por processo e empresa). */
  async garantirRotina(orgId: string): Promise<void> {
    if (this.garantidas.has(orgId)) return;
    try {
      await this.prisma.rotina.upsert({
        where: { orgId_slug: { orgId, slug: SLUG_DA_ROTINA_COMERCIAL } },
        create: {
          orgId,
          slug: SLUG_DA_ROTINA_COMERCIAL,
          nome: 'Relógio do comercial',
          tipo: TIPO_DA_ROTINA_COMERCIAL,
          config: {} as Prisma.InputJsonValue,
          cron: CRON_DA_ROTINA_COMERCIAL,
          tz: FUSO_DA_ROTINA_COMERCIAL,
          ativo: true,
          estado: AgentEstado.rodando,
          origem: 'manual',
          refExterna: null,
          agenteSlug: null,
          reservadoEm: LIVRE,
          reservadoAte: LIVRE,
          proximaExecucaoEm: proximaOcorrencia(CRON_DA_ROTINA_COMERCIAL, FUSO_DA_ROTINA_COMERCIAL, new Date()),
        },
        update: {},
      });
      this.garantidas.add(orgId);
    } catch (e) {
      this.log.error(`empresa ${orgId}: não consegui semear a rotina do relógio comercial: ${(e as Error).message}`);
    }
  }

  /** Uma passagem: todas as tarefas inscritas, cada uma isolada. */
  async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    return this.passagem(ctx.orgId, ctx.agora);
  }

  async passagem(orgId: string, agora: Date): Promise<ResultadoDaRotina> {
    const feitos: string[] = [];
    const falhas: string[] = [];
    const puladas: string[] = [];
    let novosPulos = 0;
    for (const [nome, fn] of this.tarefas.inscritas()) {
      try {
        // A autonomia (lane E): tarefa de automação em A0 não roda, e o pulo vai ao resumo.
        const guarda = this.tarefas.guarda;
        const v = guarda ? await guarda(orgId, nome) : { roda: true as const };
        if (!v.roda) {
          puladas.push(`${nome} (${v.automacao} em ${v.nivel})`);
          // O pulo vira linha de histórico UMA vez por dia e tarefa: a passagem é de minuto em minuto.
          const marca = `${orgId}:${nome}:${agora.toISOString().slice(0, 10)}`;
          if (!this.pulosAvisados.has(marca)) {
            this.pulosAvisados.add(marca);
            novosPulos++;
          }
          continue;
        }
        const r = await fn(orgId, agora);
        const n = typeof r === 'number' ? r : r && typeof r === 'object' && 'feitas' in r ? Number((r as { feitas: unknown }).feitas) : r ? 1 : 0;
        if (n > 0) feitos.push(`${nome}×${n}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(`tarefa "${nome}" falhou na empresa ${orgId}: ${msg}`);
        falhas.push(`${nome}: ${msg.slice(0, 120)}`);
      }
    }
    if (falhas.length) return { status: 'erro', resumo: `falharam ${falhas.length}: ${falhas.join(' · ')}${feitos.length ? ` · feitas: ${feitos.join(', ')}` : ''}` };
    const seguradas = puladas.length ? ` · seguradas pela autonomia: ${puladas.join(', ')}` : '';
    if (!feitos.length) {
      // Pulo de autonomia novo no dia: a passagem fica no histórico (`ok`), para o A0 deixar rastro.
      if (novosPulos) return { status: 'ok', resumo: `nada feito.${seguradas}` };
      return { status: 'pulada', resumo: `nada a fazer no relógio comercial.${seguradas}` };
    }
    return { status: 'ok', resumo: `${feitos.join(', ')}${seguradas}` };
  }

  /** Geladeira com data de volta vencida → a etapa de antes da saída. */
  async voltasDaGeladeira(orgId: string, agora: Date): Promise<number> {
    const prontas = await this.prisma.comercialFicha.findMany({
      where: { orgId, etapa: 'geladeira', voltaEm: { lte: agora } },
      select: { leadId: true, voltaEm: true, etapaAntesDaSaida: true },
      take: 100,
    });
    let voltaram = 0;
    for (const f of prontas) {
      const para = etapaDeVolta(f.etapaAntesDaSaida);
      const r = await this.fichas.mudarEtapa(orgId, f.leadId, para, { motivo: 'a data de volta da geladeira chegou', eventoGatilho: `volta:${f.voltaEm!.toISOString()}`, agora });
      if (r.mudou) voltaram++;
    }
    return voltaram;
  }

  /** Lead parado além de `leadParadoDias` → decisão `lead_parado`, uma por período. */
  async leadsParados(orgId: string, agora: Date): Promise<number> {
    const cfg = await this.config.ler(orgId);
    if (cfg.leadParadoDias == null) return 0;
    const limite = new Date(agora.getTime() - cfg.leadParadoDias * DIA_MS);
    const ativas = COMERCIAL_ETAPAS.filter((e) => e !== 'fechado');
    const parados = await this.prisma.comercialFicha.findMany({
      where: { orgId, etapa: { in: ativas }, etapaDesde: { lt: limite } },
      select: { leadId: true, etapa: true, etapaDesde: true },
      take: 200,
    });
    let abertas = 0;
    for (const f of parados) {
      const chave = periodoDoLeadParado(f.etapa, f.etapaDesde, agora, cfg.leadParadoDias);
      if (!chave) continue;
      const dias = Math.floor((agora.getTime() - f.etapaDesde.getTime()) / DIA_MS);
      const r = await this.decisoes.abrir({
        orgId,
        leadId: f.leadId,
        tipo: 'lead_parado',
        chave,
        titulo: `Lead parado há ${dias} dias em ${COMERCIAL_ROTULO_DA_ETAPA[f.etapa as ComercialEtapa]}`,
        contexto: `O prazo combinado é de ${cfg.leadParadoDias} dias por etapa${cfg.valoresDeHomologacao ? ' (valor de homologação)' : ''}. Nada aconteceu desde ${f.etapaDesde.toISOString().slice(0, 10)}.`,
        opcoes: [
          { chave: 'manter', rotulo: 'manter', efeito: 'segue onde está; a fila volta a perguntar no próximo período' },
          { chave: 'geladeira', rotulo: 'geladeira', efeito: 'sai para a geladeira com motivo "sumiu"' },
          { chave: 'perdido', rotulo: 'perdido', efeito: 'sai como perdido com motivo "sumiu"' },
        ],
        padrao: 'manter',
        dados: { etapa: f.etapa, dias },
        agora,
      });
      if (r.nova) abertas++;
    }
    return abertas;
  }
}
