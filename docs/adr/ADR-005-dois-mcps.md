# ADR-005 · Dois MCPs distintos

- **Data:** 17/08/2026
- **Situação:** aceita, herdada
- **Origem:** transcrita de `Obsidian/Root/20-empresa/root-os/HANDOFF-DEV/03-ARQUITETURA.md`
  (versão 1.0 · 20/08/2026), seção "6. Registros de decisão". O vault é somente leitura;
  esta cópia no repositório existe para que a decisão viaje junto com o código.

## Contexto

A separação existe porque leitura e ação têm perfis de risco diferentes e merecem superfícies
diferentes.

## Decisão

`postgres-mcp` em modo `restricted` para leitura de banco, e o MCP próprio, tipado com Zod, para as
ações. Nunca `@modelcontextprotocol/server-postgres`, descontinuado e com histórico de SQL
injection.

## Consequências

A proibição de `@modelcontextprotocol/server-postgres` também consta de
`HANDOFF-DEV/02-CONSTRAINTS.md`, que prevalece sobre qualquer decisão de implementação. O MCP
próprio deste repositório é `packages/mcp` (ver `docs/MCP_TOOLS.md`).
