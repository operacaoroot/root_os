/**
 * Instagram API with Instagram Login (graph.instagram.com).
 * Escolhida em vez da trilha com Facebook Login porque NÃO exige Página do
 * Facebook vinculada — é o caminho mais curto para o criador conectar.
 * Contrapartida: não tem business_discovery (monitorar perfil de terceiro).
 */
const AUTORIZAR = 'https://www.instagram.com/oauth/authorize'
const TOKEN = 'https://api.instagram.com/oauth/access_token'
const GRAPH = 'https://graph.instagram.com'

const ESCOPOS = ['instagram_business_basic']

export type Credencial = { appId: string; secret: string }

export function redirectUri() {
  return `${process.env.PUBLIC_BIO_ORIGIN ?? 'https://bio.operacaoroot.com'}/api/conectar/instagram/callback`
}

export function urlDeAutorizacao(estado: string, cred: Credencial) {
  const p = new URLSearchParams({
    client_id: cred.appId,
    redirect_uri: redirectUri(),
    scope: ESCOPOS.join(','),
    response_type: 'code',
    state: estado,
  })
  return `${AUTORIZAR}?${p}`
}

type TokenCurto = { access_token: string; user_id: number | string; permissions?: string }
type TokenLongo = { access_token: string; token_type: string; expires_in: number }

/** Código → token curto (1h, uso único) → token longo (60 dias). */
export async function trocarCodigo(codigo: string, cred: Credencial) {
  const corpo = new URLSearchParams({
    client_id: cred.appId,
    client_secret: cred.secret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code: codigo,
  })

  const r1 = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  if (!r1.ok) throw new Error(`troca de código falhou: ${r1.status} ${await r1.text()}`)
  const curto = (await r1.json()) as TokenCurto

  const p = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: cred.secret,
    access_token: curto.access_token,
  })
  const r2 = await fetch(`${GRAPH}/access_token?${p}`)
  if (!r2.ok) throw new Error(`troca por token longo falhou: ${r2.status} ${await r2.text()}`)
  const longo = (await r2.json()) as TokenLongo

  return {
    token: longo.access_token,
    expiraEm: new Date(Date.now() + longo.expires_in * 1000),
    escopos: curto.permissions ?? ESCOPOS.join(','),
  }
}

/**
 * O token de 60 dias precisa ser renovado — e MORRE se ficar 60 dias sem uso.
 * Só pode ser renovado depois de 24h de vida.
 */
export async function renovar(token: string) {
  const p = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })
  const r = await fetch(`${GRAPH}/refresh_access_token?${p}`)
  if (!r.ok) throw new Error(`renovação falhou: ${r.status} ${await r.text()}`)
  const d = (await r.json()) as TokenLongo
  return { token: d.access_token, expiraEm: new Date(Date.now() + d.expires_in * 1000) }
}

export async function perfil(token: string) {
  const p = new URLSearchParams({
    fields: 'user_id,username,account_type,media_count',
    access_token: token,
  })
  const r = await fetch(`${GRAPH}/me?${p}`)
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
 * primeira fora da janela em vez de paginar o perfil inteiro.
 */
export async function midiasDesde(token: string, desde: Date, tetoPaginas = 20) {
  const posts: Post[] = []
  let url =
    `${GRAPH}/me/media?fields=id,timestamp,permalink,media_type&limit=50&access_token=${encodeURIComponent(token)}`

  for (let pagina = 0; pagina < tetoPaginas && url; pagina++) {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`mídias falharam: ${r.status} ${await r.text()}`)
    const d = (await r.json()) as {
      data: { id: string; timestamp: string; permalink?: string; media_type?: string }[]
      paging?: { next?: string }
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

    if (passouDaJanela) break
    url = d.paging?.next ?? ''
  }

  return posts
}
