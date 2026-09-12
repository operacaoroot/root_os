# ADR-006 · O núcleo permanece fechado no V1

- **Data:** 20/08/2026
- **Situação:** aceita
- **Origem:** transcrita de `Obsidian/Root/20-empresa/root-os/HANDOFF-DEV/03-ARQUITETURA.md`
  (versão 1.0 · 20/08/2026), seção "6. Registros de decisão". O vault é somente leitura;
  esta cópia no repositório existe para que a decisão viaje junto com o código.

## Contexto

A esteira comercial prevê um repositório aberto como degrau 0.

## Decisão

A decisão de abrir foi **adiada para depois do V1**.

O motivo é de sequência, não de princípio: separar núcleo aberto de proprietário antes de o núcleo
existir custa desenho que ainda vai mudar.

## Consequências

A contrapartida é conhecida — abrir depois é mais caro que abrir desde o início.

**Mitigação:** o kernel nasce em pacotes próprios, sem dependência dos módulos de produto interno.
Isso preserva a fronteira sem pagar o custo de mantê-la pública agora.
