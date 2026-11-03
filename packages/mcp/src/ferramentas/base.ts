// O que toda ferramenta do MCP compartilha: resposta, erro e as anotações por tipo.
export function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
export function fail(e: unknown) {
  return { content: [{ type: 'text' as const, text: `Erro: ${(e as Error).message}` }], isError: true };
}
export const LE = { readOnlyHint: true, openWorldHint: false };
export const ESCREVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const ESCREVE_IDEMPOTENTE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const DESTROI = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
