"use client";

import { ArrowUpRight } from "lucide-react";
import { trackEvent } from "@/central/lib/analytics";

function dominioDe(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/**
 * Link externo com o destino sempre visível — o domínio aparece por extenso
 * e a seta indica que abre fora da central. rel de segurança sempre.
 */
export function LinkExterno({ label, selo, href }: { label: string; selo?: string; href: string }) {
  const dominio = dominioDe(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackEvent("link_externo_aberto", { dominio })}
      className="group mb-5 flex flex-col justify-between gap-1.5 border border-central-linha bg-central-painel2 px-4 py-3.5 no-underline transition-colors hover:border-central-acento sm:flex-row sm:items-center sm:gap-3"
    >
      <span className="font-medium text-central-tinta">
        {label}
        {selo && (
          <span className="ml-2 bg-central-acento-soft px-1.5 py-0.5 font-central-mono text-[0.62rem] font-semibold uppercase tracking-wider text-central-acento">
            {selo}
          </span>
        )}
      </span>
      <span className="inline-flex items-center gap-1 break-all font-central-mono text-sm text-central-acento group-hover:underline">
        {dominio}
        <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
        <span className="sr-only">(abre em nova aba)</span>
      </span>
    </a>
  );
}
