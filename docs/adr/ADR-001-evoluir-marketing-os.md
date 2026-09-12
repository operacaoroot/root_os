# ADR-001 · Evoluir o `marketing-os` em vez de abrir repositório novo

- **Data:** 20/08/2026
- **Situação:** aceita
- **Origem:** transcrita de `Obsidian/Root/20-empresa/root-os/HANDOFF-DEV/03-ARQUITETURA.md`
  (versão 1.0 · 20/08/2026), seção "6. Registros de decisão". O vault é somente leitura;
  esta cópia no repositório existe para que a decisão viaje junto com o código.
- **Nota editorial (fora da transcrição):** o "34 ferramentas MCP" do Contexto é o número de
  20/08/2026 e fica como está — ADR é registro datado, não inventário vivo. O servidor cresceu
  desde então; a contagem de hoje está em [docs/MCP_TOOLS.md](../MCP_TOOLS.md) (35, contável por
  `grep -c 'registerTool(' packages/mcp/src/server.ts`). A decisão não muda com o número.

## Contexto

O ROOT OS precisa de um kernel de governança que não existe. A dúvida era construí-lo num
repositório limpo ou dentro do monorepo que já roda.

A base existente entrega mais do que parecia: 45 dos 58 modelos já carregam `orgId`, o
`ApprovalGuard` já casa aprovação humana com o corpo exato da mudança, e há 34 ferramentas MCP
funcionando contra a API. Repositório novo exigiria reescrever conector, autenticação, aprovação e
deploy que já estão em produção.

## Decisão

Evoluir o `marketing-os`.

## Consequências

**Consequência que precisa ser administrada:** o repositório carrega módulos de produto interno da
ROOT — `bio`, `pauta`, `central`, `finance`, `work` — que não fazem parte do que o cliente compra.
Isso é resolvido pelo [ADR-002](ADR-002-modulos-habilitaveis-por-tenant.md), não por separação de
repositórios.
