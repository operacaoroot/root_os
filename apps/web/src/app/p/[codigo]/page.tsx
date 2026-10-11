import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ficha do produto',
  robots: { index: false, follow: false },
};

// Página provisória da base; a frente C a substitui pela ficha do produto e do lote (docs/totem/CONTRATO.md, seção 7).
export default function PaginaDaEtiqueta() {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-white px-6 py-12 text-neutral-800">
      <h1 className="text-2xl font-semibold">Ficha do produto</h1>
      <p className="mt-4 text-base">A ficha do produto lida pela etiqueta ainda está em construção.</p>
    </main>
  );
}
