import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'root/bio',
  description: 'Link na bio da Operação Root.',
};

/** Raiz do domínio da bio. Quem chega aqui não tem handle — não é erro, só não é lugar. */
export default function BioLanding() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col items-center justify-center px-6 text-center">
      <p
        className="m-0 mb-4 text-[10.5px] tracking-[0.16em] text-bio-primary"
        style={{ fontFamily: 'var(--fonte-mono), monospace' }}
      >
        OPERAÇÃO ROOT
      </p>
      <h1
        className="m-0 mb-3 text-[28px] font-extrabold tracking-[-0.02em]"
        style={{ fontFamily: 'var(--fonte-mono), monospace' }}
      >
        root/bio
      </h1>
      <p className="m-0 text-[15px] leading-[1.6] text-bio-soft">
        Cada página vive no próprio endereço. Se você chegou aqui por um link, ele veio incompleto.
      </p>
      <p className="mt-10 text-[12px] text-bio-weak">
        <a href="/termos" className="text-bio-weak no-underline hover:text-bio-soft">
          termos
        </a>
        {' · '}
        <a href="/privacidade" className="text-bio-weak no-underline hover:text-bio-soft">
          privacidade
        </a>
      </p>
    </main>
  );
}
