import { BadRequestException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import {
  COMERCIAL_AUTOMACOES,
  ComercialConfigSchema,
  type ComercialAutomacao,
  type ComercialAutonomia,
  type ComercialConfigInput,
} from '@mktos/shared';
import { Prisma } from '@prisma/client';

import { temPapelDeMaquina } from '../approvals/alcada';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { nivelDe } from './autonomia';

/*
 * A CONFIGURAÇÃO DO COMERCIAL POR EMPRESA (lane A, 13/10/2026) — K08 e a régua.
 *
 * Uma linha por empresa (`ComercialConfig`, `orgId` único). Empresa sem linha
 * lê os PADRÕES DA REGRA VIGENTE, e é isso que este arquivo garante:
 *
 *   · os três interruptores da mesa (`envioAutomatico`, `fechamentoAutomatico`,
 *     `silencioAprova`) nascem FALSOS — a regra de hoje é "agente prepara,
 *     pessoa envia/fecha/libera" (K08). Ligar é decisão da mesa, nunca padrão;
 *   · os números da régua nascem `null` = [a decidir] = DESLIGADO. Quem lê um
 *     número nulo não age: o lead parado não abre decisão, a decisão sem prazo
 *     não vence sozinha, o follow-up não sai. Nenhum número é arbitrado aqui;
 *   · `autonomia` nasce vazia e a automação sem nível lido vale o degrau que a
 *     régua já lhe dá hoje (`AUTONOMIA_VIGENTE`, em `autonomia.ts`). A0 só vale
 *     quando alguém grava A0: é o freio da tela 12, e ele só segura (lane E,
 *     fase 2; antes o padrão lido era A0, que pararia o comercial inteiro no dia
 *     em que a guarda passasse a valer).
 *
 * A homologação preenche os números pelo seed e marca `valoresDeHomologacao`:
 * a tela mostra a marca, para ninguém confundir número de teste com decisão.
 *
 * Gravar valida pelo `ComercialConfigSchema` do shared (strict: chave
 * desconhecida é 400) e escreve SÓ o que veio no corpo — campo ausente fica
 * como estava; `null` explícito volta o número para [a decidir].
 */

export interface ConfigComercial {
  envioAutomatico: boolean;
  fechamentoAutomatico: boolean;
  silencioAprova: boolean;
  janelaDeVetoMinutos: number | null;
  fupLeuDias: number | null;
  fupSilencioDias: number | null;
  prazoDiagnosticoDiasUteis: number | null;
  validadePropostaDias: number | null;
  leadParadoDias: number | null;
  decisaoExpiraHoras: number | null;
  horaPublicacaoProposta: number | null;
  cobrancaSemWebhookDias: number | null;
  efeitoRetidoHoras: number | null;
  autonomia: Partial<Record<ComercialAutomacao, ComercialAutonomia>>;
  valoresDeHomologacao: boolean;
  /** `false` quando a empresa não tem linha e tudo veio do padrão. */
  gravada: boolean;
  atualizadoEm: string | null;
}

/** Os padrões da regra vigente. Um lugar só: o teste e a tela leem daqui. */
export const CONFIG_COMERCIAL_PADRAO: Readonly<Omit<ConfigComercial, 'gravada' | 'atualizadoEm'>> = Object.freeze({
  envioAutomatico: false,
  fechamentoAutomatico: false,
  silencioAprova: false,
  janelaDeVetoMinutos: null,
  fupLeuDias: null,
  fupSilencioDias: null,
  prazoDiagnosticoDiasUteis: null,
  validadePropostaDias: null,
  leadParadoDias: null,
  decisaoExpiraHoras: null,
  horaPublicacaoProposta: null,
  cobrancaSemWebhookDias: null,
  efeitoRetidoHoras: null,
  autonomia: {},
  valoresDeHomologacao: false,
});

/** O nível de autonomia de uma automação; sem leitura, o vigente pela régua (`AUTONOMIA_VIGENTE`). */
export function autonomiaDe(cfg: Pick<ConfigComercial, 'autonomia'>, automacao: ComercialAutomacao): ComercialAutonomia {
  return nivelDe(cfg.autonomia, automacao);
}

function autonomiaLida(valor: unknown): Partial<Record<ComercialAutomacao, ComercialAutonomia>> {
  const out: Partial<Record<ComercialAutomacao, ComercialAutonomia>> = {};
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return out;
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if ((COMERCIAL_AUTOMACOES as readonly string[]).includes(k) && typeof v === 'string' && /^A[0-3]$/.test(v)) {
      out[k as ComercialAutomacao] = v as ComercialAutonomia;
    }
  }
  return out;
}

