/**
 * Instagram API with Instagram Login (graph.instagram.com).
 * Escolhida em vez da trilha com Facebook Login porque NÃO exige Página do
 * Facebook vinculada — é o caminho mais curto para o criador conectar.
 * Contrapartida: não tem business_discovery (monitorar perfil de terceiro).
 */
import type { BioFinalidade } from '@mktos/shared'
import { INSTAGRAM_ESCOPO_DE_COMENTARIOS, INSTAGRAM_ESCOPO_DE_PUBLICAR } from '@mktos/shared'

/*
 * Os três endereços aceitam sobrescrita por ambiente só para o dublê local
 * (MD5); vazio vale o de produção. Lidos a cada chamada, e não no carregamento
 * do módulo, para a suíte poder apontar para o servidor dela.
 */
const base = (valor: string | undefined, padrao: string) => ((valor ?? '').trim() || padrao).replace(/\/$/, '')
// Leitura direta de `process.env`, e não por `env('NOME')`: a catraca de
// credenciais (arquitetura.test.ts) só enxerga o nome fora de string.
const AUTORIZAR = () => base(process.env.INSTAGRAM_OAUTH_URL, 'https://www.instagram.com/oauth/authorize')
const TOKEN = () => base(process.env.INSTAGRAM_TOKEN_URL, 'https://api.instagram.com/oauth/access_token')
const GRAPH = () => base(process.env.INSTAGRAM_GRAPH_URL, 'https://graph.instagram.com')

/**
 * O que a bio pede a TODO criador que conecta. Não pôr publicação aqui: com o
 * app em Standard Access, permissão só pode ser pedida a quem tem papel no app,
 * e o criador comum não tem.
 */
export const ESCOPOS = ['instagram_business_basic'] as const

/**
 * O que a conta de publicação da própria empresa pede (MD5). Comentários já vão
 * junto para a fila de respostas (MD9) não exigir outra reconexão.
 */
export const ESCOPOS_DE_PUBLICACAO = [
  'instagram_business_basic',
  INSTAGRAM_ESCOPO_DE_PUBLICAR,
  INSTAGRAM_ESCOPO_DE_COMENTARIOS,
] as const

export type Credencial = { appId: string; secret: string }

export function redirectUri() {
  return `${process.env.PUBLIC_BIO_ORIGIN ?? 'https://bio.operacaoroot.com'}/api/conectar/instagram/callback`
}

export function escoposDa(finalidade: BioFinalidade): readonly string[] {
  return finalidade === 'publicacao' ? ESCOPOS_DE_PUBLICACAO : ESCOPOS
}

/** A mesma redirect nas duas finalidades: a diferença viaja no `state`, não no endereço. */
export function urlDeAutorizacao(estado: string, cred: Credencial, finalidade: BioFinalidade = 'bio') {
  const p = new URLSearchParams({
    client_id: cred.appId,
    redirect_uri: redirectUri(),
    scope: escoposDa(finalidade).join(','),
    response_type: 'code',
    state: estado,
  })
  return `${AUTORIZAR()}?${p}`
}

/**
 * Os escopos concedidos, como a Meta os devolve. A documentação mostra
 * `permissions` como texto separado por vírgula, dentro de `data[]`; há relato
 * de lista e de corpo sem o `data`. Aceita as quatro formas. Ausente devolve
 * `null`: quem decide o que presumir é quem chama.
 */
export function escoposConcedidos(bruto: unknown): string[] | null {
  if (Array.isArray(bruto)) {
    return bruto.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
  }
  if (typeof bruto === 'string') {
    return bruto.split(',').map((x) => x.trim()).filter(Boolean)
  }
  return null
}

type TokenCurto = { access_token: string; user_id: number | string; permissions?: unknown }
type TokenLongo = { access_token: string; token_type: string; expires_in: number }

function lerTokenCurto(corpo: unknown): TokenCurto {
  const c = corpo as { data?: unknown } & Partial<TokenCurto>
  const dentro = Array.isArray(c?.data) ? (c.data[0] as Partial<TokenCurto> | undefined) : c
  if (!dentro || typeof dentro.access_token !== 'string' || !dentro.access_token) {
    throw new Error('troca de código sem access_token na resposta')
  }
  return dentro as TokenCurto
}

