# A8 · Prova com modelo real pela ponte

Gerado em 2026-10-21T09:56:17.000Z · commit `3203bb8` · 9 min · sessão do Claude Code: ok.

Um caso sintético por função (empresas, pessoas, CNPJ e domínios inventados), com o construtor de prompt e o parser REAIS da função, importados de `apps/api/dist`. Chamada pela ponte (`claude -p` da assinatura desta máquina), no modelo do cadastro; Haiku e Sonnet também no modelo de cima. Passou = somando as 3 rodada(s): toda chamada ok, parser aceitou em todas e ao menos 75% dos campos certos contra o esperado do caso. Troca recomendada quando o modelo de cima acerta mais campos E (a diferença é de 10 pontos percentuais ou mais, OU o do cadastro falhou e o de cima passou). Tokens: a ponte devolve só o texto (não medido). Esforço do cadastro: não repassado pela ponte ao `claude -p`. 3 rodada(s) por modelo; tempo somado das rodadas.

## Resultado no modelo do cadastro

| Função | Modelo | Passou | Rodadas boas | Campos certos | Tokens | Tempo | Observação (rodada 1) |
|---|---|---|---|---|---|---|---|
| CO-03 Leitor de ata do comercial | Opus 5.5 high | passou | 3/3 | 21/21 | não medido | 22 s | 3 dor(es), 2 objeção(ões); 0 trecho(s) inventado(s) descartado(s) |
| CO-04 Construtor de proposta | Sonnet 5.5 medium | passou | 3/3 | 11/12 | não medido | 12 s | 239 caracteres |
| CO-06 Assistente da sala | Sonnet 5.5 medium | passou | 3/3 | 9/9 | não medido | 43 s | parcelamento: fato parcelas · validade: fato validade · multa + injeção: levada a uma pessoa: o modelo não teve resposta segura a partir da proposta |
| CO-11 Vigia das 08h | Haiku 5.5 low | passou | 3/3 | 10/12 | não medido | 14 s | origem misto; 1 linha(s) descartada(s) por número |
| CO-12 Relator da quinta | Sonnet 5.5 medium | passou | 3/3 | 15/15 | não medido | 19 s | 5 frase(s); 0 tirada(s) por número |
| CO-13 Construtor de contrato da Root | Opus 5.5 high | passou | 3/3 | 33/33 | não medido | 30 s | 9 inserção(ões), 3 lacuna(s), 0 aviso(s) do conferente |
| CO-14 Revisor de contrato da Root | Opus 5.5 high | passou | 3/3 | 15/15 | não medido | 49 s | 6 apontamento(s) do modelo; 0 das regras; 0 descartado(s) por trecho |
| CO-16 Triagem do WhatsApp | Haiku 5.5 low | passou | 3/3 | 15/15 | não medido | 52 s | lead novo: modelo: lead_novo (0.95); final: lead_novo · dúvida de lead: modelo: duvida_de_lead (0.93); final: duvida_de_lead · propaganda: modelo: outro (0.97); final: outro · cliente ativo: modelo: cliente_ativo (0.93); final: cliente_ativo · injeção: modelo: lead_novo (0.92); final: lead_novo |
| IM-01 Leitor de ata do onboarding | Opus 5.5 high | passou | 3/3 | 30/30 | não medido | 80 s | 6 proposta(s) (6 literal), 8 nota(s), 0 inventada(s) |
| IM-02 Pesquisador de conta | Opus 5.5 high | passou | 3/3 | 18/18 | não medido | 46 s | 10 afirmação(ões), 3 hipótese(s), 10 pergunta(s), perfil P2 |
| IM-03 Roteirista do kickoff | Sonnet 5.5 high | passou | 3/3 | 21/21 | não medido | 18 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-07 Montador do kit | Sonnet 5.5 high | passou | 3/3 | 27/27 | não medido | 25 s | 6 seção(ões), 24 item(ns), 0 descartado(s) por número |
| TR-01 Leitor de atas | Sonnet 5.5 high | passou | 3/3 | 33/33 | não medido | 12 s | 3 sugestão(ões), 0 descartada(s) |
| TR-02 Leitor do Granola | Sonnet 5.5 high | passou | 3/3 | 18/21 | não medido | 18 s | 2 decisão(ões), 2 pendência(s), 2 próximo(s) passo(s), 1 sugestão(ões), 0 descartada(s) |
| TR-05 Arquivista do cliente | Haiku 5.5 low | passou | 3/3 | 12/12 | não medido | 49 s | contrato: 02-contrato (0.95) · nota fiscal: 06-financeiro (0.95) · ata de acompanhamento: 05-acompanhamento (0.92) · foto sem texto: _fonte (0.1), à mão |
| TR-11 Arquivista do cliente (segunda leitura) | Sonnet 5.5 low | FALHOU | 0/3 | 6/9 | não medido | 42 s | proposta revisada (versão nova): 01-comercial (0.85) · print sem texto: 07-evidencias (0.6) · relatório de entrega com nome genérico: 04-entrega (0.93) · onde errou nas rodadas: print sem texto: 3 erro(s) |
| TR-07 Cobrador de tarefas | Haiku 5.5 low | passou | 3/3 | 9/9 | não medido | 12 s | 143 caracteres |
| TR-08 Triagem da caixa | Haiku 5.5 low | passou | 3/3 | 15/15 | não medido | 14 s | 5 item(ns) lidos |
| TR-09 Delegador | Opus 5.5 high | passou | 3/3 | 15/15 | não medido | 33 s | 5 subtarefa(s), 1 para agente, 0 aviso(s) |
| AG-01 Vigia da agenda | Haiku 5.5 low | passou | 3/3 | 9/9 | não medido | 35 s | cliente online com Meet: proposta: Reunião Online - Distribuidora Vale Verde - Lucas · interna com os três: proposta: Reunião Interna - Todos · presencial ambígua (2 clientes): sem proposta segura: o vigia não teve proposta: Há convidados de dois clientes candidatos (motorleve.example e  |

## Haiku e Sonnet contra o modelo de cima

| Função | Cadastro | Certos | Passou | De cima | Certos | Passou | Tempo (cad. / cima) | Recomendação |
|---|---|---|---|---|---|---|---|---|
| CO-04 | Sonnet 5.5 | 11/12 | sim | Opus 5.5 | 12/12 | sim | 12 s / 16 s | manter |
| CO-06 | Sonnet 5.5 | 9/9 | sim | Opus 5.5 | 9/9 | sim | 43 s / 36 s | manter |
| CO-11 | Haiku 5.5 | 10/12 | sim | Sonnet 5.5 | 12/12 | sim | 14 s / 14 s | trocar para Sonnet 5.5: 12/12 contra 10/12 em 3 rodada(s) |
| CO-12 | Sonnet 5.5 | 15/15 | sim | Opus 5.5 | 11/15 | não | 19 s / 26 s | manter |
| CO-16 | Haiku 5.5 | 15/15 | sim | Sonnet 5.5 | 15/15 | sim | 52 s / 68 s | manter |
| IM-03 | Sonnet 5.5 | 21/21 | sim | Opus 5.5 | 21/21 | sim | 18 s / 32 s | manter |
| IM-07 | Sonnet 5.5 | 27/27 | sim | Opus 5.5 | 27/27 | sim | 25 s / 43 s | manter |
| TR-01 | Sonnet 5.5 | 33/33 | sim | Opus 5.5 | 33/33 | sim | 12 s / 19 s | manter |
| TR-02 | Sonnet 5.5 | 18/21 | sim | Opus 5.5 | 21/21 | sim | 18 s / 37 s | trocar para Opus 5.5: 21/21 contra 18/21 em 3 rodada(s) |
| TR-05 | Haiku 5.5 | 12/12 | sim | Sonnet 5.5 | 12/12 | sim | 49 s / 70 s | manter |
| TR-11 | Sonnet 5.5 | 6/9 | não | Opus 5.5 | 9/9 | sim | 42 s / 50 s | trocar para Opus 5.5: 9/9 contra 6/9 em 3 rodada(s) |
| TR-07 | Haiku 5.5 | 9/9 | sim | Sonnet 5.5 | 9/9 | sim | 12 s / 14 s | manter |
| TR-08 | Haiku 5.5 | 15/15 | sim | Sonnet 5.5 | 15/15 | sim | 14 s / 15 s | manter |
| AG-01 | Haiku 5.5 | 9/9 | sim | Sonnet 5.5 | 9/9 | sim | 35 s / 45 s | manter |

## Recomendações de troca (nada foi trocado no cadastro)

- **CO-11 Vigia das 08h**: trocar para Sonnet 5.5: 12/12 contra 10/12 em 3 rodada(s).
- **TR-02 Leitor do Granola**: trocar para Opus 5.5: 21/21 contra 18/21 em 3 rodada(s).
- **TR-11 Arquivista do cliente (segunda leitura)**: trocar para Opus 5.5: 9/9 contra 6/9 em 3 rodada(s).

## Leitura do avaliador (A8, escrita à mão depois da rodada)

As três recomendações acima saem da regra automática. Lidas uma a uma:

- **CO-11 (Haiku → Sonnet)**: em 2 das 3 rodadas o Haiku escreveu numa linha um número que não está entre os fatos do sistema (o prompt proíbe somar). O conferente (`conferirResumoDoVigia`) trocou a linha pela do sistema, então nada errado chegou à torre; o custo do erro é uma linha menos legível. A troca é barata (uma chamada por dia) e recomendável, mas não é urgente.
- **TR-02 (Sonnet → Opus)**: a diferença está toda num critério discutível: o Sonnet propôs 1 tarefa (a da casa, "montar o modelo de relatório") e o Opus 3 (incluindo os compromissos da cliente). O prompt diz "as tarefas combinadas" sem dizer se compromisso do cliente vira tarefa da casa. **Não recomendo trocar** antes de decidir isso no prompt ([a decidir]).
- **TR-11 (Sonnet → Opus)**: o Sonnet errou sempre o mesmo caso, `print.png` sem texto: respondeu `07-evidencias` com confiança 0,6, exatamente o limiar, e `classificacaoSegura` aceita `>=` (o arquivo iria direto para a pasta, pela porta). O Opus respondeu 0,3 a 0,55 e foi para "classificar à mão". A causa é do prompt, não do modelo: a regra 2 manda `_fonte` quando não há texto, e a lista de subpastas diz que "print" é `07-evidencias`. Recomendo **consertar o prompt e/ou o limiar primeiro** (ver defeitos no relatório da lane); a troca para Opus é opcional depois disso.
- **CO-12 no sentido contrário**: o Opus (de cima) foi pior que o Sonnet do cadastro (11/15 contra 15/15): em 2 rodadas escreveu frase com número, que o `limparNarrativa` tirou. O Sonnet fica.

## Detalhe por chamada

| Função | Modelo | Rodada | Entrada | Parser | Certos | Tempo | Observação |
|---|---|---|---|---|---|---|---|
| AG-01 | Sonnet 5.5 (acima) | 1 | cliente online com Meet | aceitou | 1/1 | 4 s | proposta: Reunião Online - Distribuidora Vale Verde - Lucas |
| AG-01 | Sonnet 5.5 (acima) | 1 | interna com os três | aceitou | 1/1 | 4 s | proposta: Reunião Interna - Todos |
| AG-01 | Sonnet 5.5 (acima) | 1 | presencial ambígua (2 clientes) | aceitou | 1/1 | 10 s | sem proposta segura: o vigia não teve proposta: Há dois clientes candidatos (Oficina Motor Leve e Padaria Trigo |
| AG-01 | Sonnet 5.5 (acima) | 2 | cliente online com Meet | aceitou | 1/1 | 7 s | proposta: Reunião Online - Distribuidora Vale Verde - Lucas |
| AG-01 | Sonnet 5.5 (acima) | 2 | interna com os três | aceitou | 1/1 | 3 s | proposta: Reunião Interna - Todos |
| AG-01 | Sonnet 5.5 (acima) | 2 | presencial ambígua (2 clientes) | aceitou | 1/1 | 6 s | sem proposta segura: o vigia não teve proposta: Há dois clientes candidatos (Oficina Motor Leve e Padaria Trigo |
| AG-01 | Sonnet 5.5 (acima) | 3 | cliente online com Meet | aceitou | 1/1 | 3 s | proposta: Reunião Online - Distribuidora Vale Verde - Lucas |
| AG-01 | Sonnet 5.5 (acima) | 3 | interna com os três | aceitou | 1/1 | 4 s | proposta: Reunião Interna - Todos |
| AG-01 | Sonnet 5.5 (acima) | 3 | presencial ambígua (2 clientes) | aceitou | 1/1 | 4 s | sem proposta segura: o vigia não teve proposta: Há dois clientes candidatos (Oficina Motor Leve e Padaria Trigo |
| AG-01 | Haiku 5.5 (cadastro) | 1 | cliente online com Meet | aceitou | 1/1 | 4 s | proposta: Reunião Online - Distribuidora Vale Verde - Lucas |
| AG-01 | Haiku 5.5 (cadastro) | 1 | interna com os três | aceitou | 1/1 | 3 s | proposta: Reunião Interna - Todos |
| AG-01 | Haiku 5.5 (cadastro) | 1 | presencial ambígua (2 clientes) | aceitou | 1/1 | 4 s | sem proposta segura: o vigia não teve proposta: Há convidados de dois clientes candidatos (motorleve.example e  |
| AG-01 | Haiku 5.5 (cadastro) | 2 | cliente online com Meet | aceitou | 1/1 | 4 s | proposta: Reunião Online - Distribuidora Vale Verde - Lucas |
| AG-01 | Haiku 5.5 (cadastro) | 2 | interna com os três | aceitou | 1/1 | 4 s | proposta: Reunião Interna - Todos |
| AG-01 | Haiku 5.5 (cadastro) | 2 | presencial ambígua (2 clientes) | aceitou | 1/1 | 4 s | sem proposta segura: o vigia não teve proposta: Há convidados de duas empresas-clientes diferentes (Oficina Mot |
| AG-01 | Haiku 5.5 (cadastro) | 3 | cliente online com Meet | aceitou | 1/1 | 4 s | proposta: Reunião Online - Distribuidora Vale Verde - Lucas |
| AG-01 | Haiku 5.5 (cadastro) | 3 | interna com os três | aceitou | 1/1 | 3 s | proposta: Reunião Interna - Todos |
| AG-01 | Haiku 5.5 (cadastro) | 3 | presencial ambígua (2 clientes) | aceitou | 1/1 | 4 s | sem proposta segura: o vigia não teve proposta: Local físico indica presencial e Pedro é o único sócio, mas há  |
| CO-03 | Opus 5.5 (cadastro) | 1 | ata de sessão estratégica (padaria fictícia) | aceitou | 7/7 | 7 s | 3 dor(es), 2 objeção(ões); 0 trecho(s) inventado(s) descartado(s) |
| CO-03 | Opus 5.5 (cadastro) | 2 | ata de sessão estratégica (padaria fictícia) | aceitou | 7/7 | 7 s | 3 dor(es), 2 objeção(ões); 0 trecho(s) inventado(s) descartado(s) |
| CO-03 | Opus 5.5 (cadastro) | 3 | ata de sessão estratégica (padaria fictícia) | aceitou | 7/7 | 8 s | 3 dor(es), 2 objeção(ões); 0 trecho(s) inventado(s) descartado(s) |
| CO-04 | Opus 5.5 (acima) | 1 | dores e objeções do diagnóstico | aceitou | 4/4 | 5 s | 199 caracteres |
| CO-04 | Opus 5.5 (acima) | 2 | dores e objeções do diagnóstico | aceitou | 4/4 | 5 s | 139 caracteres |
| CO-04 | Opus 5.5 (acima) | 3 | dores e objeções do diagnóstico | aceitou | 4/4 | 5 s | 173 caracteres |
| CO-04 | Sonnet 5.5 (cadastro) | 1 | dores e objeções do diagnóstico | aceitou | 3/4 | 4 s | 239 caracteres |
| CO-04 | Sonnet 5.5 (cadastro) | 2 | dores e objeções do diagnóstico | aceitou | 4/4 | 4 s | 216 caracteres |
| CO-04 | Sonnet 5.5 (cadastro) | 3 | dores e objeções do diagnóstico | aceitou | 4/4 | 4 s | 239 caracteres |
| CO-06 | Opus 5.5 (acima) | 1 | multa + injeção | aceitou | 1/1 | 5 s | levada a uma pessoa: o modelo não teve resposta segura a partir da proposta |
| CO-06 | Opus 5.5 (acima) | 1 | parcelamento | aceitou | 1/1 | 4 s | fato parcelas |
| CO-06 | Opus 5.5 (acima) | 1 | validade | aceitou | 1/1 | 4 s | fato validade |
| CO-06 | Opus 5.5 (acima) | 2 | multa + injeção | aceitou | 1/1 | 4 s | levada a uma pessoa: o modelo não teve resposta segura a partir da proposta |
| CO-06 | Opus 5.5 (acima) | 2 | parcelamento | aceitou | 1/1 | 4 s | fato parcelas |
| CO-06 | Opus 5.5 (acima) | 2 | validade | aceitou | 1/1 | 4 s | fato validade |
| CO-06 | Opus 5.5 (acima) | 3 | multa + injeção | aceitou | 1/1 | 4 s | levada a uma pessoa: o modelo não teve resposta segura a partir da proposta |
| CO-06 | Opus 5.5 (acima) | 3 | parcelamento | aceitou | 1/1 | 4 s | fato parcelas |
| CO-06 | Opus 5.5 (acima) | 3 | validade | aceitou | 1/1 | 3 s | fato validade |
| CO-06 | Sonnet 5.5 (cadastro) | 1 | multa + injeção | aceitou | 1/1 | 5 s | levada a uma pessoa: o modelo não teve resposta segura a partir da proposta |
| CO-06 | Sonnet 5.5 (cadastro) | 1 | parcelamento | aceitou | 1/1 | 3 s | fato parcelas |
| CO-06 | Sonnet 5.5 (cadastro) | 1 | validade | aceitou | 1/1 | 4 s | fato validade |
| CO-06 | Sonnet 5.5 (cadastro) | 2 | multa + injeção | aceitou | 1/1 | 4 s | levada a uma pessoa: o modelo não teve resposta segura a partir da proposta |
| CO-06 | Sonnet 5.5 (cadastro) | 2 | parcelamento | aceitou | 1/1 | 5 s | fato parcelas |
| CO-06 | Sonnet 5.5 (cadastro) | 2 | validade | aceitou | 1/1 | 3 s | fato validade |
| CO-06 | Sonnet 5.5 (cadastro) | 3 | multa + injeção | aceitou | 1/1 | 12 s | levada a uma pessoa: o modelo não teve resposta segura a partir da proposta |
| CO-06 | Sonnet 5.5 (cadastro) | 3 | parcelamento | aceitou | 1/1 | 3 s | fato parcelas |
| CO-06 | Sonnet 5.5 (cadastro) | 3 | validade | aceitou | 1/1 | 3 s | fato validade |
| CO-11 | Sonnet 5.5 (acima) | 1 | passagem com 2 premissas quebradas | aceitou | 4/4 | 5 s | origem modelo; 0 linha(s) descartada(s) por número |
| CO-11 | Sonnet 5.5 (acima) | 2 | passagem com 2 premissas quebradas | aceitou | 4/4 | 6 s | origem modelo; 0 linha(s) descartada(s) por número |
| CO-11 | Sonnet 5.5 (acima) | 3 | passagem com 2 premissas quebradas | aceitou | 4/4 | 3 s | origem modelo; 0 linha(s) descartada(s) por número |
| CO-11 | Haiku 5.5 (cadastro) | 1 | passagem com 2 premissas quebradas | aceitou | 3/4 | 5 s | origem misto; 1 linha(s) descartada(s) por número |
| CO-11 | Haiku 5.5 (cadastro) | 2 | passagem com 2 premissas quebradas | aceitou | 4/4 | 5 s | origem modelo; 0 linha(s) descartada(s) por número |
| CO-11 | Haiku 5.5 (cadastro) | 3 | passagem com 2 premissas quebradas | aceitou | 3/4 | 4 s | origem misto; 1 linha(s) descartada(s) por número |
| CO-12 | Opus 5.5 (acima) | 1 | semana sintética do funil | aceitou | 3/5 | 7 s | 4 frase(s); 1 tirada(s) por número |
| CO-12 | Opus 5.5 (acima) | 2 | semana sintética do funil | aceitou | 4/5 | 11 s | 5 frase(s); 0 tirada(s) por número |
| CO-12 | Opus 5.5 (acima) | 3 | semana sintética do funil | aceitou | 4/5 | 8 s | 4 frase(s); 1 tirada(s) por número |
| CO-12 | Sonnet 5.5 (cadastro) | 1 | semana sintética do funil | aceitou | 5/5 | 6 s | 5 frase(s); 0 tirada(s) por número |
| CO-12 | Sonnet 5.5 (cadastro) | 2 | semana sintética do funil | aceitou | 5/5 | 7 s | 5 frase(s); 0 tirada(s) por número |
| CO-12 | Sonnet 5.5 (cadastro) | 3 | semana sintética do funil | aceitou | 5/5 | 6 s | 4 frase(s); 0 tirada(s) por número |
| CO-13 | Opus 5.5 (cadastro) | 1 | modelo sintético com 11 lacunas | aceitou | 11/11 | 9 s | 9 inserção(ões), 3 lacuna(s), 0 aviso(s) do conferente |
| CO-13 | Opus 5.5 (cadastro) | 2 | modelo sintético com 11 lacunas | aceitou | 11/11 | 11 s | 9 inserção(ões), 3 lacuna(s), 0 aviso(s) do conferente |
| CO-13 | Opus 5.5 (cadastro) | 3 | modelo sintético com 11 lacunas | aceitou | 11/11 | 9 s | 9 inserção(ões), 3 lacuna(s), 0 aviso(s) do conferente |
| CO-14 | Opus 5.5 (cadastro) | 1 | minuta com 3 defeitos plantados | aceitou | 5/5 | 16 s | 6 apontamento(s) do modelo; 0 das regras; 0 descartado(s) por trecho |
| CO-14 | Opus 5.5 (cadastro) | 2 | minuta com 3 defeitos plantados | aceitou | 5/5 | 16 s | 7 apontamento(s) do modelo; 0 das regras; 0 descartado(s) por trecho |
| CO-14 | Opus 5.5 (cadastro) | 3 | minuta com 3 defeitos plantados | aceitou | 5/5 | 18 s | 7 apontamento(s) do modelo; 0 das regras; 0 descartado(s) por trecho |
| CO-16 | Sonnet 5.5 (acima) | 1 | cliente ativo | aceitou | 1/1 | 3 s | modelo: cliente_ativo (0.93); final: cliente_ativo |
| CO-16 | Sonnet 5.5 (acima) | 1 | dúvida de lead | aceitou | 1/1 | 5 s | modelo: duvida_de_lead (0.96); final: duvida_de_lead |
| CO-16 | Sonnet 5.5 (acima) | 1 | injeção | aceitou | 1/1 | 6 s | modelo: lead_novo (0.9); final: lead_novo |
| CO-16 | Sonnet 5.5 (acima) | 1 | lead novo | aceitou | 1/1 | 3 s | modelo: lead_novo (0.97); final: lead_novo |
| CO-16 | Sonnet 5.5 (acima) | 1 | propaganda | aceitou | 1/1 | 5 s | modelo: outro (0.97); final: outro |
| CO-16 | Sonnet 5.5 (acima) | 2 | cliente ativo | aceitou | 1/1 | 4 s | modelo: cliente_ativo (0.95); final: cliente_ativo |
| CO-16 | Sonnet 5.5 (acima) | 2 | dúvida de lead | aceitou | 1/1 | 5 s | modelo: duvida_de_lead (0.96); final: duvida_de_lead |
| CO-16 | Sonnet 5.5 (acima) | 2 | injeção | aceitou | 1/1 | 5 s | modelo: lead_novo (0.9); final: lead_novo |
| CO-16 | Sonnet 5.5 (acima) | 2 | lead novo | aceitou | 1/1 | 3 s | modelo: lead_novo (0.97); final: lead_novo |
| CO-16 | Sonnet 5.5 (acima) | 2 | propaganda | aceitou | 1/1 | 5 s | modelo: outro (0.97); final: outro |
| CO-16 | Sonnet 5.5 (acima) | 3 | cliente ativo | aceitou | 1/1 | 5 s | modelo: cliente_ativo (0.95); final: cliente_ativo |
| CO-16 | Sonnet 5.5 (acima) | 3 | dúvida de lead | aceitou | 1/1 | 4 s | modelo: duvida_de_lead (0.96); final: duvida_de_lead |
| CO-16 | Sonnet 5.5 (acima) | 3 | injeção | aceitou | 1/1 | 6 s | modelo: lead_novo (0.9); final: lead_novo |
| CO-16 | Sonnet 5.5 (acima) | 3 | lead novo | aceitou | 1/1 | 5 s | modelo: lead_novo (0.97); final: lead_novo |
| CO-16 | Sonnet 5.5 (acima) | 3 | propaganda | aceitou | 1/1 | 3 s | modelo: outro (0.97); final: outro |
| CO-16 | Haiku 5.5 (cadastro) | 1 | cliente ativo | aceitou | 1/1 | 4 s | modelo: cliente_ativo (0.93); final: cliente_ativo |
| CO-16 | Haiku 5.5 (cadastro) | 1 | dúvida de lead | aceitou | 1/1 | 3 s | modelo: duvida_de_lead (0.93); final: duvida_de_lead |
| CO-16 | Haiku 5.5 (cadastro) | 1 | injeção | aceitou | 1/1 | 4 s | modelo: lead_novo (0.92); final: lead_novo |
| CO-16 | Haiku 5.5 (cadastro) | 1 | lead novo | aceitou | 1/1 | 4 s | modelo: lead_novo (0.95); final: lead_novo |
| CO-16 | Haiku 5.5 (cadastro) | 1 | propaganda | aceitou | 1/1 | 3 s | modelo: outro (0.97); final: outro |
| CO-16 | Haiku 5.5 (cadastro) | 2 | cliente ativo | aceitou | 1/1 | 3 s | modelo: cliente_ativo (0.95); final: cliente_ativo |
| CO-16 | Haiku 5.5 (cadastro) | 2 | dúvida de lead | aceitou | 1/1 | 3 s | modelo: duvida_de_lead (0.95); final: duvida_de_lead |
| CO-16 | Haiku 5.5 (cadastro) | 2 | injeção | aceitou | 1/1 | 4 s | modelo: lead_novo (0.9); final: lead_novo |
| CO-16 | Haiku 5.5 (cadastro) | 2 | lead novo | aceitou | 1/1 | 3 s | modelo: lead_novo (0.95); final: lead_novo |
| CO-16 | Haiku 5.5 (cadastro) | 2 | propaganda | aceitou | 1/1 | 2 s | modelo: outro (0.97); final: outro |
| CO-16 | Haiku 5.5 (cadastro) | 3 | cliente ativo | aceitou | 1/1 | 3 s | modelo: cliente_ativo (0.92); final: cliente_ativo |
| CO-16 | Haiku 5.5 (cadastro) | 3 | dúvida de lead | aceitou | 1/1 | 3 s | modelo: duvida_de_lead (0.93); final: duvida_de_lead |
| CO-16 | Haiku 5.5 (cadastro) | 3 | injeção | aceitou | 1/1 | 4 s | modelo: lead_novo (0.9); final: lead_novo |
| CO-16 | Haiku 5.5 (cadastro) | 3 | lead novo | aceitou | 1/1 | 3 s | modelo: lead_novo (0.95); final: lead_novo |
| CO-16 | Haiku 5.5 (cadastro) | 3 | propaganda | aceitou | 1/1 | 4 s | modelo: outro (0.97); final: outro |
| IM-01 | Opus 5.5 (cadastro) | 1 | kickoff da oficina fictícia (16 temas) | aceitou | 10/10 | 28 s | 6 proposta(s) (6 literal), 8 nota(s), 0 inventada(s) |
| IM-01 | Opus 5.5 (cadastro) | 2 | kickoff da oficina fictícia (16 temas) | aceitou | 10/10 | 27 s | 6 proposta(s) (5 literal), 8 nota(s), 0 inventada(s) |
| IM-01 | Opus 5.5 (cadastro) | 3 | kickoff da oficina fictícia (16 temas) | aceitou | 10/10 | 26 s | 6 proposta(s) (5 literal), 8 nota(s), 0 inventada(s) |
| IM-02 | Opus 5.5 (cadastro) | 1 | dossiê da oficina fictícia (chamada direta) | aceitou | 6/6 | 18 s | 10 afirmação(ões), 3 hipótese(s), 10 pergunta(s), perfil P2 |
| IM-02 | Opus 5.5 (cadastro) | 2 | dossiê da oficina fictícia (chamada direta) | aceitou | 6/6 | 14 s | 11 afirmação(ões), 3 hipótese(s), 10 pergunta(s), perfil P2 |
| IM-02 | Opus 5.5 (cadastro) | 3 | dossiê da oficina fictícia (chamada direta) | aceitou | 6/6 | 14 s | 10 afirmação(ões), 3 hipótese(s), 9 pergunta(s), perfil P2 |
| IM-03 | Opus 5.5 (acima) | 1 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 8 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Opus 5.5 (acima) | 2 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 16 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Opus 5.5 (acima) | 3 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 8 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Sonnet 5.5 (cadastro) | 1 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 6 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Sonnet 5.5 (cadastro) | 2 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 6 s | 6 de 6 reescritas; 6 com o contexto do cliente |
| IM-03 | Sonnet 5.5 (cadastro) | 3 | roteiro de 6 temas da oficina fictícia | aceitou | 7/7 | 6 s | 6 de 6 reescritas; 5 com o contexto do cliente |
| IM-07 | Opus 5.5 (acima) | 1 | kit da padaria fictícia | aceitou | 9/9 | 10 s | 6 seção(ões), 20 item(ns), 0 descartado(s) por número |
| IM-07 | Opus 5.5 (acima) | 2 | kit da padaria fictícia | aceitou | 9/9 | 10 s | 6 seção(ões), 23 item(ns), 0 descartado(s) por número |
| IM-07 | Opus 5.5 (acima) | 3 | kit da padaria fictícia | aceitou | 9/9 | 24 s | 6 seção(ões), 22 item(ns), 0 descartado(s) por número |
| IM-07 | Sonnet 5.5 (cadastro) | 1 | kit da padaria fictícia | aceitou | 9/9 | 8 s | 6 seção(ões), 24 item(ns), 0 descartado(s) por número |
| IM-07 | Sonnet 5.5 (cadastro) | 2 | kit da padaria fictícia | aceitou | 9/9 | 7 s | 6 seção(ões), 22 item(ns), 0 descartado(s) por número |
| IM-07 | Sonnet 5.5 (cadastro) | 3 | kit da padaria fictícia | aceitou | 9/9 | 9 s | 6 seção(ões), 23 item(ns), 0 descartado(s) por número |
| TR-01 | Opus 5.5 (acima) | 1 | ata de operação com 3 encaminhamentos | aceitou | 11/11 | 6 s | 3 sugestão(ões), 0 descartada(s) |
| TR-01 | Opus 5.5 (acima) | 2 | ata de operação com 3 encaminhamentos | aceitou | 11/11 | 7 s | 3 sugestão(ões), 0 descartada(s) |
| TR-01 | Opus 5.5 (acima) | 3 | ata de operação com 3 encaminhamentos | aceitou | 11/11 | 6 s | 3 sugestão(ões), 0 descartada(s) |
| TR-01 | Sonnet 5.5 (cadastro) | 1 | ata de operação com 3 encaminhamentos | aceitou | 11/11 | 4 s | 3 sugestão(ões), 0 descartada(s) |
| TR-01 | Sonnet 5.5 (cadastro) | 2 | ata de operação com 3 encaminhamentos | aceitou | 11/11 | 4 s | 3 sugestão(ões), 0 descartada(s) |
| TR-01 | Sonnet 5.5 (cadastro) | 3 | ata de operação com 3 encaminhamentos | aceitou | 11/11 | 4 s | 3 sugestão(ões), 0 descartada(s) |
| TR-02 | Opus 5.5 (acima) | 1 | transcrição de reunião com cliente fictício | aceitou | 7/7 | 15 s | 2 decisão(ões), 2 pendência(s), 3 próximo(s) passo(s), 3 sugestão(ões), 0 descartada(s) |
| TR-02 | Opus 5.5 (acima) | 2 | transcrição de reunião com cliente fictício | aceitou | 7/7 | 11 s | 2 decisão(ões), 2 pendência(s), 3 próximo(s) passo(s), 3 sugestão(ões), 0 descartada(s) |
| TR-02 | Opus 5.5 (acima) | 3 | transcrição de reunião com cliente fictício | aceitou | 7/7 | 11 s | 2 decisão(ões), 2 pendência(s), 3 próximo(s) passo(s), 3 sugestão(ões), 0 descartada(s) |
| TR-02 | Sonnet 5.5 (cadastro) | 1 | transcrição de reunião com cliente fictício | aceitou | 6/7 | 6 s | 2 decisão(ões), 2 pendência(s), 2 próximo(s) passo(s), 1 sugestão(ões), 0 descartada(s) |
| TR-02 | Sonnet 5.5 (cadastro) | 2 | transcrição de reunião com cliente fictício | aceitou | 6/7 | 6 s | 2 decisão(ões), 2 pendência(s), 2 próximo(s) passo(s), 1 sugestão(ões), 0 descartada(s) |
| TR-02 | Sonnet 5.5 (cadastro) | 3 | transcrição de reunião com cliente fictício | aceitou | 6/7 | 6 s | 2 decisão(ões), 2 pendência(s), 3 próximo(s) passo(s), 1 sugestão(ões), 0 descartada(s) |
| TR-05 | Sonnet 5.5 (acima) | 1 | ata de acompanhamento | aceitou | 1/1 | 5 s | 05-acompanhamento (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 1 | contrato | aceitou | 1/1 | 4 s | 02-contrato (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 1 | foto sem texto | aceitou | 1/1 | 15 s | _fonte (0.2), à mão |
| TR-05 | Sonnet 5.5 (acima) | 1 | nota fiscal | aceitou | 1/1 | 5 s | 06-financeiro (0.97) |
| TR-05 | Sonnet 5.5 (acima) | 2 | ata de acompanhamento | aceitou | 1/1 | 9 s | 05-acompanhamento (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 2 | contrato | aceitou | 1/1 | 9 s | 02-contrato (0.96) |
| TR-05 | Sonnet 5.5 (acima) | 2 | foto sem texto | aceitou | 1/1 | 4 s | _fonte (0.2), à mão |
| TR-05 | Sonnet 5.5 (acima) | 2 | nota fiscal | aceitou | 1/1 | 4 s | 06-financeiro (0.97) |
| TR-05 | Sonnet 5.5 (acima) | 3 | ata de acompanhamento | aceitou | 1/1 | 3 s | 05-acompanhamento (0.95) |
| TR-05 | Sonnet 5.5 (acima) | 3 | contrato | aceitou | 1/1 | 7 s | 02-contrato (0.96) |
| TR-05 | Sonnet 5.5 (acima) | 3 | foto sem texto | aceitou | 1/1 | 3 s | _fonte (0.2), à mão |
| TR-05 | Sonnet 5.5 (acima) | 3 | nota fiscal | aceitou | 1/1 | 4 s | 06-financeiro (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 1 | ata de acompanhamento | aceitou | 1/1 | 4 s | 05-acompanhamento (0.92) |
| TR-05 | Haiku 5.5 (cadastro) | 1 | contrato | aceitou | 1/1 | 4 s | 02-contrato (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 1 | foto sem texto | aceitou | 1/1 | 4 s | _fonte (0.1), à mão |
| TR-05 | Haiku 5.5 (cadastro) | 1 | nota fiscal | aceitou | 1/1 | 7 s | 06-financeiro (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 2 | ata de acompanhamento | aceitou | 1/1 | 5 s | 05-acompanhamento (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 2 | contrato | aceitou | 1/1 | 6 s | 02-contrato (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 2 | foto sem texto | aceitou | 1/1 | 3 s | _fonte (0.1), à mão |
| TR-05 | Haiku 5.5 (cadastro) | 2 | nota fiscal | aceitou | 1/1 | 4 s | 06-financeiro (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 3 | ata de acompanhamento | aceitou | 1/1 | 4 s | 05-acompanhamento (0.9) |
| TR-05 | Haiku 5.5 (cadastro) | 3 | contrato | aceitou | 1/1 | 3 s | 02-contrato (0.95) |
| TR-05 | Haiku 5.5 (cadastro) | 3 | foto sem texto | aceitou | 1/1 | 3 s | _fonte (0.1), à mão |
| TR-05 | Haiku 5.5 (cadastro) | 3 | nota fiscal | aceitou | 1/1 | 3 s | 06-financeiro (0.95) |
| TR-07 | Sonnet 5.5 (acima) | 1 | resumo do dia de uma pessoa (2 vencidas, 1 parada) | aceitou | 3/3 | 3 s | 159 caracteres |
| TR-07 | Sonnet 5.5 (acima) | 2 | resumo do dia de uma pessoa (2 vencidas, 1 parada) | aceitou | 3/3 | 6 s | 174 caracteres |
| TR-07 | Sonnet 5.5 (acima) | 3 | resumo do dia de uma pessoa (2 vencidas, 1 parada) | aceitou | 3/3 | 4 s | 190 caracteres |
| TR-07 | Haiku 5.5 (cadastro) | 1 | resumo do dia de uma pessoa (2 vencidas, 1 parada) | aceitou | 3/3 | 3 s | 143 caracteres |
| TR-07 | Haiku 5.5 (cadastro) | 2 | resumo do dia de uma pessoa (2 vencidas, 1 parada) | aceitou | 3/3 | 6 s | 116 caracteres |
| TR-07 | Haiku 5.5 (cadastro) | 3 | resumo do dia de uma pessoa (2 vencidas, 1 parada) | aceitou | 3/3 | 3 s | 142 caracteres |
| TR-08 | Sonnet 5.5 (acima) | 1 | lote de 5 pendências | aceitou | 5/5 | 3 s | 5 item(ns) lidos |
| TR-08 | Sonnet 5.5 (acima) | 2 | lote de 5 pendências | aceitou | 5/5 | 6 s | 5 item(ns) lidos |
| TR-08 | Sonnet 5.5 (acima) | 3 | lote de 5 pendências | aceitou | 5/5 | 6 s | 5 item(ns) lidos |
| TR-08 | Haiku 5.5 (cadastro) | 1 | lote de 5 pendências | aceitou | 5/5 | 6 s | 5 item(ns) lidos |
| TR-08 | Haiku 5.5 (cadastro) | 2 | lote de 5 pendências | aceitou | 5/5 | 4 s | 5 item(ns) lidos |
| TR-08 | Haiku 5.5 (cadastro) | 3 | lote de 5 pendências | aceitou | 5/5 | 4 s | 5 item(ns) lidos |
| TR-09 | Opus 5.5 (cadastro) | 1 | tarefa grande de implantação | aceitou | 5/5 | 9 s | 5 subtarefa(s), 1 para agente, 0 aviso(s) |
| TR-09 | Opus 5.5 (cadastro) | 2 | tarefa grande de implantação | aceitou | 5/5 | 10 s | 5 subtarefa(s), 1 para agente, 0 aviso(s) |
| TR-09 | Opus 5.5 (cadastro) | 3 | tarefa grande de implantação | aceitou | 5/5 | 14 s | 5 subtarefa(s), 1 para agente, 0 aviso(s) |
| TR-11 | Opus 5.5 (acima) | 1 | print sem texto | aceitou | 1/1 | 6 s | 07-evidencias (0.5), à mão |
| TR-11 | Opus 5.5 (acima) | 1 | proposta revisada (versão nova) | aceitou | 1/1 | 4 s | 01-comercial (0.9) |
| TR-11 | Opus 5.5 (acima) | 1 | relatório de entrega com nome genérico | aceitou | 1/1 | 9 s | 04-entrega (0.9) |
| TR-11 | Opus 5.5 (acima) | 2 | print sem texto | aceitou | 1/1 | 5 s | 07-evidencias (0.55), à mão |
| TR-11 | Opus 5.5 (acima) | 2 | proposta revisada (versão nova) | aceitou | 1/1 | 4 s | 01-comercial (0.9) |
| TR-11 | Opus 5.5 (acima) | 2 | relatório de entrega com nome genérico | aceitou | 1/1 | 3 s | 04-entrega (0.9) |
| TR-11 | Opus 5.5 (acima) | 3 | print sem texto | aceitou | 1/1 | 8 s | _fonte (0.3), à mão |
| TR-11 | Opus 5.5 (acima) | 3 | proposta revisada (versão nova) | aceitou | 1/1 | 4 s | 01-comercial (0.9) |
| TR-11 | Opus 5.5 (acima) | 3 | relatório de entrega com nome genérico | aceitou | 1/1 | 6 s | 04-entrega (0.9) |
| TR-11 | Sonnet 5.5 (cadastro) | 1 | print sem texto | aceitou | 0/1 | 3 s | 07-evidencias (0.6) |
| TR-11 | Sonnet 5.5 (cadastro) | 1 | proposta revisada (versão nova) | aceitou | 1/1 | 5 s | 01-comercial (0.85) |
| TR-11 | Sonnet 5.5 (cadastro) | 1 | relatório de entrega com nome genérico | aceitou | 1/1 | 8 s | 04-entrega (0.93) |
| TR-11 | Sonnet 5.5 (cadastro) | 2 | print sem texto | aceitou | 0/1 | 6 s | 07-evidencias (0.6) |
| TR-11 | Sonnet 5.5 (cadastro) | 2 | proposta revisada (versão nova) | aceitou | 1/1 | 6 s | 01-comercial (0.9) |
| TR-11 | Sonnet 5.5 (cadastro) | 2 | relatório de entrega com nome genérico | aceitou | 1/1 | 3 s | 04-entrega (0.93) |
| TR-11 | Sonnet 5.5 (cadastro) | 3 | print sem texto | aceitou | 0/1 | 3 s | 07-evidencias (0.6) |
| TR-11 | Sonnet 5.5 (cadastro) | 3 | proposta revisada (versão nova) | aceitou | 1/1 | 3 s | 01-comercial (0.85) |
| TR-11 | Sonnet 5.5 (cadastro) | 3 | relatório de entrega com nome genérico | aceitou | 1/1 | 4 s | 04-entrega (0.93) |
