# A8 · Prova com modelo real pela ponte

Gerado em 2026-10-21T10:58:52.694Z · commit `0a89420` · 2 min · sessão do Claude Code: ok.

Um caso sintético por função (empresas, pessoas, CNPJ e domínios inventados), com o construtor de prompt e o parser REAIS da função, importados de `apps/api/dist`. Chamada pela ponte (`claude -p` da assinatura desta máquina), no modelo do cadastro; Haiku e Sonnet também no modelo de cima. Passou = somando as 3 rodada(s): toda chamada ok, parser aceitou em todas e ao menos 75% dos campos certos contra o esperado do caso. Troca recomendada quando o modelo de cima acerta mais campos E (a diferença é de 10 pontos percentuais ou mais, OU o do cadastro falhou e o de cima passou). Tokens: a ponte devolve só o texto (não medido). Esforço do cadastro: não repassado pela ponte ao `claude -p`. 3 rodada(s) por modelo; tempo somado das rodadas.

## Resultado no modelo do cadastro

| Função | Modelo | Passou | Rodadas boas | Campos certos | Tokens | Tempo | Observação (rodada 1) |
|---|---|---|---|---|---|---|---|
| TR-05 Arquivista do cliente | Haiku 5.5 low | passou | 3/3 | 12/12 | não medido | 56 s | contrato: 02-contrato (0.95) · nota fiscal: 06-financeiro (0.95) · ata de acompanhamento: 05-acompanhamento (0.9) · foto sem texto: _fonte (0.1), à mão |
| TR-11 Arquivista do cliente (segunda leitura) | Sonnet 5.5 low | passou | 3/3 | 9/9 | não medido | 46 s | proposta revisada (versão nova): 01-comercial (0.8) · relatório de entrega com nome genérico: 04-entrega (0.92) · print sem texto: _fonte (0.3), à mão |

## Haiku e Sonnet contra o modelo de cima

| Função | Cadastro | Certos | Passou | De cima | Certos | Passou | Tempo (cad. / cima) | Recomendação |
|---|---|---|---|---|---|---|---|---|
| TR-05 | Haiku 5.5 | 12/12 | sim | Sonnet 5.5 | 12/12 | sim | 56 s / 55 s | manter |
| TR-11 | Sonnet 5.5 | 9/9 | sim | Opus 5.5 | 9/9 | sim | 46 s / 46 s | manter |

## Recomendações de troca (nada foi trocado no cadastro)

Nenhuma: em nenhuma função o modelo de cima ganhou com folga do modelo do cadastro.

## Detalhe por chamada

