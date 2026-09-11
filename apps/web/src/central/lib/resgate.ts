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

/**
 * De QUEM é este resgate — RF-T-04.
 *
 * A API resolve a empresa do evento pela chave do pixel, que é o `id` da `Org`
 * (`apps/api/src/events/pixel-tenant.service.ts`). Sem chave, o evento cai na
 * empresa PADRÃO — que hoje é a ROOT, dona da Central, então funcionava por
 * coincidência: no dia em que a Central mudar de tenant, o dono dos eventos de
 * resgate muda em silêncio.
 *
 * Esta variável roda no SERVIDOR (Route Handler), então vale em tempo de
 * execução: basta estar no bloco `environment:` do serviço `web` do compose.
 * Vazia, o corpo sai sem `pixel_key` e o comportamento é o de sempre — a chave
 * ausente é um caso previsto na API, não um erro.
 */
const CHAVE = (process.env.CENTRAL_PIXEL_KEY ?? "").trim();

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
      // Só quando existe: `pixel_key: ""` é RECUSA na API (chave presente e
      // inutilizável), e recusar o resgate seria pior que contá-lo no padrão.
      ...(CHAVE ? { pixel_key: CHAVE } : {}),
    }),
    cache: "no-store",
  }).catch(() => undefined);
}
