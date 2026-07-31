import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';

// Auto-hospedadas no build: o browser do visitante nunca chama o CDN do Google.
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '700', '800'], variable: '--fonte-mono' });
const corpo = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--fonte-corpo' });

export default function BioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${mono.variable} ${corpo.variable} min-h-screen bg-bio-bg text-bio-text`}
      style={{ fontFamily: 'var(--fonte-corpo), system-ui, sans-serif' }}
    >
      {children}
    </div>
  );
}
