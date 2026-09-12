# ADR-002 · Módulos habilitáveis por tenant

- **Data:** 20/08/2026
- **Situação:** aceita
- **Origem:** transcrita de `Obsidian/Root/20-empresa/root-os/HANDOFF-DEV/03-ARQUITETURA.md`
  (versão 1.0 · 20/08/2026), seção "6. Registros de decisão". O vault é somente leitura;
  esta cópia no repositório existe para que a decisão viaje junto com o código.

## Contexto

Consequência direta do [ADR-001](ADR-001-evoluir-marketing-os.md). O monorepo carrega módulos de
produto interno da ROOT que não fazem parte do que o cliente compra.

## Decisão

Um registro por tenant declara quais módulos aquele tenant enxerga — em navegação, em roteamento e
em API. O tenant da ROOT tem tudo habilitado; um tenant cliente vê o kernel mais o que contratou.

Módulo desabilitado não aparece no menu e **também não responde na API**. Esconder na interface e
deixar a rota viva é vazamento com fachada.

## Consequências

**Efeito colateral desejado:** esse mesmo mecanismo é o que sustenta o catálogo de agentes do
degrau 2. Um agente comprado é um módulo habilitado.
