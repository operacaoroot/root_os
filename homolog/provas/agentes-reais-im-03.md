# A8 · Prova com modelo real pela ponte

Gerado em 2026-10-22T01:01:56.266Z · commit `2e46b874` · 0 min · sessão do Claude Code: ok.

Um caso sintético por função (empresas, pessoas, CNPJ e domínios inventados), com o construtor de prompt e o parser REAIS da função, importados de `apps/api/dist`. Chamada pela ponte (`claude -p` da assinatura desta máquina), no modelo do cadastro; Haiku e Sonnet também no modelo de cima. Passou = somando as 3 rodada(s): toda chamada ok, parser aceitou em todas e ao menos 75% dos campos certos contra o esperado do caso. Troca recomendada quando o modelo de cima acerta mais campos E (a diferença é de 10 pontos percentuais ou mais, OU o do cadastro falhou e o de cima passou). Tokens: a ponte devolve só o texto (não medido). Esforço do cadastro: não repassado pela ponte ao `claude -p`. 3 rodada(s) por modelo; tempo somado das rodadas.

## Resultado no modelo do cadastro

| Função | Modelo | Passou | Rodadas boas | Campos certos | Tokens | Tempo | Observação (rodada 1) |
|---|---|---|---|---|---|---|---|
| IM-03 Roteirista do kickoff | Sonnet 5.5 high | passou | 3/3 | 21/21 | não medido | 20 s | 6 de 6 reescritas; 6 com o contexto do cliente |

## Haiku e Sonnet contra o modelo de cima

| Função | Cadastro | Certos | Passou | De cima | Certos | Passou | Tempo (cad. / cima) | Recomendação |
|---|---|---|---|---|---|---|---|---|
| IM-03 | Sonnet 5.5 | 21/21 | sim | Opus 5.5 | 21/21 | sim | 20 s / 26 s | manter |

## Recomendações de troca (nada foi trocado no cadastro)

Nenhuma: em nenhuma função o modelo de cima ganhou com folga do modelo do cadastro.

## Detalhe por chamada

| Função | Modelo | Rodada | Entrada | Parser | Certos | Tempo | Observação |
|---|---|---|---|---|---|---|---|
| IM-03 | Opus 5.5 (acima) | 1 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 10 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Opus 5.5 (acima) | 2 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 8 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Opus 5.5 (acima) | 3 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 8 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Sonnet 5.5 (cadastro) | 1 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 7 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Sonnet 5.5 (cadastro) | 2 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 6 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Sonnet 5.5 (cadastro) | 3 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 6 s | 6 de 6 reescritas; 6 com o contexto do cliente |
