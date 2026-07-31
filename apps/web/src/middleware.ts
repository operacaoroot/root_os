import { NextRequest, NextResponse } from 'next/server';

export const COOKIE_VISITANTE = 'rid';
const UM_ANO = 400 * 86_400; // teto que Chrome e Safari respeitam

const BIO_HOST = process.env.BIO_HOST ?? 'bio.operacaoroot.com';

/**
 * Duas funções, ambas exclusivas da superfície pública da bio:
 *
 * 1. Domínio próprio → rotas limpas. Quem chega por bio.operacaoroot.com/@fulano
 *    é reescrito pra /b/fulano sem que a URL mude na barra do navegador.
 *
 * 2. Cookie do visitante gravado AQUI, por header HTTP — nunca por JS.
 *    O ITP do Safari corta cookie escrito por document.cookie em 7 dias, e em 24
 *    HORAS quando a pessoa chega com query string vinda de rede social. É
 *    exatamente o nosso caso (clique no anúncio → /@handle?fbclid=...), e tráfego
 *    de link na bio é quase todo mobile. Cookie de header first-party não tem teto.
 *
 * O painel autenticado não passa por aqui: só age no host da bio ou em /b/*.
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get('host')?.split(':')[0] ?? '';
  const noHostDaBio = host === BIO_HOST;
  const { pathname } = req.nextUrl;

  if (!noHostDaBio && !pathname.startsWith('/b')) return NextResponse.next();

  let destino: URL | null = null;
  if (noHostDaBio && !pathname.startsWith('/b') && !pathname.startsWith('/api')) {
    const limpo = decodeURIComponent(pathname).replace(/^\/@?/, '').replace(/\/+$/, '');
    // /r/:id continua funcionando (URL antiga do root-bio, já circulando por aí).
    destino = new URL(
      pathname.startsWith('/r/') ? `/api/bio${pathname}` : limpo ? `/b/${limpo}` : '/b',
      req.url,
    );
    destino.search = req.nextUrl.search;
  }

  const existente = req.cookies.get(COOKIE_VISITANTE)?.value;
  const rid = existente ?? crypto.randomUUID();

  // Visível já nesta requisição, não só na próxima.
  req.cookies.set(COOKIE_VISITANTE, rid);
  const headers = new Headers(req.headers);
  const res = destino
    ? NextResponse.rewrite(destino, { request: { headers } })
    : NextResponse.next({ request: { headers } });

  if (!existente) {
    res.cookies.set(COOKIE_VISITANTE, rid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // sobrevive à navegação vinda de Instagram/TikTok
      path: '/',
      maxAge: UM_ANO,
    });
  }

  res.headers.set('x-rid', rid);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
