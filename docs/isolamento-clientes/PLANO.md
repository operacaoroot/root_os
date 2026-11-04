# Isolamento por cliente no ROOT OS

Data: 04/11/2026 (UTC). Solicitação de Pedro: adaptar o isolamento do FinOps, planejar tarefas/modelos, criar testes antes e desenvolver a melhoria.

## Decisão

`Org` continua sendo a organização contratante. `Partner` é o cadastro canônico do cliente operacional. Papel define a ação; perfil e vínculo definem os clientes acessíveis. O seletor apenas escolhe a tela: toda autorização ocorre na API.

Perfil explícito `ALL` permite visão ampla; `SELECTED` exige vínculo ativo ao cliente. Perfil ausente nega acesso. Novos usuários não recebem visão ampla automaticamente. A migração registra `ALL` somente para usuários ativos já existentes, preservando o acesso organizacional que tinham. Administração exige `admin_master` atual e visão ampla. O trabalho interno usa um Partner real; registros sem cliente continuam em “Sem classificação”, restritos à visão ampla.

## Lotes e modelos

| Tarefa | Modelo | Entrega e dependência |
| --- | --- | --- |
| Mapear FinOps e ROOT | GPT-6.1 Sol, high | Leitura de memberships, filtros, modelos e caminhos de vazamento; concluída sem alterar FinOps |
| Revisar arquitetura e limites | GPT-6 Astra, high | Contrato de escopo e riscos de MCP, jobs e banco; revisão inicial concluída |
| Modelo comum, migração e integração | Coordenador Codex | Perfil, vínculo, FKs por organização, autorização e contenção das rotas ainda não adaptadas |
| Cofre e depósitos | GPT-6.1 Terra, high | Testes negativos antes do código; CRUD, anexos, emissão, revogação, recebimento e CLI |
| Interface | GPT-6.1 Sol, high | Testes antes do código; seleção do cliente, criação vinculada e descarte de respostas antigas |
| Revisão e aceite técnico | GPT-6 Astra + coordenador | Revisão independente, Postgres descartável, build, verificação HTTP e publicação recuperável |
| Trabalho e arquivos | GPT-6.1 Terra + revisão Astra | Próximo lote: tarefa/subtarefa, pasta, anexos, busca, totais e URLs de download; depende do núcleo validado |
| Comercial e financeiro | GPT-6.1 Terra + revisão Astra | Próximo lote: ficha/lead, contratos, transações, relatórios e relações herdadas |
| Contexto, agentes e integrações | GPT-6 Astra (desenho), Terra (código) | Próximo lote: ator e cliente em jobs, revalidação no retry, busca vetorial, MCP e ferramentas |
| Papel restrito do banco | GPT-6 Astra + coordenador | Cobrir caminhos de plataforma pendentes, testar papel efetivo e ativar restrição; não creditar RLS antes disso |

## Aceite do primeiro lote

1. Usuário de A não lista, revela, altera, apaga nem baixa arquivos de B, inclusive conhecendo IDs; organizações distintas permanecem isoladas.
2. Revogar vínculo vale na próxima operação com o mesmo JWT e a mesma sessão do cofre. Sem perfil ou sem vínculos não há acesso implícito.
3. Novos itens/links recebem um cliente canônico ativo do mesmo Org, validado no servidor. Cliente interno e legado não se confundem.
4. Depósito público deriva o destino da linha travada e revalida o emissor; preserva prazo, recibos, idempotência e criptografia. O link JUMA não será reemitido nem terá validade renovada.
5. Usuários restritos não entram em APIs ainda organizacionais (incluindo auditoria e agentes). Métodos adaptados são declarados individualmente.
6. Trocar cliente limpa segredos, anexos e formulários; respostas pendentes do cliente anterior não reaparecem.
7. Migração aditiva, cópia de segurança antes da publicação, evidências de testes e build. Rollback não pode reabrir acesso org-wide depois de ativar usuários restritos.

## Limites e sequência de expansão

