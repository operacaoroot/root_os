import { agentesDaSemente } from './complementos';
import { paraRoster, type AgenteDoRoster } from './roster';

/* ==========================================================================
 * O ROSTER DO ONBOARDING — os agentes que a ROOT usa para entregar
 * ==========================================================================
 *
 * Três agentes, todos da empresa que ENTREGA (a ROOT, tenant 001), semeados
 * na primeira vez que a bancada de onboarding é aberta — idempotente, como o
 * roster de entrada. Leem o que o sócio cola, escrevem proposta, dossiê e
 * roteiro. R1.
 *
 * DESDE A RODADA DOS AGENTES (21/10/2026, A1) os três saem do CADASTRO ÚNICO
 * (`funcoesDaSemente('onboarding')`: IM-01, IM-02, IM-03): slug, nome, missão,
 * tipo e capacidades são os de lá (o leitor de ata declara `drive.arquivo.enviar`,
 * R3, para mandar a ata gerada a `03-kickoff` do cliente pela porta). O
 * PROCEDIMENTO, as iniciais e o pilar moram em `complementos.ts`.
 *
 * O que cada um faz está em `onboarding/trilho/` (o prompt e o parser são
 * puros). Ver `docs/ONBOARDING.md`.
 */

export const SLUG_DO_LEITOR_DE_ATA = 'leitor-de-ata';
export const SLUG_DO_PESQUISADOR_DE_CONTA = 'pesquisador-de-conta';
export const SLUG_DO_ROTEIRISTA = 'roteirista-de-kickoff';

export const ROSTER_DO_ONBOARDING: readonly AgenteDoRoster[] = agentesDaSemente('onboarding').map(paraRoster);

// Os três slugs nomeados acima são os do cadastro: se o cadastro mudar um deles,
// o arranque acusa aqui em vez de a bancada procurar um agente que não existe.
for (const slug of [SLUG_DO_LEITOR_DE_ATA, SLUG_DO_PESQUISADOR_DE_CONTA, SLUG_DO_ROTEIRISTA]) {
  if (!ROSTER_DO_ONBOARDING.some((a) => a.slug === slug)) {
    throw new Error(`o cadastro único não semeia "${slug}" no onboarding (funcoesDaSemente('onboarding'))`);
  }
}
