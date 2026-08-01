"use client";

import { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { trackEvent } from "@/central/lib/analytics";

function BotaoCopiar({
  conteudo,
  evento,
  rotulo,
}: {
  conteudo: string;
  evento: "prompt_copiado" | "comando_copiado";
  rotulo: string;
}) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(conteudo);
      setCopiado(true);
      trackEvent(evento, { rotulo });
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard bloqueado: seleciona o texto manualmente
    }
  }
  return (
    <button
      type="button"
      onClick={copiar}
      className="inline-flex cursor-pointer items-center gap-1.5 bg-central-lima px-3 py-1.5 font-central-mono text-xs font-bold uppercase tracking-wide text-black transition-opacity hover:opacity-90"
      aria-label={copiado ? "Copiado" : `Copiar ${rotulo}`}
    >
      {copiado ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      {copiado ? "Copiado" : "Copiar"}
    </button>
  );
}

/** Prompt pronto pra copiar — preserva quebras de linha, feedback anunciado. */
export function PromptCopiavel({ rotulo, conteudo }: { rotulo: string; conteudo: string }) {
  return (
    <div className="caixa-terminal mb-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-central-linha px-4 py-2.5">
        <span className="font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-central-acento">
          &gt;_ {rotulo}
        </span>
        <BotaoCopiar conteudo={conteudo} evento="prompt_copiado" rotulo={rotulo} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 font-central-mono text-sm leading-relaxed">
        {conteudo}
      </pre>
      <span aria-live="polite" className="sr-only" />
    </div>
  );
}

/** Comando de terminal — com aviso de segurança quando o comando altera coisas. */
export function ComandoCopiavel({
  linguagem,
  conteudo,
  aviso,
}: {
  linguagem: string;
  conteudo: string;
  aviso?: string;
}) {
  return (
    <div className="caixa-terminal mb-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-central-linha px-4 py-2">
        <span className="font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-central-tinta-suave">
          $ {linguagem}
        </span>
        <BotaoCopiar conteudo={conteudo} evento="comando_copiado" rotulo={conteudo.slice(0, 30)} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-central-mono text-sm leading-relaxed">{conteudo}</pre>
      {aviso && (
        <p className="flex items-start gap-2 border-t border-central-linha px-4 py-2 text-xs text-central-alerta">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {aviso}
        </p>
      )}
    </div>
  );
}
