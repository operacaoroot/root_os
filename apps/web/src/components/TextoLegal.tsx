import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';

const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '700', '800'], variable: '--fonte-mono' });
const corpo = Space_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--fonte-corpo' });

/**
 * Moldura dos textos legais (termos e privacidade). São públicos por obrigação:
 * a Meta e o TikTok exigem URLs acessíveis sem login no App Review dos apps que
 * a bio usa para contar publicações.
 */
export function TextoLegal({
  titulo,
  atualizadoEm,
  children,
}: {
  titulo: string;
  atualizadoEm: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${mono.variable} ${corpo.variable} min-h-screen bg-bio-bg text-bio-text`}
      style={{ fontFamily: 'var(--fonte-corpo), system-ui, sans-serif' }}
    >
      <main className="mx-auto max-w-[640px] px-6 pb-[12vh] pt-[10vh]">
        <p
          className="m-0 mb-4 text-[10.5px] tracking-[0.16em] text-bio-primary"
          style={{ fontFamily: 'var(--fonte-mono), monospace' }}
        >
          OPERAÇÃO ROOT
        </p>
        <h1
          className="m-0 mb-[10px] text-[30px] font-extrabold tracking-[-0.02em]"
          style={{ fontFamily: 'var(--fonte-mono), monospace' }}
        >
          {titulo}
        </h1>
        <p className="m-0 mb-9 text-[13px] text-bio-weak">Atualizado em {atualizadoEm}</p>

        <div className="bio-prose text-[15px] leading-[1.75]">{children}</div>

        <p
          className="mt-12 text-center text-[11px] tracking-[0.14em] text-bio-weak"
          style={{ fontFamily: 'var(--fonte-mono), monospace' }}
        >
          root/bio
        </p>
      </main>
    </div>
  );
}
