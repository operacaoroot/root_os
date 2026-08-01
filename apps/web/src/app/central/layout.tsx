import type { Metadata } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { Header } from '@/central/components/layout/Header';
import { Footer } from '@/central/components/layout/Footer';
import { SkipLink } from '@/central/components/layout/SkipLink';

// Auto-hospedadas no build: o browser do visitante nunca chama o CDN do Google.
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space',
  display: 'swap',
});

const URL_BASE = process.env.NEXT_PUBLIC_URL_BASE ?? 'https://os.operacaoroot.com';

export const metadata: Metadata = {
  metadataBase: new URL(URL_BASE),
  title: {
    default: 'Root Central — materiais, ferramentas e tutoriais da comunidade Root',
    template: '%s · Root Central',
  },
  description:
    'Todo material da Operação Root num lugar só: tutoriais, prompts, automações e trilhas de IA aplicada. Busca o código do reel e opera.',
  openGraph: { type: 'website', locale: 'pt_BR', siteName: 'Root Central' },
  twitter: { card: 'summary_large_image' },
};

/*
 * Aplica o tema salvo ANTES da primeira pintura — sem flash de tema errado.
 * Escreve no <html> porque o seletor do tema claro em globals.css é
 * `:root[data-theme='light'] .central-root`: a raiz decide, o container pinta.
 * Inline no corpo do layout (e não no <head>, que pertence ao layout raiz do
 * painel): script inline executa durante o parse, antes do que vem depois.
 */
const scriptTema = `(function(){try{var e=localStorage.getItem("root-central:tema");if(e){var t=JSON.parse(e).dados;if(t==="light"||t==="system"&&matchMedia("(prefers-color-scheme: light)").matches){document.documentElement.setAttribute("data-theme","light")}}}catch(e){}})()`;

export default function CentralLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: scriptTema }} />
      <div
        className={`central-root ${jetbrains.variable} ${spaceGrotesk.variable} flex min-h-screen flex-col`}
      >
        <SkipLink />
        <Header />
        <div id="conteudo" className="flex-1">
          {children}
        </div>
        <Footer />
      </div>
    </>
  );
}
