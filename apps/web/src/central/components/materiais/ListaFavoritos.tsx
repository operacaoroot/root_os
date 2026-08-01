"use client";

import Link from "next/link";
import type { Material } from "@/central/types";
import { useFavoritos } from "@/central/hooks/useFavoritos";
import { useVistosRecentemente } from "@/central/hooks/useVistosRecentemente";
import { storageDisponivel } from "@/central/lib/storage";
import { GridMateriais } from "./GridMateriais";
import { rotas } from "@/central/lib/rotas";

/** Favoritos + vistos recentemente — tudo local, nada de conta. */
export function ListaFavoritos({ materiais }: { materiais: Material[] }) {
  const { favoritos, carregado } = useFavoritos();
  const { vistos, carregado: vistosCarregados } = useVistosRecentemente();

  if (!carregado || !vistosCarregados) {
    return <p className="py-10 text-center font-central-mono text-sm text-central-tinta-fraca">Carregando…</p>;
  }

  if (!storageDisponivel()) {
    return (
      <div className="border border-central-linha bg-central-painel p-6 text-center">
        <p className="font-central-mono text-sm font-bold uppercase text-central-tinta">
          Seu navegador bloqueou o armazenamento local.
        </p>
        <p className="mt-2 text-sm text-central-tinta-suave">
          Favoritos e histórico ficam salvos no navegador — sem conta, sem nuvem. Libere o
          armazenamento pra este site (modo anônimo costuma bloquear) e volte aqui.
        </p>
      </div>
    );
  }

  const porId = new Map(materiais.map((m) => [m.id, m]));
  const salvos = favoritos.map((id) => porId.get(id)).filter((m): m is Material => Boolean(m));
  const recentes = vistos
    .map((id) => porId.get(id))
    .filter((m): m is Material => Boolean(m) && !favoritos.includes(m!.id))
    .slice(0, 8);

  return (
    <div className="space-y-12">
      <section>
        <h2 className="mb-5 font-central-mono text-lg font-bold uppercase text-central-tinta">
          Salvos <span className="text-central-magenta">({salvos.length})</span>
        </h2>
        {salvos.length > 0 ? (
          <GridMateriais materiais={salvos} />
        ) : (
          <div className="border border-central-linha bg-central-painel p-6 text-center">
            <p className="font-central-mono text-sm font-bold uppercase text-central-tinta">
              Nada salvo ainda.
            </p>
            <p className="mt-2 text-sm text-central-tinta-suave">
              O marcador em cada card guarda o material aqui — no seu navegador, sem cadastro.
            </p>
            <Link
              href={rotas.materiais}
              className="mt-4 inline-block bg-central-lima px-5 py-2.5 font-central-mono text-sm font-bold uppercase tracking-wide text-black no-underline"
            >
              Explorar os materiais
            </Link>
          </div>
        )}
      </section>

      {recentes.length > 0 && (
        <section>
          <h2 className="mb-5 font-central-mono text-lg font-bold uppercase text-central-tinta">
            Vistos recentemente
          </h2>
          <GridMateriais materiais={recentes} />
        </section>
      )}
    </div>
  );
}
