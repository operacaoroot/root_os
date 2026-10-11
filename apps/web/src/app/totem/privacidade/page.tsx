import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de privacidade do totem',
  robots: { index: false, follow: false },
};

// Página provisória da base; a frente D a substitui pelo texto da política (docs/totem/CONTRATO.md, seção 7).
export default function PaginaDaPrivacidadeDoTotem() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white px-6 py-12 text-neutral-800">
      <h1 className="text-2xl font-semibold">Política de privacidade do totem</h1>
      <p className="mt-4 text-base">
        O texto da política de privacidade está em revisão. Enquanto isso, o cadastro pelo totem e pelo QR da
        etiqueta fica fechado.
      </p>
    </main>
  );
}
