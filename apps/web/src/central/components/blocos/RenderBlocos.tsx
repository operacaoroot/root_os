import type { Bloco } from "@/central/types";
import { CircleAlert, Info, OctagonAlert, StickyNote } from "lucide-react";
import { PromptCopiavel, ComandoCopiavel } from "./Copiavel";
import { LinkExterno } from "./LinkExterno";

/* Renderizador das primitivas de conteúdo — ver docs/content-model.md. */

function Callout({
  variante,
  titulo,
  conteudo,
}: {
  variante: "info" | "nota" | "atencao" | "risco";
  titulo?: string;
  conteudo: string;
}) {
  const estilos = {
    info: { borda: "border-central-acento", fundo: "bg-central-acento-soft", Icone: Info, cor: "text-central-acento" },
    nota: { borda: "border-central-linha", fundo: "bg-central-painel2", Icone: StickyNote, cor: "text-central-tinta-suave" },
    atencao: { borda: "border-central-alerta", fundo: "bg-central-painel2", Icone: CircleAlert, cor: "text-central-alerta" },
    risco: { borda: "border-central-magenta", fundo: "bg-central-magenta-soft", Icone: OctagonAlert, cor: "text-central-magenta" },
  }[variante];
  const { Icone } = estilos;
  return (
    <div className={`mb-5 border-l-4 px-4 py-3.5 ${estilos.borda} ${estilos.fundo}`}>
      {titulo && (
        <p className={`mb-1 flex items-center gap-1.5 font-central-mono text-sm font-bold ${estilos.cor}`}>
          <Icone aria-hidden className="size-4 shrink-0" />
          {titulo}
        </p>
      )}
      <p className="text-sm leading-relaxed text-central-tinta-suave">{conteudo}</p>
    </div>
  );
}

function PassoHeader({ n, titulo, sub }: { n: number; titulo: string; sub?: string }) {
  return (
    <div className="mb-5 flex items-start gap-4">
      <div className="flex size-11 shrink-0 items-center justify-center bg-central-lima font-central-mono text-xl font-extrabold text-black">
        {n}
      </div>
      <div>
        <h2 className="font-central-mono text-lg font-bold uppercase leading-tight text-central-tinta sm:text-xl">
          {titulo}
        </h2>
        {sub && <p className="mt-0.5 text-sm text-central-tinta-suave">{sub}</p>}
      </div>
    </div>
  );
}

function Lista({ estilo, itens }: { estilo: "letras" | "numeros" | "marcadores"; itens: string[] }) {
  return (
    <ol className="mb-5 space-y-2.5">
      {itens.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center border border-central-linha bg-central-painel2 font-central-mono text-xs font-bold text-central-tinta-suave">
            {estilo === "letras" ? String.fromCharCode(65 + i) : estilo === "numeros" ? i + 1 : "·"}
          </span>
          <span className="text-sm leading-relaxed text-central-tinta-suave">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Requisitos({
  itens,
}: {
  itens: { texto: string; obrigatorio: boolean; href?: string; nota?: string }[];
}) {
  return (
    <div className="mb-5 divide-y divide-central-linha border border-central-linha bg-central-painel2">
      {itens.map((r, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <span
            className={`mt-0.5 shrink-0 px-1.5 py-0.5 font-central-mono text-[0.6rem] font-bold uppercase tracking-wider ${
              r.obrigatorio ? "bg-central-acento-soft text-central-acento" : "border border-central-linha text-central-tinta-fraca"
            }`}
          >
            {r.obrigatorio ? "obrigatório" : "opcional"}
          </span>
          <div className="text-sm text-central-tinta-suave">
            {r.href ? (
              <a href={r.href} className="text-central-tinta underline decoration-central-acento underline-offset-2">
                {r.texto}
              </a>
            ) : (
              <span className="text-central-tinta">{r.texto}</span>
            )}
            {r.nota && <span className="block text-xs text-central-tinta-fraca">{r.nota}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Exemplo({ contexto, prompt, resultado }: { contexto: string; prompt: string; resultado: string }) {
  return (
    <div className="mb-6">
      <p className="mb-2 font-central-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-central-tinta-fraca">
        {`// ${contexto}`}
      </p>
      <div className="mb-2 border-l-4 border-central-acento bg-central-painel2 px-4 py-3">
        <code className="break-words font-central-mono text-sm text-central-acento">{prompt}</code>
      </div>
      <p className="text-sm leading-relaxed text-central-tinta-suave">{resultado}</p>
    </div>
  );
}

function Dialogo({ linhas }: { linhas: [string, string][] }) {
  return (
    <div className="mb-5 divide-y divide-central-linha border border-central-linha bg-central-painel2">
      {linhas.map(([quem, texto], i) => (
        <div key={i} className="flex gap-4 px-4 py-3">
          <span
            className={`w-16 shrink-0 font-central-mono text-xs font-bold uppercase tracking-wide ${
              quem.toLowerCase() === "você" || quem.toLowerCase() === "voce"
                ? "text-central-tinta"
                : "text-central-acento"
            }`}
          >
            {quem}
          </span>
          <span className="text-sm leading-relaxed text-central-tinta-suave">{texto}</span>
        </div>
      ))}
    </div>
  );
}

export function RenderBloco({ bloco }: { bloco: Bloco }) {
  switch (bloco.tipo) {
    case "passo":
      return (
        <section className="mb-6 border border-central-linha bg-central-painel p-5 sm:p-7">
          <PassoHeader n={bloco.n} titulo={bloco.titulo} sub={bloco.sub} />
          {bloco.blocos.map((b, i) => (
            <RenderBloco key={i} bloco={b} />
          ))}
        </section>
      );
    case "texto":
      return <p className="mb-5 leading-relaxed text-central-tinta-suave">{bloco.conteudo}</p>;
    case "callout":
      return <Callout variante={bloco.variante} titulo={bloco.titulo} conteudo={bloco.conteudo} />;
    case "link":
      return <LinkExterno label={bloco.label} selo={bloco.selo} href={bloco.href} />;
    case "prompt":
      return <PromptCopiavel rotulo={bloco.rotulo} conteudo={bloco.conteudo} />;
    case "comando":
      return <ComandoCopiavel linguagem={bloco.linguagem} conteudo={bloco.conteudo} aviso={bloco.aviso} />;
    case "lista":
      return <Lista estilo={bloco.estilo} itens={bloco.itens} />;
    case "requisitos":
      return <Requisitos itens={bloco.itens} />;
    case "exemplo":
      return <Exemplo contexto={bloco.contexto} prompt={bloco.prompt} resultado={bloco.resultado} />;
    case "dialogo":
      return <Dialogo linhas={bloco.linhas} />;
  }
}

export function RenderBlocos({ blocos }: { blocos: Bloco[] }) {
  return (
    <div>
      {blocos.map((b, i) => (
        <RenderBloco key={i} bloco={b} />
      ))}
    </div>
  );
}