| Função | Modelo | Rodada | Entrada | Parser | Certos | Tempo | Observação |
|---|---|---|---|---|---|---|---|
| TR-05 | Sonnet 5.5 (acima) | 1 | ata de acompanhamento | aceitou | 1/1 | 4 s | 05-acompanhamento (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 1 | contrato | aceitou | 1/1 | 3 s | 02-contrato (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 1 | foto sem texto | aceitou | 1/1 | 4 s | _fonte (0.1), à mão |
| TR-05 | Sonnet 5.5 (acima) | 1 | nota fiscal | aceitou | 1/1 | 3 s | 06-financeiro (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 2 | ata de acompanhamento | aceitou | 1/1 | 5 s | 05-acompanhamento (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 2 | contrato | aceitou | 1/1 | 5 s | 02-contrato (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 2 | foto sem texto | aceitou | 1/1 | 4 s | _fonte (0.2), à mão |
| TR-05 | Sonnet 5.5 (acima) | 2 | nota fiscal | aceitou | 1/1 | 4 s | 06-financeiro (0.96) |
| TR-05 | Sonnet 5.5 (acima) | 3 | ata de acompanhamento | aceitou | 1/1 | 6 s | 05-acompanhamento (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 3 | contrato | aceitou | 1/1 | 8 s | 02-contrato (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 3 | foto sem texto | aceitou | 1/1 | 5 s | _fonte (0.1), à mão |
| TR-05 | Sonnet 5.5 (acima) | 3 | nota fiscal | aceitou | 1/1 | 5 s | 06-financeiro (0.97) |
| TR-05 | Haiku 5.5 (cadastro) | 1 | ata de acompanhamento | aceitou | 1/1 | 3 s | 05-acompanhamento (0.9) |
| TR-05 | Haiku 5.5 (cadastro) | 1 | contrato | aceitou | 1/1 | 9 s | 02-contrato (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 1 | foto sem texto | aceitou | 1/1 | 3 s | _fonte (0.1), à mão |
| TR-05 | Haiku 5.5 (cadastro) | 1 | nota fiscal | aceitou | 1/1 | 10 s | 06-financeiro (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 2 | ata de acompanhamento | aceitou | 1/1 | 3 s | 05-acompanhamento (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 2 | contrato | aceitou | 1/1 | 4 s | 02-contrato (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 2 | foto sem texto | aceitou | 1/1 | 4 s | _fonte (0.1), à mão |
| TR-05 | Haiku 5.5 (cadastro) | 2 | nota fiscal | aceitou | 1/1 | 3 s | 06-financeiro (0.97) |
| TR-05 | Haiku 5.5 (cadastro) | 3 | ata de acompanhamento | aceitou | 1/1 | 5 s | 05-acompanhamento (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 3 | contrato | aceitou | 1/1 | 4 s | 02-contrato (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 3 | foto sem texto | aceitou | 1/1 | 4 s | _fonte (0.1), à mão |
| TR-05 | Haiku 5.5 (cadastro) | 3 | nota fiscal | aceitou | 1/1 | 4 s | 06-financeiro (0.95) |
| TR-11 | Opus 5.5 (acima) | 1 | print sem texto | aceitou | 1/1 | 13 s | _fonte (0.2), à mão |
| TR-11 | Opus 5.5 (acima) | 1 | proposta revisada (versão nova) | aceitou | 1/1 | 5 s | 01-comercial (0.9) |
| TR-11 | Opus 5.5 (acima) | 1 | relatório de entrega com nome genérico | aceitou | 1/1 | 3 s | 04-entrega (0.9) |
| TR-11 | Opus 5.5 (acima) | 2 | print sem texto | aceitou | 1/1 | 5 s | _fonte (0.2), à mão |
| TR-11 | Opus 5.5 (acima) | 2 | proposta revisada (versão nova) | aceitou | 1/1 | 7 s | 01-comercial (0.9) |
| TR-11 | Opus 5.5 (acima) | 2 | relatório de entrega com nome genérico | aceitou | 1/1 | 3 s | 04-entrega (0.9) |
| TR-11 | Opus 5.5 (acima) | 3 | print sem texto | aceitou | 1/1 | 4 s | _fonte (0.2), à mão |
| TR-11 | Opus 5.5 (acima) | 3 | proposta revisada (versão nova) | aceitou | 1/1 | 4 s | 01-comercial (0.9) |
| TR-11 | Opus 5.5 (acima) | 3 | relatório de entrega com nome genérico | aceitou | 1/1 | 4 s | 04-entrega (0.92) |
| TR-11 | Sonnet 5.5 (cadastro) | 1 | print sem texto | aceitou | 1/1 | 7 s | _fonte (0.3), à mão |
| TR-11 | Sonnet 5.5 (cadastro) | 1 | proposta revisada (versão nova) | aceitou | 1/1 | 4 s | 01-comercial (0.8) |
| TR-11 | Sonnet 5.5 (cadastro) | 1 | relatório de entrega com nome genérico | aceitou | 1/1 | 6 s | 04-entrega (0.92) |
| TR-11 | Sonnet 5.5 (cadastro) | 2 | print sem texto | aceitou | 1/1 | 5 s | _fonte (0.3), à mão |
| TR-11 | Sonnet 5.5 (cadastro) | 2 | proposta revisada (versão nova) | aceitou | 1/1 | 3 s | 01-comercial (0.85) |
| TR-11 | Sonnet 5.5 (cadastro) | 2 | relatório de entrega com nome genérico | aceitou | 1/1 | 4 s | 04-entrega (0.93) |
| TR-11 | Sonnet 5.5 (cadastro) | 3 | print sem texto | aceitou | 1/1 | 8 s | _fonte (0.3), à mão |
| TR-11 | Sonnet 5.5 (cadastro) | 3 | proposta revisada (versão nova) | aceitou | 1/1 | 3 s | 01-comercial (0.8) |
| TR-11 | Sonnet 5.5 (cadastro) | 3 | relatório de entrega com nome genérico | aceitou | 1/1 | 6 s | 04-entrega (0.93) |
