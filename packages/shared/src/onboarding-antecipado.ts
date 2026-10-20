import { z } from 'zod';

import { COMERCIAL_ROTULO_DA_ETAPA, ehSaida, type ComercialEtapa } from './comercial.js';
import { chaveDoNomeDoTrabalho } from './implantacao.js';

/*
 * INICIAR O ONBOARDING ANTES DO NEGÓCIO FECHADO (ajustes da versão final A2, 19/10/2026).
 *
 * O pedido do Rodrigo: "quero que eu possa iniciar um onboarding sem o lead ter
 * chegado em negócio fechado". É a TERCEIRA porta da implantação, ao lado do
 * fechamento (sexta escrita) e de "Registrar cliente já fechado": sempre a partir
 * de um lead do funil, nunca um cartão solto. A regra de quem pode entrar e a
 * etapa de entrada moram aqui porque a tela (o botão) e a API (a rota) leem a
 * mesma regra.
 */

/** A etapa em que o card antecipado entra quando a pessoa não escolhe outra. */
export const ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO = 'Kickoff marcado';

export const OnboardingAntecipadoSchema = z
  .object({ etapa: z.string().trim().min(1).max(120).optional() })
  .strict();
export type OnboardingAntecipadoInput = z.infer<typeof OnboardingAntecipadoSchema>;

/** O rótulo da etapa do funil sem o código ("E6 · Proposta" vira "Proposta"). */
export function rotuloCurtoDaEtapa(etapa: ComercialEtapa): string {
  const r = COMERCIAL_ROTULO_DA_ETAPA[etapa] ?? etapa;
  const i = r.indexOf(' · ');
  return i >= 0 ? r.slice(i + 3) : r;
}

/**
 * Por que este lead NÃO pode iniciar o onboarding agora, ou nulo se pode. Vale
 * em qualquer etapa antes de "Negócio fechado" e fora das quatro saídas
 * (desqualificado, geladeira, perdido e enviado a parceiro: `ehSaida`).
 */
export function motivoParaNaoIniciarOnboarding(s: { etapa: ComercialEtapa; clienteAtivo: boolean }): string | null {
  if (s.etapa === 'fechado' || s.clienteAtivo) return 'Este lead já fechou: o card da implantação nasce do fechamento.';
  if (ehSaida(s.etapa)) return `Este lead saiu do funil (${rotuloCurtoDaEtapa(s.etapa)}): o onboarding começa só com lead em andamento.`;
  return null;
}

/** Uma etapa da lista "Onboarding de cliente", na ordem. */
export interface EtapaDaListaDeOnboarding {
  name: string;
  type: string;
}

/**
 * A etapa de entrada escolhida, conferida contra as etapas da lista (pelo nome,
 * sem diferença de maiúscula nem de espaço). A primeira etapa ("Fechado no
 * comercial") é do fechamento, e a etapa de encerramento não recebe card novo.
 */
export function conferirEtapaDeEntrada(
  etapas: readonly EtapaDaListaDeOnboarding[],
  pedida: string | undefined,
): { ok: true; etapa: string } | { ok: false; motivo: string } {
  const nome = (pedida ?? ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO).trim();
  const i = etapas.findIndex((e) => chaveDoNomeDoTrabalho(e.name) === chaveDoNomeDoTrabalho(nome));
  if (i < 0) return { ok: false, motivo: `A etapa "${nome}" não existe na lista de onboarding. Escolha uma das etapas da lista.` };
  if (i === 0) return { ok: false, motivo: `"${etapas[0].name}" é a etapa do fechamento: o lead ainda não fechou. Escolha outra etapa de entrada.` };
  if (etapas[i].type === 'closed') return { ok: false, motivo: `"${etapas[i].name}" encerra o card: o onboarding não começa encerrado.` };
  return { ok: true, etapa: etapas[i].name };
}

/** As etapas que a tela oferece como entrada: todas menos a primeira e a de encerramento. */
export function etapasDeEntrada(etapas: readonly EtapaDaListaDeOnboarding[]): string[] {
  return etapas.filter((e, i) => i > 0 && e.type !== 'closed').map((e) => e.name);
}

/** O que a rota devolve. */
export interface OnboardingAntecipadoResposta {
  leadId: string;
  /** `criado` na primeira vez; `reaproveitado` quando o card do lead já existia. */
  estado: 'criado' | 'reaproveitado';
  cardId: string;
  listId: string;
  etapa: string;
  trilhoId: string | null;
  partnerId: string | null;
  /** Como o cliente (`Partner`) foi achado: o da ficha, pelo CNPJ, telefone ou e-mail, nome, ou criado. */
  cliente: 'ficha' | 'cnpj' | 'contato' | 'nome' | 'criado';
  selo: string;
}

/** Um lead elegível na busca da Implantação. */
export interface LeadElegivelAoOnboarding {
  leadId: string;
  nome: string;
  empresa: string | null;
  etapa: ComercialEtapa;
  rotuloDaEtapa: string;
}

/** As etapas de entrada que a tela oferece, com a padrão primeiro marcada. */
export interface EtapasDoOnboardingAntecipado {
  etapas: string[];
  padrao: string;
}
