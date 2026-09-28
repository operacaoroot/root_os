import type { MarcaService } from '../src/pauta/marca.service';

/*
 * MK1. A empresa sem marca escrita: o bloco é vazio e o prompt fica exatamente
 * como era antes da fatia. É o que a maioria das suítes da pauta quer — elas
 * medem outra coisa, e uma marca gravada mudaria o `system` que elas comparam.
 * Quem mede a marca de verdade é `pauta-marca.test.ts`.
 */
export const semMarca = { bloco: async () => '' } as unknown as MarcaService;

/** Uma marca gravada, para provar que o prompt a recebe. */
export function comMarca(bloco: string): MarcaService {
  return { bloco: async () => bloco } as unknown as MarcaService;
}
