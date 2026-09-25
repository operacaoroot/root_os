# Madrugada — supervisão econômica pelo Codex

Preparado em 17/09/2026. **Plano pronto; automação ainda não ativada.**
Executor: [workflow do Claude](WORKFLOW-MADRUGADA-CLAUDE.md).

## Modelo e custo

Esta sessão foi configurada na interface como **gpt-5.6-luna, medium**, com Fast
desligado (`Service tier set to default`). A escolha usa a opção apresentada como
econômica no seletor, não uma estimativa de preço por token. Vale para próximas
interações; não transforma retroativamente o trabalho já realizado.

Luna é o padrão para ler status/diff/testes, responder decisões já registradas,
detectar desvios e pedir reprodução mínima. Não reduzir para raciocínio baixo só
para economizar: o acompanhamento envolve scripts de deploy e fronteiras de acesso.

Escalada proposta: no máximo duas tentativas fundamentadas por dúvida; persistindo,
preparar pacote curto (pergunta, decisão vigente, diff e teste falho) e recomendar uma
consulta pontual ao `gpt-5.6-sol`. Segurança/migração sem evidência suficiente fica
bloqueada para revisão, não é liberada porque um modelo maior concordou. Não trocar
automaticamente para modelo caro nem abrir agentes em paralelo nesta primeira noite.

Não atribuir limite financeiro fictício: o plano/assinatura e orçamento não foram
medidos. Economia vem de contexto curto, execução serial, Fast desligado e invocações
por mudança útil — não de uma promessa de custo que não foi verificada.

## Contexto mínimo e política de resposta

Ler inicialmente `CLAUDE.md`, `PLANO-PRODUTO.md` e o workflow. Depois, apenas alterações,
perguntas novas e arquivos citados. Consultar notas específicas do Obsidian/Drive
somente se houver dúvida de negócio não coberta pelas decisões já confirmadas; citar
nota/data, separar evidência de inferência e não enviar um vault inteiro ao Claude.

Ordem: instruções atuais do Pedro → decisões confirmadas do plano vigente/ADRs →
evidência atual do código/testes → histórico. Conflito de autoridade ou nova decisão
de negócio é pergunta humana, não oportunidade para inventar requisito.

| Tipo de dúvida | Conduta |
|---|---|
| Já decidida (ex.: MCP, local × VPS) | responder com a decisão e seção de origem |
| Técnica, reversível, dentro de P1 | inspecionar reprodução/diff, propor menor correção e teste de aceite |
| Falta de evidência | pedir teste discriminante; não tratar suposição como fato |
| Credenciais, publicação, dados reais, acesso ou escopo maior | marcar `AGUARDA_PEDRO`; continuar apenas frentes independentes |
| Falha repetida sem avanço | recomendar escalada pontual ou registrar bloqueio; impedir loop de tentativas |

## Caixa de comunicação simples

Diretório: [operacao/madrugada-2026-09-17](operacao/madrugada-2026-09-17/).

- Claude escreve `STATUS-CLAUDE.md`, `DUVIDAS.md`, manifesto e relatório.
- Codex escreve `STATUS-CODEX.md` e `RESPOSTAS.md`.
- Não editar simultaneamente o arquivo do outro. Pergunta tem ID `Q-001`, horário,
  etapa, evidência, alternativas e o que bloqueia. Resposta referencia o mesmo ID,
  fonte, ação/teste e classificação: `ORIENTACAO`, `PEDIR_EVIDENCIA` ou `AGUARDA_PEDRO`.
- Claude registra no próprio status a última resposta consumida. Silêncio não é aceite.
- Codex não altera código enquanto Claude trabalha. Para assumir uma correção,
  combinar cessão explícita de arquivos e verificar que o executor parou naquela fatia.

Se for necessário comunicar pela interface: enviar texto no terminal correto e
verificar o prompt efetivamente recebido/ack. Um retorno de sucesso de `setValue`
no campo do terminal não prova envio; usar digitação/colagem e confirmar visualmente.
Não criar sessões duplicadas como solução para uma mensagem que não foi entregue.

## Ciclo de acompanhamento

Proposta para a janela aprovada: verificação a cada 15 minutos, serial, sem sobreposição.
Com 02:00–07:00, no máximo 20 ciclos regulares, mais um fechamento. Sem mudança de
status/pergunta/evidência, o precheck do agendador deve pular a chamada ao modelo.
Cada ciclo usa checkpoint de última pergunta/respondida e última revisão do status.

1. Confirmar janela, workspace, modelo e ausência de execução concorrente do supervisor.
2. Ler deltas de `STATUS-CLAUDE.md` e `DUVIDAS.md`; verificar respostas já consumidas.
3. Responder perguntas pendentes com referência concreta. Revisar diff/testes apenas
   da etapa que mudou, sem reler todas as suítes e logs.
4. Se Claude está executando comando legítimo, não interromper por falta de mensagem.
   Sem progresso e sem comando ativo por dois ciclos, enviar **um** pedido de retomada
   com próximo passo específico; confirmar recebimento. Persistindo, registrar bloqueio.
5. Atualizar `STATUS-CODEX.md`: etapa, decisão, evidência, pendência, próximo check.
6. Ao atingir portão humano, não insistir em pedir autorização ao Claude. Ao fim da
   janela, consolidar relatório e encerrar os disparos.

Sem pré-check confiável no agendador, usar disparos limitados explícitos; não alegar
“sem custo quando ocioso”. Não implementar um daemon de agentes para este acompanhamento.

## Ativação e teste obrigatório antes de deixar rodando

O Orca oferece Automations no host Local Mac. A inspeção não criou automação.
Preparar documentos não agenda execução e esta sessão não fica monitorando depois
de responder sem um mecanismo de recorrência ativo.

Checklist da ativação:

- [ ] Confirmar janela futura e encerramento único; não deixar cron diário indefinido.
- [ ] Executor usa a sessão Claude existente e este workspace, não `main` por padrão.
- [ ] Supervisor usa o mesmo conjunto de arquivos; não recebe worktree novo sem a caixa.
- [ ] Verificar modelo **do job**: trocar esta sessão não garante modelo de novas sessões.
- [ ] Configurar precheck, checkpoint e exclusão mútua; testar que não muda produção.
- [ ] Manter Mac ligado/acordado, Orca disponível e rede; suspender o Mac interrompe o fluxo.
- [ ] Disparar Q-TEST e observar pergunta → resposta → confirmação do Claude de ponta a ponta.
- [ ] Somente após esse teste registrar os IDs, horários e estado dos agendamentos em
      `STATUS-CODEX.md`; se não funcionar, declarar acompanhamento não ativo.

## Prompt do supervisor

```text
Execute um ciclo de docs/ACOMPANHAMENTO-MADRUGADA-CODEX.md.
Leia os deltas na caixa docs/operacao/madrugada-2026-09-17/ e responda somente perguntas novas.
Use decisões confirmadas em docs/PLANO-PRODUTO.md e evidência do código/testes.
Você orienta o Claude, não autoriza produção, publicação, dados reais nem amplia acesso.
Não edite o código que o Claude está alterando. Atualize RESPOSTAS.md e STATUS-CODEX.md.
Se não houver mudança útil, registre checkpoint sem inventar tarefa. Respeite o fim da
janela. Não declare monitoramento contínuo se esta for apenas uma chamada avulsa.
```
