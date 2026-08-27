import Link from 'next/link';
import { Construction, ArrowLeft } from 'lucide-react';
import { NAV } from '@mktos/shared';

export default async function ModulePlaceholder({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const href = '/' + (slug?.[0] ?? '');
  const item = NAV.find((n) => n.href === href);

  return (
    <div className="mx-auto max-w-lg pt-10 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl bg-surface-2 text-warn">
        <Construction size={26} />
      </div>
      <h1 className="text-xl font-semibold">{item?.label ?? 'Módulo'}</h1>
      <p className="mt-2 text-sm text-muted">
        Este módulo entra em funcionamento na{' '}
        <span className="text-text">Fase {item?.phase ?? '—'}</span> do roadmap. A
        navegação, as permissões e o card do dashboard que apontam para cá já estão
        prontos — falta plugar os dados/conector.
      </p>
      <Link
        href="/painel"
        className="mt-6 inline-flex items-center gap-1 rounded-lg border border-border px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-text"
      >
        <ArrowLeft size={15} /> Voltar ao painel
      </Link>
    </div>
  );
}
