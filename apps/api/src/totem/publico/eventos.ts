import type { TotemEventoQuiosque } from '@mktos/shared';

/*
 * O lote de eventos que o quiosque sobe, já validado pelo schema (tipo do
 * contrato, termo cortado e sem CPF nem telefone), virando linhas de
 * `TotemEvento`. Loja e aparelho vêm do token, nunca do corpo.
 */

export interface AparelhoDoEvento {
  orgId: string;
  lojaId: string;
  dispositivoId: string;
}

export interface LinhaDeEvento {
  id: string;
  orgId: string;
  lojaId: string;
  dispositivoId: string;
  tipo: string;
  produtoId: string | null;
  termo: string | null;
  ocorridoEm: Date;
}

/**
 * Um id repetido no mesmo lote entra uma vez. `produtoId` que não é produto da
 * empresa vira `null`: a coluna não tem FK, e um id solto estragaria a
 * contagem de "mais vistos". Relógio do aparelho adiantado não grava evento
 * no futuro.
 */
export function linhasDeEventos(
  eventos: readonly TotemEventoQuiosque[],
  aparelho: AparelhoDoEvento,
  produtosDaEmpresa: ReadonlySet<string>,
  agora: Date,
): LinhaDeEvento[] {
  const vistos = new Set<string>();
  const linhas: LinhaDeEvento[] = [];
  for (const e of eventos) {
    if (vistos.has(e.id)) continue;
    vistos.add(e.id);
    const quando = new Date(e.ocorridoEm);
    linhas.push({
      id: e.id,
      orgId: aparelho.orgId,
      lojaId: aparelho.lojaId,
      dispositivoId: aparelho.dispositivoId,
      tipo: e.tipo,
      produtoId: e.produtoId && produtosDaEmpresa.has(e.produtoId) ? e.produtoId : null,
      termo: e.termo,
      ocorridoEm: quando.getTime() > agora.getTime() ? agora : quando,
    });
  }
  return linhas;
}
