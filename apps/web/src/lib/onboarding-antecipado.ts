import {
  ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO,
  motivoParaNaoIniciarOnboarding,
  type EtapasDoOnboardingAntecipado,
  type FichaDoLead,
  type LeadElegivelAoOnboarding,
  type OnboardingAntecipadoResposta,
} from '@mktos/shared';

import { apiGet, apiPost } from '@/lib/api';

/*
 * INICIAR O ONBOARDING ANTES DO NEGÓCIO FECHADO (ajustes da versão final A2, 19/10/2026).
 *
 * As duas telas que chamam a porta (o painel do lead e a Implantação) leem daqui
 * quem vê o botão e falam com as mesmas rotas. A API confere tudo de novo: o botão
 * escondido é conforto, a recusa de verdade é dela.
 */

/** As duas permissões da rota: o lead (`leads.editar`) e o card no Trabalho (`tarefas.editar`). */
export function podeIniciarOnboarding(can: (p: string) => boolean): boolean {
  return can('leads.editar') && can('tarefas.editar');
}

/** O botão aparece no painel do lead? Só com as permissões, antes de fechado, fora das saídas e sem card. */
export function mostrarIniciarOnboardingNoLead(can: (p: string) => boolean, ficha: Pick<FichaDoLead, 'etapa' | 'ligadoA'>): boolean {
  if (!podeIniciarOnboarding(can)) return false;
  if (ficha.ligadoA.implantacao) return false;
  return motivoParaNaoIniciarOnboarding({ etapa: ficha.etapa, clienteAtivo: false }) === null;
}

export const ETAPAS_DE_RESERVA: EtapasDoOnboardingAntecipado = { etapas: [ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO], padrao: ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO };

export function lerEtapasDoOnboarding(token: string | null | undefined): Promise<EtapasDoOnboardingAntecipado> {
  return apiGet<EtapasDoOnboardingAntecipado>('/comercial/onboarding-antecipado/etapas', token);
}

export function buscarLeadsElegiveis(token: string | null | undefined, q: string): Promise<LeadElegivelAoOnboarding[]> {
  const busca = q.trim();
  return apiGet<LeadElegivelAoOnboarding[]>(`/comercial/onboarding-antecipado/elegiveis${busca ? `?q=${encodeURIComponent(busca)}` : ''}`, token);
}

export function iniciarOnboarding(token: string | null | undefined, leadId: string, etapa: string): Promise<OnboardingAntecipadoResposta> {
  return apiPost<OnboardingAntecipadoResposta>(`/comercial/leads/${encodeURIComponent(leadId)}/onboarding-antecipado`, { etapa }, token);
}

/** O endereço do card na Implantação, com o pop-up aberto. */
export function linkDoCardAntecipado(r: Pick<OnboardingAntecipadoResposta, 'cardId'>): string {
  return `/trabalho/implantacao?tarefa=${encodeURIComponent(r.cardId)}`;
}
