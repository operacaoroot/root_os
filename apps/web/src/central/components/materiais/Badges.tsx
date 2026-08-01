import type { Material, Situacao } from "@/central/types";
import { rotuloCusto, rotuloNivel, rotuloTipo } from "@/central/lib/cta";
import { rotuloSituacao, situacaoDe } from "@/central/lib/frescor";

function Badge({ children, tom = "neutro" }: { children: React.ReactNode; tom?: string }) {
  const tons: Record<string, string> = {
    neutro: "border-central-linha text-central-tinta-suave",
    acento: "border-central-acento/40 bg-central-acento-soft text-central-acento",
    magenta: "border-central-magenta/40 bg-central-magenta-soft text-central-magenta",
    alerta: "border-central-alerta/40 text-central-alerta",
  };
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 font-central-mono text-[0.62rem] font-semibold uppercase tracking-wider ${tons[tom] ?? tons.neutro}`}
    >
      {children}
    </span>
  );
}

export function BadgeSituacao({ situacao }: { situacao: Situacao }) {
  const tom =
    situacao === "verificado"
      ? "acento"
      : situacao === "descontinuado"
        ? "magenta"
        : situacao === "requer-revisao"
          ? "alerta"
          : "neutro";
  return <Badge tom={tom}>{rotuloSituacao[situacao]}</Badge>;
}

export function BadgesMaterial({ m, compacto = false }: { m: Material; compacto?: boolean }) {
  const situacao = situacaoDe(m);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge>{rotuloTipo[m.tipo]}</Badge>
      <Badge>{rotuloNivel[m.nivel]}</Badge>
      <Badge tom={m.custo === "gratuito" ? "acento" : "neutro"}>{rotuloCusto[m.custo]}</Badge>
      {!compacto && m.minutosEstimados && <Badge>{m.minutosEstimados} min</Badge>}
      {(situacao === "requer-revisao" || situacao === "descontinuado" || !compacto) && (
        <BadgeSituacao situacao={situacao} />
      )}
    </div>
  );
}
