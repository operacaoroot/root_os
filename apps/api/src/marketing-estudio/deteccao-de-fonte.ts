import { BadRequestException } from '@nestjs/common';
import { buscarPaginaPublica, lerCorpoComTeto } from '../pauta/pagina-publica';

/*
 * Marketing › Ideias › FONTES (26/10/2026): do link colado ao cadastro da fonte da Pauta
 * (PautaFonte), como o "Adicionar" do ROOT Estúdio (lib/sources/detect.mjs).
 *  · instagram.com/<perfil> e tiktok.com/@perfil → tipo perfil (coleta pelo Apify, paga);
 *  · YouTube (@canal, /channel/UC…, /c/…) → o feed grátis videos.xml?channel_id=…;
 *  · site → o feed RSS anunciado na página (<link rel="alternate">), ou o próprio link se já é feed.
 * Só lê páginas públicas, pela busca que confere o destino (nada de endereço interno).
 */

export interface FonteDetectada {
  tipo: 'rss' | 'perfil';
  nome: string;
  url: string | null;
  handle: string | null;
  plataforma: string | null;
}

const RESERVADOS = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts']);

async function ler(url: string): Promise<{ texto: string; tipo: string; final: string }> {
  const r = await buscarPaginaPublica(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; RootOS/1.0)', cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new BadRequestException(`O link respondeu ${r.status}. Confira se está certo e é público.`);
  // A página de um canal do YouTube passa dos 2 MB do teto padrão: aqui o teto é 8 MB.
  try {
    return { texto: await lerCorpoComTeto(r, 8 * 1024 * 1024), tipo: r.headers.get('content-type') ?? '', final: url };
  } catch {
    throw new BadRequestException('A página é grande demais para ler. Cole o link do feed RSS direto.');
  }
}

const pareceFeed = (texto: string, tipo: string) => /xml|rss|atom/i.test(tipo) || /^\s*<\?xml[\s\S]{0,400}<(rss|feed)\b/i.test(texto) || /^\s*<(rss|feed)\b/i.test(texto);
const tituloDoFeed = (texto: string) => (/<title[^>]*>(?:<!\[CDATA\[)?([^<\]]+)/i.exec(texto)?.[1] ?? '').trim();

export async function detectarFonte(bruto: string, nome?: string): Promise<FonteDetectada> {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(bruto.trim()) ? bruto.trim() : `https://${bruto.trim()}`);
  } catch {
    throw new BadRequestException('Isso não parece um link. Cole o endereço completo.');
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const partes = u.pathname.split('/').filter(Boolean);

  if (/(^|\.)instagram\.com$/.test(host)) {
    const h = partes[0];
    if (!h || RESERVADOS.has(h.toLowerCase())) throw new BadRequestException('Cole o link do perfil do Instagram (instagram.com/perfil), não de um post.');
    return { tipo: 'perfil', plataforma: 'instagram', handle: h.replace(/^@/, ''), url: null, nome: nome || `@${h.replace(/^@/, '')}` };
  }
  if (/(^|\.)tiktok\.com$/.test(host)) {
    const h = partes.find((p) => p.startsWith('@'));
    if (!h) throw new BadRequestException('Cole o link do perfil do TikTok (tiktok.com/@perfil).');
    return { tipo: 'perfil', plataforma: 'tiktok', handle: h.slice(1), url: null, nome: nome || h };
  }
  if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') {
    let canal = u.searchParams.get('channel_id') || (partes[0] === 'channel' ? partes[1] : '');
    if (!canal) {
      const pagina = await ler(u.href);
      canal = /"channelId":"(UC[\w-]{20,})"/.exec(pagina.texto)?.[1] || /channel_id=(UC[\w-]{20,})/.exec(pagina.texto)?.[1] || /<meta itemprop="identifier" content="(UC[\w-]{20,})"/.exec(pagina.texto)?.[1] || '';
      if (!nome) nome = (/<meta property="og:title" content="([^"]+)"/.exec(pagina.texto)?.[1] ?? '').trim() || undefined;
    }
    if (!/^UC[\w-]{20,}$/.test(canal)) throw new BadRequestException('Não achei o canal do YouTube. Use o link do canal, por exemplo youtube.com/@canal.');
    return { tipo: 'rss', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${canal}`, handle: null, plataforma: 'youtube', nome: nome || `YouTube ${partes[0] ?? canal}` };
  }

  const pagina = await ler(u.href);
  if (pareceFeed(pagina.texto, pagina.tipo)) return { tipo: 'rss', url: u.href, handle: null, plataforma: 'web', nome: nome || tituloDoFeed(pagina.texto) || host };
  const alt = [...pagina.texto.matchAll(/<link[^>]+rel=["']alternate["'][^>]*>/gi)].map((m) => m[0]).find((t) => /application\/(rss|atom)\+xml/i.test(t));
  const href = alt ? /href=["']([^"']+)["']/i.exec(alt)?.[1] : null;
  if (!href) throw new BadRequestException('Esse site não anuncia um feed RSS. Cole o link do feed (muitos sites usam /feed ou /rss).');
  const feed = new URL(href, u.href).href;
  const titulo = (/<title[^>]*>([^<]+)<\/title>/i.exec(pagina.texto)?.[1] ?? '').trim();
  return { tipo: 'rss', url: feed, handle: null, plataforma: 'web', nome: nome || titulo.slice(0, 120) || host };
}