type LinhaDeConfig = Prisma.ComercialConfigGetPayload<Record<string, never>>;

export function configDaLinha(linha: LinhaDeConfig | null): ConfigComercial {
  if (!linha) return { ...CONFIG_COMERCIAL_PADRAO, autonomia: {}, gravada: false, atualizadoEm: null };
  return {
    envioAutomatico: linha.envioAutomatico,
    fechamentoAutomatico: linha.fechamentoAutomatico,
    silencioAprova: linha.silencioAprova,
    janelaDeVetoMinutos: linha.janelaDeVetoMinutos,
    fupLeuDias: linha.fupLeuDias,
    fupSilencioDias: linha.fupSilencioDias,
    prazoDiagnosticoDiasUteis: linha.prazoDiagnosticoDiasUteis,
    validadePropostaDias: linha.validadePropostaDias,
    leadParadoDias: linha.leadParadoDias,
    decisaoExpiraHoras: linha.decisaoExpiraHoras,
    horaPublicacaoProposta: linha.horaPublicacaoProposta,
    cobrancaSemWebhookDias: linha.cobrancaSemWebhookDias,
    efeitoRetidoHoras: linha.efeitoRetidoHoras,
    autonomia: autonomiaLida(linha.autonomia),
    valoresDeHomologacao: linha.valoresDeHomologacao,
    gravada: true,
    atualizadoEm: linha.atualizadoEm.toISOString(),
  };
}

@Injectable()
export class ConfigComercialService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async ler(orgId: string): Promise<ConfigComercial> {
    const linha = await this.prisma.comercialConfig.findUnique({ where: { orgId } });
    return configDaLinha(linha);
  }

  /**
   * Grava o que veio no corpo, validado. Devolve a configuração inteira depois da escrita.
   *
   * Pela tela (A-1 da revisão), `quem` vem preenchido: conta de máquina não
   * mexe nos interruptores da mesa nem na autonomia, e a escrita vai ao RASTRO
   * com o antes e o depois de cada campo que mudou.
   */
  async gravar(orgId: string, corpo: unknown, quem?: { id: string; papeis: readonly string[]; ip?: string }): Promise<ConfigComercial> {
    if (quem && temPapelDeMaquina(quem.papeis)) throw new ForbiddenException('Conta de serviço não muda os interruptores nem a autonomia do comercial.');
    const r = ComercialConfigSchema.safeParse(corpo ?? {});
    if (!r.success) {
      throw new BadRequestException({
        message: 'Configuração do comercial inválida.',
        erros: r.error.issues.map((i) => `${i.path.join('.') || '(corpo)'}: ${i.message}`),
      });
    }
    const dados = this.dadosDaEscrita(r.data);
    const antes = quem ? await this.ler(orgId) : null;
    await this.prisma.comercialConfig.upsert({
      where: { orgId },
      create: { orgId, ...dados },
      update: dados,
    });
    const depois = await this.ler(orgId);
    if (quem && antes) {
      const a = antes as unknown as Record<string, unknown>;
      const d = depois as unknown as Record<string, unknown>;
      // O carimbo da linha muda a cada escrita: não é campo que alguém mudou.
      const mudou = Object.keys(d).filter((k) => k !== 'atualizadoEm' && k !== 'gravada' && JSON.stringify(a[k]) !== JSON.stringify(d[k]));
      if (mudou.length) {
        await this.audit?.log({
          orgId,
          actorId: quem.id,
          action: 'comercial.config.alterada',
          entityType: 'comercial.config',
          entityId: orgId,
          ip: quem.ip,
          before: Object.fromEntries(mudou.map((k) => [k, a[k] ?? null])) as Prisma.InputJsonValue,
          after: Object.fromEntries(mudou.map((k) => [k, d[k] ?? null])) as Prisma.InputJsonValue,
        });
      }
    }
    return depois;
  }

  private dadosDaEscrita(c: ComercialConfigInput): Omit<Prisma.ComercialConfigUncheckedCreateInput, 'orgId'> {
    const d: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c)) {
      if (v === undefined) continue;
      d[k] = k === 'autonomia' ? (v as Prisma.InputJsonValue) : v;
    }
    return d as Omit<Prisma.ComercialConfigUncheckedCreateInput, 'orgId'>;
  }
}
