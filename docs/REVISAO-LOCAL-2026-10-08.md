# ROOT OS — branch de revisão de 08/10/2026

Branch: `entrega/root-os-2026-10-08`. Base: `18e3421e2b6c78466ea1c542e05664c582565c11`.

Esta entrega reúne as alterações locais desta janela. Pedro assumiu os testes finais. A branch é um candidato para revisão; as seis frentes do pedido original ainda têm pendências.

## Alterações reunidas

- Síntese local: limita o conteúdo enviado ao modelo, confere modelo e término da resposta, conserva o consumo observado e recusa saídas inválidas sem gravar o texto recusado.
- Comercial e Financeiro: o aceite de exercício pode abrir um projeto operacional ligado a Trabalho e uma obrigação financeira planejada. A decisão tem seu próprio pedido, versão e alçada. Recuperação e repetição conservam os vínculos já registrados.
- Isolamento: sete caminhos técnicos de plataforma resolvem a empresa antes de consultar ou gravar dados. A revisão não libera a aplicação inteira com papel restrito.
- Trabalho: edição interna passa a exigir a versão esperada antes de consultar a tarefa; o conflito de uma edição antiga continua sendo recusado.
- Contexto: o integrador registra o catálogo de uma coleção e seus membros; a consulta devolve metadados do pertencimento conferido. Esta etapa não implementa movimento de arquivos nem aliases.

## Como observar as mudanças

| Tela ou caminho | O que conferir |
| --- | --- |
| `/trabalho` | Histórico paginado, responsável e edição conservando a versão da tarefa. |
| `/contexto` e `/agentes` | Fonte e versão selecionadas, resultado do procedimento, modelo, consumo e recuperação do pedido. O modelo local precisa estar configurado e disponível. |
| `/leads` | Criar uma oportunidade de exercício, registrar proposta e aceite; abrir o projeto pela ponte. Essa rotina exige `ROOTOS_QA_PREVIEW=1` e origem de exercício válida. |
| `/financeiro` | Abrir a obrigação planejada da ponte e registrar a decisão com a pessoa autorizada. Esta obrigação não executa pagamento, cobrança ou conciliação. |
| `GET /api/knowledge/colecao/itens/:itemId` | Consultar catálogo autorizado; distinguir seleção histórica conferida e situação da captura mais recente. A coleção precisa ter passado pelo integrador. |

## Preparação do ambiente de revisão

O código usa as dependências e o banco configurados para o ambiente local. As duas migrations novas são aditivas:

- `20261008183000_comercial_ponte_exercicio`
- `20261008193000_catalogo_de_colecao`

Elas não foram aplicadas a um banco nesta entrega. Para testar, use uma cópia do banco, conserve o backup anterior e aplique as migrations somente nessa cópia. Não use `migrate reset` nem seeds de limpeza para preparar a revisão.

Com Node 22 ou superior e as dependências instaladas, gere o client Prisma e compile `@mktos/shared`, `@mktos/policy` e `@mktos/api`. O web usa `API_PROXY_TARGET` para chegar à API. A configuração habitual desta cópia local usa web em `127.0.0.1:4270` e API em `127.0.0.1:4271`; isso identifica os endereços esperados, sem afirmar que os processos estejam ativos.

A configuração privada de QA e os backups permanecem fora do Git. O código da API carrega configurações locais de provedores no início; para um ensaio sem efeitos externos, mantenha o launcher isolado desta cópia e as rotinas de integração desativadas. Não copie credenciais reais para a branch.

## Estado das provas e pendências

Antes de Pedro assumir os testes, a síntese, a ponte e os sete caminhos de plataforma receberam provas unitárias e revisões separadas; a interface da ponte teve 69 casos de componentes aprovados e checagem de tipos. Essas provas têm escopo sintético. Duas chamadas ao adaptador do modelo local produziram recibos; a segunda condensou a fonte corretamente para aquela fixture. Isso ainda não encerra o percurso completo de procedimento, banco e recuperação.

As correções finais de Trabalho e do catálogo passaram por revisão estática. A validação do schema, a geração do client Prisma, o build de shared/API e a checagem de tipos do web passaram. Não há novo aceite por PostgreSQL, navegador, concorrência, restauração ou papel restrito nesta entrega.

A checagem global de tipos das fixtures da API ainda aponta quatro diagnósticos em `financeiro-exercicio.test.ts`, `leads-proposta.test.ts`, `teto-custo-ia.test.ts` e `vault-colecao.test.ts`. As chamadas e assinaturas que causam esses diagnósticos foram conferidas por leitura e já estavam na base `18e3421`; o comando global continua falhando. Nenhum teste foi executado depois que Pedro assumiu essa etapa.

Continuam abertas:

- Política de destino da saúde financeira e política de sessão no retorno OAuth de Bio; os caminhos dependentes e a liberação geral do papel restrito aguardam essas decisões.
- Movimento explícito, aliases, Drive com acesso por pessoa, agenda, gatilhos e ferramentas necessários para encerrar Contexto/Agentes.
- Identificação do ROOT-001 e prova de conservação dos dez commits de Lucas nesta cópia; os documentos anteriores não substituem a prova atual.
- OAuth, publicação, métricas e transição real das integrações, que precisam de seus acessos e autorizações próprios.
- Testes finais assumidos por Pedro. Nenhuma implantação de produção faz parte desta branch.
