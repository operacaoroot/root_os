# ADR-012 · O caso piloto do produto é a ProMedical

- **Data:** 16/09/2026
- **Situação:** **aceita** em 17/09/2026 — o Pedro decidiu seguir a recomendação ("siga conforme as boas práticas e sua recomendação"). Proposta em 16/09 (etapa P0 de `docs/PLANO-PRODUTO.md`)
- **Origem da pergunta:** o plano de produto exige *um trabalho já validado* como caso de partida;
  o Codex, na sessão "Simplifique a ferramenta e o onboard" (16/09), pôs "selecionar o caso" como a
  primeira etapa de qualquer entrega.

## Contexto

Três clientes têm o mesmo esqueleto construído à mão fora do repositório — ProMedical (Protheus /
SQL Server), Dispropan (WinThor / Oracle) e Custeio (Senior Sapiens, × N clientes). O produto precisa
nascer sobre UM deles, com entradas, prompt e resultado esperado já conhecidos, para que cada etapa
seja medida contra um padrão-ouro e não contra uma intenção.

## Decisão

**A ProMedical.** Três razões: é o único contrato fechado (R$ 12.000, 28/08/2026); tem VPS própria e
a decisão de 11/09 por instância única já tomada; e o kit (`~/dev/promedical-os/`, vault
`10-clientes/promedical/`) tem descoberta feita, três consultas escritas, volumes medidos
(SD2 445.690 · SA1 35.352 · SB1 8.351) e a conferência contra o relatório do sócio como portão.

Os prompts e o material atuais ficam preservados como referência: são o padrão contra o qual se mede.

## Consequências

- O portão da etapa A6 é numérico e já está escrito: as 445.690 linhas em ≤ 120 s, e o número
  conferindo contra o relatório que o sócio já confia.
- A Custeio entra depois, como segundo caso — e é ela que prova "cliente novo = um adaptador + um
  dicionário", porque muda o ERP e o número de clientes.
- A Dispropan continua como caso provado de método, sem fatia própria.