/** Código → token curto (1h, uso único) → token longo (60 dias). */
export async function trocarCodigo(codigo: string, cred: Credencial) {
  const corpo = new URLSearchParams({
    client_id: cred.appId,
    client_secret: cred.secret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code: codigo,
  })

  const r1 = await fetch(TOKEN(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  if (!r1.ok) throw new Error(`troca de código falhou: ${r1.status} ${await r1.text()}`)
  const curto = lerTokenCurto(await r1.json())

  const p = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: cred.secret,
    access_token: curto.access_token,
  })
  const r2 = await fetch(`${GRAPH()}/access_token?${p}`)
  if (!r2.ok) throw new Error(`troca por token longo falhou: ${r2.status} ${await r2.text()}`)
  const longo = (await r2.json()) as TokenLongo

  return {
    token: longo.access_token,
    expiraEm: new Date(Date.now() + longo.expires_in * 1000),
    /** `null` quando a Meta não disse o que concedeu. */
    concedidos: escoposConcedidos(curto.permissions),
  }
}

/**
 * O token de 60 dias precisa ser renovado — e MORRE se ficar 60 dias sem uso.
 * Só pode ser renovado depois de 24h de vida.
 */
export async function renovar(token: string) {
  const p = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })
  const r = await fetch(`${GRAPH()}/refresh_access_token?${p}`)
  if (!r.ok) throw new Error(`renovação falhou: ${r.status} ${await r.text()}`)
  const d = (await r.json()) as TokenLongo
  return { token: d.access_token, expiraEm: new Date(Date.now() + d.expires_in * 1000) }
}

export async function perfil(token: string) {
  const p = new URLSearchParams({
    fields: 'user_id,username,account_type,media_count',
    access_token: token,
  })
  const r = await fetch(`${GRAPH()}/me?${p}`)
  if (!r.ok) throw new Error(`perfil falhou: ${r.status} ${await r.text()}`)
  return (await r.json()) as {
    user_id: string
    username: string
    account_type: string
    media_count: number
  }
}

export type Post = { externalId: string; publicadoEm: Date; permalink?: string; tipo?: string }

/**
 * Mídias com data >= `desde`. Vem ordenado por data desc, então paramos na
 * primeira fora da janela em vez de paginar o perfil inteiro. A paginação segue
 * o cursor `after` sobre o nosso endereço, como em `comentariosDa`: o
 * `paging.next` do corpo levaria o token para onde a resposta mandasse.
 */
export async function midiasDesde(token: string, desde: Date, tetoPaginas = 20) {
  const posts: Post[] = []
  let depois: string | null = null

  for (let pagina = 0; pagina < tetoPaginas; pagina++) {
    const p = new URLSearchParams({ fields: 'id,timestamp,permalink,media_type', limit: '50', access_token: token })
    if (depois) p.set('after', depois)
    const r = await fetch(`${GRAPH()}/me/media?${p}`)
    if (!r.ok) throw new Error(`mídias falharam: ${r.status} ${await r.text()}`)
    const d = (await r.json()) as {
      data: { id: string; timestamp: string; permalink?: string; media_type?: string }[]
      paging?: { next?: string; cursors?: { after?: unknown } }
    }

    let passouDaJanela = false
    for (const m of d.data ?? []) {
      const quando = new Date(m.timestamp)
      if (quando < desde) {
        passouDaJanela = true
        break
      }
      posts.push({
        externalId: m.id,
        publicadoEm: quando,
        permalink: m.permalink,
        tipo: m.media_type,
      })
    }

    const cursor = d.paging?.cursors?.after
    if (passouDaJanela || !d.paging?.next || typeof cursor !== 'string' || !cursor) break
    depois = cursor
  }

  return posts
}

// ---------------------------------------------------------------------------
// Publicação (MD6): container → status → publish, na conta de publicação.
// ---------------------------------------------------------------------------

/**
 * A versão da Graph nas chamadas de publicação. As de leitura acima seguem sem
 * versão no caminho (valem a do app), como sempre foram.
 */
export const VERSAO_DA_GRAPH_DE_PUBLICACAO = 'v24.0';

/** Cada chamada de publicação tem prazo: a Meta baixa a mídia antes de responder ao container. */
const PRAZO_DA_CHAMADA_MS = 60_000;

