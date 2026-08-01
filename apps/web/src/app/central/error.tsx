"use client";

export default function Erro({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center px-5 py-24 text-center">
      <p className="glitch-root text-5xl" aria-hidden>
        ERRO
      </p>
      <h1 className="mt-6 font-central-mono text-2xl font-bold uppercase text-central-tinta">
        Algo quebrou do nosso lado.
      </h1>
      <p className="mt-3 max-w-md text-central-tinta-suave">
        Não foi você. Tenta recarregar — se insistir, volta mais tarde que a gente já está em cima.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 cursor-pointer bg-central-lima px-6 py-3 font-central-mono text-sm font-bold uppercase tracking-wide text-black"
      >
        Tentar de novo
      </button>
    </main>
  );
}