O primeiro lote protege o cofre e contém acesso restrito ao restante. Não afirma que Trabalho, Financeiro, Comercial, Contexto ou execução de agentes já oferecem operação por carteira. Cada lote posterior só libera seus métodos após testes de filhos, relações, agregações, exportações, buscas e execução em segundo plano.

Produção usa papel superusuário e `TENANT_MODO=observar`: as políticas RLS atuais não limitam esse papel. A API deve impor o escopo mesmo nessa condição. FKs compostas continuam sendo verificadas pelo banco. Não trocar o papel produtivo sem cobrir os caminhos de plataforma pendentes.

O MCP tem chamadas `apiGet()` pela conta de serviço, independentemente do operador: não distribuir uma conta ampla como acesso de usuário restrito. Contas e execuções de sistema mantêm escopo explicitamente operacional até sua adaptação. Jobs antigos não se tornam restritos apenas porque a entrada HTTP foi bloqueada.

## Migração dos dados

Adicionar clienteId nullable, sem classificar pelo título. Vincular depósitos existentes somente após identificar o Partner correto; vincular itens pelos recibos e pela referência exata ao depósito, sob a mesma trava. Casos ambíguos ficam sem classificação. Preservar ids, hash do token, vencimento, contadores, AAD e ciphertext. Não apagar senhas ao encerrar link.

## Referência FinOps

Leitura local em `/Users/pedro/Library/Projetos/FinOps5.0`, sem testes ou acesso à produção. Referências: `20260918130850_empresa_interna_so_o_email.sql` (ação versus carteira), `20260825210000_guard_multitenant_rpcs.sql` (validar também o recurso), `ACH-018-SEC-vazamento-cross-tenant-user-companies.md` (revogação com resíduo legado), `ACH-024-SEC-residuo-user-companies-no-with-check.md` (INSERT e WITH CHECK). Lacunas identificadas em jobs e identidade MCP não foram copiadas como comportamento desejado.

## Integração com a publicação de 04/11/2026

A produção avançou para `rootos-official:etapa5-7396c26` durante a validação. Foi integrado o commit exato `7396c26f99ab121ee53a78c438438d34e8bf5a65`, preservando Comercial, Financeiro e a migration `20261103230000_dinheiro_do_contrato`. O schema foi mesclado sem conflito. A Etapa 6, encontrada no checkout de integração, não foi incluída porque ainda não era a versão publicada. A imagem de isolamento deve partir da Etapa 5 e o deploy deve recusar mudança de base posterior.

## Modelos de dados por lote

| Lote | Modelos e regras |
| --- | --- |
| Núcleo e cofre, implementados | `Org` e `User` mantidos; `Partner` canônico; `ClienteAcessoPerfil` por usuário/org; `ClienteAcessoVinculo` por usuário/org/cliente; `CofreItem.clienteId` e `CofreDeposito.clienteId` com FK composta; recibos preservados |
| Trabalho e arquivos | `WorkTask.clienteId` como destino; filhos herdam o cliente do pai; pastas, listas e anexos precisam de regra explícita para agrupamentos; `ArquivoDoCliente.partnerId` limitado à carteira |
| Comercial e Financeiro | `ComercialFicha`, `ComercialContrato`, `AcordoComercial`, `Contract` e `FinanceTransaction` vinculados ao Partner, com validação dos pais e filtro em totais/relatórios; preservar a integração financeira já publicada |
| Contexto e busca | Definir cliente nos registros de contexto e fazer versões, anexos, índice vetorial e resultados herdarem a autorização; conteúdo sem classificação permanece reservado à visão ampla |
| Agentes, jobs e MCP | Contexto persistido com organização, cliente e ator; revalidação na execução/retry; chaves de idempotência por cliente; conta de sistema não substitui silenciosamente o operador |
| Banco restrito | Papel sem superusuário/BYPASSRLS, contexto transacional validado e políticas que combinem organização e carteira; execução com o papel real deve provar leitura e escrita negadas |

O provisionamento do primeiro administrador de uma organização nova cria seu perfil `ALL` explicitamente, na mesma transação. A regra não alcança usuários comuns nem amplia uma carteira `SELECTED` em reconfigurações posteriores. Uma falha ao criar o perfil desfaz também a criação da organização e do usuário.
