import { createHmac, randomBytes } from 'node:crypto';

import { envOpcional } from '../../llm/env';

/*
 * O CPF DO CADASTRO (CONTRATO.md, seção 4).
 *
 * O CPF em claro não é gravado: vai para o banco o HMAC-SHA256 dele com a
 * `TOTEM_CPF_PEPPER`, que reconhece o mesmo CPF num cadastro novo sem permitir
 * voltar aos dígitos. Um SHA-256 puro não serviria: são só 10^9 CPFs válidos,
 * e quem lesse o banco os recalcularia todos numa tarde. A chave fica fora do
 * banco, no ambiente.
 */

/** 32 bytes em hex dão 64 caracteres; abaixo de 32 a chave é fraca demais para segurar o HMAC. */
export const TAMANHO_MINIMO_DO_PEPPER = 32;

/** A chave do HMAC, ou `null` quando falta ou é curta demais (o cadastro responde 503). */
export function lerPepper(): string | null {
  const v = envOpcional('TOTEM_CPF_PEPPER');
  return v.length >= TAMANHO_MINIMO_DO_PEPPER ? v : null;
}

/** HMAC-SHA256 em hex dos 11 dígitos do CPF. */
export function hashDoCpf(pepper: string, cpfDigitos: string): string {
  return createHmac('sha256', pepper).update(cpfDigitos, 'utf8').digest('hex');
}

/**
 * O que entra no lugar do `cpfHash` na anonimização: 64 caracteres hex como o
 * HMAC, mas sorteados, para não casar com o mesmo CPF num cadastro futuro.
 */
export function hashSorteado(): string {
  return randomBytes(32).toString('hex');
}
