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
