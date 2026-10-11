import type { Metadata, Viewport } from 'next';
import { Fraunces, Montserrat, Oswald } from 'next/font/google';

import { Quiosque } from '@/components/totem/quiosque/Quiosque';

/*
 * O quiosque mora em `/totem/quiosque`, e não em `/totem`, porque o service
 * worker de escopo `/totem/` não controla a URL `/totem` (sem a barra). Fora
 * deste escopo não haveria abertura sem internet. `/totem` redireciona para cá.
 */

const fraunces = Fraunces({ subsets: ['latin'], variable: '--fonte-fraunces', display: 'swap' });
const oswald = Oswald({ subsets: ['latin'], variable: '--fonte-oswald', display: 'swap' });
const montserrat = Montserrat({ subsets: ['latin'], variable: '--fonte-montserrat', display: 'swap' });

export const metadata: Metadata = {
  title: 'Totem de consulta',
  robots: { index: false, follow: false },
  manifest: '/totem/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#28371D',
};

export default function PaginaDoQuiosque() {
  return <Quiosque classeDasFontes={`${fraunces.variable} ${oswald.variable} ${montserrat.variable}`} />;
}
