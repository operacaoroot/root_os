"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ListFilter, Search, X } from "lucide-react";
import type { Custo, Material, Nivel, TipoMaterial } from "@/central/types";
import { buscar, sugestoes as gerarSugestoes } from "@/central/lib/busca";
import {
  aplicarFiltros,
  contarAtivos,
  filtrosParaQuery,
  filtrosVazios,
  ordenar,
  queryParaFiltros,
  type Filtros,
  type Ordenacao,
} from "@/central/lib/filtros";
import { rotuloCusto, rotuloNivel, rotuloTipo } from "@/central/lib/cta";
import { trackEvent } from "@/central/lib/analytics";
import { GridMateriais } from "./GridMateriais";
import type { Categoria } from "@/central/types";
import { rotas } from "@/central/lib/rotas";

const OPCOES_ORDEM: { valor: Ordenacao; rotulo: string }[] = [
  { valor: "recentes", rotulo: "Mais recentes" },
  { valor: "verificados", rotulo: "Verificados há menos tempo" },
  { valor: "alfabetica", rotulo: "A–Z" },
  { valor: "menor-duracao", rotulo: "Menor duração" },
  { valor: "destaques", rotulo: "Destaques primeiro" },
];

const TIPOS_FILTRO: TipoMaterial[] = [
  "tutorial",
  "prompt",
  "repositorio",
  "curso",
  "template",
  "automacao",
  "skill",
  "mcp",
  "ferramenta",
  "checklist",
  "estudo-de-caso",
];
const NIVEIS_FILTRO: Nivel[] = ["iniciante", "intermediario", "avancado"];
const CUSTOS_FILTRO: Custo[] = ["gratuito", "freemium", "pago"];

