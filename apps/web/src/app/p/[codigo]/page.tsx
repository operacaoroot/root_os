import type { Metadata } from 'next';
import { TotemCodigoEtiquetaSchema } from '@mktos/shared';
import { EtiquetaNaoEncontrada, FichaDaEtiqueta } from './FichaDaEtiqueta';

export const metadata: Metadata = {
  title: 'Ficha do produto',
  robots: { index: false, follow: false },
};

function decodificado(texto: string): string {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto;
  }
}

// Código fora do formato nem chega à API: a página responde direto que a etiqueta não existe.
export default async function PaginaDaEtiqueta({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const lido = TotemCodigoEtiquetaSchema.safeParse(decodificado(codigo));
  if (!lido.success) return <EtiquetaNaoEncontrada />;
  return <FichaDaEtiqueta codigo={lido.data} />;
}
