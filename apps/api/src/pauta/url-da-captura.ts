import { createHash } from 'node:crypto';

/*
 * A chave de deduplicação da captura pela tela e pelo grupo do WhatsApp.
 *
 * Morava como método privado do `PautaService`. Saiu para cá quando a entrada
 * pelo grupo do WhatsApp (MC1) passou a gravar captura por outro caminho: duas
 * normalizações diferentes para a MESMA coluna `urlHash` fariam o link colado
 * na tela e o link colado no grupo virarem duas capturas — que é justamente o
 * que o `@@unique([orgId, urlHash])` existe para impedir.
 *
 * AINDA NÃO É A ÚNICA: `ColetaService.coletarRss` (`pauta/coleta.service.ts`)
 * grava o `urlHash` do RSS com outra regra (tira a query inteira, não tira
 * `www`, não baixa a caixa do host). A matéria que chega pelo feed e depois é
 * colada no grupo vira duas capturas. Unificar muda o hash das capturas de RSS novas contra as já
 * gravadas, e o MC5 decidiu não unificar: a rodada junta a mesma matéria antes do
 * prompt e da lista da curadoria (`umaPorMateriaDoInsumo`), com as letras de todas
 * as origens. O mesmo vale para a matéria que chega pelo feed e pela busca (MC3).
 */

/** Normaliza a URL antes do hash: sem UTM, sem barra final, sem fragmento. */
export function normalizarUrlDaCaptura(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|si$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    const s = u.toString();
    return s.endsWith('/') ? s.slice(0, -1) : s;
  } catch {
    return url.trim();
  }
}

/** O `urlHash` da captura: sha256 da chave já normalizada. */
export function hashDaCaptura(chave: string): string {
  return createHash('sha256').update(chave).digest('hex');
}

/**
 * Uma captura por matéria, pela chave da tela: fica a primeira de cada chave, na
 * ordem recebida. Captura sem URL não tem com quem repetir e passa.
 */
export function umaPorMateria<T extends { url: string | null }>(capturas: readonly T[]): T[] {
  const vistas = new Set<string>();
  return capturas.filter((c) => {
    if (!c.url) return true;
    const chave = normalizarUrlDaCaptura(c.url);
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}
