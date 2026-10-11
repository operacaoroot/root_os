import type { Metadata } from 'next';
import { TotemCodigoEtiquetaSchema } from '@mktos/shared';
import { ConteudoDaPrivacidade } from './ConteudoDaPrivacidade';

export const metadata: Metadata = {
  title: 'Política de privacidade do totem',
  robots: { index: false, follow: false },
  // O `?e=` traz o código da etiqueta; sem referer, ele não sai desta página.
  referrer: 'no-referrer',
};

/**
 * `/totem/privacidade` (frente D). Aberta pelo QR, recebe o código da etiqueta
 * em `?e=`; no quiosque, usa o token guardado no aparelho. Nos dois casos a
 * credencial vai à API em cabeçalho, nunca na URL da chamada.
 */
export default async function PaginaDaPrivacidadeDoTotem({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { e } = await searchParams;
  const etiqueta = TotemCodigoEtiquetaSchema.safeParse(typeof e === 'string' ? e : undefined);
  return (
    <main className="min-h-screen px-6 py-12" style={{ backgroundColor: '#F5F3EC', color: '#28371D' }}>
      <div className="mx-auto max-w-2xl">
        <ConteudoDaPrivacidade etiqueta={etiqueta.success ? etiqueta.data : null} />
      </div>
    </main>
  );
}
