# ADR-007 · A régua nasce completa, a configuração é que limita

- **Data:** 20/08/2026
- **Situação:** aceita
- **Origem:** transcrita de `Obsidian/Root/20-empresa/root-os/HANDOFF-DEV/03-ARQUITETURA.md`
  (versão 1.0 · 20/08/2026), seção "6. Registros de decisão". O vault é somente leitura;
  esta cópia no repositório existe para que a decisão viaje junto com o código.

## Contexto

O degrau 1 vende apenas R0 e R1 — o sistema vê e rascunha, não age. A tentação seria construir só
isso.

## Decisão

O Policy Engine e o gateway nascem cobrindo R0 a R5 desde o V1; o que muda por degrau é a
**configuração padrão** do tenant.

## Consequências

Construir metade da régua produziria retrabalho no ponto mais sensível do sistema, e a régua é o
desenho da oferta inteira.
