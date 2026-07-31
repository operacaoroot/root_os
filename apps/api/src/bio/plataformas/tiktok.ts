import { createHash, randomBytes } from 'node:crypto'

/**
 * TikTok Login Kit + Display API.
 * É o ÚNICO caminho: o TikTok não tem equivalente ao business_discovery da Meta,
 * e a Research API exclui uso comercial por escrito. Ou o dono conecta, ou nada.
 */
const AUTORIZAR = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/'
const API = 'https://open.tiktokapis.com/v2'

const ESCOPOS = ['user.info.basic', 'user.info.stats', 'video.list']

export type Credencial = { appId: string; secret: string }

export function redirectUri() {
  return `${process.env.PUBLIC_BIO_ORIGIN ?? 'https://bio.operacaoroot.com'}/api/conectar/tiktok/callback`
}

/** PKCE — o TikTok exige na web. */
export function novoVerifier() {
  return randomBytes(48).toString('base64url')
}

export function urlDeAutorizacao(estado: string, verifier: string, cred: Credencial) {
  const challenge = createHash('sha256').update(verifier).digest('hex')
  const p = new URLSearchParams({
    client_key: cred.appId,
    scope: ESCOPOS.join(','),
    response_type: 'code',
    redirect_uri: redirectUri(),
    state: estado,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return `${AUTORIZAR}?${p}`
}

type Token = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  open_id?: string
}

export async function trocarCodigo(codigo: string, verifier: string, cred: Credencial) {
  const corpo = new URLSearchParams({
    client_key: cred.appId,
    client_secret: cred.secret,
    code: codigo,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  })

  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  if (!r.ok) throw new Error(`troca de código falhou: ${r.status} ${await r.text()}`)
  const d = (await r.json()) as Token & { error?: string; error_description?: string }
  if (d.error) throw new Error(`${d.error}: ${d.error_description ?? ''}`)

  return {
    token: d.access_token,
    refresh: d.refresh_token,
    expiraEm: new Date(Date.now() + d.expires_in * 1000),
    escopos: d.scope ?? ESCOPOS.join(','),
    externalId: d.open_id,
  }
}

export async function renovar(refresh: string, cred: Credencial) {
  const corpo = new URLSearchParams({
    client_key: cred.appId,
    client_secret: cred.secret,
    grant_type: 'refresh_token',
    refresh_token: refresh,
  })
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  })
  if (!r.ok) throw new Error(`renovação falhou: ${r.status} ${await r.text()}`)
  const d = (await r.json()) as Token
  return {
    token: d.access_token,
    refresh: d.refresh_token,
    expiraEm: new Date(Date.now() + d.expires_in * 1000),
  }
}

export async function perfil(token: string) {
  const r = await fetch(`${API}/user/info/?fields=open_id,display_name,video_count`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new Error(`perfil falhou: ${r.status} ${await r.text()}`)
  const d = (await r.json()) as {
    data?: { user?: { open_id: string; display_name: string; video_count: number } }
    error?: { code: string; message: string }
  }
  if (d.error && d.error.code !== 'ok') throw new Error(`${d.error.code}: ${d.error.message}`)
  const u = d.data?.user
  if (!u) throw new Error('perfil veio vazio')
  // video_count conta SÓ vídeo público — vídeo restrito não entra.
  return { externalId: u.open_id, handle: u.display_name, videoCount: u.video_count }
}

export type Post = { externalId: string; publicadoEm: Date; permalink?: string }

/** Vídeos com data >= `desde`. Cursor em MILISSEGUNDOS; create_time em SEGUNDOS. */
export async function videosDesde(token: string, desde: Date, tetoPaginas = 30) {
  const posts: Post[] = []
  let cursor: number | undefined
  let temMais = true

  for (let pagina = 0; pagina < tetoPaginas && temMais; pagina++) {
    const r = await fetch(`${API}/video/list/?fields=id,create_time,share_url`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }),
    })
    if (!r.ok) throw new Error(`vídeos falharam: ${r.status} ${await r.text()}`)
    const d = (await r.json()) as {
      data?: {
        videos?: { id: string; create_time: number; share_url?: string }[]
        cursor?: number
        has_more?: boolean
      }
      error?: { code: string; message: string }
    }
    if (d.error && d.error.code !== 'ok') throw new Error(`${d.error.code}: ${d.error.message}`)

    let passouDaJanela = false
    for (const v of d.data?.videos ?? []) {
      const quando = new Date(v.create_time * 1000)
      if (quando < desde) {
        passouDaJanela = true
        break
      }
      posts.push({ externalId: v.id, publicadoEm: quando, permalink: v.share_url })
    }

    if (passouDaJanela) break
    temMais = !!d.data?.has_more
    cursor = d.data?.cursor
  }

  return posts
}
