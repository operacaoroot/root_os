import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Totem de consulta',
  robots: { index: false, follow: false },
};

// Página provisória da base; a frente B a substitui pelo quiosque (docs/totem/CONTRATO.md, seção 7).
export default function PaginaDoTotem() {
  return (
    <main className="grid min-h-screen place-items-center bg-white p-8 text-center text-neutral-800">
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-semibold">Totem de consulta</h1>
        <p className="text-base">Este totem ainda não foi ativado. Peça ajuda a um atendente da loja.</p>
      </div>
    </main>
  );
}