function GrupoFiltro<T extends string>({
  titulo,
  opcoes,
  rotulos,
  ativos,
  onAlternar,
}: {
  titulo: string;
  opcoes: T[];
  rotulos: Record<T, string>;
  ativos: T[];
  onAlternar: (v: T) => void;
}) {
  return (
    <fieldset className="mb-5">
      <legend className="mb-2 font-central-mono text-[0.68rem] font-bold uppercase tracking-[0.2em] text-central-tinta-fraca">
        {titulo}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {opcoes.map((op) => {
          const ativo = ativos.includes(op);
          return (
            <button
              key={op}
              type="button"
              onClick={() => onAlternar(op)}
              aria-pressed={ativo}
              className={`cursor-pointer border px-2.5 py-1 font-central-mono text-xs font-semibold transition-colors ${
                ativo
                  ? "border-central-acento bg-central-acento-soft text-central-acento"
                  : "border-central-linha text-central-tinta-suave hover:border-central-tinta-fraca"
              }`}
            >
              {rotulos[op]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function PainelFiltros({
  filtros,
  categorias,
  onMudar,
}: {
  filtros: Filtros;
  categorias: Categoria[];
  onMudar: (f: Filtros) => void;
}) {
  const alternarLista = <T extends string>(lista: T[], valor: T): T[] =>
    lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor];

  return (
    <div>
      <fieldset className="mb-5">
        <legend className="mb-2 font-central-mono text-[0.68rem] font-bold uppercase tracking-[0.2em] text-central-tinta-fraca">
          Categoria
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {categorias.map((c) => {
            const ativo = filtros.categoria === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={ativo}
                onClick={() => onMudar({ ...filtros, categoria: ativo ? null : c.id })}
                className={`cursor-pointer border px-2.5 py-1 font-central-mono text-xs font-semibold transition-colors ${
                  ativo
                    ? "border-central-acento bg-central-acento-soft text-central-acento"
                    : "border-central-linha text-central-tinta-suave hover:border-central-tinta-fraca"
                }`}
              >
                {c.nome}
              </button>
            );
          })}
        </div>
      </fieldset>
      <GrupoFiltro
        titulo="Tipo"
        opcoes={TIPOS_FILTRO}
        rotulos={rotuloTipo}
        ativos={filtros.tipos}
        onAlternar={(v) => onMudar({ ...filtros, tipos: alternarLista(filtros.tipos, v) })}
      />
      <GrupoFiltro
        titulo="Nível"
        opcoes={NIVEIS_FILTRO}
        rotulos={rotuloNivel}
        ativos={filtros.niveis}
        onAlternar={(v) => onMudar({ ...filtros, niveis: alternarLista(filtros.niveis, v) })}
      />
      <GrupoFiltro
        titulo="Custo"
        opcoes={CUSTOS_FILTRO}
        rotulos={rotuloCusto}
        ativos={filtros.custos}
        onAlternar={(v) => onMudar({ ...filtros, custos: alternarLista(filtros.custos, v) })}
      />
    </div>
  );
}

export function Biblioteca({
  materiais,
  categorias,
}: {
  materiais: Material[];
  categorias: Categoria[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [filtros, setFiltros] = useState<Filtros>(() =>
    queryParaFiltros(new URLSearchParams(params.toString())),
  );
  const [campo, setCampo] = useState(filtros.busca);
  const [drawerAberto, setDrawerAberto] = useState(false);
  const semResultadoReportado = useRef<string | null>(null);

  // filtros ⇄ URL: toda mudança vira query compartilhável
  function mudar(novos: Filtros) {
    setFiltros(novos);
    const q = filtrosParaQuery(novos).toString();
    router.replace(q ? `${rotas.materiais}?${q}` : rotas.materiais, { scroll: false });
    if (contarAtivos(novos) > 0) trackEvent("filtro_aplicado", { ativos: contarAtivos(novos) });
  }

  function buscarAgora(e?: React.FormEvent) {
    e?.preventDefault();
    trackEvent("busca_feita", { origem: "biblioteca" });
    mudar({ ...filtros, busca: campo.trim() });
  }

  const resultado = useMemo(() => {
    const base = filtros.busca ? buscar(filtros.busca, materiais) : null;
    const aposBusca = base ? base.materiais : materiais;
    const filtrados = aplicarFiltros(aposBusca, filtros);
    return { camada: base?.camada ?? null, materiais: ordenar(filtrados, filtros.ordenacao) };
  }, [filtros, materiais]);

  // resgate: código exato com resultado único abre o material direto
  useEffect(() => {
    if (resultado.camada === "codigo" && resultado.materiais.length === 1) {
      const alvo = resultado.materiais[0];
      if (alvo) router.push(`${rotas.material(alvo.slug)}?via=resgate`);
    }
  }, [resultado, router]);

  // telemetria de busca sem resultado (uma vez por termo)
  useEffect(() => {
    if (filtros.busca && resultado.materiais.length === 0) {
      if (semResultadoReportado.current !== filtros.busca) {
        semResultadoReportado.current = filtros.busca;
        trackEvent("sem_resultado", { tamanho: filtros.busca.length });
      }
    }
  }, [filtros.busca, resultado.materiais.length]);

  const ativos = contarAtivos(filtros);
  const dicas = filtros.busca ? gerarSugestoes(filtros.busca, materiais) : [];

  return (
    <div>
      {/* busca + ordenação + filtros */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <form onSubmit={buscarAgora} role="search" className="flex min-w-0 flex-1 gap-2">
          <label htmlFor="busca-biblioteca" className="sr-only">
            Buscar por código, ferramenta ou problema
          </label>
          <input
            id="busca-biblioteca"
            type="search"
            value={campo}
            onChange={(e) => setCampo(e.target.value)}
            placeholder="Código do reel, ferramenta ou problema…"
            className="min-w-0 flex-1 border border-central-linha bg-central-painel px-4 py-2.5 text-sm text-central-tinta outline-none transition-colors placeholder:text-central-tinta-fraca focus:border-central-acento"
          />
          <button
            type="submit"
            aria-label="Buscar"
            className="cursor-pointer bg-central-lima px-4 py-2.5 text-black transition-opacity hover:opacity-90"
          >
            <Search aria-hidden className="size-4" />
          </button>
        </form>

        <div className="flex items-center gap-2">
          <label htmlFor="ordenacao" className="sr-only">
            Ordenar por
          </label>
          <select
            id="ordenacao"
            value={filtros.ordenacao}
            onChange={(e) => mudar({ ...filtros, ordenacao: e.target.value as Ordenacao })}
            className="cursor-pointer border border-central-linha bg-central-painel px-3 py-2.5 font-central-mono text-xs text-central-tinta-suave outline-none focus:border-central-acento"
          >
            {OPCOES_ORDEM.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>

          {/* drawer de filtros (mobile e desktop — mantém a tela limpa) */}
          <Dialog.Root open={drawerAberto} onOpenChange={setDrawerAberto}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-2 border border-central-linha px-3 py-2.5 font-central-mono text-xs font-semibold uppercase tracking-wider text-central-tinta-suave transition-colors hover:border-central-acento hover:text-central-acento"
              >
                <ListFilter aria-hidden className="size-4" />
                Filtros
                {ativos > 0 && <span className="text-central-magenta">({ativos})</span>}
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
              <Dialog.Content
                className="fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-y-auto border-l border-central-linha bg-central-painel p-6"
                aria-describedby={undefined}
              >
                <div className="mb-6 flex items-center justify-between">
                  <Dialog.Title className="font-central-mono text-sm font-bold uppercase tracking-[0.2em] text-central-tinta">
                    Filtros {ativos > 0 && <span className="text-central-magenta">({ativos})</span>}
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Fechar filtros"
                      className="cursor-pointer p-2 text-central-tinta-suave hover:text-central-tinta"
                    >
                      <X aria-hidden className="size-5" />
                    </button>
                  </Dialog.Close>
                </div>
                <PainelFiltros filtros={filtros} categorias={categorias} onMudar={mudar} />
                <div className="mt-6 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDrawerAberto(false)}
                    className="flex-1 cursor-pointer bg-central-lima px-4 py-2.5 font-central-mono text-sm font-bold uppercase tracking-wide text-black"
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => mudar({ ...filtrosVazios, busca: filtros.busca })}
                    className="cursor-pointer border border-central-linha px-4 py-2.5 font-central-mono text-sm font-semibold uppercase tracking-wide text-central-tinta-suave hover:border-central-magenta hover:text-central-magenta"
                  >
                    Limpar
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>

      {/* status — anunciado a leitores de tela */}
      <p aria-live="polite" className="mb-6 text-sm text-central-tinta-suave">
        {filtros.busca ? (
          resultado.materiais.length > 0 ? (
            <>
              <span className="font-central-mono font-bold text-central-acento">{resultado.materiais.length}</span>{" "}
              {resultado.materiais.length === 1 ? "material" : "materiais"} pra{" "}
              <span className="font-semibold text-central-tinta">“{filtros.busca}”</span>{" "}
              <button
                type="button"
                onClick={() => {
                  setCampo("");
                  mudar({ ...filtros, busca: "" });
                }}
                className="cursor-pointer font-central-mono text-xs font-semibold uppercase text-central-acento hover:underline"
              >
                limpar
              </button>
            </>
          ) : null
        ) : (
          <>
            <span className="font-central-mono font-bold text-central-acento">{resultado.materiais.length}</span>{" "}
            materiais no catálogo
            {ativos > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => mudar({ ...filtrosVazios, busca: filtros.busca })}
                  className="cursor-pointer font-central-mono text-xs font-semibold uppercase text-central-magenta hover:underline"
                >
                  limpar {ativos} {ativos === 1 ? "filtro" : "filtros"}
                </button>
              </>
            )}
          </>
        )}
      </p>

      {/* estado vazio: orienta e nunca é beco sem saída */}
      {filtros.busca && resultado.materiais.length === 0 && (
        <div className="mb-10 border border-central-linha bg-central-painel p-6 text-center">
          <p className="font-central-mono text-sm font-bold uppercase tracking-wide text-central-tinta">
            Acesso negado pra “{filtros.busca}” — nada com esse termo.
          </p>
          <p className="mt-2 text-sm text-central-tinta-suave">
            Confere se o código do reel está certo{dicas.length > 0 && (
              <>
                {" "}
                — ou tenta{" "}
                {dicas.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setCampo(s);
                      mudar({ ...filtros, busca: s });
                    }}
                    className="cursor-pointer font-central-mono font-semibold text-central-acento hover:underline"
                  >
                    {s}
                    {i < dicas.length - 1 ? ", " : ""}
                  </button>
                ))}
              </>
            )}
            . O catálogo completo segue aí embaixo. 👇
          </p>
          <button
            type="button"
            onClick={() => {
              setCampo("");
              mudar({ ...filtros, busca: "" });
            }}
            className="mt-4 cursor-pointer bg-central-lima px-5 py-2.5 font-central-mono text-sm font-bold uppercase tracking-wide text-black"
          >
            Ver tudo
          </button>
        </div>
      )}

      <GridMateriais
        materiais={
          filtros.busca && resultado.materiais.length === 0
            ? ordenar(aplicarFiltros(materiais, { ...filtros, busca: "" }), filtros.ordenacao)
            : resultado.materiais
        }
      />
    </div>
  );
}
