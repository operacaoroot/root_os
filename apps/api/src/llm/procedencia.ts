import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * A PROCEDÊNCIA DE UMA CHAMADA DE MODELO (lane E do cockpit, 13/10/2026).
 *
 * `complete()` devolve só o texto, e a superfície não muda: há quatro pontos
 * antigos que a usam. Só que o comercial precisa gravar no fato QUEM respondeu
 * (o stub, a ponte, a ponte que caiu no stub) e se o custo é conhecido. Em vez
 * de alargar a interface de todos os provedores, quem quer saber abre um
 * escopo (`comProcedencia`) e o provedor anota nele (`anotarProcedencia`). O
 * escopo atravessa o envelope do teto (`ProviderComTeto`) sem que ele precise
 * saber de nada, porque viaja pelo `AsyncLocalStorage` da própria chamada.
 *
 * Provedor que não anota (anthropic, openai, openrouter) deixa o escopo vazio,
 * e quem chamou grava o nome e o modelo do provider com `custoDesconhecido:
 * true`: `complete()` não devolve uso, então o custo da chamada não é medido
 * aqui. Isso é dado ausente, nunca R$ 0,00.
 */

export interface ProcedenciaDaChamada {
  provider: string;
  modelo: string;
  custoUsd: number;
  custoDesconhecido: boolean;
  /** true quando a ponte falhou e quem respondeu foi o stub. */
  caiuNoStub: boolean;
  /** O porquê da queda, em uma linha, para a tela avisar. */
  aviso: string | null;
}

const escopo = new AsyncLocalStorage<{ ultima: ProcedenciaDaChamada | null }>();

/** O provedor anota quem respondeu. Fora de um escopo, não faz nada. */
export function anotarProcedencia(p: ProcedenciaDaChamada): void {
  const s = escopo.getStore();
  if (s) s.ultima = p;
}

/** Roda `fn` e devolve o resultado com a procedência da ÚLTIMA chamada de modelo feita dentro dela. */
export async function comProcedencia<T>(fn: () => Promise<T>): Promise<{ resultado: T; procedencia: ProcedenciaDaChamada | null }> {
  const store = { ultima: null as ProcedenciaDaChamada | null };
  const resultado = await escopo.run(store, fn);
  return { resultado, procedencia: store.ultima };
}
