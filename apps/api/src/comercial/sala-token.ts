import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { SALA_TOKEN_RE, SALA_VALIDADE_DIAS } from '@mktos/shared';

/*
 * O TOKEN DA SALA DO CLIENTE — a parte pura (Lane B, 13/10/2026).
 *
 * A mesma construção do convite do onboarding (`onboarding/trilho/convite.ts`):
 *
 *   · 32 bytes aleatórios em base64url (43 caracteres, casa `SALA_TOKEN_RE`);
 *   · o banco guarda só o sha256 (`tokenHash`): quem lê a tabela não monta o
 *     link de ninguém;
 *   · o token cifrado (AES-256-GCM, chave derivada de `ENCRYPTION_KEY`, o id da
 *     sala como dado associado) existe só para o OS reescrever o MESMO link nas
 *     mensagens M1 a M8. Sem chave no ambiente o token não é guardado e o link
 *     não pode ser reescrito: a mensagem que o pede não é preparada.
 *
 * A chave é derivada com outro prefixo que a do convite: o pacote de uma
 * tabela não abre na outra.
 */

const DIA_MS = 86_400_000;

export interface TokenDaSala {
  token: string;
  hash: string;
}

export function gerarTokenDaSala(): TokenDaSala {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashDoTokenDaSala(token) };
}

export function hashDoTokenDaSala(token: string): string {
  return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

export function tokenDaSalaBemFormado(token: unknown): token is string {
  return typeof token === 'string' && SALA_TOKEN_RE.test(token);
}

export function validadeDaSala(agora: Date = new Date()): Date {
  return new Date(agora.getTime() + SALA_VALIDADE_DIAS * DIA_MS);
}

/** A sala aceita leitura e escrita? Revogada ou vencida respondem o mesmo 404. */
export function salaAtiva(s: { validoAte: Date; revogadoEm: Date | null }, agora: Date = new Date()): boolean {
  return !s.revogadoEm && s.validoAte.getTime() > agora.getTime();
}

export function baseDoLink(): string {
  return (process.env.PUBLIC_BASE_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export function linkDaSala(token: string, base: string = baseDoLink()): string {
  return `${base.replace(/\/+$/, '')}/s/${token}`;
}

/** O slug da sala (`/alicerce` da tela 02): legível, nunca credencial. */
export function slugDaSala(nome: string): string {
  const s = String(nome ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return s || 'sala';
}

function chaveDerivada(segredo: string): Buffer {
  return createHash('sha256').update(`comercial-sala:${segredo}`, 'utf8').digest();
}

export function cifrarTokenDaSala(token: string, segredo: string, salaId: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chaveDerivada(segredo), iv);
  cifra.setAAD(Buffer.from(salaId, 'utf8'));
  const corpo = Buffer.concat([cifra.update(token, 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${corpo.toString('base64url')}`;
}

export function decifrarTokenDaSala(cifrado: string, segredo: string, salaId: string): string | null {
  try {
    const [v, iv, tag, corpo] = String(cifrado ?? '').split('.');
    if (v !== 'v1' || !iv || !tag || !corpo) return null;
    const decifra = createDecipheriv('aes-256-gcm', chaveDerivada(segredo), Buffer.from(iv, 'base64url'));
    decifra.setAAD(Buffer.from(salaId, 'utf8'));
    decifra.setAuthTag(Buffer.from(tag, 'base64url'));
    const texto = Buffer.concat([decifra.update(Buffer.from(corpo, 'base64url')), decifra.final()]).toString('utf8');
    return tokenDaSalaBemFormado(texto) ? texto : null;
  } catch {
    return null;
  }
}

/** A chave de cifra do ambiente, ou `null` (degrada: o link não é reescrito). */
export function segredoDoAmbiente(): string | null {
  const k = process.env.ENCRYPTION_KEY;
  return k && k.trim().length >= 16 ? k.trim() : null;
}
