/*
 * Leitura de variável de ambiente com default de verdade.
 *
 * `process.env.X ?? padrao` NÃO serve aqui, e isso quebrou o motor em
 * produção: o `??` só cai no default para `null` e `undefined`, e o
 * docker-compose entrega STRING VAZIA para toda variável declarada como
 * `${X:-}` e não preenchida. O resultado foi `baseUrl = ''` e um
 * "Failed to parse URL from /chat/completions" — com a chave certa no lugar.
 *
 * Variável ausente e variável vazia significam a mesma coisa: ninguém
 * configurou. É isso que esta função trata.
 */
export function env(nome: string, padrao: string): string {
  const v = process.env[nome];
  return v !== undefined && v.trim() !== '' ? v.trim() : padrao;
}

/** Sem default: devolve string vazia quando ausente OU vazia. */
export function envOpcional(nome: string): string {
  return env(nome, '');
}

export function envNumero(nome: string, padrao: number): number {
  const n = Number(env(nome, String(padrao)));
  return Number.isFinite(n) ? n : padrao;
}
