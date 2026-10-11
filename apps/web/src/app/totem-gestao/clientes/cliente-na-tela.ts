import type { TotemClienteDetalhe, TotemClienteLinha } from '@mktos/shared';

/*
 * O cliente do totem no painel (frente D): rótulos de canal e de finalidade,
 * a paginação e a troca da linha da lista depois de uma ação na ficha. Fora de
 * `page.tsx` porque página do App Router só pode exportar o componente.
 */

const ROTULO_DO_CANAL: Record<string, string> = { totem: 'Totem', qr: 'QR da etiqueta' };
const ROTULO_DA_FINALIDADE: Record<string, string> = { cupom: 'cupom', campanhas: 'campanhas' };

export function rotuloDoCanal(canal: string): string {
  return ROTULO_DO_CANAL[canal] ?? canal;
}

export function textoDasFinalidades(finalidades: string[]): string {
  if (finalidades.length === 0) return 'Nenhuma';
  const texto = finalidades.map((f) => ROTULO_DA_FINALIDADE[f] ?? f).join(' e ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function totalDePaginas(total: number, porPagina: number): number {
  return Math.max(1, Math.ceil(total / porPagina));
}

/** A linha da lista com os dados novos da ficha; as outras ficam como estavam. */
export function trocarLinha(itens: TotemClienteLinha[], ficha: TotemClienteDetalhe): TotemClienteLinha[] {
  return itens.map((i) =>
    i.id === ficha.id
      ? {
          id: ficha.id,
          cpfMascarado: ficha.cpfMascarado,
          telefoneMascarado: ficha.telefoneMascarado,
          lojaOrigem: ficha.lojaOrigem,
          canalOrigem: ficha.canalOrigem,
          aceitaCampanhas: ficha.aceitaCampanhas,
          anonimizado: ficha.anonimizado,
          criadoEm: ficha.criadoEm,
          totalDeCupons: ficha.totalDeCupons,
        }
      : i,
  );
}
