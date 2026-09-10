# ADR-004 · O Tool Gateway é a única porta

- **Data:** 20/08/2026
- **Situação:** aceita
- **Origem:** transcrita de `Obsidian/Root/20-empresa/root-os/HANDOFF-DEV/03-ARQUITETURA.md`
  (versão 1.0 · 20/08/2026), seção "6. Registros de decisão". O vault é somente leitura;
  esta cópia no repositório existe para que a decisão viaje junto com o código.

## Contexto

A alternativa — cada módulo aplicando a própria regra — foi descartada porque a política precisa
ser consultável e auditável num lugar só. Regra distribuída é regra que diverge.

## Decisão

Nenhum agente chama conector, API externa ou banco diretamente. Toda ação com efeito passa pelo
gateway, que valida, classifica, aplica escopo e limite, registra e então decide.

## Consequências

**Como isso é garantido:** por teste de arquitetura que falha quando um módulo importa conector ou
cliente externo fora do gateway. Sem esse teste, a regra vira intenção.
