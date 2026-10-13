import { BadRequestException, Injectable } from '@nestjs/common';
import {
  COMERCIAL_AUTOMACOES,
  ComercialConfigSchema,
  type ComercialAutomacao,
  type ComercialAutonomia,
  type ComercialConfigInput,
} from '@mktos/shared';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

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
 *   · `autonomia` nasce vazia e a automação sem nível lido vale A0 (não roda
 *     sozinha), que é o degrau mais baixo da tela 12.
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
  autonomia: {},
  valoresDeHomologacao: false,
});

/** O nível de autonomia de uma automação; sem leitura, A0 (não roda sozinha). */
export function autonomiaDe(cfg: Pick<ConfigComercial, 'autonomia'>, automacao: ComercialAutomacao): ComercialAutonomia {
  return cfg.autonomia[automacao] ?? 'A0';
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
    autonomia: autonomiaLida(linha.autonomia),
    valoresDeHomologacao: linha.valoresDeHomologacao,
    gravada: true,
    atualizadoEm: linha.atualizadoEm.toISOString(),
  };
}

@Injectable()
export class ConfigComercialService {
  constructor(private readonly prisma: PrismaService) {}

  async ler(orgId: string): Promise<ConfigComercial> {
    const linha = await this.prisma.comercialConfig.findUnique({ where: { orgId } });
    return configDaLinha(linha);
  }

  /** Grava o que veio no corpo, validado. Devolve a configuração inteira depois da escrita. */
  async gravar(orgId: string, corpo: unknown): Promise<ConfigComercial> {
    const r = ComercialConfigSchema.safeParse(corpo ?? {});
    if (!r.success) {
      throw new BadRequestException({
        message: 'Configuração do comercial inválida.',
        erros: r.error.issues.map((i) => `${i.path.join('.') || '(corpo)'}: ${i.message}`),
      });
    }
    const dados = this.dadosDaEscrita(r.data);
    await this.prisma.comercialConfig.upsert({
      where: { orgId },
      create: { orgId, ...dados },
      update: dados,
    });
    return this.ler(orgId);
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
