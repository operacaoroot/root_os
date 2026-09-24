import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/* ==========================================================================
 * O CONVITE — o link público, sem login, que escreve na carga guiada
 * ==========================================================================
 *
 * Decisão de 23/09: o formulário do cliente é um link único no WhatsApp,
 * aberto no celular, sem senha. O que segura isso:
 *
 *   · o TOKEN nunca vai ao banco — só o sha256 dele (`tokenHash`). Quem lê a
 *     tabela não consegue montar o link de ninguém;
 *   · VALIDADE de 14 dias, REVOGÁVEL na bancada, e `concluidoEm` fecha a porta
 *     para escrita depois que o cliente terminou;
 *   · o token tem 32 bytes de entropia (256 bits) em base64url: não se adivinha,
 *     e cabe numa mensagem de WhatsApp sem quebrar;
 *   · a rota anônima responde a MESMA coisa para token inexistente, expirado e
 *     revogado (404 sem detalhe) — ver o controller. Distinguir contaria a
 *     quem sondasse que um convite existiu.
 *
 * O RELÓGIO (decisão 10): 3 dias sem concluir → lembrete automático; 5 dias →
 * o sócio cobra pessoalmente. Os dois números moram aqui e em nenhum outro
 * lugar.
 */

export const VALIDADE_DIAS = 14;
export const LEMBRETE_DIAS = 3;
export const COBRANCA_PESSOAL_DIAS = 5;

const DIA_MS = 86_400_000;

export interface TokenGerado {
  /** Vai na URL. Some depois de mostrado uma vez. */
  token: string;
  /** Vai no banco. */
  hash: string;
}

export function gerarToken(): TokenGerado {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashDoToken(token) };
}

export function hashDoToken(token: string): string {
  return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

/** Formato do token como a rota o aceita. Fora disto, nem consulta o banco. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{40,48}$/;

export function tokenBemFormado(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function validoAte(agora: Date = new Date()): Date {
  return new Date(agora.getTime() + VALIDADE_DIAS * DIA_MS);
}

export interface ConviteParaEstado {
  validoAte: Date;
  revogadoEm: Date | null;
  concluidoEm: Date | null;
}

export type EstadoDoConvite = 'ativo' | 'concluido' | 'expirado' | 'revogado';

/**
 * A ordem importa: revogado ganha de tudo (é decisão de gente), concluído ganha
 * de expirado (o cliente terminou a tempo; o prazo depois não o reabre).
 */
export function estadoDoConvite(c: ConviteParaEstado, agora: Date = new Date()): EstadoDoConvite {
  if (c.revogadoEm) return 'revogado';
  if (c.concluidoEm) return 'concluido';
  if (c.validoAte.getTime() <= agora.getTime()) return 'expirado';
  return 'ativo';
}

/** O convite aceita ESCRITA? Só ativo. Leitura de concluído é permitida (o retrato). */
export function aceitaEscrita(c: ConviteParaEstado, agora: Date = new Date()): boolean {
  return estadoDoConvite(c, agora) === 'ativo';
}

export function linkDoConvite(baseUrl: string, token: string): string {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  return `${base}/e/${token}`;
}

/** Dias inteiros desde uma data, para o relógio. */
export function diasDesde(desde: Date, agora: Date = new Date()): number {
  return Math.floor((agora.getTime() - desde.getTime()) / DIA_MS);
}

// ---------------------------------------------------------------------------
// O token cifrado — para o lembrete de 3 dias mandar O MESMO link
// ---------------------------------------------------------------------------
//
// O hash acha o convite; o token cifrado permite ao OS reescrever a mensagem
// de lembrete com o link que o cliente já tem ("o link é o mesmo"). AES-256-GCM
// com a chave derivada de `ENCRYPTION_KEY` e o id do convite como dado
// associado: linha copiada para outro convite não abre. Sem chave no ambiente,
// o token não é guardado e o lembrete pede um link novo — degrada, não quebra.


function chaveDerivada(segredo: string): Buffer {
  return createHash('sha256').update(`onboarding-convite:${segredo}`, 'utf8').digest();
}

export function cifrarToken(token: string, segredo: string, conviteId: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chaveDerivada(segredo), iv);
  cifra.setAAD(Buffer.from(conviteId, 'utf8'));
  const corpo = Buffer.concat([cifra.update(token, 'utf8'), cifra.final()]);
  const tag = cifra.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${corpo.toString('base64url')}`;
}

export function decifrarToken(cifrado: string, segredo: string, conviteId: string): string | null {
  try {
    const [v, iv, tag, corpo] = String(cifrado ?? '').split('.');
    if (v !== 'v1' || !iv || !tag || !corpo) return null;
    const decifra = createDecipheriv('aes-256-gcm', chaveDerivada(segredo), Buffer.from(iv, 'base64url'));
    decifra.setAAD(Buffer.from(conviteId, 'utf8'));
    decifra.setAuthTag(Buffer.from(tag, 'base64url'));
    const texto = Buffer.concat([decifra.update(Buffer.from(corpo, 'base64url')), decifra.final()]).toString('utf8');
    return tokenBemFormado(texto) ? texto : null;
  } catch {
    return null;
  }
}
