# Lote 5 — autorização das pastas e arquivos em segundo plano

04/11/2026. Continuação solicitada por Pedro, com testes antes do código. Após informar que não sabe a frente atual do Lucas, Pedro orientou: “Não sei; siga isolado”. Este lote é desenvolvido e validado em checkout próprio; não publica a aplicação nem modifica dados de produção.

## Base e convivência com Lucas

- Base: `c61f1f47a93aa466f9083d2b4def1e446e7fe027`, lote 4 publicado e CI aprovado no run `41889724660`.
- Checkout desta entrega: `/Users/pedro/Library/Projetos/root-os-clientes-contexto`, branch `codex/isolamento-clientes-lote5`.
- Fonte de integração do Lucas observada, somente por leitura: `/srv/rootos/builds/integracao`, commit `5dcd491808e52cae4acc90e4a82143bcf678372a`, Etapa 9b. Há arquivos operacionais não rastreados nesse checkout; nenhum foi editado ou removido.
- A Etapa 9b alcança Marketing, tema, navegação, Comercial e seu painel. Este lote não altera interface, esses módulos, Prisma/migrations ou scripts de publicação. Não faz merge ou cherry-pick dos commits ainda em elaboração do Lucas.
- Antes de futura integração, conferir novamente runtime, SHA de Lucas, árvore de trabalho e interseção de arquivos. A fotografia acima não reserva nem congela o trabalho dele. Não usar a imagem antiga como base de publicação se a produção tiver avançado.

## Recorte e modelos

O próximo bloco do plano inclui Contexto, agentes e integrações. A inspeção mostrou que `ContextItem` e `KnowledgeNote` ainda não possuem cliente proprietário. Ligar uma fonte a uma tarefa não prova que o conteúdo pertence ao cliente da tarefa. Essas leituras continuam contidas para `SELECTED`; a futura classificação precisa de modelo explícito, sem inferência por título ou caminho.

Este recorte protege duas capacidades com proprietário identificável: `drive.pasta.criar` e `drive.arquivo.enviar`. Reutiliza `Approval`, `ToolCall`, `ArquivoDoCliente`, `Partner`, `User`, `ClienteAcessoPerfil` e as relações `WorkAnexo`/`WorkTask`. Não cria classificação automática, carteira, conta ou concessão.

| Responsabilidade | Modelo | Arquivos e prova |
| --- | --- | --- |
| Desenho e revisão independente | GPT-6 Astra, high | Identidade persistida, hash, legado, retries e limites de concorrência |
| Helper e serviços de arquivos/pastas | GPT-6.1 Terra, high | Testes negativos, preservação do originador, revalidação antes dos conectores |
| Consumo da aprovação e transporte de contexto | GPT-6.1 Sol, high | Preflight das duas capacidades, ID da aprovação realmente consumida, uso único |
| Integração, PostgreSQL, documentação e CI | Coordenador Codex | Banco descartável, registros reais de aprovação/carteira e verificação da branch isolada |

## Contrato de autorização

1. O originador vem dos registros persistidos, não de quem classificou, aprovou ou disparou o retry. Usuário ausente ou inativo nunca vira `system`.
2. Para humanos, este lote exige perfil atual `ALL`, usuário ativo e permissões atuais. Os POSTs restritos continuam bloqueados; não se libera uma ação pela fila que ainda não pode ser iniciada por `SELECTED`.
3. Aprovação, ToolCall, organização, capacidade, recurso e hash precisam corresponder. O hash usa o mesmo catálogo efetivo por organização que a Porta. Conferir antes de consumir a aprovação e novamente dentro do efeito.
4. Arquivo mantém originador, proprietário e referência. WorkAnexo exige `tarefas.editar` e cadeia coerente até o cliente. Retry não reclassifica registros nem substitui a pessoa original.
5. Autorizar antes de storage, classificação, proposta, resposta idempotente ou Drive. Repetir a conferência após esperas relevantes e antes da próxima escrita.
6. Origem de sistema precisa de identidade e proveniência coerentes. Registro humano contraditório ou legado sem proveniência suficiente é recusado; não recebe concessão nem backfill implícito.

## Validação e limites

Os primeiros testes reproduziram, antes da correção, a conversão de humano inativo em sistema e a substituição do originador pelo classificador. A validação usa PostgreSQL descartável local e Drive/storage/modelo falsos. Nenhum arquivo é enviado ao Google.

As provas incluem revogação depois da aprovação, perfil ausente, organização/recurso/cliente divergentes, alteração de conteúdo, troca de cliente na tarefa, preservação do token quando o preflight nega e consumo único. A execução final local passou 181 testes em seis arquivos, incluindo 14 casos novos de autorização com PostgreSQL e as regressões de pastas, Arquivista e Porta. Um caso usa uma segunda conexão para alterar cliente, autor e referência durante a espera pelo storage: a atualização condicional recusa o retry e preserva os dados concorrentes, sem criar aprovação ou chamar o Drive.

O build da API e o boot do Nest compilado passaram. O boot usou outro banco descartável com as 141 migrations, segredos sintéticos, conectores simulados e cron desligado. Evidências locais: `/tmp/root-clientes-lote5/focal-final.log`, `postgres.log`, `api-build.log` e `api-boot-proof.json`. O CI da branch será registrado no PR; validação local não equivale a publicação.

Isso não torna PostgreSQL e Drive uma transação única. Uma operação externa já iniciada não pode ser desfeita por revogação posterior; falhas após efeito parcial precisam conservar seu estado e relato. Os produtores automáticos antigos que omitem identidade exigem avaliação explícita antes de futura publicação. Este documento não comprova compatibilidade desses produtores, publicação ou ativação de RLS em produção.

Resultado final e SHA serão registrados no PR deste lote. O ambiente de produção e a mensagem já enviada à JUMA permanecem fora das operações desta rodada.
