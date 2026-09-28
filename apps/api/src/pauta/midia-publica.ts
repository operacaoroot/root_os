import { createHmac, timingSafeEqual } from 'node:crypto';
import { PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG } from '@mktos/shared';

/*
 * A URL PÚBLICA ASSINADA DA MÍDIA DA PEÇA (MD4).
 *
 * A Graph da Meta baixa a mídia de uma URL pública no momento da chamada, e o
 * MinIO da VPS não é público (nem deve ser). A API serve o arquivo numa rota
 * sem login, e o que autoriza é um token: `base64url(payload).base64url(hmac)`,
 * com o HMAC-SHA256 de `PAUTA_MIDIA_PUBLICA_SEGREDO` sobre o payload já
 * codificado. O payload leva a empresa, a peça, a chave do storage e o
 * vencimento, de no máximo 1 h.
 *
 * A conferência é pura e vem ANTES de qualquer consulta: token malformado,
 * adulterado (outra empresa, outra peça, outra chave), vencido ou com validade
 * acima de 1 h não chega ao banco. A comparação do HMAC é em tempo constante.
 * Quem não passa recebe o mesmo 404 de quem pediu um arquivo que não existe.
 */

export const SEGREDO_MINIMO = 32;
/** O token inteiro: payload com uuid, uuid e chave do storage cabe folgado. */
export const TETO_DO_TOKEN = 1024;
/** Separa o uso desta chave de qualquer outro HMAC que um dia usar o mesmo segredo. */
const DOMINIO = 'mktos:midia-publica:v1:';

export interface MidiaAssinada {
  orgId: string;
  pecaId: string;
  chave: string;
  /** Vencimento, em segundos desde a época. */
  exp: number;
}

/** O segredo configurado, ou nulo (a rota fica desligada). Curto demais é o mesmo que nenhum. */
export function segredoDaMidiaPublica(env: Record<string, string | undefined> = process.env): string | null {
  const s = (env.PAUTA_MIDIA_PUBLICA_SEGREDO ?? '').trim();
  return s.length >= SEGREDO_MINIMO ? s : null;
}

/** A origem das URLs: `PAUTA_MIDIA_PUBLICA_ORIGEM`, senão a da bio (que já leva `/api` à API). */
export function origemDaMidiaPublica(env: Record<string, string | undefined> = process.env): string | null {
  const o = (env.PAUTA_MIDIA_PUBLICA_ORIGEM ?? '').trim() || (env.PUBLIC_BIO_ORIGIN ?? '').trim();
  return o ? o.replace(/\/+$/, '') : null;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function hmac(segredo: string, payload: string): Buffer {
  return createHmac('sha256', segredo).update(DOMINIO).update(payload).digest();
}

/** Os 8 primeiros caracteres do HMAC: o que o RASTRO e o log guardam do token. */
export function rastroDoToken(token: string): string {
  return token.split('.')[1]?.slice(0, 8) ?? '';
}

/**
 * Assina. `exp` em segundos desde a época; `agora` também (padrão: o relógio).
 * Vencido ou acima de 1 h é erro de quem chama, nunca token.
 */
export function assinar(m: MidiaAssinada, segredo: string, agora = Math.floor(Date.now() / 1000)): string {
  if (segredo.length < SEGREDO_MINIMO) throw new Error('Segredo da mídia pública curto demais.');
  if (!Number.isInteger(m.exp) || m.exp <= agora) throw new Error('O vencimento da URL tem de ser no futuro.');
  if (m.exp - agora > PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG) throw new Error('A URL pública vale no máximo 1 h.');
  if (!m.orgId || !m.pecaId || !m.chave) throw new Error('Empresa, peça e chave são obrigatórias.');
  const payload = b64(JSON.stringify({ o: m.orgId, p: m.pecaId, c: m.chave, e: m.exp }));
  return `${payload}.${b64(hmac(segredo, payload))}`;
}

/**
 * Confere o token. Devolve o que ele autoriza, ou nulo — sem dizer por quê: o
 * motivo não sai da função, e a rota responde o mesmo 404 em todos os casos.
 */
export function conferir(token: string, segredo: string | null, agora = Math.floor(Date.now() / 1000)): MidiaAssinada | null {
  if (!segredo || typeof token !== 'string' || token.length > TETO_DO_TOKEN) return null;
  const partes = token.split('.');
  if (partes.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(partes[0]) || !/^[A-Za-z0-9_-]{43}$/.test(partes[1])) return null;
  const recebido = Buffer.from(partes[1], 'base64url');
  const esperado = hmac(segredo, partes[0]);
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null;
  let p: unknown;
  try {
    p = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object') return null;
  const { o, p: peca, c, e } = p as Record<string, unknown>;
  if (typeof o !== 'string' || typeof peca !== 'string' || typeof c !== 'string' || !Number.isInteger(e)) return null;
  const exp = e as number;
  // Assinado por nós, mas vencido — ou com prazo acima do teto, que só um segredo vazado produziria.
  if (exp <= agora || exp - agora > PAUTA_MIDIA_PUBLICA_VALIDADE_MAXIMA_SEG) return null;
  if (!o || !peca || !c) return null;
  return { orgId: o, pecaId: peca, chave: c, exp };
}
