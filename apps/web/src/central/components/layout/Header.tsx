"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bookmark, Menu, Moon, Sun, X } from "lucide-react";
import { LogoRootLink } from "@/central/components/marca/LogoRoot";
import { useTema } from "@/central/hooks/useTema";
import { useFavoritos } from "@/central/hooks/useFavoritos";
import { rotas } from "@/central/lib/rotas";

const LINKS = [
  { href: rotas.inicio, rotulo: "Início" },
  { href: rotas.materiais, rotulo: "Materiais" },
  { href: rotas.trilhas, rotulo: "Trilhas" },
  { href: rotas.favoritos, rotulo: "Favoritos" },
  { href: rotas.sobre, rotulo: "Sobre" },
] as const;

export function Header() {
  const caminho = usePathname();
  const { alternar: alternarTema } = useTema();
  const { favoritos, carregado } = useFavoritos();
  const [menuAberto, setMenuAberto] = useState(false);

  // "Início" é a raiz da Central: casa exato, senão todo caminho começaria por ele.
  const ativo = (href: string) =>
    href === rotas.inicio ? caminho === rotas.inicio : caminho.startsWith(href);

  return (
    <header className="sticky top-0 z-50 border-b border-central-linha bg-central-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
        <LogoRootLink />

        <nav aria-label="Navegação principal" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={ativo(l.href) ? "page" : undefined}
              className={`px-3 py-2 font-central-mono text-xs font-semibold uppercase tracking-wider transition-colors ${
                ativo(l.href) ? "text-central-acento" : "text-central-tinta-suave hover:text-central-tinta"
              }`}
            >
              {l.rotulo}
              {l.href === rotas.favoritos && carregado && favoritos.length > 0 && (
                <span className="ml-1 text-central-magenta">({favoritos.length})</span>
              )}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={alternarTema}
            aria-label="Alternar entre tema claro e escuro"
            className="cursor-pointer p-2 text-central-tinta-suave transition-colors hover:text-central-tinta"
          >
            <Sun aria-hidden className="hidden size-4 [html[data-theme=light]_&]:block" />
            <Moon aria-hidden className="block size-4 [html[data-theme=light]_&]:hidden" />
          </button>

          <Dialog.Root open={menuAberto} onOpenChange={setMenuAberto}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                aria-label="Abrir menu"
                className="cursor-pointer p-2 text-central-tinta-suave transition-colors hover:text-central-tinta md:hidden"
              >
                <Menu aria-hidden className="size-5" />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
              <Dialog.Content
                className="fixed inset-y-0 right-0 z-50 w-72 border-l border-central-linha bg-central-painel p-6"
                aria-describedby={undefined}
              >
                <div className="mb-8 flex items-center justify-between">
                  <Dialog.Title className="font-central-mono text-xs font-bold uppercase tracking-[0.3em] text-central-tinta-suave">
                    Menu
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Fechar menu"
                      className="cursor-pointer p-2 text-central-tinta-suave hover:text-central-tinta"
                    >
                      <X aria-hidden className="size-5" />
                    </button>
                  </Dialog.Close>
                </div>
                <nav aria-label="Navegação móvel" className="flex flex-col gap-1">
                  {LINKS.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMenuAberto(false)}
                      aria-current={ativo(l.href) ? "page" : undefined}
                      className={`flex items-center justify-between px-3 py-3 font-central-mono text-sm font-semibold uppercase tracking-wider ${
                        ativo(l.href) ? "bg-central-acento-soft text-central-acento" : "text-central-tinta hover:bg-central-painel2"
                      }`}
                    >
                      {l.rotulo}
                      {l.href === rotas.favoritos && carregado && favoritos.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-central-magenta">
                          <Bookmark aria-hidden className="size-3.5" />
                          {favoritos.length}
                        </span>
                      )}
                    </Link>
                  ))}
                </nav>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
