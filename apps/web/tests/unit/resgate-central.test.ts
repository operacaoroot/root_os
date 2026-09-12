/**
 * O resgate da Central diz de quem ele é — fatia 1.4, RF-T-04
 * ===========================================================
 *
 * `/central/r/CODIGO` é a terceira superfície pública da fatia: chega sem token,
 * responde com um redirect e GRAVA um evento. Quem grava é a API
 * (`POST /api/events/track`), e é lá que a empresa é resolvida — pela chave do
 * pixel. Sem chave, o evento cai na empresa PADRÃO, que hoje é a ROOT por
 * coincidência de a Central ser dela: no dia em que a Central mudar de tenant, o
 * dono dos eventos de resgate muda em silêncio.
 *
 * Esta suíte prova as duas metades: o redirect continua sendo um `Location` de
 * verdade (e não um `<meta refresh>` de 1s, que foi o motivo de isto ser Route
 * Handler), e o corpo do evento leva a chave da empresa dona.
 *
 * POR QUE UM `describe` POR VALOR DE AMBIENTE
 * A chave é lida no IMPORT de `resgate.ts` — é uma `const` de módulo, não uma
 * leitura por chamada (e tem de ser: ler `process.env` a cada evento é caro e
 * muda o comportamento no meio do voo). Trocar a variável exige reimportar, e
 * reimportar aqui custa caro de verdade: a rota puxa `@/central/data`, que valida
 * o catálogo inteiro com Zod no import. Um `beforeAll` por valor paga esse preço
 * três vezes em vez de uma por caso.
 */
import type { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// O import do catálogo é pesado (validação Zod de todo o acervo no import).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

type Chamada = { url: string; corpo: Record<string, unknown> };
type Rota = (
  req: NextRequest,
  ctx: { params: Promise<{ codigo: string }> },
) => Promise<Response>;

const CHAVE = "11111111-2222-4333-8444-555555555555";

const chamadas: Chamada[] = [];
let fetchOriginal: typeof globalThis.fetch;

/** A rota, importada DEPOIS de o ambiente estar do jeito do bloco. */
async function carregarRota(chave?: string): Promise<Rota> {
  vi.resetModules();
  if (chave === undefined) delete process.env.CENTRAL_PIXEL_KEY;
  else process.env.CENTRAL_PIXEL_KEY = chave;
  const mod = await import("@/app/central/r/[codigo]/route");
  return mod.GET as Rota;
}

/** O par (requisição, contexto) que o Route Handler recebe do Next. */
function pedido(codigo: string, rid?: string) {
  // Só `cookies.get` é usado pela rota; o resto do NextRequest não entra em cena.
  const req = {
    cookies: { get: (nome: string) => (rid && nome === "rid" ? { value: rid } : undefined) },
  } as unknown as NextRequest;
  return [req, { params: Promise.resolve({ codigo }) }] as const;
}

beforeEach(() => {
  chamadas.length = 0;
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(null, { status: 204 });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("resgate da Central com a chave configurada", () => {
  let GET: Rota;
  beforeAll(async () => {
    GET = await carregarRota(CHAVE);
  });

  it("redireciona por Location, sem renderizar nada", async () => {
    const res = await GET(...pedido("N8N"));

    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe(
      "/central/materiais/n8n-automacao-de-verdade?via=resgate",
    );
  });

  it("o evento do resgate leva a chave da empresa dona", async () => {
    await GET(...pedido("N8N", "rid-de-teste"));

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toMatch(/\/api\/events\/track$/);
    expect(chamadas[0].corpo.pixel_key).toBe(CHAVE);
    expect(chamadas[0].corpo.event_name).toBe("central_resgate");
    // o cookie do visitante vira a sessão, quando existe
    expect(chamadas[0].corpo.session_id).toBe("rid-de-teste");
    expect(chamadas[0].corpo.metadata).toMatchObject({ codigo: "N8N", encontrado: "sim" });
  });

  it("código que não existe cai na busca e MESMO ASSIM é contado, com a chave", async () => {
    const res = await GET(...pedido("CODIGO-MORTO"));

    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe("/central/materiais?busca=CODIGO-MORTO");
    expect(chamadas[0].corpo.pixel_key).toBe(CHAVE);
    expect(chamadas[0].corpo.metadata).toMatchObject({ encontrado: "nao" });
  });
});

describe("resgate da Central sem a variável", () => {
  let GET: Rota;
  beforeAll(async () => {
    GET = await carregarRota(undefined);
  });

  it("o corpo sai SEM a chave — e não com uma chave vazia", async () => {
    await GET(...pedido("N8N"));

    expect(chamadas).toHaveLength(1);
    // A diferença importa: chave AUSENTE cai na empresa padrão (o comportamento
    // de antes desta fatia); chave presente e VAZIA é recusa na API, e o resgate
    // deixaria de ser contado.
    expect("pixel_key" in chamadas[0].corpo).toBe(false);
  });
});

describe("resgate da Central com a variável em branco", () => {
  let GET: Rota;
  beforeAll(async () => {
    GET = await carregarRota("   ");
  });

  it("branco conta como ausente, não como chave", async () => {
    await GET(...pedido("N8N"));
    expect("pixel_key" in chamadas[0].corpo).toBe(false);
  });
});
