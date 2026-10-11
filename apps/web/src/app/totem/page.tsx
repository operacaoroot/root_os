import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Totem de consulta',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

// O quiosque fica em /totem/quiosque, dentro do escopo do service worker; ver a página de lá.
export default function PaginaDoTotem() {
  redirect('/totem/quiosque');
}