const PUBLICACAO = () => `${GRAPH()}/${VERSAO_DA_GRAPH_DE_PUBLICACAO}`;

/** O erro de uma chamada da Graph, com o código HTTP separado para quem decide o que repetir. */
export class ErroDaGraph extends Error {
  constructor(
    mensagem: string,
    /** `null` quando nem houve resposta (rede, prazo): o pedido pode ter chegado. */
    readonly status: number | null,
  ) {
    super(mensagem);
  }
}

async function chamar(url: string, init: RequestInit, oQue: string): Promise<unknown> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(PRAZO_DA_CHAMADA_MS) });
  } catch (e) {
    throw new ErroDaGraph(`${oQue} sem resposta: ${(e as Error).message}`, null);
  }
  const texto = await r.text();
  if (!r.ok) throw new ErroDaGraph(`${oQue} falhou: ${r.status} ${texto.slice(0, 400)}`, r.status);
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErroDaGraph(`${oQue} devolveu corpo que não é JSON`, r.status);
  }
}

const porFormulario = (campos: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(campos),
});

/** Quanto do teto de 100 posts em 24 h móveis a conta já usou. */
export async function limiteDePublicacao(token: string, igUserId: string): Promise<{ usado: number; teto: number }> {
  const p = new URLSearchParams({ fields: 'quota_usage,config', access_token: token });
  const d = (await chamar(`${PUBLICACAO()}/${encodeURIComponent(igUserId)}/content_publishing_limit?${p}`, {}, 'limite de publicação')) as {
    data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }>;
  };
  const linha = d.data?.[0] ?? {};
  return { usado: Number(linha.quota_usage ?? 0), teto: Number(linha.config?.quota_total ?? 100) };
}

export interface ContainerNovo {
  image_url?: string;
  video_url?: string;
  media_type?: 'CAROUSEL' | 'REELS' | 'STORIES';
  is_carousel_item?: boolean;
  children?: string[];
  caption?: string;
  share_to_feed?: boolean;
}

/** Cria um container e devolve o id dele (a mídia é baixada pela Meta da URL dada). */
export async function criarContainer(token: string, igUserId: string, c: ContainerNovo): Promise<string> {
  const campos: Record<string, string> = { access_token: token };
  if (c.image_url) campos.image_url = c.image_url;
  if (c.video_url) campos.video_url = c.video_url;
  if (c.media_type) campos.media_type = c.media_type;
  if (c.is_carousel_item) campos.is_carousel_item = 'true';
  if (c.children?.length) campos.children = c.children.join(',');
  if (c.caption) campos.caption = c.caption;
  if (c.share_to_feed !== undefined) campos.share_to_feed = String(c.share_to_feed);
  const d = (await chamar(`${PUBLICACAO()}/${encodeURIComponent(igUserId)}/media`, porFormulario(campos), 'criar container')) as { id?: unknown };
  if (typeof d.id !== 'string' || !d.id) throw new ErroDaGraph('criar container sem id na resposta', 200);
  return d.id;
}

/** `EXPIRED`, `ERROR`, `FINISHED`, `IN_PROGRESS` ou `PUBLISHED`, como a Meta escreve. */
export async function statusDoContainer(token: string, containerId: string): Promise<{ codigo: string; detalhe: string | null }> {
  const p = new URLSearchParams({ fields: 'status_code,status', access_token: token });
  const d = (await chamar(`${PUBLICACAO()}/${encodeURIComponent(containerId)}?${p}`, {}, 'status do container')) as {
    status_code?: unknown;
    status?: unknown;
  };
  return { codigo: String(d.status_code ?? ''), detalhe: typeof d.status === 'string' ? d.status.slice(0, 300) : null };
}

/** Publica o container; devolve o id da mídia publicada. */
export async function publicarContainer(token: string, igUserId: string, creationId: string): Promise<string> {
  const d = (await chamar(
    `${PUBLICACAO()}/${encodeURIComponent(igUserId)}/media_publish`,
    porFormulario({ creation_id: creationId, access_token: token }),
    'publicar',
  )) as { id?: unknown };
  if (typeof d.id !== 'string' || !d.id) throw new ErroDaGraph('publicar sem id na resposta', 200);
  return d.id;
}

