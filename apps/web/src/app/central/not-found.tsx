import Link from "next/link";
import { rotas } from "@/central/lib/rotas";

export default function NaoEncontrado() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center px-5 py-24 text-center">
      <p className="glitch-root text-6xl" aria-hidden>
        404
      </p>
      <h1 className="mt-6 font-central-mono text-2xl font-bold uppercase text-central-tinta">
        Acesso negado: rota inexistente.
      </h1>
      <p className="mt-3 max-w-md text-central-tinta-suave">
        Esse endereço não existe (ou o material mudou de lugar). Se você veio de um reel, busca o
        código na biblioteca — ele te leva direto.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href={rotas.materiais}
          className="bg-central-lima px-6 py-3 font-central-mono text-sm font-bold uppercase tracking-wide text-black no-underline"
        >
          Buscar na biblioteca
        </Link>
        <Link
          href={rotas.inicio}
          className="border border-central-linha px-6 py-3 font-central-mono text-sm font-semibold uppercase tracking-wide text-central-tinta no-underline hover:border-central-acento hover:text-central-acento"
        >
          Voltar pro início
        </Link>
      </div>
    </main>
  );
}
