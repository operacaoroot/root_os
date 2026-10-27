import './globals.css';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
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

// Layout do Estúdio (27/10/2026): o texto do painel é Inter, como no Root Estúdio V1.
// Space Grotesk segue carregada para a Central e a bio, que usam --font-space.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
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
// Layout do Estúdio (27/10/2026): o padrão é "estudio" para todos (chave nova, então a
// escolha antiga de escuro não vale mais); só quem escolher "escuro" de novo fica nele.
const scriptTema = `(function(){var t="estudio";try{if(localStorage.getItem("root-os:tema-estudio")==="dark"){t="dark"}}catch(e){}document.documentElement.setAttribute("data-os-theme",t)})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // O script de tema escreve data-os-theme no <html> antes da hidratação.
    <html lang="pt-BR" suppressHydrationWarning className={`${inter.variable} ${jetbrains.variable} ${spaceGrotesk.variable}`}>
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
