import { createHash, randomBytes, randomInt } from 'node:crypto';

import { TOTEM_ALFABETO_CROCKFORD } from '@mktos/shared';

/*
 * Os segredos do Totem: o token do aparelho (32 bytes) e os códigos curtos
 * (ativação, etiqueta, cupom) em base32 de Crockford. Só o hash do token e do
 * código de ativação vai para o banco. Código de etiqueta e de cupom é gravado
 * em claro porque é impresso e lido por gente; o que o protege é ser aleatório.
 */

/**
 * SHA-256 em hex. Código curto entra já normalizado (`totemNormalizarCodigo`,
 * que os schemas de `@mktos/shared` aplicam), senão "abc-123" e "ABC123" teriam
 * hashes diferentes.
 */
export function hashToken(valor: string): string {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

/** `n` caracteres de base32 Crockford, sorteados com `crypto.randomInt`. */
export function gerarCodigo(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 64) throw new RangeError(`tamanho de código inválido: ${n}`);
  let codigo = '';
  for (let i = 0; i < n; i += 1) codigo += TOTEM_ALFABETO_CROCKFORD[randomInt(TOTEM_ALFABETO_CROCKFORD.length)];
  return codigo;
}

/** 32 bytes aleatórios em base64url sem preenchimento: 43 caracteres. */
export function gerarToken(): string {
  return randomBytes(32).toString('base64url');
}
