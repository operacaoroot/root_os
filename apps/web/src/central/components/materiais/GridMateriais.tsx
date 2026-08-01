import type { Material } from "@/central/types";
import { CardMaterial } from "./CardMaterial";

/** Grid do catálogo: 2 colunas no celular (padrão de feed), 3–4 no desktop. */
export function GridMateriais({ materiais }: { materiais: Material[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
      {materiais.map((m) => (
        <CardMaterial key={m.id} m={m} />
      ))}
    </div>
  );
}
