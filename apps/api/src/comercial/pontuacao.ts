import type { ComercialPerfil, ComercialProduto } from '@mktos/shared';

/*
 * A PONTUAÇÃO DO LEAD — a parte pura do qualificador (Lane A).
 *
 * O mapa (C04, E1 e E2) diz o que cada perfil é e a que canal corresponde:
 *   · P1 "conhece o ChatGPT": conteúdo, tráfego e comunidade;
 *   · P2 "tem sistema com base organizada": ERPs parceiros;
 *   · P3 "tem muito dado e não cruza": indicação, eventos e rede.
 * O semáforo do AUT-WEB-01 (0 a 8) que o mapa cita como espelho NÃO está
 * descrito no desenho, então a conta abaixo é uma RÉGUA PROVISÓRIA DE
 * HOMOLOGAÇÃO, determinística e visível, para a mesa trocar: cada critério
 * vale um número fixo e o total é limitado a 100. O que não se sabe não pontua.
 * Sem nenhum dado, a resposta é `null` nos dois campos, nunca um número.
 *
 * O produto de entrada que o qualificador "propõe" (E2) também é regra
 * provisória: com sistema e base organizada, Operação ROOT; sem base, Imersão
 * (a Imersão é "diagnóstico aprofundado e primeiro fluxo rodando", a porta de
 * entrada; a Operação pede base para conciliar). Trocar isso é decisão da mesa,
 * registrada em `homolog/progresso.md` como pendência.
 */

export interface DadosParaPontuar {
  canal?: string | null;
  sistemaErp?: string | null;
  baseDados?: boolean | null;
  equipeFinanceiro?: number | null;
  maiorDor?: string | null;
  cnpj?: string | null;
}

export interface Pontuacao {
  pontuacao: number | null;
  perfil: ComercialPerfil | null;
  criterios: Record<string, number | boolean | string | null>;
}

/** O perfil que o canal sugere (C04, E1). Canal desconhecido não sugere nada. */
export function perfilDoCanal(canal: string | null | undefined): ComercialPerfil | null {
  switch (canal) {
    case 'conteudo':
    case 'comunidade':
    case 'site':
      return 'P1';
    case 'erp_parceiro':
      return 'P2';
    case 'indicacao':
    case 'evento':
      return 'P3';
    default:
      return null;
  }
}

/** Os pesos da régua provisória. Um lugar só, para a mesa trocar sem caçar número. */
export const PESOS_DA_PONTUACAO = {
  canalConhecido: 20,
  sistemaInformado: 25,
  baseOrganizada: 30,
  equipeFinanceiroAte2: 10,
  equipeFinanceiroAcimaDe2: 15,
  dorEscrita: 10,
  cnpjInformado: 10,
} as const;

export function pontuar(d: DadosParaPontuar): Pontuacao {
  const criterios: Record<string, number | boolean | string | null> = {};
  let total = 0;
  let houveDado = false;

  if (d.canal) {
    houveDado = true;
    total += PESOS_DA_PONTUACAO.canalConhecido;
    criterios.canal = d.canal;
  }
  if (d.sistemaErp && d.sistemaErp.trim()) {
    houveDado = true;
    total += PESOS_DA_PONTUACAO.sistemaInformado;
    criterios.sistema = d.sistemaErp.trim();
  }
  if (typeof d.baseDados === 'boolean') {
    houveDado = true;
    if (d.baseDados) total += PESOS_DA_PONTUACAO.baseOrganizada;
    criterios.baseOrganizada = d.baseDados;
  }
  if (typeof d.equipeFinanceiro === 'number' && Number.isFinite(d.equipeFinanceiro)) {
    houveDado = true;
    total += d.equipeFinanceiro > 2 ? PESOS_DA_PONTUACAO.equipeFinanceiroAcimaDe2 : PESOS_DA_PONTUACAO.equipeFinanceiroAte2;
    criterios.equipeFinanceiro = d.equipeFinanceiro;
  }
  if (d.maiorDor && d.maiorDor.trim()) {
    houveDado = true;
    total += PESOS_DA_PONTUACAO.dorEscrita;
    criterios.dorEscrita = true;
  }
  if (d.cnpj && d.cnpj.trim()) {
    houveDado = true;
    total += PESOS_DA_PONTUACAO.cnpjInformado;
    criterios.cnpj = true;
  }

  if (!houveDado) return { pontuacao: null, perfil: null, criterios };

  // O perfil vem do canal quando há canal; sem canal, do que o formulário disse.
  let perfil = perfilDoCanal(d.canal);
  if (!perfil && (d.sistemaErp || typeof d.baseDados === 'boolean')) {
    perfil = d.baseDados === true ? 'P2' : 'P1';
  }
  criterios.perfilPor = perfil ? (perfilDoCanal(d.canal) ? 'canal' : 'formulario') : null;

  return { pontuacao: Math.min(100, total), perfil, criterios };
}

/** O produto de entrada proposto pelo qualificador (regra provisória, ver o topo). */
export function produtoAlvo(d: { sistemaErp?: string | null; baseDados?: boolean | null }): ComercialProduto | null {
  if (typeof d.baseDados !== 'boolean') return null;
  return d.baseDados && d.sistemaErp ? 'operacao' : 'imersao';
}
