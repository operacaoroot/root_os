import './globals.css';
import type { Metadata } from 'next';
import { Fraunces, JetBrains_Mono, Montserrat, Oswald, Space_Grotesk } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { EH_SRAGRANEL, SELO_SRAGRANEL } from '@/lib/marca';

/*
 * As duas fontes da marca ROOT, auto-hospedadas no build (o browser do
 * visitante nunca chama o CDN do Google). Ficam na raiz porque o painel
 * também as usa agora — antes só o layout da Central as carregava, e o
 * --os-mono do painel caía no monospace do sistema.
 */
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

/*
 * As três fontes do design system do Sr. aGranel, com os mesmos nomes de
 * variável do quiosque. As opções do next/font precisam ser literais, então não
 * dá para carregá-las só na instância dele: o preload desligado garante que a
 * instância ROOT nunca baixa os arquivos, porque nenhum CSS dela usa a fonte.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--fonte-fraunces',
  display: 'swap',
  preload: false,
});

const oswald = Oswald({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--fonte-oswald',
  display: 'swap',
  preload: false,
});

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--fonte-montserrat',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = EH_SRAGRANEL
  ? {
      title: 'Senhor aGranel',
      description: 'Painel das lojas do Sr. a Granel.',
      icons: { icon: SELO_SRAGRANEL, apple: SELO_SRAGRANEL },
      robots: { index: false, follow: false },
    }
  : {
      title: 'ROOT OS',
      description: 'A central de contexto da operação — painel único, ferramentas e conexões.',
    };

/*
 * Aplica o tema do painel ANTES da primeira pintura. Sem isto, quem escolheu
 * "papel" ou "mono" leva um flash do escuro a cada navegação: a Sidebar só
 * escreve o atributo depois de hidratar e autenticar. Mesmo padrão que a
 * Central já usava (app/central/layout.tsx).
 * Escrever no <html> é seguro em qualquer rota: /central usa data-theme e o
 * namespace --central-*, e /b usa cores próprias — nenhuma das duas lê --os-*.
 * A instância do Sr. aGranel tem um tema só, fixo no <html>, e não lê o que
 * ficou guardado no navegador.
 */
const scriptTema = `(function(){try{var t=localStorage.getItem("root-os:tema");if(t==="dark"||t==="light"||t==="mono"){document.documentElement.setAttribute("data-os-theme",t)}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  if (EH_SRAGRANEL) {
    return (
      <html
        lang="pt-BR"
        data-os-theme="sragranel"
        className={`${fraunces.variable} ${oswald.variable} ${montserrat.variable}`}
      >
        <body>
          <AuthProvider>
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </body>
      </html>
    );
  }

  return (
    <html lang="pt-BR" className={`${jetbrains.variable} ${spaceGrotesk.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: scriptTema }} />
      </head>
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