export async function permalinkDe(token: string, mediaId: string): Promise<string | null> {
  const p = new URLSearchParams({ fields: 'permalink', access_token: token });
  const d = (await chamar(`${PUBLICACAO()}/${encodeURIComponent(mediaId)}?${p}`, {}, 'permalink')) as { permalink?: unknown };
  return typeof d.permalink === 'string' && /^https:\/\//.test(d.permalink) ? d.permalink : null;
}

/** As mídias mais recentes da conta, para achar o post cuja resposta do publish se perdeu. */
export async function midiasRecentes(
  token: string,
  igUserId: string,
  limite = 10,
): Promise<Array<{ id: string; caption: string | null; timestamp: string | null; permalink: string | null }>> {
  const p = new URLSearchParams({ fields: 'id,caption,timestamp,permalink', limit: String(limite), access_token: token });
  const d = (await chamar(`${PUBLICACAO()}/${encodeURIComponent(igUserId)}/media?${p}`, {}, 'mídias recentes')) as {
    data?: Array<Record<string, unknown>>;
  };
  return (d.data ?? [])
    .filter((m) => typeof m.id === 'string')
    .map((m) => ({
      id: m.id as string,
      caption: typeof m.caption === 'string' ? m.caption : null,
      timestamp: typeof m.timestamp === 'string' ? m.timestamp : null,
      permalink: typeof m.permalink === 'string' ? m.permalink : null,
    }));
}

// ---------------------------------------------------------------------------
// Comentários (MD9): a fila da DM à mão, lida na conta de publicação.
// ---------------------------------------------------------------------------

/** Um comentário como a Graph o devolve, só com o que a fila usa. */
export interface ComentarioDaGraph {
  id: string;
  texto: string;
  timestamp: string | null;
  deId: string | null;
  deUsuario: string | null;
  /** Presente quando é resposta a outro comentário. */
  parentId: string | null;
  /**
   * Reserva para o webhook da MD11, onde `ad_id` chega. A leitura por consulta
   * não pede o campo (fora do nó IG Comment, ele dá #100), então aqui é nulo.
   */
  adId: string | null;
}

/** Quantos comentários cada página pede. A Graph aceita até 50 por página nesta aresta. */
const COMENTARIOS_POR_PAGINA = 50;

/**
 * Os comentários de uma mídia, do mais novo ao mais velho, com teto de
 * páginas. A paginação segue o CURSOR `after` montado sobre o nosso endereço,
 * e não o `paging.next` que a resposta traz: seguir uma URL vinda do corpo
 * seria mandar o token para onde a resposta mandasse.
 */
export async function comentariosDa(
  token: string,
  midiaId: string,
  tetoPaginas = 5,
): Promise<{ comentarios: ComentarioDaGraph[]; truncado: boolean }> {
  const comentarios: ComentarioDaGraph[] = [];
  let depois: string | null = null;
  for (let pagina = 0; pagina < tetoPaginas; pagina++) {
    const p = new URLSearchParams({
      fields: 'id,text,timestamp,from{id,username},parent_id',
      limit: String(COMENTARIOS_POR_PAGINA),
      access_token: token,
    });
    if (depois) p.set('after', depois);
    const d = (await chamar(`${PUBLICACAO()}/${encodeURIComponent(midiaId)}/comments?${p}`, {}, 'comentários')) as {
      data?: Array<Record<string, unknown>>;
      paging?: { cursors?: { after?: unknown }; next?: unknown };
    };
    for (const c of d.data ?? []) {
      if (typeof c.id !== 'string' || !c.id) continue;
      const de = c.from && typeof c.from === 'object' ? (c.from as Record<string, unknown>) : {};
      comentarios.push({
        id: c.id,
        texto: typeof c.text === 'string' ? c.text : '',
        timestamp: typeof c.timestamp === 'string' ? c.timestamp : null,
        deId: typeof de.id === 'string' ? de.id : null,
        deUsuario: typeof de.username === 'string' ? de.username : null,
        parentId: typeof c.parent_id === 'string' && c.parent_id ? c.parent_id : null,
        adId: typeof c.ad_id === 'string' && c.ad_id ? c.ad_id : null,
      });
    }
    const cursor = d.paging?.cursors?.after;
    if (!d.paging?.next || typeof cursor !== 'string' || !cursor) return { comentarios, truncado: false };
    depois = cursor;
  }
  return { comentarios, truncado: true };
}
