import './globals.css';
import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Marketing OS',
  description: 'Sistema Operacional de Marketing — painel único + Hub/MCP.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
