/**
 * Camada de eventos da Central.
 *
 * Mantém o CustomEvent que o root-central já emitia (qualquer provedor pode
 * escutar) e, além dele, despacha para o pixel do próprio OS — que era o
 * "provedor futuro" previsto aqui. É o que faz o clique no código do reel
 * voltar como número em /pixels em vez de morrer no console.
 *
 * Usa as MESMAS chaves de identificação do public/pixel.js de propósito: quem
 * chegou por uma landing com o pixel e depois abriu a Central é UM visitante,
 * não dois. Nada de dado pessoal sai daqui — só id anônimo e nome do evento.
 */

export type EventoAnalytics =
  | "busca_feita"
  | "sem_resultado"
  | "filtro_aplicado"
  | "material_aberto"
  | "material_favoritado"
  | "material_desfavoritado"
  | "link_externo_aberto"
  | "prompt_copiado"
  | "comando_copiado"
  | "trilha_iniciada"
  | "trilha_item_concluido"
  | "compartilhar_clicado";

/** Prefixo no nome do evento: no painel a Central não se mistura com a landing. */
export const PREFIXO_EVENTO = "central_";

/**
 * De QUEM são estes eventos — RF-T-04.
 *
 * A API resolve a empresa pela chave do pixel (o `id` da `Org`); sem chave, o
 * evento cai na empresa padrão. Aqui a chave viaja porque estes eventos são da
 * Central, e a Central tem dono — não é "de quem estiver configurado como
 * padrão".
 *
 * DUAS COISAS QUE ESTA LINHA NÃO RESOLVE, e é melhor lê-las do que descobri-las:
 *
 *  1. `NEXT_PUBLIC_*` é trocada pelo valor no BUILD, não em tempo de execução.
 *     Pôr a variável só no bloco `environment:` do compose NÃO a faz chegar ao
 *     pacote do browser: ela precisa ir também como build arg da imagem (o
 *     `build:` fica no serviço `api`, que não é arquivo desta fatia — está no
 *     relatório). Sem isso o valor sai vazio, a chave não vai, e o evento cai na
 *     empresa padrão — que é o comportamento de hoje, não uma quebra.
 *  2. Chave em código de browser é PÚBLICA por natureza: quem abrir o pacote a
 *     lê. Isso vale para qualquer pixel — é o motivo de a chave por site, com
 *     conferência de origem e teto de taxa, estar declarada como o desenho
 *     seguinte em `apps/api/src/events/pixel-tenant.service.ts`. O que a chave
 *     resolve aqui é o dono do evento, não o controle de quem escreve.
 */
const CHAVE_DO_PIXEL = (process.env.NEXT_PUBLIC_CENTRAL_PIXEL_KEY ?? "").trim();

const SESSION_TTL = 30 * 60 * 1000; // 30 min de inatividade encerram a sessão

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

/** Persistente entre visitas; em modo privado cai para um id efêmero. */
function anonymousId(): string {
  try {
    let id = localStorage.getItem("mktos_aid");
    if (!id) {
      id = uuid();
      localStorage.setItem("mktos_aid", id);
    }
    return id;
  } catch {
    return uuid();
  }
}

function sessionId(): string {
  const agora = Date.now();
  try {
    let sid = sessionStorage.getItem("mktos_sid");
    const ultimo = Number.parseInt(sessionStorage.getItem("mktos_sid_ts") ?? "0", 10);
    if (!sid || agora - ultimo > SESSION_TTL) sid = uuid();
    sessionStorage.setItem("mktos_sid", sid);
    sessionStorage.setItem("mktos_sid_ts", String(agora));
    return sid;
  } catch {
    return uuid();
  }
}

function despacharParaOS(nome: string, payload: Record<string, string | number>) {
  const corpo = JSON.stringify({
    event_name: `${PREFIXO_EVENTO}${nome}`,
    event_id: uuid(),
    session_id: sessionId(),
    anonymous_id: anonymousId(),
    url: window.location.href,
    referrer: document.referrer || undefined,
    device: /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "mobile" : "desktop",
    ts: Date.now(),
    // Vazia não vai: chave presente e vazia é RECUSA na API, e perder o evento
    // é pior do que contá-lo na empresa padrão (ver `CHAVE_DO_PIXEL`).
    ...(CHAVE_DO_PIXEL ? { pixel_key: CHAVE_DO_PIXEL } : {}),
    ...(Object.keys(payload).length ? { metadata: payload } : {}),
  });

  // sendBeacon sobrevive à navegação — importante em clique de link externo,
  // que é justamente o evento que mais interessa medir aqui.
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([corpo], { type: "application/json" });
      if (navigator.sendBeacon("/api/events/track", blob)) return;
    }
  } catch {
    /* cai no fetch abaixo */
  }
  void fetch("/api/events/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corpo,
    keepalive: true,
    credentials: "omit",
  }).catch(() => undefined);
}

export function trackEvent(nome: EventoAnalytics, payload: Record<string, string | number> = {}) {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "development") {
    console.debug(`[analytics] ${nome}`, payload);
  }
  window.dispatchEvent(new CustomEvent("root-central:evento", { detail: { nome, payload } }));
  despacharParaOS(nome, payload);
}
