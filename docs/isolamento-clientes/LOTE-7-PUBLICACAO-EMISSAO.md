# Lote 7 — publicação da Sala e emissão de contratos

Continuação autorizada em 04/11/2026. Base: `85a2d12bb25169328660a75ac9c6f345c1e299b8`, PR #49. Branch `codex/isolamento-clientes-lote7`, checkout `/Users/pedro/Library/Projetos/root-os-clientes-contexto`. Trabalho isolado; integração com Lucas e publicação não fazem parte desta rodada.

## Tarefas e modelos

| Responsabilidade | Modelo | Prova necessária |
| --- | --- | --- |
| Conferir entradas ainda contidas | Explorador | Nenhuma mutação SELECTED liberada implicitamente |
| Sala, itens publicados e repetição do pedido | GPT-6.1 Sol, high | Estado, versão, aprovação e cliente exatos; origem do trilho verificável; publicação atômica |
| Emissão pelo registro e pelo aceite, retorno da assinatura | GPT-6.1 Terra, high | Origem atual antes de PDF/provedor; cadeia de contrato coerente; retorno ligado ao documento correto |
| Guarda comum, Porta, catálogo e integração | Coordenador Codex | Aprovação e ator persistidos, recusa antes do consumo, testes de uso único e token |
| Revisão independente | GPT-6 Astra, high | Revogação, troca de cliente, relações cruzadas e limites dos efeitos externos |

## Contrato e critérios de aceite

1. Cada pedido registra `clienteId`, inclusive null explícito quando o lead ainda não tem cliente. O cliente vem da ficha canônica; o argumento não concede acesso. O hash da aprovação inclui o objeto `origemCliente:{versao:1,clienteId}`, que preserva o null interno e distingue a origem nova de argumentos legados. Mudança posterior impede o efeito. Legado sem snapshot exige novo pedido, sem preenchimento por inferência.
2. Proponente vem de Approval/ToolCall, com organização, capacidade, recurso, argumentos e backlink coerentes. Usuários precisam continuar ativos, ALL e com permissão. O aprovador também é conferido. R4 exige pessoas distintas. Sistema conhecido não pode substituir uma iniciativa humana expirada.
3. Botão de aprovação e token conferem acesso antes de consumir. O efeito repete a conferência após esperas relevantes. ID de aprovação fornecido pelo chamador não é autoridade. Sala mantém aprovação individual R3/R4; emissão mantém R4.
4. Sala exige a versão ainda vinculada à aprovação. Regravar conteúdo idêntico não preserva autorização descartada. Retorno idempotente também exige autorização atual. Item não pode virar publicação da sala inteira. Trilho deriva sua propriedade da tarefa vinculada, não do nome.
5. Emissão confere registro, pai, minuta, signatários, lead e cliente antes da saída. Os dois caminhos de emissão são cobertos. Repetir contrato não cria cobrança nem troca o registro solicitado.
6. Retorno legítimo de assinatura registra um fato já ocorrido, mesmo após revogação do proponente. Precisa corresponder à organização, lead, provedor e ID externo; não reabre documento cancelado. Cópia derivada continua sujeita às guardas do lote 6.
7. O preparo automático da mensagem M7 com links de assinatura fica suspenso: seu caminho atual usa sistema sem transportar a origem da emissão. O retorno informa a pendência; documento e fatos do provedor são preservados. A adaptação da mensagem é um próximo recorte próprio.
8. Não liberar escritas SELECTED, alterar permissões reais, enviar arquivos reais ou operar provedores externos. Todos os testes usam banco descartável e conectores simulados.

## Testes e evidências

Os testes precedem cada alteração de comportamento. Reproduções iniciais: emissão após restrição do proponente; pedido sem cliente; Sala publicada com aprovação descartada apesar do hash igual; proponente inativo; consumo por botão/token sem revalidação; callback com documento divergente ou cancelado. Logs locais em `/tmp/root-clientes-lote7/`.

Revisão adicional reproduziu políticas que omitiam o cliente do hash, null acrescentado ao legado, revogação durante PDF, alçada rebaixada com permissão mantida e perda de autoridade do signatário Root. Cada correção recebeu teste negativo antes do código.

Validação local final: 422 testes em 23 arquivos, mais 10 casos da jornada comercial e 118 testes de políticas; tipos dos 12 arquivos de teste alterados e dependências transitivas; build da API; boot do AppModule compilado, com a guarda injetada e seis rotas respondendo 401. A migration aplicou no banco descartável existente e do zero; comparação com schema sem diferença. Logs: `focal-final.log`, `policy.log`, `types-final.log`, `types-jornada-green.log`, `jornada-green.log`, `build-final.log`, `boot-final.log` e `migration-diff.log`. A revisão independente não encontrou bloqueio restante no diff final. CI e SHA serão registrados no PR. Os testes não comprovam integração real com ZapSign nem publicação em produção.

## Migration

`SalaVersao.origemCliente` é JSON privado e nullable, com formato versionado. Não há backfill. Rascunhos e pedidos antigos sem origem exigem revisão e salvamento explícitos; publicar não preenche essa coluna em uma linha legada. Versões publicadas e histórico permanecem preservados. A migration foi ensaiada em banco descartável e não foi aplicada em produção.

## Dependências posteriores

Decisões comerciais ainda perdem a identidade no retry; a régua de contratos importados ainda não revalida o autor do evento. Respostas do Assistente, publicação de propostas/descontos, contexto, busca e MCP são caminhos próprios. Este lote não os libera nem declara o programa de isolamento concluído.

Antes de publicar, conferir a versão corrente de Lucas, interseções e catálogo efetivo. A mudança do catálogo exige o procedimento de autoria já previsto no seed. Não substituir a imagem atual por uma imagem construída sobre esta base sem reconciliação.

Banco e provedor externo não compartilham transação: revogação impede a próxima chamada, mas não desfaz uma chamada já iniciada. Conservar fatos do provedor e tratar resultado desconhecido explicitamente; não repetir automaticamente uma operação financeira.
