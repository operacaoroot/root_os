import './globals.css';
import type { Metadata } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';

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

export const metadata: Metadata = {
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
 */
const scriptTema = `(function(){try{var t=localStorage.getItem("root-os:tema");if(t==="dark"||t==="light"||t==="mono"){document.documentElement.setAttribute("data-os-theme",t)}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
