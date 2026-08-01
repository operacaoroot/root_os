import { PREFIXO_EVENTO } from "./analytics";

/**
 * Registro do resgate (/central/r/CODIGO) — feito no servidor, não no browser.
 *
 * O resgate é um redirect: a página some antes de qualquer JS rodar, então o
 * trackEvent do cliente não pega. E este é o evento que mais importa: é o
 * clique que veio do comentário do reel.
 *
 * Registra também o código que NÃO existe. Saber que estão comentando um
 * código morto vale tanto quanto saber qual material converte.
 */
const API = process.env.API_INTERNAL_URL ?? "http://localhost:4001";

export function registrarResgate(codigo: string, slug: string | null, rid?: string): void {
  const anonimo = rid ?? `anon-${crypto.randomUUID()}`;
  void fetch(`${API}/api/events/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_name: `${PREFIXO_EVENTO}resgate`,
      event_id: crypto.randomUUID(),
      // Sem cookie do visitante não há sessão de verdade: um id por resgate.
      // O evento continua contável (quantos resgates, de qual código); o que
      // não dá pra afirmar é que dois resgates vieram da mesma pessoa.
      session_id: anonimo,
      anonymous_id: anonimo,
      metadata: { codigo, slug: slug ?? "", encontrado: slug ? "sim" : "nao" },
      ts: Date.now(),
    }),
    cache: "no-store",
  }).catch(() => undefined);
}
