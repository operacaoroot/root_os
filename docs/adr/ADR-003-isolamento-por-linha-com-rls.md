# ADR-003 · Isolamento por linha com RLS, não por schema

- **Data:** 20/08/2026
- **Situação:** aceita · **Divergência registrada**
- **Origem:** transcrita de `Obsidian/Root/20-empresa/root-os/HANDOFF-DEV/03-ARQUITETURA.md`
  (versão 1.0 · 20/08/2026), seção "6. Registros de decisão". O vault é somente leitura;
  esta cópia no repositório existe para que a decisão viaje junto com o código.

## Contexto

O diagrama `06-topologia.html`, de 17/08/2026, previa "um schema por cliente no mesmo Postgres". A
base atual implementa isolamento por coluna discriminadora (`orgId`) em 45 modelos.

Migrar para schema por cliente exigiria refazer o modelo de dados inteiro e toda a camada de
acesso, sem ganho proporcional: RLS entrega isolamento no banco com o modelo que já existe, e
schema por cliente cria um problema novo — migração de esquema multiplicada pelo número de tenants.

## Decisão

Isolamento por linha, com RLS ativa e filtro de tenant obrigatório também na consulta vetorial.

## Consequências

**Ação pendente:** atualizar o diagrama `06-topologia.html`, que hoje contradiz esta decisão.
