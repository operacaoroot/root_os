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
 * AINDA NÃO É A ÚNICA: `RodadaService.coletarFeeds` grava o `urlHash` do RSS
 * com outra regra (tira a query inteira, não tira `www`, não baixa a caixa do
 * host). A matéria que chega pelo feed e depois é colada no grupo vira duas
 * capturas. Unificar muda o hash das capturas de RSS novas contra as já
 * gravadas — decisão do MC5, quando a rodada juntar W e N.
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
