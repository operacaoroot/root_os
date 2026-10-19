import { redirect } from 'next/navigation';

/*
 * /onboarding DEIXOU DE SER PORTA (rodada do trabalho T1, 19/10/2026).
 *
 * O item "Implantação de clientes" abre o kanban denso da lista "Onboarding de
 * cliente" (`/trabalho/implantacao`), e o trilho de cada cliente virou a aba
 * "Trilho" do pop-up do cartão. Esta rota redireciona preservando a query; a
 * bancada antiga segue viva em `/onboarding/bancada` e a de um trilho em
 * `/onboarding/<id>`. Apagar é decisão do Pedro.
 */
export default async function OnboardingAntigo({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) p.append(k, x);
  }
  const q = p.toString();
  redirect(`/trabalho/implantacao${q ? `?${q}` : ''}`);
}
